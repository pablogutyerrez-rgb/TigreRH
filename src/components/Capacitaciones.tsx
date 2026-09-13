/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Plus,
  BookOpen,
  Calendar,
  User,
  Users,
  Search,
  Filter,
  CheckCircle,
  FileText,
  UploadCloud,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Trash2,
  FileSpreadsheet,
  Grid,
  Clock,
  Edit3,
  X
} from 'lucide-react';
import { TrainingSession, Participant, User as AppUser, AttendanceStatus, AttendanceRecord, TrainingSurvey, SurveyResponse } from '../types';
import { permissions } from '../utils/permissions';
import { getTrainingDays, getTrainingDaysCount } from '../utils/trainingDays';
import { BPO_CAMPAIGNS, getCampaignPrefix, normalizeCampaignName } from '../constants/campaigns';
import {
  getSessionInitialTrainerIds,
  getSessionOjtTrainerIds,
  getSessionTrainerIds,
  getSessionTrainerNames,
  isSessionAssignedTrainer,
} from '../utils/trainingAssignments';

interface CapacitacionesProps {
  sessions: TrainingSession[];
  participants: Participant[];
  attendance?: AttendanceRecord[];
  surveys?: TrainingSurvey[];
  responses?: SurveyResponse[];
  currentUser: AppUser;
  trainers: AppUser[];
  recruiters: AppUser[];
  onAddSession: (newSession: Omit<TrainingSession, 'id' | 'fecha_creacion' | 'formador_nombre' | 'reclutador_nombre'>, uploadedParticipants: Omit<Participant, 'id'>[]) => Promise<void>;
  onDeleteSession: (sessionId: string) => void;
  onViewAttendance: (sessionId: string) => void;
  onCloseCampaign?: (sessionId: string) => void;
  onUpdateSession?: (sessionId: string, updatedFields: Partial<TrainingSession>) => void;
  onAppendParticipants?: (
    sessionId: string,
    participants: Omit<Participant, 'id'>[],
  ) => void;
  onAuditLog?: (action: string, module: string, detail: string, campaign?: string, generation?: string) => void;
}

// Sample CSV templates for testing
const DEMO_CSV_TEMPLATES = [
  {
    name: 'Plantilla Ideal (Columnas Exactas)',
    data: `DNI,nombres,apellidos,celular,correo,puesto,fuente_reclutamiento,observacion
44112233,Mateo,Pérez Rojas,988112233,mateo.perez@gmail.com,Asesor BPO,Computrabajo,Postulante idóneo
44112244,Gabriela,Flores Solano,988112244,gaby.flores@outlook.com,Asesor BPO,Indeed,Tiene experiencia
44112255,César Augusto,Vela Palomino,988112255,cesar.vela@gmail.com,Asesor BPO,Facebook,Excelente actitud`
  },
  {
    name: 'Plantilla con Nombres Diferentes (Mapear Columnas)',
    data: `Documento;Nombre completo;Teléfono;Email;Cargo;Origen;Comentario
55112211;María Fe Mendoza;912345678;maria.fe@gmail.com;Ejecutivo de Cuentas;Referido;Inglés intermedio
55112222;Leonardo Silva Alva;912345679;leo.silva@hotmail.com;Ejecutivo de Cuentas;Computrabajo;Proactivo
55112233;Patricia Luna Santillán;912345680;paty.luna@gmail.com;Ejecutivo de Cuentas;Facebook Ads;Reingreso`
  },
  {
    name: 'Plantilla con Errores y Duplicados (Prueba de Validación)',
    data: `DNI,nombres,apellidos,celular,correo,puesto,fuente_reclutamiento,observacion
12121212,Juan,Ríos,900000001,juan.rios@gmail.com,Analista,Indeed,Registro correcto
12121212,Juan,Ríos,900000001,juan.rios@gmail.com,Analista,Indeed,Duplicado detectado por DNI
,Sin DNI,Persona,900000002,no-dni@gmail.com,Analista,Referido,DNI vacío (Error)
99999999,Sofía,,900000003,sofia@gmail.com,Analista,Computrabajo,Sin Apellidos (Válido con alerta)`
  }
];

const getTrainingIdentifier = (
  session?: Pick<TrainingSession, 'generation_code' | 'nombre_generacion'>,
) => session?.generation_code?.trim() || session?.nombre_generacion?.trim() || 'Sin código';

