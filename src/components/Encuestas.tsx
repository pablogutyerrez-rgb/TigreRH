import React, { useState, useMemo } from 'react';
import { TrainingSurvey, SurveyResponse, Participant, TrainingSession, User, UserRole, SurveyStatus, AttendanceRecord } from '../types';
import {
  ClipboardCheck,
  Plus,
  Play,
  Square,
  Link2,
  Copy,
  Check,
  Search,
  Filter,
  BarChart3,
  MessageSquare,
  ListFilter,
  Download,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  Award,
  Users,
  Building2,
  Eye,
  EyeOff,
  Star,
  RefreshCw,
  Trash2,
  Calendar,
  FileText,
  CheckCircle2,
  UserCheck,
  Mail,
  Send
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Cell
} from 'recharts';
import * as XLSX from 'xlsx';
import { sendSurveyInvitations } from '../services/surveyEmailService';
import { permissions } from '../utils/permissions';
import { isSurveyEligibleParticipant } from '../utils/trainingProgress';
import { getSessionTrainerIds, getSessionTrainerNames, isSessionAssignedTrainer } from '../utils/trainingAssignments';

interface EncuestasProps {
  surveys: TrainingSurvey[];
  responses: SurveyResponse[];
  sessions: TrainingSession[];
  participants: Participant[];
  attendance: AttendanceRecord[];
  users: User[];
  currentUser: User;
  onUpdateSurveyStatus: (surveyId: string, status: SurveyStatus) => void;
  onAddSurvey?: (survey: TrainingSurvey) => void;
  onUpdateSurveyAssignments: (surveyId: string, userIds: string[]) => void;
  onAuditLog: (
    accion: string,
    modulo: string,
    detalle: string,
    campaña?: string,
    generacion?: string,
    partId?: string,
    partName?: string,
    prevVal?: string,
    newVal?: string,
    comment?: string
  ) => void;
  onOpenPublicSurvey: (token: string) => void;
}

export default function Encuestas({
  surveys,
  responses,
  sessions,
  participants,
  attendance,
  users,
  currentUser,
  onUpdateSurveyStatus,
  onAddSurvey,
  onUpdateSurveyAssignments,
  onAuditLog,
  onOpenPublicSurvey
}: EncuestasProps) {
  // --- Tab State ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'comentarios' | 'respuestas' | 'monitoreo' | 'links' | 'configuracion'>('dashboard');

  // --- Filtering State ---
  const [filterCampaign, setFilterCampaign] = useState('');
  const [filterGenerator, setFilterGenerator] = useState('');
  const [filterTrainer, setFilterTrainer] = useState('');
  const [filterType, setFilterType] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [commentKeyword, setCommentKeyword] = useState('');
  const anonymizeTrainers = false;

  // --- Monitoreo Tab Specific Survey Selection State ---
  const [monitoreoSurveyId, setMonitoreoSurveyId] = useState('');

  // --- Survey Creation Modal States ---
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [surveyStatus, setSurveyStatus] = useState<SurveyStatus>('Borrador');
  const [tokenInput, setTokenInput] = useState('');
  const [deleteSurveyId, setDeleteSurveyId] = useState<string | null>(null);
  const [assignmentSurveyId, setAssignmentSurveyId] = useState<string | null>(null);
  const [assignmentUserIds, setAssignmentUserIds] = useState<string[]>([]);

  // Copy Feedback state
  const [copiedSurveyId, setCopiedSurveyId] = useState<string | null>(null);
  const [copiedDniId, setCopiedDniId] = useState<string | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [emailFeedback, setEmailFeedback] = useState('');
  const [viewingResponse, setViewingResponse] = useState<SurveyResponse | null>(null);

  const handleCopyLink = (token: string, surveyId: string) => {
    const origin = window.location.origin + window.location.pathname;
    const url = `${origin}?view=survey&token=${token}`;
    navigator.clipboard.writeText(url);
    setCopiedSurveyId(surveyId);
    setTimeout(() => setCopiedSurveyId(null), 2000);

    onAuditLog(
      'Enlace de encuesta copiado',
      'Encuestas de Satisfacción',
      `Se copió el enlace de encuesta para el token "${token}"`
    );
  };

  // --- SECURITY ROLES AND CLAIMS ---
  const isTrainer = currentUser.rol === 'Formador';
  const isAdmin = currentUser.rol === 'Administrador';
  const isAnalyst = currentUser.rol === 'Analista';
  const isRecruiter = currentUser.rol === 'Reclutador';
  const isStaff = currentUser.rol === 'Coordinador' || currentUser.rol === 'Sistemas';
  const canSendSurveyEmails = isAdmin || isAnalyst || isRecruiter || currentUser.rol === 'Coordinador';

  // --- HELPER FOR ANONYMIZATION ---
  const getTrainerDisplayName = (trainerId: string, trainerName: string) => {
    if (anonymizeTrainers && (isTrainer || isRecruiter)) {
      const hash = trainerId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return `Formador-${1000 + (hash % 9000)}`;
    }
    return trainerName;
  };

  const getSurveySession = (survey: TrainingSurvey) =>
    sessions.find((session) => session.id === survey.training_session_id);

  const getSurveyGenerationCode = (survey: TrainingSurvey) => {
    const session = getSurveySession(survey);
    return session?.generation_code || session?.nombre_generacion || survey.codigo_generacion;
  };

  const normalizeFilterValue = (value?: string) =>
    (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

  const getSurveyEligibleParticipants = (survey: TrainingSurvey) => {
    const sessionAttendance = attendance.filter(
      (record) => record.training_session_id === survey.training_session_id,
    );
    return participants.filter(
      (participant) =>
        participant.training_session_id === survey.training_session_id &&
        isSurveyEligibleParticipant(participant, sessionAttendance),
    );
  };

  const obfuscateDni = (dniVal: string) => {
    if (!dniVal) return '';
    if (dniVal.length <= 4) return '****';
    return dniVal.substring(0, 3) + '*****';
  };

  const getExecutiveLabel = (r: { dni: string; nombre_ejecutivo: string }) => {
    if (isTrainer && anonymizeTrainers) {
      return {
        nombre: 'Ejecutivo Anónimo',
        dni: obfuscateDni(r.dni)
      };
    }
    return {
      nombre: r.nombre_ejecutivo,
      dni: r.dni
    };
  };

  // --- NORMALIZED SURVEY RESPONSES ---
  const normalizedResponses = useMemo(() => {
    return responses.map(r => {
      const survey = surveys.find(s => s.id === r.training_survey_id);
      const session = survey ? getSurveySession(survey) : undefined;
      const currentGenerationCode = survey ? getSurveyGenerationCode(survey) : r.codigo_generacion;
      const q1 = r.q1 !== undefined ? r.q1 : (r.p1 || 0);
      const q2 = r.q2 !== undefined ? r.q2 : (r.p2 || 0);
      const q3 = r.q3 !== undefined ? r.q3 : (r.p3 || 0);
      const q4 = r.q4 !== undefined ? r.q4 : (r.p4 || 0);
      const q5 = r.q5 !== undefined ? r.q5 : (r.p5 || 0);
      const q6 = r.q6 !== undefined ? r.q6 : (r.p6 || 0);
      const q7 = r.q7 !== undefined ? r.q7 : (r.p7 || 0);
      const q8 = r.q8 !== undefined ? r.q8 : (r.p8 || 0);
      
      const sum_8 = q1 + q2 + q3 + q4 + q5 + q6 + q7 + q8;
      const total_score = r.total_score !== undefined ? r.total_score : Number((sum_8 * 1.25).toFixed(2));
      const final_score_20 = r.final_score_20 !== undefined ? r.final_score_20 : Number(((total_score / 50) * 20).toFixed(2));
      
      let classification = r.classification;
      if (!classification) {
        if (final_score_20 >= 18.00) classification = 'Excelente';
        else if (final_score_20 >= 15.00) classification = 'Bueno';
        else if (final_score_20 >= 11.00) classification = 'Regular';
        else classification = 'Crítico';
      }
      
      return {
        ...r,
        campaña: session?.campaña || survey?.campaña || r.campaña || (r as unknown as { campana?: string }).campana || '',
        codigo_generacion: currentGenerationCode || '',
        formador_id: survey?.formador_id || r.formador_id || '',
        formador_nombre: survey?.formador_nombre || r.formador_nombre || '',
        q1, q2, q3, q4, q5, q6, q7, q8,
        total_score,
        final_score_20,
        classification,
        promedio_individual: r.promedio_individual !== undefined ? r.promedio_individual : Number((sum_8 / 8).toFixed(2)),
        comentario_positivo: r.comentario_positivo || '',
        aspecto_mejora: r.aspecto_mejora || ''
      };
    });
  }, [responses, surveys, sessions]);

  // --- ACCESS FILTERED VIEW OF DATA ---
  const visibleSessionIds = useMemo(() => {
    if (isAdmin || isAnalyst || isStaff || isRecruiter) {
      return sessions.map(s => s.id);
    }
    if (isTrainer) {
      return sessions.filter(s => isSessionAssignedTrainer(s, currentUser.id)).map(s => s.id);
    }
    return [];
  }, [sessions, currentUser, isAdmin, isAnalyst, isTrainer, isRecruiter, isStaff]);

  // Only active surveys (excluding deleted ones)
  const visibleSurveys = useMemo(() => {
    return surveys.filter(s =>
      s.estado !== 'Eliminada' &&
      (visibleSessionIds.includes(s.training_session_id) || s.link_assigned_user_ids?.includes(currentUser.id)),
    );
  }, [surveys, visibleSessionIds, currentUser.id]);

  const assignedLinkSurveys = useMemo(() => visibleSurveys.filter((survey) => {
    if (survey.estado !== 'Habilitada') return false;
    if (isAdmin) return true;
    if (survey.link_assigned_user_ids?.includes(currentUser.id)) return true;
    const session = getSurveySession(survey);
    return Boolean(session && isSessionAssignedTrainer(session, currentUser.id));
  }), [visibleSurveys, currentUser.id, isAdmin, sessions]);

  const assignableUsers = useMemo(
    () => users.filter((user) => user.estado === 'Activo' && user.id !== currentUser.id),
    [users, currentUser.id],
  );

  const openAssignmentModal = (survey: TrainingSurvey) => {
    setAssignmentSurveyId(survey.id);
    setAssignmentUserIds(survey.link_assigned_user_ids || []);
  };

  const saveAssignments = () => {
    if (!assignmentSurveyId) return;
    onUpdateSurveyAssignments(assignmentSurveyId, assignmentUserIds);
    setAssignmentSurveyId(null);
  };

  // General filtered responses from non-deleted surveys
  const filteredResponses = useMemo(() => {
    return normalizedResponses.filter(r => {
      const survey = surveys.find(s => s.id === r.training_survey_id);
      if (!survey || survey.estado === 'Eliminada') return false;
      if (!visibleSessionIds.includes(survey.training_session_id)) return false;

      const session = sessions.find(s => s.id === survey.training_session_id);
      const campaign = session?.campaña || survey.campaña || r.campaña;
      const generation = session?.generation_code || session?.nombre_generacion || survey.codigo_generacion || r.codigo_generacion;
      if (filterCampaign && normalizeFilterValue(campaign) !== normalizeFilterValue(filterCampaign)) return false;
      if (filterGenerator && normalizeFilterValue(generation) !== normalizeFilterValue(filterGenerator)) return false;
      if (filterTrainer && (!session || !getSessionTrainerIds(session).includes(filterTrainer))) return false;
      if (filterType && normalizeFilterValue(session?.tipo_capacitacion) !== normalizeFilterValue(filterType)) return false;

      // Date range filter
      if (dateStart) {
        const dResponse = new Date(r.fecha_respuesta);
        const dStart = new Date(dateStart + 'T00:00:00');
        if (dResponse < dStart) return false;
      }
      if (dateEnd) {
        const dResponse = new Date(r.fecha_respuesta);
        const dEnd = new Date(dateEnd + 'T23:59:59');
        if (dResponse > dEnd) return false;
      }

      return true;
    });
  }, [normalizedResponses, surveys, sessions, visibleSessionIds, filterCampaign, filterGenerator, filterTrainer, filterType, dateStart, dateEnd]);

  // VALID RESPONSES ONLY (Habilitada or Cerrada surveys) FOR DASHBOARD CALCULATIONS
  const dashboardResponses = useMemo(() => {
    return filteredResponses.filter(r => {
      const survey = surveys.find(s => s.id === r.training_survey_id);
      return survey && (survey.estado === 'Habilitada' || survey.estado === 'Cerrada');
    });
  }, [filteredResponses, surveys]);

  // --- CALCULATE DASHBOARD STATS AND KPIs ---
  const kpis = useMemo(() => {
    const totalHabilitadas = visibleSurveys.filter(s => s.estado === 'Habilitada').length;
    const totalRespuestas = dashboardResponses.length;

    // Get unique participants assigned to active or closed surveys
    const activeSurveySessionIds = visibleSurveys
      .filter(s => s.estado === 'Habilitada' || s.estado === 'Cerrada')
      .map(s => s.training_session_id);

    const filteredSessionIds = Array.from(new Set(dashboardResponses.map(r => {
      const srv = surveys.find(s => s.id === r.training_survey_id);
      return srv?.training_session_id;
    }).filter(Boolean)));

    const targetSessionIds = filteredSessionIds.length > 0 ? filteredSessionIds : activeSurveySessionIds;

    const totalHabilitadosParticipants = participants.filter(p =>
      targetSessionIds.includes(p.training_session_id) &&
      p.estado_final !== 'No asistió' &&
      p.estado_final !== 'Desistió'
    ).length;

    const porcentajeRespuesta = totalHabilitadosParticipants > 0
      ? Number(((totalRespuestas / totalHabilitadosParticipants) * 100).toFixed(1))
      : 0;

    // Sum averages on 20-point final score scale
    let sumScore20 = 0;
    let sumQ1 = 0, sumQ2 = 0, sumQ3 = 0, sumQ4 = 0, sumQ5 = 0, sumQ6 = 0, sumQ7 = 0, sumQ8 = 0;

    dashboardResponses.forEach(r => {
      sumScore20 += r.final_score_20;
      sumQ1 += r.q1;
      sumQ2 += r.q2;
      sumQ3 += r.q3;
      sumQ4 += r.q4;
      sumQ5 += r.q5;
      sumQ6 += r.q6;
      sumQ7 += r.q7;
      sumQ8 += r.q8;
    });

    const averageGeneral_20 = totalRespuestas > 0 ? Number((sumScore20 / totalRespuestas).toFixed(2)) : 0;
    const avgQ1 = totalRespuestas > 0 ? Number((sumQ1 / totalRespuestas).toFixed(2)) : 0;
    const avgQ2 = totalRespuestas > 0 ? Number((sumQ2 / totalRespuestas).toFixed(2)) : 0;
    const avgQ3 = totalRespuestas > 0 ? Number((sumQ3 / totalRespuestas).toFixed(2)) : 0;
    const avgQ4 = totalRespuestas > 0 ? Number((sumQ4 / totalRespuestas).toFixed(2)) : 0;
    const avgQ5 = totalRespuestas > 0 ? Number((sumQ5 / totalRespuestas).toFixed(2)) : 0;
    const avgQ6 = totalRespuestas > 0 ? Number((sumQ6 / totalRespuestas).toFixed(2)) : 0;
    const avgQ7 = totalRespuestas > 0 ? Number((sumQ7 / totalRespuestas).toFixed(2)) : 0;
    const avgQ8 = totalRespuestas > 0 ? Number((sumQ8 / totalRespuestas).toFixed(2)) : 0;

    // Best Formador based on 20-point scale
    const trainerScores: { [key: string]: { sum: number; count: number; name: string } } = {};
    dashboardResponses.forEach(r => {
      if (!trainerScores[r.formador_id]) {
        trainerScores[r.formador_id] = { sum: 0, count: 0, name: r.formador_nombre };
      }
      trainerScores[r.formador_id].sum += r.final_score_20;
      trainerScores[r.formador_id].count += 1;
    });
    let bestTrainerName = '-';
    let bestTrainerScore = 0;
    Object.keys(trainerScores).forEach(id => {
      const avg = trainerScores[id].sum / trainerScores[id].count;
      if (avg > bestTrainerScore) {
        bestTrainerScore = avg;
        bestTrainerName = getTrainerDisplayName(id, trainerScores[id].name);
      }
    });

    // Best Campaign based on 20-point scale
    const campaignScores: { [key: string]: { sum: number; count: number } } = {};
    dashboardResponses.forEach(r => {
      if (!campaignScores[r.campaña]) {
        campaignScores[r.campaña] = { sum: 0, count: 0 };
      }
      campaignScores[r.campaña].sum += r.final_score_20;
      campaignScores[r.campaña].count += 1;
    });
    let bestCampaignName = '-';
    let bestCampaignScore = 0;
    Object.keys(campaignScores).forEach(name => {
      const avg = campaignScores[name].sum / campaignScores[name].count;
      if (avg > bestCampaignScore) {
        bestCampaignScore = avg;
        bestCampaignName = name;
      }
    });

    // Best Generation based on 20-point scale
    const genScores: { [key: string]: { sum: number; count: number } } = {};
    dashboardResponses.forEach(r => {
      if (!genScores[r.codigo_generacion]) {
        genScores[r.codigo_generacion] = { sum: 0, count: 0 };
      }
      genScores[r.codigo_generacion].sum += r.final_score_20;
      genScores[r.codigo_generacion].count += 1;
    });
    let bestGenName = '-';
    let bestGenScore = 0;
    Object.keys(genScores).forEach(name => {
      const avg = genScores[name].sum / genScores[name].count;
      if (avg > bestGenScore) {
        bestGenScore = avg;
        bestGenName = name;
      }
    });

    return {
      totalHabilitadas,
      totalRespuestas,
      porcentajeRespuesta,
      averageGeneral_20,
      avgQ1,
      avgQ2,
      avgQ3,
      avgQ4,
      avgQ5,
      avgQ6,
      avgQ7,
      avgQ8,
      bestTrainerName,
      bestTrainerScore: Number(bestTrainerScore.toFixed(2)),
      bestCampaignName,
      bestCampaignScore: Number(bestCampaignScore.toFixed(2)),
      bestGenName,
      bestGenScore: Number(bestGenScore.toFixed(2))
    };
  }, [dashboardResponses, visibleSurveys, participants, surveys, anonymizeTrainers]);

  // Semáforo based on converted grade on 20:
  // Excelente (18-20), Bueno (15-17.99), Regular (11-14.99), Crítico (0-10.99)
  const getSatisfactionLevel_20 = (val: number) => {
    if (val === 0) return { label: 'Sin datos', color: 'text-slate-400 bg-slate-50 border-slate-200' };
    if (val >= 18.00) return { label: 'Excelente', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
    if (val >= 15.00) return { label: 'Bueno', color: 'text-blue-700 bg-blue-50 border-blue-200' };
    if (val >= 11.00) return { label: 'Regular', color: 'text-amber-700 bg-amber-50 border-amber-200' };
    return { label: 'Crítico', color: 'text-rose-700 bg-rose-50 border-rose-200' };
  };

  const satisfactionLevel = getSatisfactionLevel_20(kpis.averageGeneral_20);

  // --- RECHARTS CHART PREPARATIONS ---

  // 1. Average por Formador (0 to 20 scale)
  const chartTrainerData = useMemo(() => {
    const mapping: { [key: string]: { sum: number; count: number; name: string } } = {};
    dashboardResponses.forEach(r => {
      if (!mapping[r.formador_id]) {
        mapping[r.formador_id] = { sum: 0, count: 0, name: r.formador_nombre };
      }
      mapping[r.formador_id].sum += r.final_score_20;
      mapping[r.formador_id].count += 1;
    });

    return Object.keys(mapping).map(id => ({
      name: getTrainerDisplayName(id, mapping[id].name),
      promedio: Number((mapping[id].sum / mapping[id].count).toFixed(2))
    }));
  }, [dashboardResponses, anonymizeTrainers]);

  // 2. Average por Campaña (0 to 20 scale)
  const chartCampaignData = useMemo(() => {
    const mapping: { [key: string]: { sum: number; count: number } } = {};
    dashboardResponses.forEach(r => {
      if (!mapping[r.campaña]) {
        mapping[r.campaña] = { sum: 0, count: 0 };
      }
      mapping[r.campaña].sum += r.final_score_20;
      mapping[r.campaña].count += 1;
    });

    return Object.keys(mapping).map(name => ({
      name,
      promedio: Number((mapping[name].sum / mapping[name].count).toFixed(2))
    }));
  }, [dashboardResponses]);

  // 3. Radar Comparativo de Dimensiones (0 to 5 scale for original q1 to q8 answers)
  const chartDimensionData = useMemo(() => {
    return [
      { subject: 'Utilidad', valor: kpis.avgQ1, fullMark: 5 },
      { subject: 'Claridad', valor: kpis.avgQ2, fullMark: 5 },
      { subject: 'Dominio', valor: kpis.avgQ3, fullMark: 5 },
      { subject: 'Resolución', valor: kpis.avgQ4, fullMark: 5 },
      { subject: 'Práctica', valor: kpis.avgQ5, fullMark: 5 },
      { subject: 'Material', valor: kpis.avgQ6, fullMark: 5 },
      { subject: 'Preparación', valor: kpis.avgQ7, fullMark: 5 },
      { subject: 'Calific. Gral', valor: kpis.avgQ8, fullMark: 5 }
    ];
  }, [kpis]);

  // 4. Distribución de Calificaciones (Classification counts)
  const chartDistributionData = useMemo(() => {
    const counts = { Excelente: 0, Bueno: 0, Regular: 0, Crítico: 0 };
    dashboardResponses.forEach(r => {
      if (counts[r.classification] !== undefined) {
        counts[r.classification] += 1;
      }
    });

    return [
      { name: 'Excelente (18-20)', value: counts.Excelente, color: '#10b981' },
      { name: 'Bueno (15-17.99)', value: counts.Bueno, color: '#3b82f6' },
      { name: 'Regular (11-14.99)', value: counts.Regular, color: '#f59e0b' },
      { name: 'Crítico (0-10.99)', value: counts.Crítico, color: '#ef4444' }
    ];
  }, [dashboardResponses]);

  // --- FILTRAR COMENTARIOS EN TIEMPO REAL ---
  const filteredComments = useMemo(() => {
    return filteredResponses.filter(r => {
      if (!commentKeyword) return true;
      const kw = commentKeyword.toLowerCase();
      return (
        r.comentario_positivo.toLowerCase().includes(kw) ||
        r.aspecto_mejora.toLowerCase().includes(kw) ||
        r.nombre_ejecutivo.toLowerCase().includes(kw) ||
        r.dni.includes(kw)
      );
    });
  }, [filteredResponses, commentKeyword]);

  // --- LISTS FOR INPUT DROPDOWNS ---
  const campaignsList = useMemo(() => {
    return Array.from(new Set(visibleSurveys.map(s => getSurveySession(s)?.campaña || s.campaña).filter(Boolean))).sort();
  }, [visibleSurveys, sessions]);

  const trainersList = useMemo(() => {
    const unique: { [key: string]: string } = {};
    visibleSurveys.forEach(s => {
      const session = getSurveySession(s);
      const ids = session ? getSessionTrainerIds(session) : [s.formador_id];
      const names = session ? getSessionTrainerNames(session) : [s.formador_nombre];
      ids.forEach((id, index) => {
        if (id) unique[id] = names[index] || users.find(user => user.id === id)?.nombre || s.formador_nombre;
      });
    });
    return Object.keys(unique).map(id => ({ id, nombre: unique[id] }));
  }, [visibleSurveys, sessions, users]);

  const generationsList = useMemo(() => {
    return Array.from(new Set(visibleSurveys.map(s => getSurveyGenerationCode(s))));
  }, [visibleSurveys, sessions]);

  const trainingTypesList = useMemo(() => Array.from(new Set(
    visibleSurveys
      .map((survey) => getSurveySession(survey)?.tipo_capacitacion || survey.training_type)
      .filter(Boolean) as string[],
  )).sort(), [visibleSurveys, sessions]);

  // Sessions that do not have an active satisfaction survey yet (to avoid duplicates)
  const sessionsWithoutSurvey = useMemo(() => {
    return sessions.filter(
      sess => !surveys.some(srv => srv.training_session_id === sess.id && srv.estado !== 'Eliminada')
    );
  }, [sessions, surveys]);

  // Currently selected session object in Create Modal
  const selectedSessionObj = useMemo(() => {
    return sessions.find(s => s.id === selectedSessionId);
  }, [selectedSessionId, sessions]);

  // Generate survey slug token based on the selected generation
  const handleSelectSessionInModal = (sessId: string) => {
    setSelectedSessionId(sessId);
    const sess = sessions.find(s => s.id === sessId);
    if (sess) {
      const genCode = sess.generation_code || sess.nombre_generacion || `GR-${Math.floor(10 + Math.random() * 90)}`;
      const cleanToken = genCode.trim().replace(/\s+/g, '-').toUpperCase();
      setTokenInput(cleanToken);
    } else {
      setTokenInput('');
    }
  };

  const handleCreateSurveySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId || !selectedSessionObj) return;

    const genCode = selectedSessionObj.generation_code || selectedSessionObj.nombre_generacion;
    const cleanToken = tokenInput.trim() || genCode.trim().replace(/\s+/g, '-').toUpperCase();

    const newSurvey: TrainingSurvey = {
      id: `srv-${Math.random().toString(36).substring(2, 11)}`,
      training_session_id: selectedSessionId,
      codigo_generacion: genCode,
      campaña: selectedSessionObj.campaña,
      formador_id: selectedSessionObj.formador_id,
      formador_nombre: selectedSessionObj.formador_nombre,
      estado: surveyStatus,
      token: cleanToken,
      training_type: selectedSessionObj.tipo_capacitacion,
      start_date: selectedSessionObj.fecha_inicio,
      end_date: selectedSessionObj.fecha_fin,
      created_by: currentUser.nombre,
      created_at: new Date().toISOString()
    };

    if (onAddSurvey) {
      onAddSurvey(newSurvey);
    }

    setIsCreateModalOpen(false);
    setSelectedSessionId('');
    setSurveyStatus('Borrador');
    setTokenInput('');
  };

  // Soft delete survey handler with custom confirmation modal & logging
  const handleDeleteSurveyClick = (sId: string, sName: string) => {
    const s = surveys.find(srv => srv.id === sId);
    
    // Audit log: Administrador intenta eliminar encuesta
    onAuditLog(
      'Administrador intenta eliminar encuesta',
      'Encuestas de Satisfacción',
      `El administrador inició la intención de eliminar la encuesta para la generación "${sName}" (ID: ${sId}).`,
      s?.campaña,
      s?.codigo_generacion
    );

    if (!isAdmin) {
      onAuditLog(
        'Usuario sin permiso intenta eliminar encuesta',
        'Encuestas de Satisfacción',
        `El usuario "${currentUser.nombre}" con rol "${currentUser.rol}" intentó eliminar la encuesta para la generación "${sName}" sin poseer privilegios de Administrador.`,
        s?.campaña,
        s?.codigo_generacion
      );
      return;
    }

    setDeleteSurveyId(sId);
  };

  const handleDeleteCancel = () => {
    if (deleteSurveyId) {
      const s = surveys.find(srv => srv.id === deleteSurveyId);
      onAuditLog(
        'Intento de eliminación de encuesta cancelado',
        'Encuestas de Satisfacción',
        `El administrador canceló la eliminación de la encuesta para la generación "${s?.codigo_generacion}" (ID: ${deleteSurveyId}).`,
        s?.campaña,
        s?.codigo_generacion
      );
    }
    setDeleteSurveyId(null);
  };

  const handleDeleteConfirm = () => {
    if (deleteSurveyId) {
      const s = surveys.find(srv => srv.id === deleteSurveyId);
      if (s) {
        onUpdateSurveyStatus(deleteSurveyId, 'Eliminada');

        onAuditLog(
          'Administrador elimina encuesta',
          'Encuestas de Satisfacción',
          `El administrador confirmó la eliminación de la encuesta para la generación "${s.codigo_generacion}" (ID: ${deleteSurveyId}).`,
          s.campaña,
          s.codigo_generacion
        );

        onAuditLog(
          'Encuesta eliminada deja de alimentar dashboard',
          'Encuestas de Satisfacción',
          `La encuesta de la generación "${s.codigo_generacion}" fue eliminada y sus respuestas dejaron de alimentar el dashboard y los reportes de resultados.`,
          s.campaña,
          s.codigo_generacion
        );
      }
      setDeleteSurveyId(null);
    }
  };

  // --- MONITOREO STATUS MATH & CALCULATIONS ---
  // If no survey is selected yet, default to the first active survey if available
  const currentMonitoreoSurvey = useMemo(() => {
    const activeAndClosedSurveys = visibleSurveys.filter(s => s.estado === 'Habilitada' || s.estado === 'Cerrada');
    if (monitoreoSurveyId) {
      return visibleSurveys.find(s => s.id === monitoreoSurveyId);
    }
    return activeAndClosedSurveys[0] || null;
  }, [monitoreoSurveyId, visibleSurveys]);

  const monitoreoData = useMemo(() => {
    if (!currentMonitoreoSurvey) return null;

    // Get only participants allowed to answer this survey.
    const classParticipants = getSurveyEligibleParticipants(currentMonitoreoSurvey);

    // Get responses registered for this specific survey
    const surveyResponses = normalizedResponses.filter(
      r => r.training_survey_id === currentMonitoreoSurvey.id
    );

    const mappedList = classParticipants.map(p => {
      const resp = surveyResponses.find(r => r.dni.trim() === p.dni.trim());
      return {
        participant: p,
        hasResponded: !!resp,
        responseDetails: resp || null
      };
    });

    const totalCount = classParticipants.length;
    const respondedCount = mappedList.filter((item) => item.hasResponded).length;
    const percentage = totalCount > 0 ? Math.round((respondedCount / totalCount) * 100) : 0;

    return {
      list: mappedList,
      totalCount,
      respondedCount,
      percentage
    };
  }, [currentMonitoreoSurvey, participants, attendance, normalizedResponses]);

  const handleCopyPersonalLink = (token: string, dniVal: string, pId: string) => {
    const origin = window.location.origin + window.location.pathname;
    const url = `${origin}?view=survey&token=${token}&dni=${dniVal}`;
    navigator.clipboard.writeText(url);
    setCopiedDniId(pId);
    setTimeout(() => setCopiedDniId(null), 2000);

    onAuditLog(
      'Enlace personalizado copiado',
      'Encuestas de Satisfacción',
      `Se copió el enlace de encuesta personalizado para el DNI "${dniVal}" (Token: ${token})`
    );
  };

  const buildPersonalSurveyUrl = (token: string, dniVal: string) => {
    const origin = window.location.origin + window.location.pathname;
    return `${origin}?view=survey&token=${token}&dni=${dniVal}`;
  };

  const buildSurveyEmailInfo = (survey: TrainingSurvey) => ({
    id: survey.id,
    campana: survey.campaña,
    codigo_generacion: getSurveyGenerationCode(survey),
    formador_nombre: survey.formador_nombre,
  });

  const buildRecipient = (survey: TrainingSurvey, participant: Participant) => ({
    participant_id: participant.id,
    nombre: `${participant.nombres} ${participant.apellidos}`.trim(),
    dni: participant.dni,
    correo: participant.correo,
    url: buildPersonalSurveyUrl(survey.token, participant.dni),
  });

  const handleSendPersonalEmail = async (survey: TrainingSurvey, participant: Participant) => {
    if (!participant.correo) {
      setEmailFeedback('El participante no tiene correo registrado.');
      return;
    }

    setSendingEmailId(participant.id);
    setEmailFeedback('');

    try {
      await sendSurveyInvitations({
        survey: buildSurveyEmailInfo(survey),
        recipients: [buildRecipient(survey, participant)],
      });

      setEmailFeedback(`Correo enviado a ${participant.correo}.`);
      onAuditLog(
        'Encuesta enviada por correo',
        'Encuestas de Satisfacción',
        `Se envió la encuesta por correo al DNI "${participant.dni}" (${participant.correo}).`,
        survey.campaña,
        survey.codigo_generacion,
        participant.id,
        `${participant.nombres} ${participant.apellidos}`,
      );
    } catch (error) {
      setEmailFeedback(error instanceof Error ? error.message : 'No se pudo enviar el correo.');
    } finally {
      setSendingEmailId(null);
      setTimeout(() => setEmailFeedback(''), 5000);
    }
  };

  const handleSendPendingEmails = async () => {
    if (!currentMonitoreoSurvey || !monitoreoData) return;

    const pendingRecipients = monitoreoData.list
      .filter((item) => !item.hasResponded && item.participant.correo)
      .map((item) => buildRecipient(currentMonitoreoSurvey, item.participant));

    if (pendingRecipients.length === 0) {
      setEmailFeedback('No hay participantes pendientes con correo registrado.');
      setTimeout(() => setEmailFeedback(''), 5000);
      return;
    }

    setSendingEmailId(`survey-${currentMonitoreoSurvey.id}`);
    setEmailFeedback('');

    try {
      await sendSurveyInvitations({
        survey: buildSurveyEmailInfo(currentMonitoreoSurvey),
        recipients: pendingRecipients,
      });

      setEmailFeedback(`Se enviaron ${pendingRecipients.length} correos de encuesta.`);
      onAuditLog(
        'Encuestas enviadas por correo',
        'Encuestas de Satisfacción',
        `Se enviaron ${pendingRecipients.length} invitaciones por correo para la generación "${currentMonitoreoSurvey.codigo_generacion}".`,
        currentMonitoreoSurvey.campaña,
        currentMonitoreoSurvey.codigo_generacion,
      );
    } catch (error) {
      setEmailFeedback(error instanceof Error ? error.message : 'No se pudieron enviar los correos.');
    } finally {
      setSendingEmailId(null);
      setTimeout(() => setEmailFeedback(''), 6000);
    }
  };

  // --- EXPORT LOGIC FOR EXCEL & CSV ---
  const handleExportCSV = () => {
    if (isTrainer || isRecruiter) return; // double check permissions

    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    csvContent += 'Fecha Respuesta,Campaña,Generación,Formador,DNI,Ejecutivo,Q1 (Utilidad),Q2 (Claridad),Q3 (Dominio),Q4 (Resolución),Q5 (Casos Prácticos),Q6 (Material),Q7 (Preparación),Q8 (Calificación),Suma Total,Nota Final (0-20),Clasificación,Aspectos Positivos,Mejoras\n';

    filteredResponses.forEach(r => {
      const label = getExecutiveLabel(r);
      const row = [
        r.fecha_respuesta.split('T')[0],
        `"${r.campaña}"`,
        `"${r.codigo_generacion}"`,
        `"${getTrainerDisplayName(r.formador_id, r.formador_nombre)}"`,
        `"${label.dni}"`,
        `"${label.nombre}"`,
        r.q1,
        r.q2,
        r.q3,
        r.q4,
        r.q5,
        r.q6,
        r.q7,
        r.q8,
        r.total_score,
        r.final_score_20,
        `"${r.classification}"`,
        `"${r.comentario_positivo.replace(/"/g, '""')}"`,
        `"${r.aspecto_mejora.replace(/"/g, '""')}"`
      ].join(',');
      csvContent += row + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `reporte_encuestas_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    onAuditLog(
      'Exportación de reporte',
      'Encuestas de Satisfacción',
      `El usuario "${currentUser.nombre}" exportó ${filteredResponses.length} respuestas de encuesta a CSV.`
    );
  };

  const handleExportExcel = () => {
    if (!isAdmin && currentUser.rol !== 'Analista') return; // restricted to Administrador and Analista

    const dataToExport = filteredResponses.map(r => {
      const label = getExecutiveLabel(r);
      return {
        'Fecha Respuesta': r.fecha_respuesta.split('T')[0],
        'Campaña': r.campaña,
        'Generación': r.codigo_generacion,
        'Formador': getTrainerDisplayName(r.formador_id, r.formador_nombre),
        'DNI': label.dni,
        'Ejecutivo': label.nombre,
        'Q1 (Utilidad)': r.q1,
        'Q2 (Claridad)': r.q2,
        'Q3 (Dominio)': r.q3,
        'Q4 (Resolución)': r.q4,
        'Q5 (Casos Prácticos)': r.q5,
        'Q6 (Material)': r.q6,
        'Q7 (Preparación)': r.q7,
        'Q8 (Calificación Formador)': r.q8,
        'Suma Total (Max 50)': r.total_score,
        'Nota Final (0-20)': r.final_score_20,
        'Clasificación': r.classification,
        'Aspectos Positivos': r.comentario_positivo,
        'Oportunidades de Mejora': r.aspecto_mejora
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Encuestas de Satisfacción');
    XLSX.writeFile(wb, `reporte_encuestas_automatizate_${new Date().toISOString().split('T')[0]}.xlsx`);

    onAuditLog(
      'Usuario exporta Excel',
      'Encuestas de Satisfacción',
      `El usuario "${currentUser.nombre}" exportó ${filteredResponses.length} respuestas de encuesta a Excel.`,
      filterCampaign || undefined,
      filterGenerator || undefined
    );
  };

  const handleExportPDF = () => {
    window.print();
    onAuditLog(
      'Impresión / Reporte PDF',
      'Encuestas de Satisfacción',
      `El usuario "${currentUser.nombre}" imprimió el reporte de encuestas de satisfacción.`
    );
  };

  return (
    <div className="space-y-6 animate-fade-in" id="encuestas-satisfaccion-module">
      {/* 1. HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
              Encuestas de Satisfacción
              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-md font-bold uppercase font-mono">
                Área de Calidad
              </span>
            </h1>
            <p className="text-slate-500 text-xs">Evaluación del desempeño de formadores y nivel de satisfacción de los ejecutivos.</p>
          </div>
        </div>

        {/* Header CTA & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {permissions[currentUser.rol]?.canCreateSurvey && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold text-xs rounded-xl px-4 py-2.5 flex items-center gap-2 transition-all cursor-pointer shadow-sm shadow-fuchsia-950/10"
              title="Crear encuesta asociada a una capacitación"
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva Encuesta
            </button>
          )}

          {/* Export actions based on role */}
          {filteredResponses.length > 0 && (isAdmin || isStaff || currentUser.rol === 'Analista') && (
            <button
              onClick={handleExportExcel}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl px-4 py-2.5 flex items-center gap-2 transition-all cursor-pointer shadow-sm shadow-emerald-950/10"
            >
              <Download className="w-3.5 h-3.5" />
              Excel
            </button>
          )}
        </div>
      </div>

      {/* 2. GLOBAL FILTERS BAR */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs space-y-4">
        <div className="flex items-center gap-2 text-slate-700 font-extrabold text-xs">
          <Filter className="w-4 h-4 text-indigo-500" />
          Filtros de Búsqueda
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {/* Campaña */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Campaña</label>
            <select
              value={filterCampaign}
              onChange={(e) => setFilterCampaign(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-2 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500"
            >
              <option value="">Todas</option>
              {campaignsList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Código de generación */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Código</label>
            <select
              value={filterGenerator}
              onChange={(e) => setFilterGenerator(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-2 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500"
            >
              <option value="">Todas</option>
              {generationsList.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          {/* Formador */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Formador</label>
            <select
              disabled={isTrainer}
              value={isTrainer ? currentUser.id : filterTrainer}
              onChange={(e) => setFilterTrainer(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-2 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500 disabled:opacity-75"
            >
              {isTrainer ? (
                <option value={currentUser.id}>{currentUser.nombre}</option>
              ) : (
                <>
                  <option value="">Todos</option>
                  {trainersList.map(t => (
                    <option key={t.id} value={t.id}>{t.nombre}</option>
                  ))}
                </>
              )}
            </select>
          </div>

          {/* Tipo Capacitación */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Tipo de Cap.</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-2 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500"
            >
              <option value="">Todos</option>
              {trainingTypesList.map((trainingType) => (
                <option key={trainingType} value={trainingType}>{trainingType}</option>
              ))}
            </select>
          </div>

          {/* Fecha Inicio */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Fecha Inicio</label>
            <input
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-1.5 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500"
            />
          </div>

          {/* Fecha Fin */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Fecha Fin</label>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-1.5 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500"
            />
          </div>
        </div>

        {/* Clear Filters CTA */}
        {(filterCampaign || filterGenerator || filterTrainer || filterType || dateStart || dateEnd) && (
          <div className="flex justify-end pt-1">
            <button
              onClick={() => {
                setFilterCampaign('');
                setFilterGenerator('');
                setFilterTrainer('');
                setFilterType('');
                setDateStart('');
                setDateEnd('');
              }}
              className="text-fuchsia-600 hover:text-fuchsia-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              Restablecer Filtros
            </button>
          </div>
        )}
      </div>

      {/* 3. TABS NAVIGATION */}
      <div className="border-b border-slate-200 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'dashboard'
              ? 'border-fuchsia-600 text-fuchsia-600 font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Dashboard de Resultados
        </button>
        <button
          onClick={() => setActiveTab('comentarios')}
          className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'comentarios'
              ? 'border-fuchsia-600 text-fuchsia-600 font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          Comentarios Abiertos ({filteredComments.length})
        </button>
        <button
          onClick={() => setActiveTab('respuestas')}
          className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'respuestas'
              ? 'border-fuchsia-600 text-fuchsia-600 font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <ListFilter className="w-4 h-4" />
          Respuestas Individuales
        </button>
        <button
          onClick={() => setActiveTab('links')}
          className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'links'
              ? 'border-fuchsia-600 text-fuchsia-600 font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Link2 className="w-4 h-4" />
          LINKS
        </button>
        {/* Config surveys available for admin/formador/analista */}
        {(isAdmin || isTrainer || currentUser.rol === 'Analista') && (
          <button
            onClick={() => setActiveTab('configuracion')}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'configuracion'
                ? 'border-fuchsia-600 text-fuchsia-600 font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            Configuración de Enlaces
          </button>
        )}
      </div>

      {/* 4. TAB CONTENTS */}

      {/* TAB 4.1: DASHBOARD & ANALYTICS */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6" id="dashboard-tab-content">
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Active Link Count */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <ClipboardCheck className="w-5 h-5" />
              </div>
              <div>
                <span className="block text-[10px] text-slate-400 font-bold uppercase">Enlaces Activos</span>
                <span className="text-xl font-black text-slate-800">{kpis.totalHabilitadas}</span>
              </div>
            </div>

            {/* Total Answers Received */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-fuchsia-50 text-fuchsia-600 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <span className="block text-[10px] text-slate-400 font-bold uppercase">Respuestas Válidas</span>
                <span className="text-xl font-black text-slate-800">{kpis.totalRespuestas}</span>
              </div>
            </div>

            {/* Response rate percentage */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <span className="block text-[10px] text-slate-400 font-bold uppercase">% de Respuesta</span>
                <span className="text-xl font-black text-slate-800">{kpis.porcentajeRespuesta}%</span>
              </div>
            </div>

            {/* Average General Grade on 20-point scale */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Star className="w-5 h-5 fill-emerald-100" />
              </div>
              <div className="truncate">
                <span className="block text-[10px] text-slate-400 font-bold uppercase">Promedio General</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xl font-black text-slate-800 font-mono">{kpis.averageGeneral_20 || '-'} <span className="text-xs text-slate-400">/20</span></span>
                  {kpis.averageGeneral_20 > 0 && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm border ${satisfactionLevel.color}`}>
                      {satisfactionLevel.label}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Dimensions Radar KPI score summary */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs space-y-4">
            <h3 className="text-slate-800 font-extrabold text-sm border-b border-slate-50 pb-2 flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
              Resultados de Satisfacción Promedio por Dimensión Evaluada (Escala 1 - 5)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3 text-center">
              {[
                { label: 'Utilidad (Q1)', val: kpis.avgQ1 },
                { label: 'Claridad (Q2)', val: kpis.avgQ2 },
                { label: 'Dominio (Q3)', val: kpis.avgQ3 },
                { label: 'Resolución (Q4)', val: kpis.avgQ4 },
                { label: 'Ejemplos (Q5)', val: kpis.avgQ5 },
                { label: 'Material (Q6)', val: kpis.avgQ6 },
                { label: 'Preparación (Q7)', val: kpis.avgQ7 },
                { label: 'Nota Gral (Q8)', val: kpis.avgQ8 }
              ].map((dim, idx) => (
                <div key={idx} className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-col justify-between">
                  <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-tight leading-tight mb-1">{dim.label}</span>
                  <span className="text-base font-black text-slate-700 font-mono">{dim.val || '-'}</span>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div className="bg-indigo-600 h-full" style={{ width: `${(dim.val / 5) * 100}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Best Evaluated Leaders section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <Award className="w-5 h-5" />
              </div>
              <div className="truncate">
                <span className="block text-[10px] text-slate-400 font-bold uppercase">Formador mejor evaluado</span>
                <span className="text-xs font-black text-slate-800 truncate block mt-0.5">{kpis.bestTrainerName}</span>
                <span className="text-[10px] text-amber-600 font-extrabold font-mono mt-0.5 block">{kpis.bestTrainerScore > 0 ? `${kpis.bestTrainerScore} / 20` : ''}</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="truncate">
                <span className="block text-[10px] text-slate-400 font-bold uppercase">Campaña mejor evaluada</span>
                <span className="text-xs font-black text-slate-800 truncate block mt-0.5">{kpis.bestCampaignName}</span>
                <span className="text-[10px] text-indigo-600 font-extrabold font-mono mt-0.5 block">{kpis.bestCampaignScore > 0 ? `${kpis.bestCampaignScore} / 20` : ''}</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-fuchsia-50 text-fuchsia-600 flex items-center justify-center shrink-0">
                <ClipboardCheck className="w-5 h-5" />
              </div>
              <div className="truncate">
                <span className="block text-[10px] text-slate-400 font-bold uppercase">Generación mejor evaluada</span>
                <span className="text-xs font-black text-slate-800 truncate block mt-0.5">{kpis.bestGenName}</span>
                <span className="text-[10px] text-fuchsia-600 font-extrabold font-mono mt-0.5 block">{kpis.bestGenScore > 0 ? `${kpis.bestGenScore} / 20` : ''}</span>
              </div>
            </div>
          </div>

          {/* CHARTS GRAPHICS VIEW */}
          {dashboardResponses.length === 0 ? (
            <div className="bg-slate-50 border border-dashed border-slate-200 p-12 text-center rounded-2xl flex flex-col items-center justify-center gap-2">
              <AlertCircle className="w-8 h-8 text-slate-400 animate-pulse" />
              <p className="text-slate-600 font-bold text-xs">No se encontraron respuestas para los filtros aplicados o no hay encuestas en estado Habilitada/Cerrada.</p>
              <p className="text-slate-400 text-[10px]">Pruebe a cambiar los selectores de búsqueda o habilitar una encuesta en la sección de enlaces.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 animate-fade-in">
              {/* Chart 1: Average per Trainer */}
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs md:col-span-6 space-y-4">
                <h4 className="text-slate-800 text-xs font-extrabold tracking-tight uppercase border-b border-slate-50 pb-2">Nota Promedio General por Formador (Escala 0 - 20)</h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartTrainerData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} domain={[0, 20]} />
                      <Tooltip formatter={(value) => [`${value} / 20`, 'Nota Promedio']} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                      <Bar dataKey="promedio" fill="#4f46e5" radius={[6, 6, 0, 0]} barSize={35}>
                        {chartTrainerData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#4f46e5' : '#c026d3'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 2: Average per Campaign */}
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs md:col-span-6 space-y-4">
                <h4 className="text-slate-800 text-xs font-extrabold tracking-tight uppercase border-b border-slate-50 pb-2">Nota Promedio General por Campaña (Escala 0 - 20)</h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartCampaignData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} domain={[0, 20]} />
                      <Tooltip formatter={(value) => [`${value} / 20`, 'Nota Promedio']} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                      <Bar dataKey="promedio" fill="#06b6d4" radius={[6, 6, 0, 0]} barSize={35} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 3: Comparative Dimensions Radar */}
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs md:col-span-6 space-y-4">
                <h4 className="text-slate-800 text-xs font-extrabold tracking-tight uppercase border-b border-slate-50 pb-2">Radar Comparativo de Dimensiones (Escala 1 - 5)</h4>
                <div className="h-64 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="75%" data={chartDimensionData}>
                      <PolarGrid stroke="#e2e8f0" />
                      <PolarAngleAxis dataKey="subject" stroke="#64748b" fontSize={9} fontWeight="bold" />
                      <PolarRadiusAxis angle={30} domain={[0, 5]} stroke="#cbd5e1" fontSize={8} />
                      <Radar name="Valor Promedio" dataKey="valor" stroke="#db2777" fill="#f472b6" fillOpacity={0.4} />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 4: Semáforo Desempeño Distribution */}
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs md:col-span-6 space-y-4">
                <h4 className="text-slate-800 text-xs font-extrabold tracking-tight uppercase border-b border-slate-50 pb-2">Distribución de Desempeño Formador (Semáforo de Notas)</h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartDistributionData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                      <Tooltip formatter={(value) => [value, 'Cantidad de Respuestas']} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={35}>
                        {chartDistributionData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4.2: COMENTARIOS Y OPORTUNIDADES DE MEJORA */}
      {activeTab === 'comentarios' && (
        <div className="space-y-4" id="comentarios-tab-content">
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h3 className="text-slate-800 font-extrabold text-sm flex items-center gap-2">
                <MessageSquare className="w-4.5 h-4.5 text-indigo-500" />
                Comentarios Abiertos y Áreas de Mejora (Q9 y Q10)
              </h3>
              <div className="relative max-w-xs w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Buscar palabras o ejecutivo..."
                  value={commentKeyword}
                  onChange={(e) => setCommentKeyword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl pl-9 pr-4 py-2 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500"
                />
              </div>
            </div>

            {filteredComments.length === 0 ? (
              <div className="bg-slate-50 border border-dashed border-slate-200 p-12 text-center rounded-2xl">
                <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-slate-600 font-bold text-xs">No se encontraron comentarios para los criterios actuales.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredComments.map((r) => {
                  const label = getExecutiveLabel(r);
                  const lvl = getSatisfactionLevel_20(r.final_score_20);
                  return (
                    <div key={r.id} className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-3 hover:bg-white hover:shadow-md transition-all duration-200">
                      <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div className="truncate">
                          <span className="block text-[9px] text-fuchsia-600 font-black uppercase font-mono">{r.codigo_generacion} ({r.campaña})</span>
                          <span className="block text-xs font-bold text-slate-800 mt-0.5">{label.nombre}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-slate-400 block font-semibold">{r.fecha_respuesta.split('T')[0]}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm border inline-block mt-1 font-mono ${lvl.color}`}>
                            {r.final_score_20} ★ ({lvl.label})
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        {/* Positive Aspects (Q9) */}
                        <div className="bg-emerald-50/30 p-3 rounded-xl border border-emerald-100/40">
                          <span className="block text-[8px] text-emerald-700 font-extrabold uppercase tracking-wider mb-1">Aspectos Positivos (Q9)</span>
                          <p className="text-slate-600 leading-normal text-[11px] font-medium italic">
                            "{r.comentario_positivo || 'S/C'}"
                          </p>
                        </div>

                        {/* Improvements (Q10) */}
                        <div className="bg-rose-50/30 p-3 rounded-xl border border-rose-100/40">
                          <span className="block text-[8px] text-rose-700 font-extrabold uppercase tracking-wider mb-1">Oportunidades de Mejora (Q10)</span>
                          <p className="text-slate-600 leading-normal text-[11px] font-medium italic">
                            "{r.aspecto_mejora || 'S/C'}"
                          </p>
                        </div>
                      </div>

                      <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 font-medium border-t border-slate-100/50">
                        <span>Formador: <strong>{getTrainerDisplayName(r.formador_id, r.formador_nombre)}</strong></span>
                        <span>DNI: <strong>{label.dni}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4.3: RESPUESTAS INDIVIDUALES TABLA */}
      {activeTab === 'respuestas' && (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs space-y-4" id="respuestas-tab-content">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-slate-800 font-extrabold text-sm flex items-center gap-2">
              <ListFilter className="w-4 h-4 text-indigo-500" />
              Detalle de Respuestas Recibidas
            </h3>
            <span className="text-xs text-slate-400 font-bold font-mono">Total filtradas: {filteredResponses.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-extrabold">
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Campaña</th>
                  <th className="p-3">Generación</th>
                  {!isTrainer && <th className="p-3">Formador</th>}
                  <th className="p-3">DNI</th>
                  <th className="p-3">Ejecutivo</th>
                  <th className="p-3 text-center" title="Q1: Utilidad">Q1</th>
                  <th className="p-3 text-center" title="Q2: Claridad">Q2</th>
                  <th className="p-3 text-center" title="Q3: Dominio">Q3</th>
                  <th className="p-3 text-center" title="Q4: Resolución dudas">Q4</th>
                  <th className="p-3 text-center" title="Q5: Casos prácticos">Q5</th>
                  <th className="p-3 text-center" title="Q6: Material">Q6</th>
                  <th className="p-3 text-center" title="Q7: Preparación">Q7</th>
                  <th className="p-3 text-center" title="Q8: Calificación general">Q8</th>
                  <th className="p-3 text-center bg-indigo-50/30 text-indigo-700">Nota Final</th>
                  <th className="p-3 text-center">Clasificación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredResponses.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="p-8 text-center text-slate-400 font-bold">No se encontraron registros de encuestas de satisfacción.</td>
                  </tr>
                ) : (
                  filteredResponses.map((r) => {
                    const label = getExecutiveLabel(r);
                    const lvl = getSatisfactionLevel_20(r.final_score_20);
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/40 text-[11px] font-medium text-slate-700">
                        <td className="p-3 font-mono whitespace-nowrap">{r.fecha_respuesta.split('T')[0]}</td>
                        <td className="p-3 whitespace-nowrap">{r.campaña}</td>
                        <td className="p-3 font-bold text-slate-800 whitespace-nowrap">{r.codigo_generacion}</td>
                        {!isTrainer && <td className="p-3 whitespace-nowrap">{getTrainerDisplayName(r.formador_id, r.formador_nombre)}</td>}
                        <td className="p-3 font-mono whitespace-nowrap">{label.dni}</td>
                        <td className="p-3 font-bold text-slate-900 whitespace-nowrap">{label.nombre}</td>
                        <td className="p-3 text-center font-bold font-mono text-slate-400">{r.q1}</td>
                        <td className="p-3 text-center font-bold font-mono text-slate-400">{r.q2}</td>
                        <td className="p-3 text-center font-bold font-mono text-slate-400">{r.q3}</td>
                        <td className="p-3 text-center font-bold font-mono text-slate-400">{r.q4}</td>
                        <td className="p-3 text-center font-bold font-mono text-slate-400">{r.q5}</td>
                        <td className="p-3 text-center font-bold font-mono text-slate-400">{r.q6}</td>
                        <td className="p-3 text-center font-bold font-mono text-slate-400">{r.q7}</td>
                        <td className="p-3 text-center font-bold font-mono text-slate-400">{r.q8}</td>
                        <td className="p-3 text-center font-black font-mono bg-indigo-50/20 text-indigo-700 whitespace-nowrap">{r.final_score_20} / 20</td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${lvl.color}`}>
                            {lvl.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4.4: MONITOREO DE ENVIOS (QUIEN RESPONDIO Y QUIEN NO) */}
      {false && activeTab === 'monitoreo' && (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs space-y-5" id="monitoreo-tab-content">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div>
              <h3 className="text-slate-800 font-extrabold text-sm flex items-center gap-2">
                <Users className="w-4.5 h-4.5 text-indigo-500" />
                Monitoreo de Respuestas (Quién respondió y quién no)
              </h3>
              <p className="text-slate-400 text-[11px] mt-0.5">Selecciona una encuesta habilitada para ver la lista completa de ejecutivos y rastrear sus respuestas.</p>
            </div>

            {/* Selector of enabled/closed surveys */}
            <div className="w-full sm:w-80">
              <select
                value={monitoreoSurveyId}
                onChange={(e) => setMonitoreoSurveyId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl px-3.5 py-2 font-bold outline-hidden focus:ring-1 focus:ring-fuchsia-500"
              >
                <option value="">Selecciona una campaña / generación...</option>
                {visibleSurveys.filter(s => s.estado === 'Habilitada' || s.estado === 'Cerrada').map(s => (
                  <option key={s.id} value={s.id}>
                    [{s.campaña}] {getSurveyGenerationCode(s)} - Formador: {getTrainerDisplayName(s.formador_id, s.formador_nombre)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!currentMonitoreoSurvey ? (
            <div className="bg-slate-50 border border-dashed border-slate-200 p-12 text-center rounded-2xl flex flex-col items-center justify-center gap-1.5">
              <AlertCircle className="w-8 h-8 text-slate-400" />
              <p className="text-slate-600 font-bold text-xs">Por favor, selecciona una capacitación de la lista superior para realizar el monitoreo.</p>
              <p className="text-slate-400 text-[10px]">Solo se listan las encuestas en estado Habilitada o Cerrada.</p>
            </div>
          ) : (
            monitoreoData && (
              <div className="space-y-4 animate-fade-in">
                {/* Global counters */}
                <div className="bg-slate-900 text-white p-4.5 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <span className="text-[9px] bg-fuchsia-600 text-white font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wide">
                      MÉTRICA DE RESPUESTAS
                    </span>
                    <h4 className="font-extrabold text-sm mt-1">{currentMonitoreoSurvey.campaña} - {getSurveyGenerationCode(currentMonitoreoSurvey)}</h4>
                    <p className="text-xs text-slate-400">Formador asignado: <strong className="text-white">{getTrainerDisplayName(currentMonitoreoSurvey.formador_id, currentMonitoreoSurvey.formador_nombre)}</strong></p>
                    {emailFeedback && (
                      <p className="text-[11px] text-emerald-300 font-bold mt-2">{emailFeedback}</p>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
                    {currentMonitoreoSurvey.estado === 'Habilitada' && canSendSurveyEmails && (
                      <button
                        onClick={handleSendPendingEmails}
                        disabled={sendingEmailId === `survey-${currentMonitoreoSurvey.id}`}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-3 py-2 rounded-xl font-bold text-[10px] uppercase flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        title="Enviar encuesta por correo a todos los pendientes con correo registrado"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {sendingEmailId === `survey-${currentMonitoreoSurvey.id}` ? 'Enviando...' : 'Enviar pendientes'}
                      </button>
                    )}
                    <div className="flex items-center gap-4 bg-white/5 px-4 py-2.5 rounded-xl border border-white/5">
                      <div className="text-center">
                        <span className="text-[10px] text-slate-400 block font-bold uppercase">Respondieron</span>
                        <span className="text-lg font-black font-mono text-fuchsia-400">{monitoreoData.respondedCount} <span className="text-xs text-white">de {monitoreoData.totalCount}</span></span>
                      </div>
                      <div className="w-[1px] bg-white/10 h-8"></div>
                      <div className="text-center">
                        <span className="text-[10px] text-slate-400 block font-bold uppercase">Progreso</span>
                        <span className="text-lg font-black font-mono text-emerald-400">{monitoreoData.percentage}%</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Grid List of executives status */}
                <div className="border border-slate-100 rounded-2xl overflow-hidden bg-white">
                  <div className="bg-slate-50/50 px-4 py-3 border-b border-slate-100 flex justify-between items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Ejecutivo</span>
                    <span>Estado encuesta</span>
                  </div>

                  <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
                    {monitoreoData.list.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 text-xs">No hay ejecutivos con asistencia registrada en el Día 5 de esta capacitación.</div>
                    ) : (
                      monitoreoData.list.map((item) => {
                        const hasResp = item.hasResponded;
                        const det = item.responseDetails;
                        const customLinkCopied = copiedDniId === item.participant.id;
                        
                        return (
                          <div key={item.participant.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 hover:bg-slate-50/30">
                            <div>
                              <span className="text-xs font-bold text-slate-800 block">
                                {item.participant.nombres} {item.participant.apellidos}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono font-medium block mt-0.5">DNI: {item.participant.dni} | Correo: {item.participant.correo || 'S/C'}</span>
                            </div>

                            <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                              {hasResp && det ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-400 font-mono block">
                                    Respondió el: {det.fecha_respuesta.split('T')[0]}
                                  </span>
                                  <span className={`px-2.5 py-1 rounded-full text-[9px] font-extrabold uppercase border ${getSatisfactionLevel_20(det.final_score_20).color}`}>
                                    {det.final_score_20} / 20 ({det.classification})
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setViewingResponse(det)}
                                    className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 border border-indigo-150 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                    title="Ver respuesta de la encuesta"
                                  >
                                    <Eye className="w-3 h-3" />
                                    Ver respuesta
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-full text-[9px] font-bold uppercase bg-amber-50 text-amber-700 border border-amber-100">
                                    Pendiente
                                  </span>
                                  {currentMonitoreoSurvey.estado === 'Habilitada' && canSendSurveyEmails && (
                                    <>
                                      <button
                                        onClick={() => handleCopyPersonalLink(currentMonitoreoSurvey.token, item.participant.dni, item.participant.id)}
                                        className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 border border-indigo-150 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                        title="Copia link con el DNI pre-rellenado para el ejecutivo"
                                      >
                                        {customLinkCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                        {customLinkCopied ? 'Copiado!' : 'Copiar Link'}
                                      </button>
                                      <button
                                        onClick={() => handleSendPersonalEmail(currentMonitoreoSurvey, item.participant)}
                                        disabled={!item.participant.correo || sendingEmailId === item.participant.id}
                                        className="text-[10px] font-extrabold text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border border-emerald-150 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                        title="Enviar enlace personalizado por correo"
                                      >
                                        <Mail className="w-3 h-3" />
                                        {sendingEmailId === item.participant.id ? 'Enviando...' : 'Enviar correo'}
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {viewingResponse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">Respuesta de encuesta</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {viewingResponse.nombre_ejecutivo} · DNI {viewingResponse.dni} · {viewingResponse.fecha_respuesta.split('T')[0]}
                </p>
              </div>
              <button type="button" onClick={() => setViewingResponse(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Cerrar</button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[viewingResponse.q1, viewingResponse.q2, viewingResponse.q3, viewingResponse.q4, viewingResponse.q5, viewingResponse.q6, viewingResponse.q7, viewingResponse.q8].map((score, index) => (
                  <div key={index} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
                    <p className="text-[10px] font-black uppercase text-slate-400">Pregunta {index + 1}</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{score}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                <p className="text-xs font-bold text-indigo-700">Resultado final</p>
                <p className="mt-1 text-xl font-black text-indigo-950">{viewingResponse.final_score_20} / 20 · {viewingResponse.classification}</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-100 p-4"><p className="text-xs font-black text-slate-700">Aspectos positivos</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{viewingResponse.comentario_positivo || 'Sin comentario.'}</p></div>
                <div className="rounded-xl border border-slate-100 p-4"><p className="text-xs font-black text-slate-700">Aspectos de mejora</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{viewingResponse.aspecto_mejora || 'Sin comentario.'}</p></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'links' && (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs space-y-5" id="links-tab-content">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-slate-800 font-extrabold text-sm flex items-center gap-2">
              <Link2 className="w-4.5 h-4.5 text-indigo-500" />
              LINKS
            </h3>
          </div>
          {assignedLinkSurveys.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs font-bold">
              No tienes enlaces de encuestas habilitados o asignados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-extrabold">
                    <th className="p-3">Generación</th>
                    <th className="p-3">Campaña</th>
                    <th className="p-3">Formador</th>
                    <th className="p-3">Enlace</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignedLinkSurveys.map((survey) => {
                    const origin = window.location.origin + window.location.pathname;
                    const fullLink = `${origin}?view=survey&token=${survey.token}`;
                    return (
                      <tr key={survey.id} className="hover:bg-slate-50/40 font-medium text-slate-700">
                        <td className="p-3 font-extrabold text-slate-800 whitespace-nowrap">{getSurveyGenerationCode(survey)}</td>
                        <td className="p-3 whitespace-nowrap">{survey.campaña}</td>
                        <td className="p-3 whitespace-nowrap">{getTrainerDisplayName(survey.formador_id, survey.formador_nombre)}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5 max-w-[420px]">
                            <input type="text" readOnly value={fullLink} className="bg-slate-50 border border-slate-200 text-slate-500 rounded-lg px-2 py-1 text-[9px] font-mono outline-hidden flex-1 truncate" />
                            <button type="button" onClick={() => handleCopyLink(survey.token, survey.id)} className="bg-slate-100 hover:bg-slate-200 p-1.5 rounded-lg text-slate-500 transition-colors" title="Copiar enlace">
                              {copiedSurveyId === survey.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4.5: CONFIGURACION DE ENLACES (HABILITAR/DESACTIVAR/ELIMINAR) */}
      {activeTab === 'configuracion' && permissions[currentUser.rol]?.canCreateSurvey && (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs space-y-5" id="configuracion-tab-content">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-slate-800 font-extrabold text-sm flex items-center gap-2">
                <ClipboardCheck className="w-4.5 h-4.5 text-indigo-500" />
                Habilitar y Administrar Enlaces de Encuestas
              </h3>
              <p className="text-slate-400 text-[11px] mt-0.5">Habilite el enlace interno al finalizar una capacitación para que los ejecutivos puedan evaluar el desempeño.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-extrabold">
                  <th className="p-3">Generación</th>
                  <th className="p-3">Campaña</th>
                  <th className="p-3">Formador</th>
                  <th className="p-3">Estado Encuesta</th>
                  <th className="p-3">Enlace de Acceso</th>
                  <th className="p-3">Acceso Interno</th>
                  <th className="p-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleSurveys.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400 font-bold">No hay encuestas registradas bajo tu alcance de vista.</td>
                  </tr>
                ) : (
                  visibleSurveys.map((s) => {
                    const isCopied = copiedSurveyId === s.id;
                    const origin = window.location.origin + window.location.pathname;
                    const fullLink = `${origin}?view=survey&token=${s.token}`;

                    return (
                      <tr key={s.id} className="hover:bg-slate-50/40 font-medium text-slate-700">
                        <td className="p-3 font-extrabold text-slate-800 whitespace-nowrap">{getSurveyGenerationCode(s)}</td>
                        <td className="p-3 whitespace-nowrap">{s.campaña}</td>
                        <td className="p-3 whitespace-nowrap">{getTrainerDisplayName(s.formador_id, s.formador_nombre)}</td>
                        <td className="p-3">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                            s.estado === 'Habilitada' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                            s.estado === 'Cerrada' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                            s.estado === 'Borrador' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                            'bg-slate-50 text-slate-500 border border-slate-100' // Deshabilitada
                          }`}>
                            {s.estado}
                          </span>
                        </td>
                        <td className="p-3">
                          {s.estado === 'Habilitada' && s.token ? (
                            <div className="flex items-center gap-1.5 max-w-[280px]">
                              <input
                                type="text"
                                readOnly
                                value={fullLink}
                                className="bg-slate-50 border border-slate-200 text-slate-500 rounded-lg px-2 py-1 text-[9px] font-mono outline-hidden flex-1 truncate"
                              />
                              <button
                                onClick={() => handleCopyLink(s.token, s.id)}
                                className="bg-slate-100 hover:bg-slate-200 p-1.5 rounded-lg text-slate-500 transition-colors cursor-pointer"
                                title="Copiar enlace"
                              >
                                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => onOpenPublicSurvey(s.token)}
                                className="bg-indigo-50 hover:bg-indigo-100 p-1.5 rounded-lg text-indigo-600 transition-colors cursor-pointer"
                                title="Abrir Formulario de Encuesta"
                              >
                                <Link2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[10px] italic">
                              {s.estado === 'Habilitada' ? 'Enlace disponible solo para usuarios asignados' : 'No disponible (Encuesta desactivada)'}
                            </span>
                          )}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500">{s.link_assigned_user_ids?.length || 0} asignados</span>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => openAssignmentModal(s)}
                                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 p-1.5 rounded-lg transition-colors"
                                title="Asignar usuarios al enlace"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Actions to move between states */}
                            {s.estado !== 'Habilitada' && (
                              <button
                                onClick={() => onUpdateSurveyStatus(s.id, 'Habilitada')}
                                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-xl font-bold text-[10px] uppercase flex items-center gap-1 transition-all cursor-pointer border border-emerald-200"
                              >
                                <Play className="w-3 h-3 fill-emerald-700" />
                                Habilitar
                              </button>
                            )}
                            {s.estado === 'Habilitada' && (
                              <>
                                <button
                                  onClick={() => onUpdateSurveyStatus(s.id, 'Deshabilitada')}
                                  className="bg-amber-50 hover:bg-amber-100 text-amber-700 px-3 py-1.5 rounded-xl font-bold text-[10px] uppercase flex items-center gap-1 transition-all cursor-pointer border border-amber-200"
                                >
                                  Deshabilitar
                                </button>
                                <button
                                  onClick={() => onUpdateSurveyStatus(s.id, 'Cerrada')}
                                  className="bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-1.5 rounded-xl font-bold text-[10px] uppercase flex items-center gap-1 transition-all cursor-pointer border border-rose-200"
                                >
                                  <Square className="w-3 h-3 fill-rose-700" />
                                  Cerrar
                                </button>
                              </>
                            )}
                            {s.estado === 'Deshabilitada' && (
                              <button
                                onClick={() => onUpdateSurveyStatus(s.id, 'Cerrada')}
                                className="bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-1.5 rounded-xl font-bold text-[10px] uppercase flex items-center gap-1 transition-all cursor-pointer border border-rose-200"
                              >
                                Cerrar
                              </button>
                            )}

                            {/* Only administrator can soft delete surveys */}
                            {isAdmin && (
                              <button
                                onClick={() => handleDeleteSurveyClick(s.id, s.codigo_generacion)}
                                className="bg-rose-50 hover:bg-rose-100 text-rose-600 p-2 rounded-xl transition-all border border-rose-100 cursor-pointer"
                                title="Eliminar encuesta"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {assignmentSurveyId && isAdmin && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl p-6 space-y-5 border border-slate-100">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-slate-800 font-extrabold text-base">Asignar enlace de encuesta</h3>
              <p className="text-slate-400 text-[11px] mt-1">Selecciona los usuarios que podrán ver y copiar este enlace en LINKS.</p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-xl">
              {assignableUsers.map((user) => (
                <label key={user.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignmentUserIds.includes(user.id)}
                    onChange={(event) => setAssignmentUserIds((current) =>
                      event.target.checked
                        ? Array.from(new Set([...current, user.id]))
                        : current.filter((id) => id !== user.id),
                    )}
                    className="h-4 w-4 accent-fuchsia-600"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{user.nombre}</p>
                    <p className="text-[10px] text-slate-400">{user.rol} · {user.usuario}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setAssignmentSurveyId(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl py-3 text-xs">Cancelar</button>
              <button type="button" onClick={saveAssignments} className="flex-1 bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold rounded-xl py-3 text-xs">Guardar asignaciones</button>
            </div>
          </div>
        </div>
      )}

      {isCreateModalOpen && permissions[currentUser.rol]?.canCreateSurvey && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="survey-creation-modal">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl p-6 sm:p-7 space-y-5 border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-fuchsia-600" />
                <h3 className="text-slate-800 font-extrabold text-base tracking-tight">Crear Nueva Encuesta de Satisfacción</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-black leading-none cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSurveySubmit} className="space-y-4 text-xs font-semibold">
              {/* Select Capacitacion */}
              <div className="space-y-1">
                <label className="text-slate-500 font-bold block">Selecciona Capacitación <span className="text-rose-500">*</span></label>
                <select
                  required
                  value={selectedSessionId}
                  onChange={(e) => handleSelectSessionInModal(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl px-3 py-2.5 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500"
                >
                  <option value="">-- Seleccionar capacitación activa --</option>
                  {sessionsWithoutSurvey.map(s => (
                    <option key={s.id} value={s.id}>
                      [{s.campaña}] {s.nombre_generacion || s.generation_code} - {s.formador_nombre}
                    </option>
                  ))}
                </select>
                {sessionsWithoutSurvey.length === 0 && (
                  <p className="text-[10px] text-amber-600 italic mt-1 font-medium">Todas las capacitaciones cargadas actualmente ya tienen una encuesta de satisfacción vinculada.</p>
                )}
              </div>

              {selectedSessionId && selectedSessionObj ? (
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3 animate-fade-in">
                  <span className="text-[9px] text-fuchsia-600 font-extrabold uppercase font-mono block tracking-wide">Detalles de la Capacitación</span>
                  
                  <div className="grid grid-cols-2 gap-3 text-xs font-semibold text-slate-700">
                    <div>
                      <span className="block text-[10px] text-slate-400">Campaña:</span>
                      <span className="font-bold">{selectedSessionObj.campaña}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Generación:</span>
                      <span className="font-bold">{selectedSessionObj.nombre_generacion || selectedSessionObj.generation_code}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Formador asignado:</span>
                      <span className="font-bold text-slate-900">{selectedSessionObj.formador_nombre}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Tipo de Capacitación:</span>
                      <span className="font-bold">{selectedSessionObj.tipo_capacitacion}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Fecha de Inicio:</span>
                      <span className="font-bold">{selectedSessionObj.fecha_inicio}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400">Fecha de Fin:</span>
                      <span className="font-bold">{selectedSessionObj.fecha_fin}</span>
                    </div>
                    <div className="col-span-2 pt-2 border-t border-slate-200/50 flex justify-between items-center">
                      <div>
                        <span className="block text-[10px] text-slate-400">Participantes Cargados:</span>
                        <span className="font-black text-indigo-600 font-mono text-xs">
                          {participants.filter(p => p.training_session_id === selectedSessionId).length} ejecutivos
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 italic font-medium">Se vinculará automáticamente.</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 p-6 rounded-2xl border border-dashed border-slate-200 text-center text-slate-400 text-xs">
                  Selecciona una capacitación arriba para rellenar los metadatos correspondientes.
                </div>
              )}

              {/* Link token / slug slug input */}
              <div className="space-y-1">
                <label className="text-slate-500 font-bold block">Token / Slug del enlace de acceso <span className="text-rose-500">*</span></label>
                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:ring-1 focus-within:ring-fuchsia-500">
                  <span className="text-slate-400 select-none mr-1">/survey&token=</span>
                  <input
                    type="text"
                    required
                    placeholder="Escribe el slug..."
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value.replace(/\s+/g, '-').toUpperCase())}
                    className="bg-transparent border-0 p-0 text-slate-800 text-xs font-bold font-mono outline-hidden flex-1"
                  />
                </div>
                <p className="text-[9px] text-slate-400 font-medium">El sistema rellenará este token basado en el código de generación, puedes editarlo si es necesario.</p>
              </div>

              {/* Survey state selection */}
              <div className="space-y-1">
                <label className="text-slate-500 font-bold block">Estado Inicial de la Encuesta <span className="text-rose-500">*</span></label>
                <select
                  required
                  value={surveyStatus}
                  onChange={(e) => setSurveyStatus(e.target.value as SurveyStatus)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl px-3 py-2 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500"
                >
                  <option value="Borrador">Borrador (Creada, enlace privado, lista de monitoreo inactiva)</option>
                  <option value="Habilitada">Habilitada (Enlace público abierto para que ejecutivos respondan)</option>
                  <option value="Deshabilitada">Deshabilitada (Link público cerrado temporalmente, no recibe respuestas)</option>
                  <option value="Cerrada">Cerrada (No recibe más respuestas, pero alimenta dashboards y reportes)</option>
                </select>
              </div>

              {/* Action buttons */}
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl py-3 cursor-pointer transition-colors text-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!selectedSessionId}
                  className="flex-1 bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:opacity-95 text-white font-bold rounded-xl py-3 cursor-pointer transition-transform shadow-md disabled:opacity-50 disabled:cursor-not-allowed text-center"
                >
                  Guardar Encuesta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. MODAL DE CONFIRMACIÓN DE ELIMINACIÓN (ONLY FOR ADMIN) */}
      {deleteSurveyId && isAdmin && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="survey-delete-modal">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 sm:p-7 space-y-5 border border-slate-100">
            <div className="flex items-center gap-3 text-rose-600 border-b border-slate-100 pb-3">
              <AlertTriangle className="w-6 h-6 animate-pulse" />
              <h3 className="text-slate-800 font-extrabold text-base tracking-tight">Confirmar Eliminación</h3>
            </div>
            <p className="text-slate-600 text-xs leading-relaxed">
              ¿Estás seguro de eliminar esta encuesta? Esta acción quitará la encuesta del historial activo y sus respuestas dejarán de alimentar el dashboard.
            </p>
            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={handleDeleteCancel}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl py-3 cursor-pointer transition-all text-xs text-center border border-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl py-3 cursor-pointer transition-all text-xs text-center shadow-md active:scale-[0.98]"
              >
                Sí, eliminar encuesta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