const TrainerMultiSelect = ({
  label,
  trainerIds,
  trainers,
  onChange,
  required = false,
}: {
  label: string;
  trainerIds: string[];
  trainers: AppUser[];
  onChange: (ids: string[]) => void;
  required?: boolean;
}) => (
  <div>
    <label className="mb-1 block text-xs font-semibold text-slate-600">{label}{required ? ' *' : ''}</label>
    <details className="rounded-xl border border-slate-200 bg-slate-50">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-slate-700">
        {trainerIds.length === 0 ? 'Seleccionar formadores' : `${trainerIds.length} formador(es) seleccionado(s)`}
      </summary>
      <div className="max-h-52 space-y-1 overflow-y-auto border-t border-slate-200 p-2">
        {trainers.map((trainer) => (
          <label key={trainer.id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50">
            <input
              type="checkbox"
              checked={trainerIds.includes(trainer.id)}
              onChange={() => onChange(trainerIds.includes(trainer.id)
                ? trainerIds.filter((id) => id !== trainer.id)
                : [...trainerIds, trainer.id])}
              className="h-4 w-4 accent-indigo-600"
            />
            <span>{trainer.nombre}</span>
          </label>
        ))}
      </div>
    </details>
    {trainerIds.length > 0 && (
      <p className="mt-1 truncate text-[11px] text-slate-500" title={trainers.filter((trainer) => trainerIds.includes(trainer.id)).map((trainer) => trainer.nombre).join(', ')}>
        {trainers.filter((trainer) => trainerIds.includes(trainer.id)).map((trainer) => trainer.nombre).join(', ')}
      </p>
    )}
  </div>
);

export default function Capacitaciones({
  sessions,
  participants,
  attendance = [],
  surveys = [],
  responses = [],
  currentUser,
  trainers,
  recruiters,
  onAddSession,
  onDeleteSession,
  onViewAttendance,
  onCloseCampaign,
  onUpdateSession,
  onAppendParticipants,
  onAuditLog
}: CapacitacionesProps) {
  const [view, setView] = useState<'list' | 'create'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCampaña, setFilterCampaña] = useState('todos');
  const [filterEstado, setFilterEstado] = useState('todos');
  const [isSavingTraining, setIsSavingTraining] = useState(false);

  // Form State
  const [fechaInicio, setFechaInicio] = useState('2026-07-02');
  const [fechaFin, setFechaFin] = useState('2026-07-06');
  const [campaña, setCampaña] = useState<string>(BPO_CAMPAIGNS[0]);
  const [tipoCapacitacion, setTipoCapacitacion] = useState('Capacitación regular');
  const [formadorInicialIds, setFormadorInicialIds] = useState<string[]>([]);
  const [formadorOjtIds, setFormadorOjtIds] = useState<string[]>([]);
  const [reclutadorId, setReclutadorId] = useState(
    currentUser.rol === 'Reclutador' ? currentUser.id : '',
  );
  const [modalidad, setModalidad] = useState<'Presencial' | 'Virtual' | 'Híbrida'>('Presencial');
  const [turno, setTurno] = useState<'Part time' | 'Full time' | 'Mini full'>('Full time');
  const [horaCapacitacion, setHoraCapacitacion] = useState('08:00');
  const [observaciones, setObservaciones] = useState('');

  // Editing Training states
  const [editingSession, setEditingSession] = useState<TrainingSession | null>(null);
  const [editCampaña, setEditCampaña] = useState('');
  const [editFechaInicio, setEditFechaInicio] = useState('');
  const [editFechaFin, setEditFechaFin] = useState('');
  const [editHoraCapacitacion, setEditHoraCapacitacion] = useState('');
  const [editTurno, setEditTurno] = useState<'Part time' | 'Full time' | 'Mini full'>('Full time');
  const [editTipoCapacitacion, setEditTipoCapacitacion] = useState('Capacitación regular');
  const [editFormadorInicialIds, setEditFormadorInicialIds] = useState<string[]>([]);
  const [editFormadorOjtIds, setEditFormadorOjtIds] = useState<string[]>([]);
  const [editReclutadorId, setEditReclutadorId] = useState('');
  const [editEstado, setEditEstado] = useState<'Pendiente de inicio' | 'En curso' | 'Activa' | 'Campaña cerrada' | 'Capacitación cerrada'>('En curso');
  const [editObservaciones, setEditObservaciones] = useState('');
  const [editManualGenerationCode, setEditManualGenerationCode] = useState('');

  // Closing/Reopening Training States
  const [sessionToClose, setSessionToClose] = useState<TrainingSession | null>(null);
  const [sessionToReopen, setSessionToReopen] = useState<TrainingSession | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  // Find session participants
  const sessionParts = useMemo(() => {
    if (!sessionToClose) return [];
    return participants.filter(p => p.training_session_id === sessionToClose.id);
  }, [sessionToClose, participants]);

  // Dynamic conditions check for closing modal
  const validationDetails = useMemo(() => {
    if (!sessionToClose) {
      return {
        isAttendanceComplete: false,
        isResultadoFormacionCompleto: false,
        isCommentsComplete: false,
        isSurveyComplete: false,
        isAptosDefined: false,
        habilitadosCount: 0,
        respondieronCount: 0,
        pendientesCount: 0,
        pendientesList: [] as Participant[]
      };
    }

    const sessionId = sessionToClose.id;
    const requiredDays = getTrainingDays(sessionToClose);

    // Condition 1: Asistencia completa
    const checkAttendanceDay = (p: Participant, day: number) => {
      const pAtts = attendance.filter(a => a.participant_id === p.id && a.training_session_id === sessionId);
      const desistedDays = pAtts.filter(a => a.estado_asistencia === 'Desistió' || a.estado_asistencia === 'Baja').map(a => a.dia);
      if (desistedDays.some(d => d < day) || p.estado_final === 'Desistió') {
        return true; // excused
      }
      const record = pAtts.find(a => a.dia === day);
      if (!record) return false;
      const status = record.estado_asistencia;
      if (!status || status === 'Seleccionar' || status === 'Pendiente' || (status as string) === 'Marcar' || (status as string) === '') {
        return false;
      }
      return ['Asistió', 'Faltó', 'Tardanza', 'Descanso médico', 'Desistió', 'Baja', 'Feriado'].includes(status);
    };

    const isAttendanceComplete = sessionParts.length > 0 && sessionParts.every(p => {
      return requiredDays.every(d => checkAttendanceDay(p, d));
    });

    // Condition 2: Resultado de formación completo
    const isResultadoFormacionCompleto = sessionParts.length > 0 && sessionParts.every(p => {
      if (p.estado_final === 'Desistió' || p.estado_final === 'No asistió') {
        return true;
      }
      const res = p.resultado_formacion;
      return res === 'Apto' || res === 'No apto';
    });

    // Condition 2b: Comentarios completos
    const isCommentsComplete = sessionParts.length > 0 && sessionParts.every(p => {
      if (p.estado_final === 'Desistió' || p.estado_final === 'No asistió') {
        return true;
      }
      const res = p.resultado_formacion;
      if (res === 'Apto') {
        return !!p.comentario_aptitud?.trim();
      }
      if (res === 'No apto') {
        return !!p.motivo_no_apt?.trim();
      }
      return true;
    });

    // Condition 3: Encuesta de satisfacción completada
    const survey = surveys.find(s => s.training_session_id === sessionId);
    const surveyCreated = !!survey;
    const surveyEnabledOrClosed = survey ? (survey.estado === 'Habilitada' || survey.estado === 'Cerrada') : false;
    const surveyLinkGenerated = survey ? !!survey.token : false;

    // Helper to calculate eligibility
    const isHabilitado = (p: Participant) => {
      if (p.estado_final === 'Desistió' || p.estado_final === 'No asistió') {
        return false;
      }
      const pAttendance = attendance.filter(a =>
        a.participant_id === p.id &&
        a.training_session_id === sessionId &&
        requiredDays.includes(a.dia)
      );
      if (pAttendance.length === 0) return true;
      const presentCount = pAttendance.filter(
        a => a.estado_asistencia === 'Asistió' || a.estado_asistencia === 'Tardanza'
      ).length;
      const attendancePercent = Math.round((presentCount / pAttendance.length) * 100);
      return attendancePercent >= 80;
    };

    const habilitados = sessionParts.filter(isHabilitado);
    const respondieron = survey ? habilitados.filter(p => responses.some(r => r.training_survey_id === survey.id && r.dni === p.dni)) : [];
    const pendientes = survey ? habilitados.filter(p => !responses.some(r => r.training_survey_id === survey.id && r.dni === p.dni)) : habilitados;

    const isSurveyComplete = surveyCreated && surveyEnabledOrClosed && surveyLinkGenerated && pendientes.length === 0 && habilitados.length > 0;

    // Condition 4: Aptos definidos para operación
    const isAptosDefined = sessionParts.length > 0 && sessionParts.some(p => p.resultado_formacion === 'Apto' || p.resultado_formacion === 'No apto');

    return {
      isAttendanceComplete,
      isResultadoFormacionCompleto,
      isCommentsComplete,
      isSurveyComplete,
      isAptosDefined,
      habilitadosCount: habilitados.length,
      respondieronCount: respondieron.length,
      pendientesCount: pendientes.length,
      pendientesList: pendientes
    };
  }, [sessionToClose, participants, attendance, surveys, responses, sessionParts]);

  // Initiate close routine
  const handleInitiateClose = (session: TrainingSession) => {
    setSessionToClose(session);

    const sParts = participants.filter(p => p.training_session_id === session.id);

    const requiredDays = getTrainingDays(session);
    const checkAttendanceDay = (p: Participant, day: number) => {
      const pAtts = attendance.filter(a => a.participant_id === p.id && a.training_session_id === session.id);
      const desistedDays = pAtts.filter(a => a.estado_asistencia === 'Desistió' || a.estado_asistencia === 'Baja').map(a => a.dia);
      if (desistedDays.some(d => d < day) || p.estado_final === 'Desistió') return true;
      const record = pAtts.find(a => a.dia === day);
      if (!record) return false;
      const status = record.estado_asistencia;
      if (!status || status === 'Seleccionar' || status === 'Pendiente' || (status as string) === 'Marcar' || (status as string) === '') return false;
      return ['Asistió', 'Faltó', 'Tardanza', 'Descanso médico', 'Desistió', 'Baja', 'Feriado'].includes(status);
    };

    const isAttendanceComplete = sParts.length > 0 && sParts.every(p => requiredDays.every(d => checkAttendanceDay(p, d)));

    const isResultadoFormacionCompleto = sParts.length > 0 && sParts.every(p => {
      if (p.estado_final === 'Desistió' || p.estado_final === 'No asistió') return true;
      return p.resultado_formacion === 'Apto' || p.resultado_formacion === 'No apto';
    });

    const isCommentsComplete = sParts.length > 0 && sParts.every(p => {
      if (p.estado_final === 'Desistió' || p.estado_final === 'No asistió') return true;
      if (p.resultado_formacion === 'Apto') return !!p.comentario_aptitud?.trim();
      if (p.resultado_formacion === 'No apto') return !!p.motivo_no_apt?.trim();
      return true;
    });

    const survey = surveys.find(s => s.training_session_id === session.id);
    const isHabilitado = (p: Participant) => {
      if (p.estado_final === 'Desistió' || p.estado_final === 'No asistió') return false;
      const pAttendance = attendance.filter(a =>
        a.participant_id === p.id &&
        a.training_session_id === session.id &&
        requiredDays.includes(a.dia)
      );
      if (pAttendance.length === 0) return true;
      const presentCount = pAttendance.filter(a => a.estado_asistencia === 'Asistió' || a.estado_asistencia === 'Tardanza').length;
      return Math.round((presentCount / pAttendance.length) * 100) >= 80;
    };
    const habilitados = sParts.filter(isHabilitado);
    const pendientes = survey ? habilitados.filter(p => !responses.some(r => r.training_survey_id === survey.id && r.dni === p.dni)) : habilitados;
    const isSurveyComplete = !!survey && (survey.estado === 'Habilitada' || survey.estado === 'Cerrada') && pendientes.length === 0 && habilitados.length > 0;

    const isAptosDefined = sParts.length > 0 && sParts.some(p => p.resultado_formacion === 'Apto' || p.resultado_formacion === 'No apto');

    const allConditionsMet = isAttendanceComplete && isResultadoFormacionCompleto && isCommentsComplete && isSurveyComplete && isAptosDefined;

    // Log 1: Formador intenta cerrar capacitación
    if (onAuditLog) {
      onAuditLog(
        'Intento de cierre de capacitación',
        'Control de asistencia',
        `El formador inició el proceso de cierre para la capacitación "${getTrainingIdentifier(session)}".`,
        session.campaña,
        getTrainingIdentifier(session)
      );
    }

    // Log 2: Sistema valida requisitos de cierre
    if (onAuditLog) {
      onAuditLog(
        'Validación de requisitos de cierre',
        'Control de asistencia',
        `El sistema evaluó los requisitos. Asistencia: ${isAttendanceComplete ? 'COMPLETO' : 'PENDIENTE'}, Resultado: ${isResultadoFormacionCompleto ? 'COMPLETO' : 'PENDIENTE'}, Comentarios: ${isCommentsComplete ? 'COMPLETO' : 'PENDIENTE'}, Encuesta: ${isSurveyComplete ? 'COMPLETO' : 'PENDIENTE'}, Aptos: ${isAptosDefined ? 'COMPLETO' : 'PENDIENTE'}.`,
        session.campaña,
        session.nombre_generacion
      );
    }

    // Log 3: Formador intenta cerrar con pendientes
    if (!allConditionsMet && onAuditLog) {
      onAuditLog(
        'Intento de cierre con pendientes',
        'Control de asistencia',
        `El formador visualizó los requisitos pendientes de cierre para la capacitación "${getTrainingIdentifier(session)}".`,
        session.campaña,
        getTrainingIdentifier(session)
      );
    }
  };

  // Initiate reopen routine
  const handleInitiateReopen = (session: TrainingSession) => {
    setSessionToReopen(session);
    setReopenReason('');
  };

  // Confirm reopen routine
  const handleConfirmReopen = () => {
    if (!sessionToReopen) return;
    const minimumReasonLength = currentUser.rol === 'Administrador' ? 1 : 15;
    if (reopenReason.trim().length < minimumReasonLength) {
      alert(currentUser.rol === 'Administrador'
        ? 'Ingresa el motivo de la reapertura.'
        : 'El motivo de reapertura debe tener al menos 15 caracteres.');
      return;
    }

    // Call update session to change state to 'En curso'
    if (onUpdateSession) {
      onUpdateSession(sessionToReopen.id, { estado: 'En curso' });
    }

    // Log: Reapertura de capacitación
    if (onAuditLog) {
      onAuditLog(
        'Reapertura de capacitación',
        'Registro de Capacitaciones',
        `Se reabrió la capacitación "${getTrainingIdentifier(sessionToReopen)}". Motivo de reapertura: "${reopenReason.trim()}".`,
        sessionToReopen.campaña,
        getTrainingIdentifier(sessionToReopen)
      );
    }

    setSessionToReopen(null);
    setReopenReason('');
  };

  // File Upload State
  const [rawText, setRawText] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploadedFileFormat, setUploadedFileFormat] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [parsedColumns, setParsedColumns] = useState<{
    id: string;
    label: string;
    originalName: string;
    index: number;
    field: string;
  }[]>([]);
  const [delimiter, setDelimiter] = useState(',');

  // Column Mappings State
  const [mappingDni, setMappingDni] = useState('');
  const [mappingNombres, setMappingNombres] = useState('');
  const [mappingApellidos, setMappingApellidos] = useState('');
  const [mappingNombreCompleto, setMappingNombreCompleto] = useState('');
  const [mappingCelular, setMappingCelular] = useState('');
  const [mappingCorreo, setMappingCorreo] = useState('');
  const [mappingPuesto, setMappingPuesto] = useState('');
  const [mappingFuente, setMappingFuente] = useState('');
  const [mappingObservacion, setMappingObservacion] = useState('');

  // Validation Preview
  const [showPreview, setShowPreview] = useState(false);
  const [validationSummary, setValidationSummary] = useState({
    total: 0,
    valid: 0,
    error: 0,
    dups: 0
  });
  const [validatedParticipants, setValidatedParticipants] = useState<Omit<Participant, 'id'>[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Helper to parse date into parts YYYY, MM, DD
  const parseDateParts = (dateStr: string) => {
    if (!dateStr) return { year: '2026', month: '01', day: '01' };
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return {
        year: parts[0],
        month: parts[1],
        day: parts[2]
      };
    }
    return { year: '2026', month: '01', day: '01' };
  };

  const buildTrainingCode = (
    campaignName: string,
    startDate: string,
    excludeSessionId?: string,
  ) => {
    try {
      const prefix = getCampaignPrefix(campaignName);
      const { year, month, day } = parseDateParts(startDate);
      const baseCode = `CAP-${prefix}${year}${day}${month}`;
      const targetCampaign = normalizeCampaignName(campaignName);

      const usedCodes = new Set(
        sessions
          .filter((s) => s.id !== excludeSessionId)
          .map((s) => getTrainingIdentifier(s)),
      );
      const maxHistoricalSuffix = sessions
        .filter((s) => {
          if (s.id === excludeSessionId) return false;
          return normalizeCampaignName(s.campaña) === targetCampaign;
        })
        .reduce((max, s) => {
          const code = getTrainingIdentifier(s);
          if (!code.startsWith(`CAP-${prefix}`)) return max;
          const match = code.match(/-(\d{2,})$/);
          const suffix = match ? Number(match[1]) : 0;
          return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
        }, 0);

      let nextSuffix = maxHistoricalSuffix + 1;
      let candidate = `${baseCode}-${String(nextSuffix).padStart(2, "0")}`;
      while (usedCodes.has(candidate)) {
        nextSuffix += 1;
        candidate = `${baseCode}-${String(nextSuffix).padStart(2, "0")}`;
      }
      return candidate;
    } catch {
      return '';
    }
  };

  // Dynamically calculate the generation_code for the selected campaign
  const generationCode = useMemo(() => {
    return buildTrainingCode(campaña, fechaInicio);
  }, [campaña, fechaInicio, sessions]);

  const editGenerationCode = useMemo(() => {
    if (!editingSession) return '';
    return buildTrainingCode(editCampaña, editFechaInicio, editingSession.id);
  }, [editCampaña, editFechaInicio, editingSession, sessions]);

  const editDisplayedCode = useMemo(() => {
    if (!editingSession) return '';
    if (currentUser.rol === 'Administrador') return editManualGenerationCode.trim();
    const { year, month, day } = parseDateParts(editFechaInicio);
    const expectedBaseCode = `CAP-${getCampaignPrefix(editCampaña)}${year}${day}${month}`;
    const currentCode = getTrainingIdentifier(editingSession);
    return currentCode.startsWith(expectedBaseCode) ? currentCode : editGenerationCode;
  }, [currentUser.rol, editCampaña, editFechaInicio, editGenerationCode, editManualGenerationCode, editingSession]);
  // Set default formador
  React.useEffect(() => {
    if (trainers.length > 0 && formadorInicialIds.length === 0) {
      setFormadorInicialIds([trainers[0].id]);
    }
  }, [trainers, formadorInicialIds.length]);

  React.useEffect(() => {
    if (currentUser.rol === 'Reclutador') {
      setReclutadorId(currentUser.id);
    } else if (!reclutadorId && recruiters.length > 0) {
      setReclutadorId(recruiters[0].id);
    }
  }, [currentUser, recruiters, reclutadorId]);

  // Handle manual generation name trigger
  const handleCampañaChange = (newCamp: string) => {
    const oldCamp = campaña;
    setCampaña(newCamp);

    if (onAuditLog && oldCamp !== newCamp) {
      const recalculatedCode = buildTrainingCode(newCamp, fechaInicio);

      onAuditLog(
        'Cambio de campaña antes de guardar',
        'Registro de capacitaciones',
        `Se cambió la campaña de "${oldCamp}" a "${newCamp}" en el formulario de creación. El código se recalculó automáticamente a "${recalculatedCode}".`,
        newCamp,
        recalculatedCode
      );
    }
  };

  const startEditing = (s: TrainingSession) => {
    setEditingSession(s);
    setEditCampaña(s.campaña);
    setEditFechaInicio(s.fecha_inicio);
    setEditFechaFin(s.fecha_fin);
    setEditHoraCapacitacion(s.hora_capacitacion || '08:00');
    setEditTurno(s.turno as any);
    setEditTipoCapacitacion(s.tipo_capacitacion);
    setEditFormadorInicialIds(getSessionInitialTrainerIds(s));
    setEditFormadorOjtIds(getSessionOjtTrainerIds(s));
    setEditReclutadorId(s.reclutador_id || '');
    setEditEstado(s.estado as any);
    setEditObservaciones(s.observaciones || '');
    setEditManualGenerationCode(getTrainingIdentifier(s));
  };

  const handleEditCampaignChange = (nextCampaign: string) => {
    setEditCampaña(nextCampaign);
    if (editingSession && currentUser.rol === 'Administrador') {
      setEditManualGenerationCode(buildTrainingCode(nextCampaign, editFechaInicio, editingSession.id));
    }
  };

  const handleEditStartDateChange = (nextStartDate: string) => {
    setEditFechaInicio(nextStartDate);
    if (editingSession && currentUser.rol === 'Administrador') {
      setEditManualGenerationCode(buildTrainingCode(editCampaña, nextStartDate, editingSession.id));
    }
  };

  const handleSaveEdit = () => {
    if (!editingSession) return;
    const initialTrainers = trainers.filter((trainer) => editFormadorInicialIds.includes(trainer.id));
    const ojtTrainers = trainers.filter((trainer) => editFormadorOjtIds.includes(trainer.id));
    const selectedTrainers = trainers.filter((trainer) =>
      editFormadorInicialIds.includes(trainer.id) || editFormadorOjtIds.includes(trainer.id));
    if (initialTrainers.length === 0) {
      alert('Selecciona al menos un Formador de Capacitación Inicial.');
      return;
    }
    const nextTrainingIdentifier = editManualGenerationCode.trim();
    if (!nextTrainingIdentifier) {
      alert('El código de generación es obligatorio.');
      return;
    }
    if (onUpdateSession) {
      onUpdateSession(editingSession.id, {
        campaña: editCampaña,
        nombre_generacion: nextTrainingIdentifier,
        fecha_inicio: editFechaInicio,
        fecha_fin: editFechaFin,
        hora_capacitacion: editHoraCapacitacion,
        turno: editTurno,
        tipo_capacitacion: editTipoCapacitacion,
        formador_id: initialTrainers[0].id,
        formador_nombre: initialTrainers[0].nombre,
        formador_ids: selectedTrainers.map((trainer) => trainer.id),
        formador_nombres: selectedTrainers.map((trainer) => trainer.nombre),
        formador_capacitacion_inicial_ids: initialTrainers.map((trainer) => trainer.id),
        formador_capacitacion_inicial_nombres: initialTrainers.map((trainer) => trainer.nombre),
        formador_ojt_ids: ojtTrainers.map((trainer) => trainer.id),
        formador_ojt_nombres: ojtTrainers.map((trainer) => trainer.nombre),
        reclutador_id: editReclutadorId,
        estado: editEstado,
        observaciones: editObservaciones,
        generation_code: nextTrainingIdentifier
      });
    }
    if (onAppendParticipants && validatedParticipants.length > 0) {
      onAppendParticipants(editingSession.id, validatedParticipants);
    }
    setValidatedParticipants([]);
    setUploadedFileName('');
    setEditingSession(null);
  };

  // Smart Excel/CSV auto-detect, normalize, and validate engine
  const processExcelRows = (rows: any[][], fileName: string) => {
    if (rows.length === 0) {
      alert('El archivo cargado está vacío.');
      return;
    }

    // 1. Detect Campaign and Generation from file name
    let suggestedCampaña = campaña;
    const uppercaseFileName = fileName.toUpperCase();
    if (uppercaseFileName.includes('RUC 20')) {
      suggestedCampaña = 'Entel Empresas RUC 20';
    } else if (uppercaseFileName.includes('ENTEL EMPRESAS')) {
      suggestedCampaña = BPO_CAMPAIGNS[0];
    } else if (uppercaseFileName.includes('FIJA')) {
      suggestedCampaña = 'Fija';
    } else if (uppercaseFileName.includes('GPON')) {
      suggestedCampaña = 'GPON';
    } else if (uppercaseFileName.includes('CULQI')) {
      suggestedCampaña = 'Culqi';
    }

    setCampaña(suggestedCampaña);

    // 2. Scan rows to find the one with the most matching target headers
    const targetHeaders = [
      'reclutador', 'coordinador', 'ciudad', 'dni', 'nombres completos', 'nombre completo',
      'teléfono', 'telefono', 'celular', 'puesto', 'sueldo', 'pruebas psicológicas', 'pruebas psicologicas',
      'entrevista sup', 'capacitación', 'capacitación', 'formador',
      'asistencia d1', 'asistencia d2', 'asistencia d3', 'asistencia d4', 'asistencia d5'
    ];
    
    let bestHeaderRowIndex = 0;
    let maxMatches = 0;
    
    const scanLimit = Math.min(rows.length, 12);
    for (let rIdx = 0; rIdx < scanLimit; rIdx++) {
      const rowCells = rows[rIdx] || [];
      let matches = 0;
      rowCells.forEach(cell => {
        const val = String(cell || '').trim().toLowerCase();
        if (val && targetHeaders.some(th => val === th || val.includes(th))) {
          matches++;
        }
      });
      if (matches > maxMatches) {
        maxMatches = matches;
        bestHeaderRowIndex = rIdx;
      }
    }

    const rawHeaders = (rows[bestHeaderRowIndex] as string[] || []).map(h => String(h || '').trim());
    setParsedHeaders(rawHeaders);

    // Filter clean rows (from headerRowIndex + 1 onwards)
    const cleanRows = rows.slice(bestHeaderRowIndex + 1)
      .map(r => (r as any[] || []).map(val => val === undefined || val === null ? '' : String(val).trim()))
      .filter(r => r.some(cell => cell.length > 0));

    setParsedRows(cleanRows);

    // Generate unique column mappings
    const normalizeText = (text: string) => {
      return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    };

    const headerCounts: { [key: string]: number } = {};
    const columns = rawHeaders.map((header, index) => {
      const hLower = header.toLowerCase();
      headerCounts[hLower] = (headerCounts[hLower] || 0) + 1;
      const count = headerCounts[hLower];

      const normalized = normalizeText(header)
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^\w]/g, "");

      const id = `col_${index}_${normalized}_${count}`;

      let field = 'ignorar';
      let label = header;

      // Detect fields
      if (hLower === 'reclutador') {
        field = 'reclutador_origen';
        label = 'Reclutador';
      } else if (hLower === 'coordinador') {
        field = 'coordinador';
        label = 'Coordinador';
      } else if (hLower === 'ciudad') {
        field = 'ciudad';
        label = 'Ciudad';
      } else if (hLower === 'dni' || hLower === 'documento' || hLower === 'nro documento' || hLower === 'número de documento' || hLower === 'identificación' || hLower === 'cedula' || hLower === 'id') {
        field = 'dni';
        label = 'DNI';
      } else if (hLower === 'nombres completos' || hLower === 'nombre completo' || hLower === 'postulante' || hLower === 'nombre_completo') {
        field = 'nombre_completo';
        label = 'Nombre completo';
      } else if (hLower === 'nombres' || hLower === 'nombre') {
        field = 'nombres';
        label = 'Nombres';
      } else if (hLower === 'apellidos' || hLower === 'apellido') {
        field = 'apellidos';
        label = 'Apellidos';
      } else if (hLower === 'teléfono' || hLower === 'telefono' || hLower === 'celular' || hLower === 'cel' || hLower === 'phone' || hLower === 'contacto') {
        field = 'telefono';
        label = 'Teléfono';
      } else if (hLower === 'correo' || hLower === 'email' || hLower === 'e-mail' || hLower === 'correo electronico' || hLower === 'correo electrónico') {
        field = 'correo';
        label = 'Correo';
      } else if (hLower === 'puesto' || hLower === 'cargo' || hLower === 'rol' || hLower === 'position') {
        field = 'puesto';
        label = 'Puesto';
      } else if (hLower === 'sueldo') {
        field = 'sueldo';
        label = 'Sueldo';
      } else if (hLower === 'pruebas psicológicas' || hLower === 'pruebas psicologicas') {
        field = 'estado_pruebas_psicologicas';
        label = 'Pruebas psicológicas';
      } else if (hLower === 'capacitación' || hLower === 'capacitación') {
        field = 'fecha_capacitacion';
        label = 'Fecha capacitación';
      } else if (hLower === 'formador') {
        field = 'formador_asignado';
        label = 'Formador';
      } else if (hLower === 'asistencia d1' || hLower === 'asistencia_dia_1' || hLower === 'd1' || hLower === 'asistencia dia 1') {
        field = 'asistencia_dia_1';
        label = 'Asistencia Día 1';
      } else if (hLower === 'asistencia d2' || hLower === 'asistencia_dia_2' || hLower === 'd2' || hLower === 'asistencia dia 2') {
        field = 'asistencia_dia_2';
        label = 'Asistencia Día 2';
      } else if (hLower === 'asistencia d3' || hLower === 'asistencia_dia_3' || hLower === 'd3' || hLower === 'asistencia dia 3') {
        field = 'asistencia_dia_3';
        label = 'Asistencia Día 3';
      } else if (hLower === 'asistencia d4' || hLower === 'asistencia_dia_4' || hLower === 'd4' || hLower === 'asistencia dia 4') {
        field = 'asistencia_dia_4';
        label = 'Asistencia Día 4';
      } else if (hLower === 'asistencia d5' || hLower === 'asistencia_dia_5' || hLower === 'd5' || hLower === 'asistencia dia 5') {
        field = 'asistencia_dia_5';
        label = 'Asistencia Día 10';
      } else if (hLower === 'entrevista sup') {
        if (count === 1) {
          field = 'fecha_entrevista_sup';
          label = 'Fecha entrevista SUP';
        } else {
          field = 'resultado_entrevista_sup';
          label = 'Resultado entrevista SUP';
        }
      } else {
        if (count > 1) {
          label = `${header} (${count})`;
        }
      }

      return {
        id,
        label,
        originalName: header,
        index,
        field
      };
    });

    setParsedColumns(columns);

    const colReclutador = columns.find(c => c.field === 'reclutador_origen');
    const colCoordinador = columns.find(c => c.field === 'coordinador');
    const colCiudad = columns.find(c => c.field === 'ciudad');
    const colDni = columns.find(c => c.field === 'dni');
    const colNombreCompleto = columns.find(c => c.field === 'nombre_completo');
    const colNombres = columns.find(c => c.field === 'nombres');
    const colApellidos = columns.find(c => c.field === 'apellidos');
    const colTelefono = columns.find(c => c.field === 'telefono');
    const colCorreo = columns.find(c => c.field === 'correo');
    const colPuesto = columns.find(c => c.field === 'puesto');
    const colSueldo = columns.find(c => c.field === 'sueldo');
    const colPruebasPsicologicas = columns.find(c => c.field === 'estado_pruebas_psicologicas');
    const colFechaEntrevistaSup = columns.find(c => c.field === 'fecha_entrevista_sup');
    const colResultadoEntrevistaSup = columns.find(c => c.field === 'resultado_entrevista_sup');
    const colCapacitacion = columns.find(c => c.field === 'fecha_capacitacion');
    const colFormador = columns.find(c => c.field === 'formador_asignado');
    const colD1 = columns.find(c => c.field === 'asistencia_dia_1');
    const colD2 = columns.find(c => c.field === 'asistencia_dia_2');
    const colD3 = columns.find(c => c.field === 'asistencia_dia_3');
    const colD4 = columns.find(c => c.field === 'asistencia_dia_4');
    const colD5 = columns.find(c => c.field === 'asistencia_dia_5');

    // Auto-detected indices
    let dniIdx = colDni ? colDni.index : -1;
    let nombreCompletoIdx = colNombreCompleto ? colNombreCompleto.index : -1;
    let nombresIdx = colNombres ? colNombres.index : -1;
    let apellidosIdx = colApellidos ? colApellidos.index : -1;
    let telefonoIdx = colTelefono ? colTelefono.index : -1;
    let correoIdx = colCorreo ? colCorreo.index : -1;
    let puestoIdx = colPuesto ? colPuesto.index : -1;
    let reclutadorIdx = colReclutador ? colReclutador.index : -1;
    let observacionIdx = -1;

    // Override indices if user manually configured options are stored as col_ids
    if (mappingDni && mappingDni.startsWith('col_')) {
      const found = columns.find(c => c.id === mappingDni);
      if (found) dniIdx = found.index;
    }
    if (mappingNombreCompleto && mappingNombreCompleto.startsWith('col_')) {
      const found = columns.find(c => c.id === mappingNombreCompleto);
      if (found) nombreCompletoIdx = found.index;
    }
    if (mappingNombres && mappingNombres.startsWith('col_')) {
      const found = columns.find(c => c.id === mappingNombres);
      if (found) nombresIdx = found.index;
    }
    if (mappingApellidos && mappingApellidos.startsWith('col_')) {
      const found = columns.find(c => c.id === mappingApellidos);
      if (found) apellidosIdx = found.index;
    }
    if (mappingCelular && mappingCelular.startsWith('col_')) {
      const found = columns.find(c => c.id === mappingCelular);
      if (found) telefonoIdx = found.index;
    }
    if (mappingCorreo && mappingCorreo.startsWith('col_')) {
      const found = columns.find(c => c.id === mappingCorreo);
      if (found) correoIdx = found.index;
    }
    if (mappingPuesto && mappingPuesto.startsWith('col_')) {
      const found = columns.find(c => c.id === mappingPuesto);
      if (found) puestoIdx = found.index;
    }
    if (mappingFuente && mappingFuente.startsWith('col_')) {
      const found = columns.find(c => c.id === mappingFuente);
      if (found) reclutadorIdx = found.index;
    }
    if (mappingObservacion && mappingObservacion.startsWith('col_')) {
      const found = columns.find(c => c.id === mappingObservacion);
      if (found) observacionIdx = found.index;
    }

    let coordinadorIdx = colCoordinador ? colCoordinador.index : -1;
    let ciudadIdx = colCiudad ? colCiudad.index : -1;
    let sueldoIdx = colSueldo ? colSueldo.index : -1;
    let pruebasPsicologicasIdx = colPruebasPsicologicas ? colPruebasPsicologicas.index : -1;
    let fechaEntrevistaSupIdx = colFechaEntrevistaSup ? colFechaEntrevistaSup.index : -1;
    let resultadoEntrevistaSupIdx = colResultadoEntrevistaSup ? colResultadoEntrevistaSup.index : -1;
    let capacitaciónIdx = colCapacitacion ? colCapacitacion.index : -1;
    let formadorIdx = colFormador ? colFormador.index : -1;
    let d1Idx = colD1 ? colD1.index : -1;
    let d2Idx = colD2 ? colD2.index : -1;
    let d3Idx = colD3 ? colD3.index : -1;
    let d4Idx = colD4 ? colD4.index : -1;
    let d5Idx = colD5 ? colD5.index : -1;

    // Helper functions
    const parseExcelDate = (value: any): string => {
      if (value === undefined || value === null) return '';
      const trimmed = String(value).trim();
      if (!trimmed) return '';
      
      const num = Number(trimmed);
      if (!isNaN(num) && num > 20000 && num < 60000) {
        const date = new Date((num - 25569) * 86400 * 1000);
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      }
      return trimmed;
    };

    const normalizeTrainer = (name: string): string => {
      const clean = String(name || '').trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (clean === 'victor reynoso' || clean === 'victor reynoso alva' || clean === 'victor') return 'Víctor Reynoso';
      if (clean === 'paloma chamillo' || clean === 'paloma') return 'Paloma Chamillo';
      if (clean === 'oscar vildoso' || clean === 'oscar') return 'Oscar Vildoso';
      return name;
    };

    // Auto-detect and set date of training
    if (capacitaciónIdx !== -1) {
      let detectedCapDate = '';
      for (let i = 0; i < cleanRows.length; i++) {
        const val = cleanRows[i]?.[capacitaciónIdx];
        if (val) {
          detectedCapDate = parseExcelDate(val);
          break;
        }
      }
      if (detectedCapDate) {
        let ymd = '';
        const parts = detectedCapDate.split('/');
        if (parts.length === 3) {
          ymd = `${parts[2]}-${parts[1]}-${parts[0]}`;
        } else if (detectedCapDate.includes('-')) {
          ymd = detectedCapDate;
        }
        
        if (ymd && !isNaN(Date.parse(ymd))) {
          setFechaInicio(ymd);
          const start = new Date(ymd + 'T12:00:00');
          start.setDate(start.getDate() + 4);
          const endYmd = start.toISOString().split('T')[0];
          setFechaFin(endYmd);
        }
      }
    }

    // Auto-detect formador assigned
    let detectedTrainerName = '';
    if (formadorIdx !== -1) {
      for (let i = 0; i < cleanRows.length; i++) {
        const val = cleanRows[i]?.[formadorIdx];
        if (val) {
          detectedTrainerName = String(val).trim();
          break;
        }
      }
    }
    if (detectedTrainerName) {
      const normalizedTName = normalizeTrainer(detectedTrainerName);
      const matchedTrainer = trainers.find(t => 
        t.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === 
        normalizedTName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      );
      if (matchedTrainer) {
        setFormadorInicialIds([matchedTrainer.id]);
      }
    }

    // Process rows
    const tempParticipants: Omit<Participant, 'id'>[] = [];
    const dniSet = new Set<string>();
    const errorsList: string[] = [];
    let validCount = 0;
    let errorCount = 0;
    let dupCount = 0;

    const interpretAttendance = (val: string, fileRowNumber: number, dayNum: number): AttendanceStatus => {
      const v = String(val || '').trim().toUpperCase();
      if (!v || v === 'NULL' || v === 'UNDEFINED') return 'Seleccionar';
      if (v === 'A' || v === 'ASISTIÓ' || v === 'ASISTIO') return 'Asistió';
      if (v === 'T' || v === 'TARDANZA') return 'Tardanza';
      if (v === 'F' || v === 'FALTÓ' || v === 'FALTO') return 'Faltó';
      if (v === 'D' || v === 'DESISTIÓ' || v === 'DESISTIO') return 'Desistió';
      if (v === 'B' || v === 'BAJA') return 'Baja';
      if (v === 'R' || v === 'RETIRO' || v === 'RETIRADO') {
        errorsList.push(`Fila ${fileRowNumber} - Día ${dayNum}: Se interpretó "R" como "Desistió / Retiro". Verifique o edite en la lista.`);
        return 'Desistió';
      }
      errorsList.push(`Fila ${fileRowNumber} - Día ${dayNum}: Valor de asistencia "${val}" no reconocido. Se cargó como "Seleccionar".`);
      return 'Seleccionar';
    };

    cleanRows.forEach((row, index) => {
      const fileRowNumber = bestHeaderRowIndex + index + 2;

      // Skip empty lines
      if (row.length === 0 || row.every(cell => !cell.trim())) {
        errorsList.push(`Fila ${fileRowNumber}: Fila vacía o sin datos.`);
        errorCount++;
        return;
      }

      const dni = dniIdx !== -1 ? row[dniIdx]?.trim() || '' : '';
      if (!dni) {
        errorsList.push(`Fila ${fileRowNumber}: El campo "DNI" está vacío. Acción: Ingrese un DNI válido.`);
        errorCount++;
        return;
      }

      if (dniSet.has(dni)) {
        errorsList.push(`Fila ${fileRowNumber}: DNI duplicado dentro del archivo (${dni}). Acción: Elimine el registro duplicado.`);
        dupCount++;
        errorCount++;
        return;
      }
      dniSet.add(dni);

      // Nombres completos split
      let nombres = '';
      let apellidos = '';
      const full = nombreCompletoIdx !== -1 ? row[nombreCompletoIdx]?.trim() || '' : '';

      if (full) {
        const splitPos = full.indexOf(' ');
        if (splitPos !== -1) {
          nombres = full.substring(0, splitPos).trim();
          apellidos = full.substring(splitPos).trim();
        } else {
          nombres = full;
          apellidos = '-';
        }
      } else {
        nombres = nombresIdx !== -1 ? row[nombresIdx]?.trim() || '' : '';
        apellidos = apellidosIdx !== -1 ? row[apellidosIdx]?.trim() || '' : '';
      }

      if (!nombres) {
        errorsList.push(`Fila ${fileRowNumber}: El campo "Nombre Completo" está vacío. Acción: Ingrese nombres válidos.`);
        errorCount++;
        return;
      }

      // Check formador assigned
      const rowFormadorRaw = formadorIdx !== -1 ? row[formadorIdx]?.trim() || '' : '';
      const rowFormadorNormalized = normalizeTrainer(rowFormadorRaw);
      const isFormadorValido = ['Víctor Reynoso', 'Paloma Chamillo', 'Oscar Vildoso'].includes(rowFormadorNormalized);
      if (rowFormadorRaw && !isFormadorValido) {
        errorsList.push(`Fila ${fileRowNumber}: El formador "${rowFormadorRaw}" no es reconocido. Acción: Seleccione uno de la lista válida.`);
      }

      // Map all extra fields
      const reclutador_origen = reclutadorIdx !== -1 ? row[reclutadorIdx]?.trim() || '' : '';
      const coordinador = coordinadorIdx !== -1 ? row[coordinadorIdx]?.trim() || '' : '';
      const ciudad = ciudadIdx !== -1 ? row[ciudadIdx]?.trim() || '' : '';
      const celular = telefonoIdx !== -1 ? row[telefonoIdx]?.trim() || '900000000' : '900000000';
      const correo = correoIdx !== -1 ? row[correoIdx]?.trim() || '' : '';
      const puesto = puestoIdx !== -1 ? row[puestoIdx]?.trim() || 'Asesor BPO' : 'Asesor BPO';
      const sueldo = sueldoIdx !== -1 ? row[sueldoIdx]?.trim() || '' : '';
      const estado_pruebas_psicologicas = pruebasPsicologicasIdx !== -1 ? row[pruebasPsicologicasIdx]?.trim() || '' : '';
      const fecha_entrevista_sup = fechaEntrevistaSupIdx !== -1 ? parseExcelDate(row[fechaEntrevistaSupIdx]) : '';
      const resultado_entrevista_sup = resultadoEntrevistaSupIdx !== -1 ? row[resultadoEntrevistaSupIdx]?.trim() || '' : '';
      const fecha_capacitación = capacitaciónIdx !== -1 ? parseExcelDate(row[capacitaciónIdx]) : '';
      const formador_asignado = rowFormadorNormalized;

      // Interpret attendance columns
      const attendanceD1 = d1Idx !== -1 ? interpretAttendance(row[d1Idx], fileRowNumber, 1) : 'Pendiente';
      const attendanceD2 = d2Idx !== -1 ? interpretAttendance(row[d2Idx], fileRowNumber, 2) : 'Pendiente';
      const attendanceD3 = d3Idx !== -1 ? interpretAttendance(row[d3Idx], fileRowNumber, 3) : 'Pendiente';
      const attendanceD4 = d4Idx !== -1 ? interpretAttendance(row[d4Idx], fileRowNumber, 4) : 'Pendiente';
      const attendanceD5 = d5Idx !== -1 ? interpretAttendance(row[d5Idx], fileRowNumber, 5) : 'Pendiente';

      validCount++;

      tempParticipants.push({
        training_session_id: 'pending',
        dni,
        nombres,
        apellidos,
        celular,
        correo,
        puesto,
        fuente_reclutamiento: 'Carga Excel',
        observacion: '',
        estado_final: 'Pendiente de gestión',

        // Extra Excel fields
        reclutador_origen,
        coordinador,
        ciudad,
        sueldo,
        estado_pruebas_psicologicas,
        fecha_entrevista_sup,
        resultado_entrevista_sup,
        fecha_capacitacion: fecha_capacitación,
        formador_asignado,

        // Attendance states
        asistencia_dia_1: attendanceD1,
        asistencia_dia_2: attendanceD2,
        asistencia_dia_3: attendanceD3,
        asistencia_dia_4: attendanceD4,
        asistencia_dia_5: attendanceD5,

        observacion_dia_1: '',
        observacion_dia_2: '',
        observacion_dia_3: '',
        observacion_dia_4: '',
        observacion_dia_5: '',

        motivo_desercion: '',
        observacion_general: '',
        estado_alta: 'Pendiente de alta',
        _rowId: `row_${index}_${dni || "sin_dni"}`
      });
    });

    setValidatedParticipants(tempParticipants);
    setValidationErrors(errorsList);
    setValidationSummary({
      total: cleanRows.length,
      valid: validCount,
      error: errorCount,
      dups: dupCount
    });

    // Make sure mapping selects are pre-populated with unique col_ ids
    const selectOrIgnoredCol = (col: any) => col ? col.id : '';
    setMappingDni(selectOrIgnoredCol(colDni));
    setMappingNombreCompleto(selectOrIgnoredCol(colNombreCompleto));
    setMappingNombres(selectOrIgnoredCol(colNombres));
    setMappingApellidos(selectOrIgnoredCol(colApellidos));
    setMappingCelular(selectOrIgnoredCol(colTelefono));
    setMappingCorreo(selectOrIgnoredCol(colCorreo));
    setMappingPuesto(selectOrIgnoredCol(colPuesto));
    setMappingFuente(selectOrIgnoredCol(colReclutador));
    if (colPruebasPsicologicas) {
      setMappingObservacion(selectOrIgnoredCol(colPruebasPsicologicas));
    }

    setShowPreview(true);
  };

  // CSV or Excel File Parsing Entrypoint (XLSX)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    const allowedExtensions = ['xlsx', 'xls', 'xlsm', 'ods', 'csv'];
    if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
      alert('Formato de archivo no soportado. Formatos válidos: .xlsx, .xls, .xlsm, .ods, .csv');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        if (!data) return;

        // Read workbook using XLSX
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        // Convert to 2D array (headers + rows)
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });

        setUploadedFileName(file.name);
        setUploadedFileFormat(fileExtension.toUpperCase());

        // Process automatically
        processExcelRows(rows, file.name);
      } catch (err) {
        console.error('Error al leer el archivo:', err);
        alert('Error al leer el archivo. Asegúrese de que sea un archivo Excel o CSV válido.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // CSV Parsing Entrypoint
  const parseCSVData = (text: string, currentDelim = ',') => {
    if (!text.trim()) return;
    setIsParsing(true);
    setDelimiter(currentDelim);

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
      setIsParsing(false);
      return;
    }

    const rows = lines.map(line => {
      let parts: string[] = [];
      if (currentDelim === ';') {
        parts = line.split(';');
      } else {
        const match = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(',');
        parts = match;
      }
      return parts.map(p => p.trim().replace(/^"|"$/g, ''));
    });

    setUploadedFileName('Datos Pegados');
    setUploadedFileFormat('CSV');

    // Process automatically
    processExcelRows(rows, 'Datos Pegados.csv');
    setIsParsing(false);
  };

  // Run validation on the mapped columns (manual click trigger)
  const handleValidateMapping = () => {
    // Reconstruct full rows and run smart process
    processExcelRows([parsedHeaders, ...parsedRows], uploadedFileName || 'Datos.csv');
  };

  // Confirm and Save Training Session & Participants
  const handleSaveCapacitacion = async () => {
    if (isSavingTraining) return;
    const trainingIdentifier = generationCode.trim();

    if (!trainingIdentifier) {
      alert('No se pudo generar la nomenclatura de la capacitación.');
      return;
    }
    if (validatedParticipants.length === 0) {
      alert('Debe cargar y validar al menos un participante para iniciar la capacitación.');
      return;
    }

    if (sessions.some((session) => getTrainingIdentifier(session) === trainingIdentifier)) {
      alert('Ya existe una capacitación con esta nomenclatura. Edita el consolidado existente para agregar personas.');
      return;
    }

    const initialTrainers = trainers.filter((trainer) => formadorInicialIds.includes(trainer.id));
    const ojtTrainers = trainers.filter((trainer) => formadorOjtIds.includes(trainer.id));
    const selectedTrainers = trainers.filter((trainer) =>
      formadorInicialIds.includes(trainer.id) || formadorOjtIds.includes(trainer.id));
    if (initialTrainers.length === 0) {
      alert('Selecciona al menos un Formador de Capacitación Inicial.');
      return;
    }

    setIsSavingTraining(true);
    try {
      await onAddSession({
        nombre_generacion: trainingIdentifier,
        campaña,
        tipo_capacitacion: tipoCapacitacion,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        hora_capacitacion: horaCapacitacion,
        formador_id: initialTrainers[0].id,
        formador_ids: selectedTrainers.map((trainer) => trainer.id),
        formador_nombres: selectedTrainers.map((trainer) => trainer.nombre),
        formador_capacitacion_inicial_ids: initialTrainers.map((trainer) => trainer.id),
        formador_capacitacion_inicial_nombres: initialTrainers.map((trainer) => trainer.nombre),
        formador_ojt_ids: ojtTrainers.map((trainer) => trainer.id),
        formador_ojt_nombres: ojtTrainers.map((trainer) => trainer.nombre),
        reclutador_id: reclutadorId || currentUser.id,
        modalidad,
        turno,
        observaciones,
        estado: 'En curso', // Begins in course once created & populated
        generation_code: trainingIdentifier
      }, validatedParticipants);
    } catch (error) {
      console.error('Error persisting training:', error);
      alert(error instanceof Error ? error.message : 'No se pudo guardar la capacitación. Los datos permanecen en el formulario para reintentar.');
      return;
    } finally {
      setIsSavingTraining(false);
    }

    // Reset only after PostgreSQL confirms the complete transaction.
    setView('list');
    setRawText('');
    setUploadedFileName('');
    setUploadedFileFormat('');
    setParsedHeaders([]);
    setParsedRows([]);
    setValidatedParticipants([]);
    setValidationErrors([]);
    setShowPreview(false);
  };

  const handleCancelCarga = () => {
    // Reset Form
    setView('list');
    setRawText('');
    setUploadedFileName('');
    setUploadedFileFormat('');
    setParsedHeaders([]);
    setParsedRows([]);
    setValidatedParticipants([]);
    setValidationErrors([]);
    setShowPreview(false);
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const mockEvent = {
      target: {
        files: [file]
      }
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    handleFileChange(mockEvent);
  };

  // Filter Sessions List
  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      const identifier = getTrainingIdentifier(s);
      const matchesSearch = identifier.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.nombre_generacion.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.campaña.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.formador_nombre.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCampaña = filterCampaña === 'todos' || s.campaña === filterCampaña;
      const matchesEstado = filterEstado === 'todos' || s.estado === filterEstado;

      // If user is a Formador, they can only see their own assigned sessions (this is double guarded here)
      const matchesRoleAccess =
        currentUser.rol !== 'Formador' || isSessionAssignedTrainer(s, currentUser.id);

      return matchesSearch && matchesCampaña && matchesEstado && matchesRoleAccess;
    });
  }, [sessions, searchTerm, filterCampaña, filterEstado, currentUser]);

  const closeRequirementsMet =
    validationDetails.isAttendanceComplete &&
    validationDetails.isResultadoFormacionCompleto &&
    validationDetails.isCommentsComplete &&
    validationDetails.isSurveyComplete &&
    validationDetails.isAptosDefined;
  const canForceCloseAsAdmin = currentUser.rol === 'Administrador';

  return (
    <div className="space-y-6">
      {/* Top action header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-slate-800 text-2xl font-bold flex items-center gap-2">
            <BookOpen className="text-fuchsia-600" />
            {view === 'list' ? 'Registro de Capacitaciones' : 'Nueva Capacitación'}
          </h2>
          <p className="text-slate-500 text-sm">
            {view === 'list'
              ? 'Controla las generaciones de capacitación, asignación de formadores y participantes.'
              : 'Asigna campaña, formador, turno y carga la base inicial de ejecutivos.'}
          </p>
        </div>

        {view === 'list' && permissions[currentUser.rol]?.canCreateTraining && (
          <button
            onClick={() => setView('create')}
            className="bg-linear-to-r from-fuchsia-600 via-purple-600 to-indigo-600 hover:from-fuchsia-700 hover:to-indigo-700 text-white font-semibold rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all transform active:scale-95"
          >
            <Plus className="w-5 h-5" />
            Crear Capacitación
          </button>
        )}
      </div>

      {view === 'list' ? (
        <>
          {/* Filters Grid */}
          <div className="glass-card rounded-2xl p-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Buscar generación, campaña..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full glass-input text-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-hidden"
                />
              </div>

              <div>
                <select
                  value={filterCampaña}
                  onChange={(e) => setFilterCampaña(e.target.value)}
                  className="w-full glass-input text-slate-700 rounded-xl px-3 py-2.5 text-sm outline-hidden"
                >
                  <option value="todos">Todas las Campañas</option>
                  {BPO_CAMPAIGNS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>

              <div>
                <select
                  value={filterEstado}
                  onChange={(e) => setFilterEstado(e.target.value)}
                  className="w-full glass-input text-slate-700 rounded-xl px-3 py-2.5 text-sm outline-hidden"
                >
                  <option value="todos">Todos los Estados</option>
                  <option value="Pendiente de inicio">Pendiente de inicio</option>
                  <option value="En curso">En curso</option>
                  <option value="Activa">Activa</option>
                  <option value="Capacitación cerrada">Capacitación cerrada</option>
                  <option value="Campaña cerrada">Campaña cerrada</option>
                </select>
              </div>

              <div className="text-right flex items-center justify-end text-xs text-slate-500">
                Mostrando {filteredSessions.length} capacitaciones
              </div>
            </div>
          </div>

          {/* Sessions Listing */}
          {filteredSessions.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center">
              <div className="max-w-md mx-auto space-y-3">
                <div className="bg-slate-500/10 text-slate-500 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto backdrop-blur-xs">
                  <BookOpen className="w-8 h-8" />
                </div>
                <h3 className="text-slate-800 font-bold text-lg">No se encontraron capacitaciones</h3>
                <p className="text-slate-500 text-sm">
                  Prueba modificando los filtros o registra una nueva capacitación para empezar el control.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredSessions.map((session) => {
                // Count participants for this session
                const sessionPartsCount = participants.filter(p => p.training_session_id === session.id).length;

                return (
                  <div
                    key={session.id}
                    className="glass-card glass-card-hover rounded-2xl flex flex-col justify-between overflow-hidden"
                  >
                    {/* Header with Campaign Color Badge */}
                    <div className="p-5 border-b border-slate-50">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex flex-wrap gap-1.5">
                          <span className={`text-[10px] uppercase font-extrabold tracking-wider px-2.5 py-1 rounded-full ${
                            session.campaña === 'Entel Empresas' ? 'bg-blue-50 text-blue-600' :
                            session.campaña === 'Prosegur' ? 'bg-amber-50 text-amber-600' :
                            session.campaña === 'Culqi' ? 'bg-emerald-50 text-emerald-600' :
                            session.campaña === 'Equifax' ? 'bg-indigo-50 text-indigo-600' :
                            'bg-slate-50 text-slate-600'
                          }`}>
                            {session.campaña}
                          </span>
                        </div>

                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                          session.estado === 'En curso' ? 'bg-emerald-100 text-emerald-800 animate-pulse' :
                          session.estado === 'Activa' ? 'bg-indigo-100 text-indigo-800' :
                          session.estado === 'Pendiente de inicio' ? 'bg-amber-100 text-amber-800' :
                          session.estado === 'Campaña cerrada' ? 'bg-purple-100 text-purple-800' :
                          'bg-slate-100 text-slate-800'
                        }`}>
                          {session.estado}
                        </span>
                      </div>

                      <h4 className="text-slate-800 font-bold text-base leading-snug line-clamp-2">
                        {getTrainingIdentifier(session)}
                      </h4>
                      <p className="text-slate-400 text-xs mt-1">{session.tipo_capacitacion}</p>
                    </div>

                    {/* Metadata */}
                    <div className="p-5 space-y-3 flex-1 text-slate-600 text-xs">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>
                          <strong>Perúodo:</strong> {session.fecha_inicio} al {session.fecha_fin}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>
                          <strong>Hora:</strong> {session.hora_capacitacion || '08:00'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>
                          <strong>Formador:</strong> {getSessionTrainerNames(session).join(', ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>
                          <strong>Participantes:</strong> {sessionPartsCount} registrados
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Grid className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>
                          <strong>Turno / Modalidad:</strong> {session.turno} ({session.modalidad})
                        </span>
                      </div>
                      {session.observaciones && (
                        <p className="text-[11px] text-slate-400 italic border-l-2 border-slate-100 pl-2 mt-1">
                          "{session.observaciones}"
                        </p>
                      )}
                    </div>

                    {/* Actions footer */}
                    <div className="bg-slate-50/50 p-4 rounded-b-2xl border-t border-slate-50 flex justify-between items-center gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {permissions[currentUser.rol]?.canEditTraining && (
                          <button
                            onClick={() => startEditing(session)}
                            className="text-slate-400 hover:text-indigo-600 p-2 rounded-lg hover:bg-indigo-50 transition-colors cursor-pointer"
                            title="Editar datos de capacitación"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Delete button (Only for creator Reclutador or Admin, and check canDeleteTraining) */}
                        {permissions[currentUser.rol]?.canDeleteTraining && (currentUser.rol === 'Administrador' ||
                          (currentUser.rol === 'Reclutador' && session.reclutador_id === currentUser.id)) && (
                          <button
                            onClick={() => {
                              if (confirm(`¿Está seguro de eliminar esta capacitación y sus ${sessionPartsCount} participantes? Esta acción registrará una auditoría.`)) {
                                onDeleteSession(session.id);
                              }
                            }}
                            className="text-slate-400 hover:text-rose-600 p-2 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Eliminar capacitación errónea"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}

                        {/* Close Campaign / Training button (Only for Admin, or assigned Formador if they want to submit close request) */}
                        {session.estado !== 'Capacitación cerrada' && session.estado !== 'Campaña cerrada' && onCloseCampaign && (currentUser.rol === 'Administrador' || (currentUser.rol === 'Formador' && isSessionAssignedTrainer(session, currentUser.id))) && (
                          <button
                            onClick={() => handleInitiateClose(session)}
                            className="bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-xs px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                            title="Cerrar capacitación oficialmente"
                          >
                            Cerrar capacitación
                          </button>
                        )}

                        {/* Reopen closed training button (Admin can reopen either closed state) */}
                        {(
                          session.estado === 'Capacitación cerrada' ||
                          (currentUser.rol === 'Administrador' && session.estado === 'Campaña cerrada')
                        ) && (currentUser.rol === 'Administrador' || currentUser.rol === 'Analista') && (
                          <button
                            onClick={() => handleInitiateReopen(session)}
                            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                            title="Reabrir capacitación oficialmente"
                          >
                            Reabrir capacitación
                          </button>
                        )}
                      </div>

                      <button
                        onClick={() => onViewAttendance(session.id)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                      >
                        Ver Asistencias
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* Create & Upload Wizard */
        <div className="glass-card rounded-2xl shadow-lg overflow-hidden">
          {/* Sidebar wizard indicator */}
          <div className="bg-gradient-to-r from-fuchsia-600/90 to-indigo-600/90 backdrop-blur-md px-6 py-4 text-white flex justify-between items-center border-b border-white/10">
            <div>
              <h3 className="font-bold text-lg text-white">Asistente de Registro y Carga FDR</h3>
              <p className="text-white/80 text-xs">Completa los datos generales y carga tu plantilla Excel/CSV para mapear participantes.</p>
            </div>
            <button
              onClick={() => setView('list')}
              className="text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          </div>

          <div className="p-6 lg:p-8 space-y-8">
            {/* Step 1: Datos de Capacitación */}
            <div className="space-y-4">
              <h4 className="text-slate-800 font-bold text-sm uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="bg-fuchsia-100 text-fuchsia-700 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs">1</span>
                Información de Campaña y Asignación
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Campaña BPO *</label>
                  <select
                    value={campaña}
                    onChange={(e) => handleCampañaChange(e.target.value)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-fuchsia-500 outline-hidden font-bold"
                  >
                    {BPO_CAMPAIGNS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nomenclatura de capacitación</label>
                  <input
                    type="text"
                    value={generationCode}
                    readOnly
                    disabled
                    className="w-full text-sm bg-slate-100 text-slate-500 font-extrabold rounded-xl border border-slate-200 p-2.5 cursor-not-allowed outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo de Capacitación *</label>
                  <select
                    value={tipoCapacitacion}
                    onChange={(e) => setTipoCapacitacion(e.target.value)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-fuchsia-500 outline-hidden"
                  >
                    <option value="Capacitación regular">Capacitación regular</option>
                    <option value="Capacitación express">Capacitación express</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Hora de capacitación *</label>
                  <input
                    type="time"
                    required
                    value={horaCapacitacion}
                    onChange={(e) => setHoraCapacitacion(e.target.value)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-fuchsia-500 outline-hidden font-bold"
                  />
                </div>

                <TrainerMultiSelect
                  label="Formador Capacitación Inicial"
                  trainerIds={formadorInicialIds}
                  trainers={trainers}
                  onChange={setFormadorInicialIds}
                  required
                />

                <TrainerMultiSelect
                  label="Formador OJT"
                  trainerIds={formadorOjtIds}
                  trainers={trainers}
                  onChange={setFormadorOjtIds}
                />


                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de Inicio *</label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-fuchsia-500 outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha Estimada de Fin *</label>
                  <input
                    type="date"
                    value={fechaFin}
                    onChange={(e) => setFechaFin(e.target.value)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-fuchsia-500 outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Modalidad *</label>
                  <select
                    value={modalidad}
                    onChange={(e) => setModalidad(e.target.value as any)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-fuchsia-500 outline-hidden"
                  >
                    <option value="Presencial">Presencial</option>
                    <option value="Virtual">Virtual</option>
                    <option value="Híbrida">Híbrida</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Turno *</label>
                  <select
                    value={turno}
                    onChange={(e) => setTurno(e.target.value as any)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-fuchsia-500 outline-hidden"
                  >
                    <option value="Part time">Part time</option>
                    <option value="Full time">Full time</option>
                    <option value="Mini full">Mini full</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Responsable de Carga (Reclutador)</label>
                  {currentUser.rol === 'Reclutador' ? (
                    <input
                      type="text"
                      disabled
                      value={currentUser.nombre}
                      className="w-full text-sm bg-slate-100 text-slate-500 rounded-xl border border-slate-200 p-2.5 cursor-not-allowed outline-hidden"
                    />
                  ) : (
                    <select
                      value={reclutadorId}
                      onChange={(event) => setReclutadorId(event.target.value)}
                      className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5"
                    >
                      <option value="">Selecciona un reclutador</option>
                      {recruiters.map((recruiter) => (
                        <option key={recruiter.id} value={recruiter.id}>{recruiter.nombre}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Observaciones Generales</label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Comentarios adicionales o perfil de los contratados..."
                  rows={2}
                  className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-fuchsia-500 outline-hidden"
                />
              </div>
            </div>

            {/* Step 2: Cargar Excel / CSV */}
            <div className="space-y-4" onDragOver={(e) => e.preventDefault()} onDrop={handleFileDrop}>
              <h4 className="text-slate-800 font-bold text-sm uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs">2</span>
                Carga de Archivo de Participantes
              </h4>

              <input
                type="file"
                id="xlsx-file-input"
                className="hidden"
                accept=".xlsx,.xls,.xlsm,.ods,.csv"
                onChange={handleFileChange}
              />

              <div className="w-full">
                {/* Left side: upload file area */}
                <div className="w-full space-y-4">
                  <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center hover:bg-slate-100/70 transition-colors">
                    <UploadCloud className="w-12 h-12 text-indigo-500 mx-auto mb-2 animate-pulse" />
                    
                    <div className="flex flex-col items-center justify-center gap-3 mb-4">
                      <button
                        type="button"
                        onClick={() => document.getElementById('xlsx-file-input')?.click()}
                        className="bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer transform hover:scale-[1.01] active:scale-95"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                        Subir archivo de participantes
                      </button>
                      <p className="text-xs text-slate-500">
                        Arrastra y suelta tu archivo aquí. Formatos permitidos: <strong className="text-slate-700">.xlsx, .xls, .csv, .xlsm, .ods</strong>
                      </p>
                    </div>

                    <div className="relative flex py-2 items-center">
                      <div className="flex-grow border-t border-slate-200"></div>
                      <span className="flex-shrink mx-4 text-slate-400 text-[10px] font-bold uppercase">o pegar texto estructurado</span>
                      <div className="flex-grow border-t border-slate-200"></div>
                    </div>

                    <textarea
                      value={rawText}
                      onChange={(e) => {
                        setRawText(e.target.value);
                        // Auto parse with comma or semicolon
                        const autoDelim = e.target.value.includes(';') ? ';' : ',';
                        parseCSVData(e.target.value, autoDelim);
                      }}
                      placeholder="DNI,nombres,apellidos,celular,correo,puesto,fuente_reclutamiento,observacion&#10;45892154,Pedro,Campos,987451236,pedro@gmail.com,Asesor BPO,Computrabajo,Ok"
                      rows={4}
                      className="w-full text-xs font-mono bg-white text-slate-700 rounded-xl border border-slate-200 p-3 mt-2 focus:ring-2 focus:ring-indigo-500 outline-hidden"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3: Column Mapping & Preview */}
            {showPreview && parsedHeaders.length > 0 && (
              <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-3">
                  <div>
                    <h4 className="text-slate-800 font-bold text-sm flex items-center gap-1.5">
                      <Grid className="text-fuchsia-600 w-4.5 h-4.5" />
                      Mapeador Inteligente de Columnas
                    </h4>
                    <p className="text-slate-500 text-xs">
                      Asocia las columnas de tu archivo (izquierda) con los campos requeridos por FDR (derecha).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleValidateMapping}
                    className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-xs transition-colors"
                  >
                    Validar Registros Mapeados
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {/* DNI */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">DNI (Obligatorio) *</label>
                    <select
                      value={mappingDni}
                      onChange={(e) => setMappingDni(e.target.value)}
                      className="w-full text-xs bg-white text-slate-700 rounded-lg border border-slate-200 p-2"
                    >
                      <option value="">-- Ignorar --</option>
                      {parsedColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.originalName} {col.originalName !== col.label ? `(${col.label})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Nombres */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Nombres</label>
                    <select
                      value={mappingNombres}
                      onChange={(e) => setMappingNombres(e.target.value)}
                      className="w-full text-xs bg-white text-slate-700 rounded-lg border border-slate-200 p-2"
                    >
                      <option value="">-- Ignorar --</option>
                      {parsedColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.originalName} {col.originalName !== col.label ? `(${col.label})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Apellidos */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Apellidos</label>
                    <select
                      value={mappingApellidos}
                      onChange={(e) => setMappingApellidos(e.target.value)}
                      className="w-full text-xs bg-white text-slate-700 rounded-lg border border-slate-200 p-2"
                    >
                      <option value="">-- Ignorar --</option>
                      {parsedColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.originalName} {col.originalName !== col.label ? `(${col.label})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Nombre completo */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">O: Nombre Completo</label>
                    <select
                      value={mappingNombreCompleto}
                      onChange={(e) => setMappingNombreCompleto(e.target.value)}
                      className="w-full text-xs bg-white text-slate-700 rounded-lg border border-slate-200 p-2"
                    >
                      <option value="">-- Ignorar --</option>
                      {parsedColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.originalName} {col.originalName !== col.label ? `(${col.label})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Celular */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Celular / Teléfono</label>
                    <select
                      value={mappingCelular}
                      onChange={(e) => setMappingCelular(e.target.value)}
                      className="w-full text-xs bg-white text-slate-700 rounded-lg border border-slate-200 p-2"
                    >
                      <option value="">-- Ignorar --</option>
                      {parsedColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.originalName} {col.originalName !== col.label ? `(${col.label})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Correo */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Correo Electrónico</label>
                    <select
                      value={mappingCorreo}
                      onChange={(e) => setMappingCorreo(e.target.value)}
                      className="w-full text-xs bg-white text-slate-700 rounded-lg border border-slate-200 p-2"
                    >
                      <option value="">-- Ignorar --</option>
                      {parsedColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.originalName} {col.originalName !== col.label ? `(${col.label})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Puesto */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Puesto / Cargo</label>
                    <select
                      value={mappingPuesto}
                      onChange={(e) => setMappingPuesto(e.target.value)}
                      className="w-full text-xs bg-white text-slate-700 rounded-lg border border-slate-200 p-2"
                    >
                      <option value="">-- Ignorar --</option>
                      {parsedColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.originalName} {col.originalName !== col.label ? `(${col.label})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Fuente */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Fuente Recluta.</label>
                    <select
                      value={mappingFuente}
                      onChange={(e) => setMappingFuente(e.target.value)}
                      className="w-full text-xs bg-white text-slate-700 rounded-lg border border-slate-200 p-2"
                    >
                      <option value="">-- Ignorar --</option>
                      {parsedColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.originalName} {col.originalName !== col.label ? `(${col.label})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Observacion */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Observación</label>
                    <select
                      value={mappingObservacion}
                      onChange={(e) => setMappingObservacion(e.target.value)}
                      className="w-full text-xs bg-white text-slate-700 rounded-lg border border-slate-200 p-2"
                    >
                      <option value="">-- Ignorar --</option>
                      {parsedColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.originalName} {col.originalName !== col.label ? `(${col.label})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Validation Results Display */}
                {showPreview && (
                  <div className="glass-card p-5 space-y-4 rounded-2xl">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
                      <h5 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                        <CheckCircle className="text-emerald-500 w-4.5 h-4.5" />
                        Vista Previa e Informe de Carga
                      </h5>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="bg-indigo-100 text-indigo-800 font-semibold px-2 py-0.5 rounded-md">
                          Archivo: {uploadedFileName || 'Sin nombre'}
                        </span>
                        <span className="bg-purple-100 text-purple-800 font-semibold px-2 py-0.5 rounded-md">
                          Formato: {uploadedFileFormat || 'CSV'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-slate-50 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-slate-500 font-semibold uppercase">Total Filas</p>
                        <p className="text-xl font-bold text-slate-700">{validationSummary.total}</p>
                      </div>
                      <div className="bg-emerald-50 text-emerald-800 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-emerald-600 font-semibold uppercase">Registros Válidos</p>
                        <p className="text-xl font-bold">{validationSummary.valid}</p>
                      </div>
                      <div className="bg-rose-50 text-rose-800 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-rose-600 font-semibold uppercase">Duplicados Omitidos</p>
                        <p className="text-xl font-bold">{validationSummary.dups}</p>
                      </div>
                      <div className="bg-amber-50 text-amber-800 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-amber-600 font-semibold uppercase">Filas Inválidas / Error</p>
                        <p className="text-xl font-bold">{validationSummary.error}</p>
                      </div>
                    </div>

                    {/* Detailed Errors Box */}
                    {validationErrors.length > 0 && (
                      <div className="bg-rose-50 border-l-4 border-rose-500 rounded-xl p-4 text-xs text-rose-800 space-y-1.5 max-h-[150px] overflow-y-auto">
                        <p className="font-bold flex items-center gap-1">
                          <AlertTriangle className="w-4 h-4 text-rose-600" />
                          Se encontraron {validationErrors.length} errores/advertencias en el archivo:
                        </p>
                        <ul className="list-disc pl-5 space-y-0.5 font-mono">
                          {validationErrors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                        <p className="text-[10px] text-rose-600 mt-2">
                          * Nota: Solo se cargarán los registros válidos. Puede corregir el archivo y volver a cargarlo, o confirmar solo con los registros válidos.
                        </p>
                      </div>
                    )}

                    {validatedParticipants.length === 0 && (
                      <div className="bg-amber-50 text-amber-900 border border-amber-200 rounded-xl p-4 text-center text-xs">
                        No se ha ejecutado la validación aún, o no hay registros válidos. Por favor, asigne las columnas arriba y presione <strong className="text-amber-950 font-bold">"Validar Registros Mapeados"</strong>.
                      </div>
                    )}

                    {/* Pre-Loaded list preview table */}
                    {validatedParticipants.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold text-slate-700">Participantes que serán agregados a la capacitación:</p>
                        <div className="overflow-x-auto max-h-[350px] border border-slate-200 rounded-xl shadow-xs">
                          <table className="w-full text-left text-[11px] text-slate-600 border-collapse min-w-[3200px]">
                            <thead className="bg-slate-900 text-white uppercase text-[9px] tracking-wider sticky top-0 font-bold z-10">
                              <tr>
                                <th className="p-3 bg-slate-900 text-white sticky left-0 z-20 whitespace-nowrap">Reclutador</th>
                                <th className="p-3 bg-slate-900 text-white whitespace-nowrap">Coordinador</th>
                                <th className="p-3 bg-slate-900 text-white whitespace-nowrap">Ciudad</th>
                                <th className="p-3 bg-slate-900 text-white whitespace-nowrap">DNI</th>
                                <th className="p-3 bg-slate-900 text-white whitespace-nowrap">Nombre Completo</th>
                                <th className="p-3 bg-slate-900 text-white whitespace-nowrap">Teléfono</th>
                                <th className="p-3 bg-slate-900 text-white whitespace-nowrap">Puesto</th>
                                <th className="p-3 bg-slate-900 text-white whitespace-nowrap">Sueldo</th>
                                <th className="p-3 bg-slate-900 text-white whitespace-nowrap">Pruebas Psicológicas</th>
                                <th className="p-3 bg-slate-900 text-white text-center whitespace-nowrap">Fecha Entrevista SUP</th>
                                <th className="p-3 bg-slate-900 text-white text-center whitespace-nowrap">Resultado Entrevista SUP</th>
                                <th className="p-3 bg-slate-900 text-white text-center whitespace-nowrap">Fecha Capacitación</th>
                                <th className="p-3 bg-slate-900 text-white whitespace-nowrap">Formador</th>
                                
                                {/* Operational Attendance columns */}
                                {Array.from({ length: 10 }, (_, index) => index + 1).map(day => (
                                  <React.Fragment key={day}>
                                    <th className="p-3 bg-indigo-950 text-indigo-200 text-center border-l border-indigo-900">Día {day}</th>
                                    <th className="p-3 bg-indigo-950/90 text-indigo-200">Obs. Día {day}</th>
                                  </React.Fragment>
                                ))}
                                
                                <th className="p-3 bg-fuchsia-950 text-fuchsia-200">Estado Final</th>
                                <th className="p-3 bg-fuchsia-950 text-fuchsia-200">Motivo Deserción</th>
                                <th className="p-3 bg-fuchsia-950 text-fuchsia-200">Observación General</th>
                                <th className="p-3 bg-emerald-950 text-emerald-200">Estado de Alta</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                              {validatedParticipants.map((p, idx) => (
                                <tr key={p._rowId || `row_${idx}_${p.dni || "sin_dni"}`} className="hover:bg-slate-50 transition-colors">
                                  <td className="p-3 font-medium text-slate-900">{p.reclutador_origen || '-'}</td>
                                  <td className="p-3 text-slate-700">{p.coordinador || '-'}</td>
                                  <td className="p-3 text-slate-700">{p.ciudad || '-'}</td>
                                  <td className="p-3 font-mono text-slate-900 font-semibold">{p.dni}</td>
                                  <td className="p-3 font-medium text-slate-900">{p.nombres} {p.apellidos !== '-' ? p.apellidos : ''}</td>
                                  <td className="p-3 font-mono text-slate-700">{p.celular || '-'}</td>
                                  <td className="p-3 text-slate-700">{p.puesto}</td>
                                  <td className="p-3 font-mono text-slate-700">{p.sueldo || '-'}</td>
                                  <td className="p-3">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                      String(p.estado_pruebas_psicologicas).toLowerCase().includes('apto') 
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                        : p.estado_pruebas_psicologicas 
                                          ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                                          : 'text-slate-400'
                                    }`}>
                                      {p.estado_pruebas_psicologicas || '-'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-center font-mono text-slate-600">{p.fecha_entrevista_sup || '-'}</td>
                                  <td className="p-3 text-center">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                      String(p.resultado_entrevista_sup).toLowerCase().includes('apto') || String(p.resultado_entrevista_sup).toLowerCase().includes('ok')
                                        ? 'bg-emerald-100 text-emerald-800' 
                                        : p.resultado_entrevista_sup 
                                          ? 'bg-rose-100 text-rose-800' 
                                          : 'text-slate-400'
                                    }`}>
                                      {p.resultado_entrevista_sup || '-'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-center font-mono text-slate-600">{p.fecha_capacitacion || '-'}</td>
                                  <td className="p-3 font-medium text-slate-700">{p.formador_asignado || '-'}</td>
                                  
                                  {/* Operational Days defaults */}
                                  {Array.from({ length: 10 }, (_, index) => index + 1).map(day => {
                                    const attKey = `asistencia_dia_${day}` as keyof typeof p;
                                    const obsKey = `observacion_dia_${day}` as keyof typeof p;
                                    const status = (p[attKey] as string) || 'Pendiente';
                                    const obs = (p[obsKey] as string) || '';
                                    return (
                                      <React.Fragment key={day}>
                                        <td className="p-3 text-center border-l border-slate-100 bg-indigo-50/10">
                                          <span className={`font-bold px-2 py-0.5 rounded-md text-[10px] uppercase border ${
                                            status === 'Asistió' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                            status === 'Tardanza' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                            status === 'Faltó' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                            status === 'Baja' ? 'bg-orange-50 text-orange-800 border-orange-200' :
                                            status === 'Desistió' ? 'bg-slate-100 text-slate-700 border-slate-300' :
                                            'bg-slate-100 text-slate-600 border-slate-200'
                                          }`}>
                                            {status}
                                          </span>
                                        </td>
                                        <td className="p-3 text-slate-500 bg-indigo-50/10 font-medium">{obs || '-'}</td>
                                      </React.Fragment>
                                    );
                                  })}
                                  
                                  <td className="p-3 bg-fuchsia-50/10">
                                    <span className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full text-[10px]">
                                      {p.estado_final}
                                    </span>
                                  </td>
                                  <td className="p-3 text-slate-400 italic bg-fuchsia-50/10">{p.motivo_desercion || '-'}</td>
                                  <td className="p-3 text-slate-400 italic bg-fuchsia-50/10">{p.observacion_general || '-'}</td>
                                  <td className="p-3 bg-emerald-50/10">
                                    <span className="bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full text-[10px]">
                                      {p.estado_alta || 'Pendiente de alta'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Actions buttons */}
                    <div className="flex flex-col sm:flex-row justify-end items-center gap-4 pt-3 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={handleCancelCarga}
                        className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl px-5 py-3 transition-colors cursor-pointer text-center"
                      >
                        Cancelar carga
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveCapacitacion}
                        disabled={validatedParticipants.length === 0 || isSavingTraining}
                        className={`w-full sm:w-auto font-bold text-xs rounded-xl px-6 py-3 shadow-md flex items-center justify-center gap-2 transform active:scale-95 transition-all cursor-pointer ${
                          validatedParticipants.length === 0 || isSavingTraining
                            ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none' 
                            : 'bg-linear-to-r from-fuchsia-600 via-purple-600 to-indigo-600 hover:from-fuchsia-700 hover:to-indigo-700 text-white'
                        }`}
                      >
                        <CheckCircle className="w-5 h-5" />
                        {isSavingTraining ? 'Guardando en PostgreSQL...' : 'Confirmar carga y asignar capacitación'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Admin Editing Modal */}
      {editingSession && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-2xl w-full overflow-hidden transform transition-all">
            <div className="bg-linear-to-r from-indigo-600 to-purple-600 px-6 py-4 text-white flex justify-between items-center">
              <div>
                <h3 className="font-black text-base text-white">Editar Capacitación</h3>
                <p className="text-white/80 text-xs font-mono">{editDisplayedCode}</p>
              </div>
              <button
                onClick={() => setEditingSession(null)}
                className="text-white/80 hover:text-white hover:bg-white/10 p-1.5 rounded-lg text-xs"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Campaña *</label>
                  <select
                    value={editCampaña}
                    onChange={(e) => handleEditCampaignChange(e.target.value)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden font-bold"
                  >
                    {BPO_CAMPAIGNS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo de Capacitación *</label>
                  <select
                    value={editTipoCapacitacion}
                    onChange={(e) => setEditTipoCapacitacion(e.target.value)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden"
                  >
                    <option value="Capacitación regular">Capacitación regular</option>
                    <option value="Capacitación express">Capacitación express</option>
                  </select>
                </div>

                {permissions[currentUser.rol]?.canEditTraining && (
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Código de generación *</label>
                    <input
                      type="text"
                      value={editManualGenerationCode}
                      onChange={(e) => setEditManualGenerationCode(e.target.value)}
                      className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden font-mono font-bold"
                      placeholder="Ej. CAP-EN20260714-01"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">Este identificador se sincroniza con dashboard, asistencia y encuestas.</p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de Inicio *</label>
                  <input
                    type="date"
                    value={editFechaInicio}
                    onChange={(e) => handleEditStartDateChange(e.target.value)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de Fin *</label>
                  <input
                    type="date"
                    value={editFechaFin}
                    onChange={(e) => setEditFechaFin(e.target.value)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Hora de Capacitación *</label>
                  <input
                    type="time"
                    value={editHoraCapacitacion}
                    onChange={(e) => setEditHoraCapacitacion(e.target.value)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Turno *</label>
                  <select
                    value={editTurno}
                    onChange={(e) => setEditTurno(e.target.value as any)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden"
                  >
                    <option value="Part time">Part time</option>
                    <option value="Full time">Full time</option>
                    <option value="Mini full">Mini full</option>
                  </select>
                </div>

                <TrainerMultiSelect
                  label="Formador Capacitación Inicial"
                  trainerIds={editFormadorInicialIds}
                  trainers={trainers}
                  onChange={setEditFormadorInicialIds}
                  required
                />

                <TrainerMultiSelect
                  label="Formador OJT"
                  trainerIds={editFormadorOjtIds}
                  trainers={trainers}
                  onChange={setEditFormadorOjtIds}
                />

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Reclutador Asignado *</label>
                  <input
                    type="text"
                    disabled
                    value={recruiters.find(r => r.id === editReclutadorId)?.nombre || editingSession?.reclutador_nombre || 'Sin reclutador'}
                    className="w-full text-sm bg-slate-100 text-slate-500 rounded-xl border border-slate-200 p-2.5 cursor-not-allowed outline-hidden"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Estado de Capacitación *</label>
                  <select
                    value={editEstado}
                    onChange={(e) => setEditEstado(e.target.value as any)}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden font-bold"
                  >
                    <option value="Pendiente de inicio">Pendiente de inicio</option>
                    <option value="En curso">En curso</option>
                    <option value="Activa">Activa</option>
                    {editingSession?.estado === 'Capacitación cerrada' && (
                      <option value="Capacitación cerrada">Capacitación cerrada</option>
                    )}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Agregar ingresantes al consolidado
                  </label>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                    className="w-full text-xs bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    {validatedParticipants.length > 0
                      ? `${validatedParticipants.length} registros validos listos. Los DNI existentes actualizaran correo y celular.`
                      : 'Adjunta un Excel o CSV para sumar nuevos participantes o actualizar datos de contacto.'}
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Observaciones Generales</label>
                  <textarea
                    value={editObservaciones}
                    onChange={(e) => setEditObservaciones(e.target.value)}
                    rows={2}
                    className="w-full text-sm bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden"
                    placeholder="Observaciones de la edición..."
                  />
                </div>
              </div>
            </div>

            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingSession(null)}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold px-4 py-2 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-5 py-2 rounded-xl"
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Training Validation Modal */}
      {sessionToClose && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="close-training-modal">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-2xl w-full overflow-hidden transform transition-all">
            <div className="bg-linear-to-r from-purple-700 to-indigo-700 px-6 py-5 text-white flex justify-between items-center">
              <div>
                <span className="bg-purple-500/30 text-purple-100 font-extrabold text-[9px] uppercase px-2 py-0.5 rounded-full tracking-wider">Cierre de Proceso</span>
                <h3 className="font-black text-lg text-white mt-1">Validación de Requisitos de Cierre</h3>
                <p className="text-white/80 text-xs font-mono mt-0.5">{getTrainingIdentifier(sessionToClose)} - {sessionToClose.campaña}</p>
              </div>
              <button
                onClick={() => setSessionToClose(null)}
                className="text-white/80 hover:text-white hover:bg-white/10 p-1.5 rounded-lg text-xs"
              >
                âœ•
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <p className="text-slate-600 text-xs leading-relaxed">
                Antes de cerrar oficialmente la capacitación y dar inicio al alta operativa, el formador debe validar obligatoriamente que se hayan cumplido los siguientes procesos:
              </p>

              <div className="space-y-3">
                {/* 1. Asistencia Completa */}
                <div className={`p-4 rounded-2xl border transition-all ${
                  validationDetails.isAttendanceComplete 
                    ? 'bg-emerald-50/50 border-emerald-100' 
                    : 'bg-amber-50/50 border-amber-100'
                }`}>
                  <div className="flex gap-3">
                    <div className="mt-0.5">
                      {validationDetails.isAttendanceComplete ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 font-black text-xs">âœ“</span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 font-black text-xs">!</span>
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                        1. Registro de Asistencia Completo (100%)
                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                          validationDetails.isAttendanceComplete ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {validationDetails.isAttendanceComplete ? 'Cumplido' : 'Pendiente'}
                        </span>
                      </h4>
                      <p className="text-slate-500 text-[11px] mt-1">
                        Cada participante registrado en esta generación debe contar con su marca de asistencia correspondiente para los {getTrainingDaysCount(sessionToClose)} días de capacitación (o marca de deserción oportuna).
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Resultado de Formación y Comentarios */}
                <div className={`p-4 rounded-2xl border transition-all ${
                  (validationDetails.isResultadoFormacionCompleto && validationDetails.isCommentsComplete)
                    ? 'bg-emerald-50/50 border-emerald-100' 
                    : 'bg-amber-50/50 border-amber-100'
                }`}>
                  <div className="flex gap-3">
                    <div className="mt-0.5">
                      {(validationDetails.isResultadoFormacionCompleto && validationDetails.isCommentsComplete) ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 font-black text-xs">âœ“</span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 font-black text-xs">!</span>
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                        2. Calificación Final de Aptitud y Comentarios
                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                          (validationDetails.isResultadoFormacionCompleto && validationDetails.isCommentsComplete) ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {(validationDetails.isResultadoFormacionCompleto && validationDetails.isCommentsComplete) ? 'Cumplido' : 'Pendiente'}
                        </span>
                      </h4>
                      <p className="text-slate-500 text-[11px] mt-1">
                        Todos los participantes que completaron el proceso deben tener definido su resultado final (<strong className="text-slate-700 font-extrabold">Apto</strong> o <strong className="text-slate-700 font-extrabold">No apto</strong>), incluyendo comentarios obligatorios (motivo de no aptitud de mínimo 10 caracteres o comentario de aptitud).
                      </p>
                      {!validationDetails.isResultadoFormacionCompleto && (
                        <p className="text-rose-600 text-[10px] font-bold mt-1.5">? Existen participantes sin calificar su aptitud.</p>
                      )}
                      {validationDetails.isResultadoFormacionCompleto && !validationDetails.isCommentsComplete && (
                        <p className="text-rose-600 text-[10px] font-bold mt-1.5">? Existen participantes aprobados o reprobados sin su comentario de justificación correspondiente.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* 3. Encuesta de Satisfacción */}
                <div className={`p-4 rounded-2xl border transition-all ${
                  validationDetails.isSurveyComplete 
                    ? 'bg-emerald-50/50 border-emerald-100' 
                    : 'bg-amber-50/50 border-amber-100'
                }`}>
                  <div className="flex gap-3">
                    <div className="mt-0.5">
                      {validationDetails.isSurveyComplete ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 font-black text-xs">âœ“</span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 font-black text-xs">!</span>
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                        3. Encuesta de Satisfacción (100% de Aptos)
                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                          validationDetails.isSurveyComplete ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {validationDetails.isSurveyComplete ? 'Cumplido' : 'Pendiente'}
                        </span>
                      </h4>
                      <p className="text-slate-500 text-[11px] mt-1">
                        La encuesta de satisfacción debe estar creada, habilitada, y el 100% de los ejecutivos declarados aptos con asistencia del 80% o superior deben haberla completado.
                      </p>
                      <div className="mt-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-[11px] text-slate-700 space-y-1">
                        <div className="flex justify-between font-medium">
                          <span>Ejecutivos habilitados para evaluar:</span>
                          <span className="font-extrabold text-slate-900">{validationDetails.habilitadosCount}</span>
                        </div>
                        <div className="flex justify-between text-emerald-600 font-bold">
                          <span>Evaluaciones completadas:</span>
                          <span>{validationDetails.respondieronCount}</span>
                        </div>
                        <div className="flex justify-between text-amber-600 font-bold">
                          <span>Evaluaciones pendientes:</span>
                          <span>{validationDetails.pendientesCount}</span>
                        </div>

                        {validationDetails.pendientesCount > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-200">
                            <span className="font-extrabold text-slate-600 block mb-1">Ejecutivos pendientes de responder:</span>
                            <div className="max-h-24 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
                              {validationDetails.pendientesList.map(p => (
                                <div key={p.id} className="flex justify-between items-center text-[10px] bg-white p-1.5 rounded-lg border border-slate-100">
                                  <span className="font-bold text-slate-800">{p.nombres} {p.apellidos}</span>
                                  <span className="font-mono text-slate-400">DNI: {p.dni}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Alta Operativa */}
                <div className={`p-4 rounded-2xl border transition-all ${
                  validationDetails.isAptosDefined 
                    ? 'bg-emerald-50/50 border-emerald-100' 
                    : 'bg-amber-50/50 border-amber-100'
                }`}>
                  <div className="flex gap-3">
                    <div className="mt-0.5">
                      {validationDetails.isAptosDefined ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 font-black text-xs">âœ“</span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 font-black text-xs">!</span>
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                        4. Habilitación de Alta en Operaciones
                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                          validationDetails.isAptosDefined ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {validationDetails.isAptosDefined ? 'Cumplido' : 'Pendiente'}
                        </span>
                      </h4>
                      <p className="text-slate-500 text-[11px] mt-1">
                        Haber culminado la capacitación y preparado el consolidado de aptos que serán asignados para el alta operativa por el Área correspondiente.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Final Resolution Banner */}
              {closeRequirementsMet ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex gap-3 text-emerald-800 text-xs">
                  <div className="text-base">ðŸŽ‰</div>
                  <div>
                    <h5 className="font-extrabold">¡Todo en orden!</h5>
                    <p className="text-emerald-700 mt-0.5 font-medium">Todos los controles de calidad han sido superados con éxito. Puede proceder a realizar el cierre de la capacitación.</p>
                  </div>
                </div>
              ) : canForceCloseAsAdmin ? (
                <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex gap-3 text-indigo-800 text-xs">
                  <div className="text-base">!</div>
                  <div>
                    <h5 className="font-extrabold">Cierre administrativo permitido</h5>
                    <p className="text-indigo-700 mt-0.5 font-medium">Hay requisitos pendientes, pero el perfil Administrador puede cerrar la capacitación bajo criterio operativo. Los pendientes quedaran visibles en auditoria y reportes.</p>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 text-amber-800 text-xs">
                  <div className="text-base">âš ï¸</div>
                  <div>
                    <h5 className="font-extrabold">Requisitos Pendientes</h5>
                    <p className="text-amber-700 mt-0.5 font-medium">No es posible cerrar la capacitación aún. Por favor complete los registros pendientes listados anteriormente para poder habilitar el botón de cierre.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSessionToClose(null)}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold px-4 py-2 rounded-xl cursor-pointer"
              >
                Cerrar Ventana
              </button>
              <button
                type="button"
                disabled={!(closeRequirementsMet || canForceCloseAsAdmin)}
                onClick={() => {
                  if (onCloseCampaign && sessionToClose) {
                    onCloseCampaign(sessionToClose.id);
                    setSessionToClose(null);
                  }
                }}
                className={`text-white text-xs font-bold px-5 py-2 rounded-xl transition-all ${
                  (closeRequirementsMet || canForceCloseAsAdmin)
                    ? 'bg-purple-600 hover:bg-purple-700 cursor-pointer shadow-md'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                Cerrar capacitación oficialmente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen Training Session Modal */}
      {sessionToReopen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="reopen-training-modal">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden transform transition-all">
            <div className="bg-linear-to-r from-emerald-600 to-teal-600 px-6 py-4 text-white flex justify-between items-center">
              <div>
                <h3 className="font-black text-base text-white">Reapertura de Capacitación</h3>
                <p className="text-white/80 text-[10px] font-mono">{getTrainingIdentifier(sessionToReopen)}</p>
              </div>
              <button
                onClick={() => setSessionToReopen(null)}
                className="text-white/80 hover:text-white hover:bg-white/10 p-1.5 rounded-lg text-xs"
              >
                âœ•
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex gap-2.5 text-amber-800 text-[11px] leading-relaxed">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="font-medium">
                  <strong>Atención:</strong> Al reabrir esta capacitación, su estado volverá a <strong className="text-amber-950 font-black">En curso</strong>, lo que permitirá a los formadores corregir marcas de asistencia o calificaciones. Esta acción requiere justificación obligatoria y se registrará en la auditoría del sistema.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  {currentUser.rol === 'Administrador'
                    ? 'Motivo de la reapertura *'
                    : 'Motivo de la reapertura (Mínimo 15 caracteres) *'}
                </label>
                <textarea
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Escriba detalladamente el motivo por el cual es necesario reabrir esta capacitación para auditoría..."
                  rows={4}
                  className="w-full text-xs bg-slate-50 text-slate-700 rounded-xl border border-slate-200 p-3 focus:ring-2 focus:ring-emerald-500 outline-hidden leading-relaxed"
                />
                <div className="flex justify-between text-[10px] mt-1 font-semibold text-slate-400">
                  <span>{currentUser.rol === 'Administrador' ? 'Motivo obligatorio' : 'Mínimo requerido: 15 caracteres'}</span>
                  <span className={reopenReason.trim().length >= (currentUser.rol === 'Administrador' ? 1 : 15) ? 'text-emerald-600' : 'text-rose-500'}>
                    {currentUser.rol === 'Administrador'
                      ? `${reopenReason.trim().length} caracteres`
                      : `${reopenReason.trim().length} / 15`}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSessionToReopen(null)}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold px-4 py-2 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={reopenReason.trim().length < (currentUser.rol === 'Administrador' ? 1 : 15)}
                onClick={handleConfirmReopen}
                className={`text-white text-xs font-bold px-5 py-2 rounded-xl transition-all ${
                  reopenReason.trim().length >= (currentUser.rol === 'Administrador' ? 1 : 15)
                    ? 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer shadow-md'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                Confirmar Reapertura
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
