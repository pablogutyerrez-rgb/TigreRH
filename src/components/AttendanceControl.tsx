/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  Calendar,
  Users,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  UserCheck,
  UserX,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Lock,
  Unlock,
  PlusCircle,
  Info,
  Tag,
  SlidersHorizontal,
  RefreshCw,
  RotateCcw,
  Check,
  Filter,
  Pencil,
  Download,
  ShieldCheck,
  Eye,
  FileUp,
  Trash2
} from 'lucide-react';
import { TrainingSession, Participant, AttendanceRecord, AttendanceStatus, User as AppUser, AttendanceReopenRequest, OperationConfirmation } from '../types';
import { permissions } from '../utils/permissions';
import { getTrainingDays, getTrainingDaysCount } from '../utils/trainingDays';
import { getSessionTrainerNames, isSessionInitialTrainer, isSessionOjtTrainer } from '../utils/trainingAssignments';
import { getParticipantCvUrlRemote, uploadParticipantCvRemote } from '../services/operationService';
import * as XLSX from 'xlsx';

interface AttendanceControlProps {
  session: TrainingSession;
  participants: Participant[];
  attendance: AttendanceRecord[];
  confirmations: OperationConfirmation[];
  reopens: AttendanceReopenRequest[];
  currentUser: AppUser;
  simulatedTime: { hour: number; minute: number; isSimulated: boolean };
  onSaveAttendance: (record: Omit<AttendanceRecord, 'id' | 'fecha_registro'>) => void;
  onBulkAttendance: (
    sessionId: string,
    dia: number,
    status: AttendanceStatus,
    participantIds: string[],
    motivo_desercion?: string,
    obs?: string,
    evidencia_nombre?: string,
    evidencia_imagen?: string,
  ) => void;
  onRequestReopen: (newRequest: Omit<AttendanceReopenRequest, 'id' | 'formador_id' | 'formador_nombre' | 'estado' | 'fecha_solicitud'>) => Promise<void>;
  onUpdateParticipantOutcome?: (
    pId: string,
    outcome: 'Marcar' | 'Apto' | 'No apto',
    comment: string,
    reason: string,
    evaluationScore?: number,
    evaluationObservation?: string,
  ) => void;
  onUpdateParticipantDetails?: (participant: Participant) => void | Promise<void>;
  onDeleteParticipant?: (participantId: string) => void;
  onGoBack: () => void;
  onAttemptLockedEdit?: (sessionName: string, campaign: string, day: number) => void;
}

const MOTIVOS_DESERCION = [
  'No se presentó',
  'Abandono durante capacitación',
  'No acepta condiciones',
  'Otra propuesta laboral',
  'Problemas de horario',
  'Problemas personales',
  'Problemas de salud',
  'No cumple perfil',
  'Desistimiento voluntario',
  'Otro motivo'
];

const normalizeStatus = (status?: string) =>
  (status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const isPresentStatus = (status?: string) => ['asistio', 'tardanza'].includes(normalizeStatus(status));
const isAbsenceStatus = (status?: string) => normalizeStatus(status) === 'falto';
const isMedicalLeaveStatus = (status?: string) => normalizeStatus(status) === 'descanso medico';
const isDropoutStatus = (status?: string) => ['desistio', 'baja'].includes(normalizeStatus(status));
const isHolidayStatus = (status?: string) => normalizeStatus(status) === 'feriado';
const isPendingStatus = (status?: string) => ['', 'seleccionar', 'pendiente'].includes(normalizeStatus(status));
const CV_ALLOWED_UPLOAD_ROLES = ['Administrador', 'Analista', 'Reclutador', 'Coordinador'];
const CV_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const CV_ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const CV_ALLOWED_EXTENSIONS = /\.(pdf|doc|docx)$/i;

const ATTENDANCE_OPTIONS: Array<{ value: AttendanceStatus; label: string }> = [
  { value: 'Asistió', label: 'Asistió' },
  { value: 'Tardanza', label: 'Tardanza' },
  { value: 'Faltó', label: 'Faltó' },
  { value: 'Descanso médico', label: 'Descanso médico (DM)' },
  { value: 'Feriado', label: 'Feriado' },
  { value: 'Desistió', label: 'Desistió' },
  { value: 'Baja', label: 'Baja' },
];

export default function AttendanceControl({
  session,
  participants,
  attendance,
  confirmations,
  reopens,
  currentUser,
  simulatedTime,
  onSaveAttendance,
  onBulkAttendance,
  onRequestReopen,
  onUpdateParticipantOutcome,
  onUpdateParticipantDetails,
  onDeleteParticipant,
  onGoBack,
  onAttemptLockedEdit
}: AttendanceControlProps) {
  const trainingDays = useMemo(() => getTrainingDays(session), [session.training_days]);
  const trainingDaysCount = useMemo(() => getTrainingDaysCount(session), [session.training_days]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const isAdmin = currentUser.rol === 'Administrador';
  const isInitialTrainer = currentUser.rol === 'Formador' && isSessionInitialTrainer(session, currentUser.id);
  const isOjtTrainer = currentUser.rol === 'Formador' && isSessionOjtTrainer(session, currentUser.id);
  const canRoleEditAttendanceDay = (day: number) =>
    isAdmin || (isInitialTrainer && day <= 5) || (isOjtTrainer && day >= 6);

  useEffect(() => {
    if (selectedDay > trainingDaysCount) {
      setSelectedDay(trainingDaysCount);
    }
  }, [selectedDay, trainingDaysCount]);

  // Collapsible Filters Panel
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);

  // New Search Filters
  const [filterAttendanceStatus, setFilterAttendanceStatus] = useState<string>('Todos');
  const [filterFinalStatus, setFilterFinalStatus] = useState<string>('Todos');
  const [filterAltaStatus, setFilterAltaStatus] = useState<string>('Todos');
  const [filterObservationsOnly, setFilterObservationsOnly] = useState<string>('Todos'); // 'Todos', 'Con observaciones', 'Sin observaciones'
  const [filterUnmarkedOnly, setFilterUnmarkedOnly] = useState<string>('Todos'); // 'Todos', 'Sin registrar', 'Registrado'

  // Modal states
  const [showDesistioModal, setShowDesistioModal] = useState(false);
  const [modalParticipant, setModalParticipant] = useState<Participant | null>(null);
  const [desistioMotivo, setDesistioMotivo] = useState(MOTIVOS_DESERCION[0]);
  const [desistioComentario, setDesistioComentario] = useState('');
  const [desistioStatus, setDesistioStatus] = useState<Extract<AttendanceStatus, 'Desistió' | 'Baja'>>('Desistió');
  const [desistioEvidenceName, setDesistioEvidenceName] = useState('');
  const [desistioEvidenceImage, setDesistioEvidenceImage] = useState('');

  // Single Participant Observation Modal (Faltó/Tardanza)
  const [showObservationModal, setShowObservationModal] = useState(false);
  const [obsModalParticipant, setObsModalParticipant] = useState<Participant | null>(null);
  const [obsModalDay, setObsModalDay] = useState<number>(1);
  const [obsModalStatus, setObsModalStatus] = useState<AttendanceStatus>('Faltó');
  const [obsModalValue, setObsModalValue] = useState('');
  const [obsEvidenceName, setObsEvidenceName] = useState('');
  const [obsEvidenceFile, setObsEvidenceFile] = useState('');

  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenMotivo, setReopenMotivo] = useState('Se me pasó el horario de registro');
  const [reopenComentario, setReopenComentario] = useState('');
  const [isSubmittingReopen, setIsSubmittingReopen] = useState(false);

  // Bulk actions status and Bulk Dialog Modal
  const [showBulkDialogModal, setShowBulkDialogModal] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<AttendanceStatus>('Asistió');
  const [bulkMotivoDesercion, setBulkMotivoDesercion] = useState(MOTIVOS_DESERCION[0]);
  const [bulkComentario, setBulkComentario] = useState('');
  const [bulkEvidenceName, setBulkEvidenceName] = useState('');
  const [bulkEvidenceImage, setBulkEvidenceImage] = useState('');

  // Save feedback state (psychological peace of mind)
  const [showSaveFeedback, setShowSaveFeedback] = useState(false);

  // Training outcome (Apto / No apto) state variables
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const [outcomeParticipant, setOutcomeParticipant] = useState<Participant | null>(null);
  const [activeOutcome, setActiveOutcome] = useState<'Marcar' | 'Apto' | 'No apto'>('Marcar');
  const [outcomeComment, setOutcomeComment] = useState('');
  const [outcomeReason, setOutcomeReason] = useState('');
  const [outcomeError, setOutcomeError] = useState('');
  const [editingParticipant, setEditingParticipant] = useState<Participant | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<{ src: string; name: string } | null>(null);
  const [isUploadingCv, setIsUploadingCv] = useState(false);
  const [selectedCvFile, setSelectedCvFile] = useState<File | null>(null);
  const [participantDraft, setParticipantDraft] = useState({
    nombres: '',
    apellidos: '',
    celular: '',
    correo: '',
    puesto: '',
    fuente_reclutamiento: '',
    coordinador: '',
    ciudad: ''
  });

  const handleOutcomeSelect = (part: Participant, value: 'Marcar' | 'Apto' | 'No apto') => {
    if (value === 'Marcar') {
      if (onUpdateParticipantOutcome) {
        onUpdateParticipantOutcome(part.id, 'Marcar', '', '');
      }
    } else {
      setOutcomeParticipant(part);
      setActiveOutcome(value);
      setOutcomeComment(part.comentario_aptitud || '');
      setOutcomeReason(part.motivo_no_apt || '');
      setOutcomeError('');
      setShowOutcomeModal(true);
    }
  };

  const handleSaveOutcome = () => {
    if (!outcomeParticipant) return;
    if (activeOutcome === 'Apto' && !outcomeComment.trim()) {
      setOutcomeError('Debe ingresar el comentario de aptitud para los ejecutivos Aptos.');
      return;
    }
    if (activeOutcome === 'No apto' && !outcomeReason.trim()) {
      setOutcomeError('Debe ingresar el motivo de no aptitud para los ejecutivos No aptos.');
      return;
    }
    if (onUpdateParticipantOutcome) {
      onUpdateParticipantOutcome(outcomeParticipant.id, activeOutcome, outcomeComment, outcomeReason);
    }
    setShowOutcomeModal(false);
    setOutcomeParticipant(null);
  };

  const canEditEvaluation = (part: Participant) => {
    const rowAttendance = trainingDays.map(day => attendanceMap[`${part.id}_${day}`]);
    const hasDropout = part.estado_final === 'Desistió' || rowAttendance.some(a => isDropoutStatus(a?.estado_asistencia));
    const hasAnyPresent = rowAttendance.some(a => isPresentStatus(a?.estado_asistencia));
    return !hasDropout && hasAnyPresent && (isAdmin || isInitialTrainer);
  };

  const canEditOutcome = (part: Participant) => {
    const rowAttendance = trainingDays.map(day => attendanceMap[`${part.id}_${day}`]);
    const hasDropout = part.estado_final === 'Desistió' || rowAttendance.some(a => isDropoutStatus(a?.estado_asistencia));
    const hasAnyPresent = rowAttendance.some(a => isPresentStatus(a?.estado_asistencia));
    return !hasDropout && hasAnyPresent && (isAdmin || isOjtTrainer);
  };

  const saveEvaluation = (part: Participant, rawScore: string, observation: string) => {
    if (!onUpdateParticipantOutcome || !canEditEvaluation(part)) return;
    const trimmedScore = rawScore.trim();
    const cleanObservation = observation.trim();

    if (!trimmedScore) {
      onUpdateParticipantOutcome(
        part.id,
        part.resultado_formacion || 'Marcar',
        part.comentario_aptitud || '',
        part.motivo_no_apt || '',
        undefined,
        cleanObservation,
      );
      return;
    }

    const score = Number(trimmedScore);
    if (!Number.isFinite(score) || score < 0 || score > 20) {
      alert('La nota de evaluación debe estar entre 0 y 20.');
      return;
    }

    const roundedScore = Number(score.toFixed(2));
    const isApproved = roundedScore >= 16;
    const defaultObservation = isApproved
      ? `Evaluación aprobada con nota ${roundedScore}.`
      : `Evaluación desaprobada con nota ${roundedScore}.`;
    const finalObservation = cleanObservation || defaultObservation;

    onUpdateParticipantOutcome(
      part.id,
      part.resultado_formacion || 'Marcar',
      part.comentario_aptitud || '',
      part.motivo_no_apt || '',
      roundedScore,
      finalObservation,
    );
  };

  const openParticipantEditor = (part: Participant) => {
    setSelectedCvFile(null);
    setEditingParticipant(part);
    setParticipantDraft({
      nombres: part.nombres || '',
      apellidos: part.apellidos || '',
      celular: part.celular || '',
      correo: part.correo || '',
      puesto: part.puesto || '',
      fuente_reclutamiento: part.fuente_reclutamiento || '',
      coordinador: part.coordinador || '',
      ciudad: part.ciudad || ''
    });
  };

  const saveParticipantDetails = async () => {
    if (!editingParticipant || !onUpdateParticipantDetails) return;
    if (isUploadingCv) return;
    const currentParticipant = participants.find((item) => item.id === editingParticipant.id) || editingParticipant;
    const nextParticipant: Participant = {
      ...currentParticipant,
      ...editingParticipant,
      nombres: participantDraft.nombres.trim(),
      apellidos: participantDraft.apellidos.trim(),
      celular: participantDraft.celular.trim(),
      correo: participantDraft.correo.trim(),
      puesto: participantDraft.puesto.trim(),
      fuente_reclutamiento: participantDraft.fuente_reclutamiento.trim(),
      coordinador: participantDraft.coordinador.trim(),
      ciudad: participantDraft.ciudad.trim(),
      cv_file_name: editingParticipant.cv_file_name || currentParticipant.cv_file_name,
      cv_file_path: editingParticipant.cv_file_path || currentParticipant.cv_file_path,
      cv_content_type: editingParticipant.cv_content_type || currentParticipant.cv_content_type,
      cv_uploaded_at: editingParticipant.cv_uploaded_at || currentParticipant.cv_uploaded_at,
      cv_uploaded_by: editingParticipant.cv_uploaded_by || currentParticipant.cv_uploaded_by,
    };
    try {
      await onUpdateParticipantDetails(nextParticipant);
      setEditingParticipant(null);
    } catch (error) {
      console.error('Error saving participant details:', error);
    }
  };

  const closeParticipantEditor = () => {
    if (isUploadingCv) return;
    setSelectedCvFile(null);
    setEditingParticipant(null);
  };

  const canUploadCv = CV_ALLOWED_UPLOAD_ROLES.includes(currentUser.rol);
  const hasViewableCv = (part: Participant) => Boolean(
    part.cv_file_path ||
    (currentUser.rol === 'Formador' && (
      part.cv_drive_file_id ||
      part.cv_record_id ||
      part.cv_file_name
    )),
  );

  const handleViewCv = async (part: Participant) => {
    if (!hasViewableCv(part)) {
      alert('Este postulante no tiene CV cargado.');
      return;
    }
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      alert('Habilita las ventanas emergentes para visualizar el CV.');
      return;
    }
    try {
      const url = await getParticipantCvUrlRemote(part.id);
      previewWindow.opener = null;
      previewWindow.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      previewWindow.close();
      console.error('Error opening CV:', error);
      alert(error instanceof Error ? error.message : 'No se pudo abrir el CV del postulante.');
    }
  };

  const handleCvFileChange = (file?: File) => {
    if (!file) {
      setSelectedCvFile(null);
      return;
    }
    if (!CV_ALLOWED_TYPES.includes(file.type) && !CV_ALLOWED_EXTENSIONS.test(file.name)) {
      setSelectedCvFile(null);
      alert('Formato no permitido. Sube un archivo PDF, DOC o DOCX.');
      return;
    }
    if (file.size > CV_MAX_SIZE_BYTES) {
      setSelectedCvFile(null);
      alert('El CV supera el tamaño máximo permitido de 10 MB.');
      return;
    }
    setSelectedCvFile(file);
  };

  const handleSaveCv = async () => {
    if (!selectedCvFile) {
      alert('Selecciona un archivo CV antes de guardar.');
      return;
    }
    if (!editingParticipant || !onUpdateParticipantDetails || !canUploadCv) return;
    if (!CV_ALLOWED_TYPES.includes(selectedCvFile.type) && !CV_ALLOWED_EXTENSIONS.test(selectedCvFile.name)) {
      alert('Formato no permitido. Sube un archivo PDF, DOC o DOCX.');
      return;
    }
    if (selectedCvFile.size > CV_MAX_SIZE_BYTES) {
      alert('El CV supera el tamaño máximo permitido de 10 MB.');
      return;
    }
    try {
      setIsUploadingCv(true);
      const nextParticipant = await uploadParticipantCvRemote(
        editingParticipant.id,
        editingParticipant.training_session_id,
        selectedCvFile,
      );
      await onUpdateParticipantDetails(nextParticipant);
      setEditingParticipant(nextParticipant);
      setSelectedCvFile(null);
      alert('CV guardado correctamente.');
    } catch (error) {
      console.error('Error uploading CV:', error);
      alert(error instanceof Error
        ? error.message
        : 'No se pudo guardar el CV en Firebase Storage: error desconocido.');
    } finally {
      setIsUploadingCv(false);
    }
  };

  const handleEarlyAlta = (part: Participant) => {
    if (!onUpdateParticipantOutcome) return;
    if (!window.confirm(`Marcar alta anticipada para ${part.nombres} ${part.apellidos}? Se bloqueará la nota y quedará apto para encuesta.`)) return;
    onUpdateParticipantOutcome(
      part.id,
      'Apto',
      'Alta anticipada solicitada desde control de asistencia.',
      '',
      undefined,
      part.observacion_evaluacion || 'Alta anticipada',
    );
  };

  // Map confirmations by participant_id (ignoring deleted/Eliminada ones)
  const confirmationsMap = useMemo(() => {
    const map: { [key: string]: OperationConfirmation } = {};
    confirmations.filter(c => !c.isDeleted && c.estado_alta !== 'Eliminada').forEach(c => {
      map[c.participant_id] = c;
    });
    return map;
  }, [confirmations]);

  // Map attendance for fast lookup [participantId_day] -> AttendanceRecord
  const attendanceMap = useMemo(() => {
    const map: { [key: string]: AttendanceRecord } = {};
    attendance.forEach(a => {
      if (a.training_session_id === session.id) {
        map[`${a.participant_id}_${a.dia}`] = a;
      }
    });
    return map;
  }, [attendance, session.id]);

  // Filter participants
  const filteredParts = useMemo(() => {
    return participants.filter(p => {
      if (p.training_session_id !== session.id) return false;

      const normalizedSearch = searchTerm.trim().toLowerCase();
      const matchesSearch = !normalizedSearch ||
        p.nombres.toLowerCase().includes(normalizedSearch) ||
        p.apellidos.toLowerCase().includes(normalizedSearch) ||
        `${p.nombres} ${p.apellidos}`.toLowerCase().includes(normalizedSearch) ||
        p.dni.includes(normalizedSearch) ||
        (p.celular || '').includes(normalizedSearch);
      if (!matchesSearch) return false;

      const dayRecord = attendanceMap[`${p.id}_${selectedDay}`];
      const attStatus = dayRecord ? dayRecord.estado_asistencia : 'Pendiente';
      if (filterAttendanceStatus !== 'Todos' && normalizeStatus(attStatus) !== normalizeStatus(filterAttendanceStatus)) {
        return false;
      }

      const rowAttendance = trainingDays.map(d => attendanceMap[`${p.id}_${d}`]);
      const hasDesistio = rowAttendance.some(a => isDropoutStatus(a?.estado_asistencia));
      const d1 = attendanceMap[`${p.id}_1`]?.estado_asistencia;

      let computedStatus = p.estado_final;
      if (hasDesistio) {
        computedStatus = 'Desistió';
      } else if (isAbsenceStatus(d1) && rowAttendance.filter(Boolean).every(a => isAbsenceStatus(a?.estado_asistencia))) {
        computedStatus = 'No asistió';
      } else if (rowAttendance.some(a => isAbsenceStatus(a?.estado_asistencia))) {
        computedStatus = 'En riesgo';
      } else if (rowAttendance.filter(a => isPresentStatus(a?.estado_asistencia)).length === trainingDays.length) {
        const conf = confirmationsMap[p.id];
        computedStatus = conf?.estado_alta === 'Alta confirmada' || p.estado_alta === 'Alta confirmada'
          ? 'Alta confirmada'
          : conf?.estado_alta === 'No alta' || p.estado_alta === 'No alta' || p.resultado_formacion === 'No apto'
            ? 'Completó capacitación'
            : 'Pendiente de alta';
      } else if (rowAttendance.some(a => isPresentStatus(a?.estado_asistencia))) {
        computedStatus = 'En formación';
      }

      if (filterFinalStatus !== 'Todos' && computedStatus !== filterFinalStatus) {
        return false;
      }

      const conf = confirmationsMap[p.id];
      const altaStatusVal = conf ? conf.estado_alta : 'Pendiente de alta';
      if (filterAltaStatus !== 'Todos' && altaStatusVal !== filterAltaStatus) {
        return false;
      }

      const hasAnyObservation = rowAttendance.some(a => a?.observacion?.trim()) || p.observacion?.trim();
      if (filterObservationsOnly === 'Con observaciones' && !hasAnyObservation) return false;
      if (filterObservationsOnly === 'Sin observaciones' && hasAnyObservation) return false;

      const isUnmarked = !dayRecord || isPendingStatus(dayRecord.estado_asistencia);
      if (filterUnmarkedOnly === 'Sin registrar' && !isUnmarked) return false;
      if (filterUnmarkedOnly === 'Registrado' && isUnmarked) return false;

      return true;
    });
  }, [participants, session.id, searchTerm, selectedDay, attendanceMap, confirmationsMap, trainingDays, filterAttendanceStatus, filterFinalStatus, filterAltaStatus, filterObservationsOnly, filterUnmarkedOnly]);

  // Attendance metrics & progress indicators (Item 6)
  const stats = useMemo(() => {
    let total = filteredParts.length;
    let asistio = 0;
    let tardanza = 0;
    let falto = 0;
    let descansoMedico = 0;
    let desistio = 0;
    let feriado = 0;
    let pendiente = 0;

    filteredParts.forEach(p => {
      const record = attendanceMap[`${p.id}_${selectedDay}`];
      const status = record ? record.estado_asistencia : 'Pendiente';
      if (isPresentStatus(status) && normalizeStatus(status) === 'asistio') asistio++;
      else if (normalizeStatus(status) === 'tardanza') tardanza++;
      else if (isAbsenceStatus(status)) falto++;
      else if (isMedicalLeaveStatus(status)) descansoMedico++;
      else if (isDropoutStatus(status)) desistio++;
      else if (isHolidayStatus(status)) feriado++;
      else pendiente++;
    });

    const marked = total - pendiente;
    const progressPercent = total > 0 ? Math.round((marked / total) * 100) : 0;

    return { total, asistio, tardanza, falto, descansoMedico, desistio, feriado, pendiente, marked, progressPercent };
  }, [filteredParts, attendanceMap, selectedDay]);

  const attendanceWindowLabel = useMemo(() => {
    if (currentUser.rol === 'Formador') return '09:00 a 09:30';
    const [hour, minute] = (session.hora_capacitacion || '09:00').split(':').map(Number);
    const end = hour * 60 + minute + 30;
    return `${session.hora_capacitacion || '09:00'} a ${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  }, [currentUser.rol, session.hora_capacitacion]);

  // Check if modification is locked based on Role, Simulated Time and Reopens
  const isTimeLocked = useMemo(() => {
    if (!currentUser) return true;

    // Central Guard: check if role has permission to edit attendance at all
    if (!permissions[currentUser.rol]?.canEditAttendance) return true;

    if (!canRoleEditAttendanceDay(selectedDay)) return true;

    // Rule: Administrador -> Access permitted always
    if (currentUser.rol === 'Administrador') return false;

    // Rule: Formador -> Checks hours and reopens
    if (currentUser.rol === 'Formador') {
      const hour = simulatedTime.hour;
      const min = simulatedTime.minute;
      const totalMinutes = hour * 60 + min;

      const startMinutes = 9 * 60;
      const endMinutes = 9 * 60 + 30;

      const isWithinNormalWindow = totalMinutes >= startMinutes && totalMinutes <= endMinutes;

      if (isWithinNormalWindow) return false;

      // Check for approved reopen
      const hasApprovedReopen = reopens.some(r =>
        r.training_session_id === session.id &&
        r.dia_capacitacion === selectedDay &&
        r.estado === 'aprobada'
      );

      return !hasApprovedReopen;
    }

    return true;
  }, [currentUser, simulatedTime, reopens, session.id, selectedDay, isAdmin, isInitialTrainer, isOjtTrainer]);

  const readEvidenceFile = (
    file: File | undefined,
    onReady: (name: string, content: string) => void,
  ) => {
    if (!file) {
      onReady('', '');
      return;
    }
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const allowedExtension = /\.(jpe?g|png|webp|pdf|doc|docx)$/i.test(file.name);
    if (!file.type.startsWith('image/') && !allowedTypes.includes(file.type) && !allowedExtension) {
      alert('Formato no permitido. Sube una imagen, PDF, DOC o DOCX.');
      return;
    }
    if (file.size > 700 * 1024) {
      alert('El sustento debe pesar menos de 700 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onReady(file.name, String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  // Handle single attendance click change
  const handleStatusChange = (participant: Participant, day: number, status: AttendanceStatus) => {
    if (isTimeLocked) {
      if (currentUser.rol === 'Formador' && !canRoleEditAttendanceDay(day)) {
        alert(day <= 5
          ? 'Los primeros 5 días solo pueden ser editados por el Formador de Capacitación Inicial.'
          : 'Los últimos 5 días solo pueden ser editados por el Formador OJT.');
        return;
      }
      const isReadOnly = !permissions[currentUser.rol]?.canEditAttendance;
      if (isReadOnly) {
        if (onAttemptLockedEdit) {
          onAttemptLockedEdit(session.nombre_generacion, session.campaña, day);
        }
        alert('Su rol de usuario es de solo lectura. No tiene permisos para modificar la asistencia.');
      } else {
        if (currentUser.rol === 'Formador' && onAttemptLockedEdit) {
          onAttemptLockedEdit(session.nombre_generacion, session.campaña, day);
        }
        alert(`El horario de registro de asistencia es de ${attendanceWindowLabel}. Para registrar o modificar fuera de ese horario, solicita autorizacion al administrador.`);
      }
      return;
    }

    if (isDropoutStatus(status)) {
      // Open Deserción details modal
      setModalParticipant(participant);
      setDesistioStatus(status);
      setDesistioMotivo(MOTIVOS_DESERCION[0]);
      setDesistioComentario('');
      setDesistioEvidenceName('');
      setDesistioEvidenceImage('');
      setShowDesistioModal(true);
    } else if (isAbsenceStatus(status) || isMedicalLeaveStatus(status) || normalizeStatus(status) === 'tardanza') {
      // Open Novedad Observation capture modal
      const existing = attendanceMap[`${participant.id}_${day}`];
      setObsModalParticipant(participant);
      setObsModalDay(day);
      setObsModalStatus(status);
      setObsModalValue(existing?.observacion || '');
      setObsEvidenceName(existing?.evidencia_nombre || '');
      setObsEvidenceFile(existing?.evidencia_imagen || '');
      setShowObservationModal(true);
    } else {
      onSaveAttendance({
        participant_id: participant.id,
        training_session_id: session.id,
        dia: day,
        fecha: getDayDate(day),
        estado_asistencia: status,
        registrado_por: currentUser.id
      });
    }
  };

  // Date generator based on Session Start Date
  const getDayDate = (day: number) => {
    try {
      const baseDate = new Date(session.fecha_inicio + 'T12:00:00');
      baseDate.setDate(baseDate.getDate() + (day - 1));
      return baseDate.toISOString().split('T')[0];
    } catch {
      return session.fecha_inicio;
    }
  };

  // Confirm Deserción Modal
  const handleConfirmDesistio = () => {
    if (!modalParticipant) return;
    onSaveAttendance({
      participant_id: modalParticipant.id,
      training_session_id: session.id,
      dia: selectedDay,
      fecha: getDayDate(selectedDay),
      estado_asistencia: desistioStatus,
      motivo_desercion: desistioMotivo,
      observacion: desistioComentario,
      evidencia_nombre: desistioEvidenceName,
      evidencia_imagen: desistioEvidenceImage,
      registrado_por: currentUser.id
    });
    setShowDesistioModal(false);
    setModalParticipant(null);
    setDesistioEvidenceName('');
    setDesistioEvidenceImage('');
  };

  // Submit Reopen Request
  const handleSubmitReopen = async () => {
    if (isSubmittingReopen) return;
    setIsSubmittingReopen(true);
    try {
      await onRequestReopen({
        training_session_id: session.id,
        campaña: session.campaña,
        generacion: session.nombre_generacion,
        fecha_capacitacion: getDayDate(selectedDay),
        dia_capacitacion: selectedDay,
        motivo: reopenMotivo,
        comentario: reopenComentario
      });
      setShowReopenModal(false);
      setReopenComentario('');
    } finally {
      setIsSubmittingReopen(false);
    }
  };

  // Toggle selection
  const toggleSelectAll = () => {
    if (selectedParticipants.length === filteredParts.length) {
      setSelectedParticipants([]);
    } else {
      setSelectedParticipants(filteredParts.map(p => p.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    if (selectedParticipants.includes(id)) {
      setSelectedParticipants(selectedParticipants.filter(pId => pId !== id));
    } else {
      setSelectedParticipants([...selectedParticipants, id]);
    }
  };

  // Bulk execution
  const handleBulkApply = () => {
    if (isTimeLocked) {
      if (currentUser.rol === 'Formador' && onAttemptLockedEdit) {
        onAttemptLockedEdit(session.nombre_generacion, session.campaña, selectedDay);
      }
      alert(`El horario de registro de asistencia es de ${attendanceWindowLabel}. Para registrar o modificar fuera de ese horario, solicita autorizacion al administrador.`);
      return;
    }
    if (selectedParticipants.length === 0) {
      alert('Por favor seleccione al menos un participante para marcado masivo.');
      return;
    }

    setBulkMotivoDesercion(MOTIVOS_DESERCION[0]);
    setBulkComentario('');
    setBulkEvidenceName('');
    setBulkEvidenceImage('');
    setShowBulkDialogModal(true);
  };

  const handleConfirmBulkApply = () => {
    onBulkAttendance(
      session.id,
      selectedDay,
      bulkStatus,
      selectedParticipants,
      isDropoutStatus(bulkStatus) ? bulkMotivoDesercion : undefined,
      bulkComentario || undefined,
      bulkEvidenceName || undefined,
      bulkEvidenceImage || undefined
    );

    // Reset selection & options
    setSelectedParticipants([]);
    setShowBulkDialogModal(false);
    setBulkComentario('');
    setBulkEvidenceName('');
    setBulkEvidenceImage('');
  };

  // Fetch current day request status
  const currentDayRequest = useMemo(() => {
    return reopens
      .filter(r =>
        r.training_session_id === session.id &&
        r.dia_capacitacion === selectedDay
      )
      .sort((a, b) => new Date(b.fecha_solicitud).getTime() - new Date(a.fecha_solicitud).getTime())[0];
  }, [reopens, session.id, selectedDay]);

  const handleExportAttendanceExcel = () => {
    const rows = filteredParts.map((part) => {
      const rowAttendance = trainingDays.map((day) => attendanceMap[`${part.id}_${day}`]);
      const row: Record<string, string | number> = {
        DNI: part.dni,
        Nombres: part.nombres,
        Apellidos: part.apellidos,
        Celular: part.celular,
        Correo: part.correo,
        Perfil: part.puesto || '',
        'Fuente reclutamiento': part.fuente_reclutamiento || '',
        Coordinador: part.coordinador || '',
        Ciudad: part.ciudad || '',
        Campania: session.campaña,
        Generacion: session.generation_code || session.nombre_generacion,
        Formador: getSessionTrainerNames(session).join(', '),
        Evaluacion: part.evaluacion_nota ?? '',
        'Resultado formacion': part.resultado_formacion || '',
        'Estado final': part.estado_final,
        Observacion: part.observacion || part.observacion_general || '',
      };
      trainingDays.forEach((day, index) => {
        row[`Dia ${day}`] = rowAttendance[index]?.estado_asistencia || 'Pendiente';
      });
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Asistencia');
    XLSX.writeFile(workbook, `asistencia-${session.generation_code || session.nombre_generacion}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Top Navigation Row */}
      <div className="flex justify-between items-center glass-card p-4 rounded-xl">
        <button
          onClick={onGoBack}
          className="text-slate-600 hover:text-slate-800 font-semibold text-sm flex items-center gap-1 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a Capacitaciones
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportAttendanceExcel}
            className="bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs px-3 py-2 rounded-xl border border-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Descargar asistencia y perfiles en Excel"
          >
            <Download className="w-4 h-4" />
            Excel
          </button>
          <span className="text-slate-400 text-xs">Campaña:</span>
          <span className="bg-indigo-50/70 text-indigo-700 font-bold text-xs px-2.5 py-1 rounded-full border border-indigo-100">
            {session.campaña}
          </span>
          <span className="bg-slate-100/70 text-slate-700 font-bold text-xs px-2.5 py-1 rounded-full border border-slate-200">
            {session.nombre_generacion}
          </span>
        </div>
      </div>

      {/* HORARIO / LOCK BANNER */}
      <div className={`rounded-2xl p-5 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all ${
        isTimeLocked
          ? 'bg-amber-500/10 backdrop-blur-md border-amber-500/20 text-amber-900 shadow-xs'
          : 'bg-emerald-500/10 backdrop-blur-md border-emerald-500/20 text-emerald-900 shadow-xs'
      }`}>
        <div className="flex gap-3">
          <div className={`p-2.5 rounded-xl shrink-0 ${
            isTimeLocked ? 'bg-amber-500/20 text-amber-800' : 'bg-emerald-500/20 text-emerald-800'
          }`}>
            {isTimeLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-sm flex items-center gap-1.5">
              {isTimeLocked ? 'Control de Asistencia Bloqueado' : 'Control de Asistencia Habilitado'}
              <span className="font-mono text-xs bg-white/70 backdrop-blur-xs px-2 py-0.5 rounded-md border border-white/50 shadow-xs text-slate-600">
                Hora: {String(simulatedTime.hour).padStart(2, '0')}:{String(simulatedTime.minute).padStart(2, '0')}
              </span>
            </h4>
            <p className="text-xs max-w-2xl leading-relaxed">
              {isTimeLocked
                ? `El horario de registro de asistencia es de ${attendanceWindowLabel}. Para registrar o modificar fuera de ese horario, solicita autorizacion al administrador.`
                : 'Se encuentra dentro del horario permitido oficial para registrar o modificar la asistencia del día.'}
            </p>

            {currentDayRequest && (
              <div className="text-xs font-semibold mt-1.5">
                Estado de solicitud de reapertura para el Día {selectedDay}:{' '}
                <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase ${
                  currentDayRequest.estado === 'aprobada' ? 'bg-emerald-600 text-white' :
                  currentDayRequest.estado === 'rechazada' ? 'bg-rose-600 text-white' :
                  'bg-amber-500 text-white'
                }`}>
                  {currentDayRequest.estado}
                </span>
                {currentDayRequest.comentario_respuesta && (
                  <span className="text-slate-500 font-normal ml-2 italic">
                    (Motivo: "{currentDayRequest.comentario_respuesta}")
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {isTimeLocked && (
          <button
            onClick={() => {
              if (currentDayRequest?.estado === 'pendiente') {
                alert('Ya tienes una solicitud pendiente para este día.');
                return;
              }
              setShowReopenModal(true);
            }}
            className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5"
          >
            <Clock className="w-4 h-4" />
            Solicitar Reapertura Día {selectedDay}
          </button>
        )}
      </div>

      {/* ðŸ“Š INDICADORES VISUALES Y METRICAS DEL DIA */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {/* Total Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[11px] text-slate-400 font-bold uppercase">Total</span>
            <span className="text-xl font-black text-slate-800">{stats.total}</span>
          </div>
        </div>

        {/* Asistió Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[11px] text-slate-400 font-bold uppercase">Asistió</span>
            <span className="text-xl font-black text-emerald-700">{stats.asistio}</span>
          </div>
        </div>

        {/* Tardanza Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[11px] text-slate-400 font-bold uppercase">Tardanza</span>
            <span className="text-xl font-black text-amber-700">{stats.tardanza}</span>
          </div>
        </div>

        {/* Faltó Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
            <UserX className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[11px] text-slate-400 font-bold uppercase">Faltó</span>
            <span className="text-xl font-black text-rose-700">{stats.falto}</span>
          </div>
        </div>

        {/* Desistió Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-slate-100 text-slate-600 rounded-xl">
            <XCircle className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[11px] text-slate-400 font-bold uppercase">Desistió</span>
            <span className="text-xl font-black text-slate-700">{stats.desistio}</span>
          </div>
        </div>

        {/* Descanso médico Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-sky-50 text-sky-600 rounded-xl">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[11px] text-slate-400 font-bold uppercase">DM</span>
            <span className="text-xl font-black text-sky-700">{stats.descansoMedico}</span>
          </div>
        </div>

        {/* Feriado Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="p-3 bg-violet-50 text-violet-600 rounded-xl">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[11px] text-slate-400 font-bold uppercase">Feriado</span>
            <span className="text-xl font-black text-violet-700">{stats.feriado}</span>
          </div>
        </div>

        {/* Progress Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
            <span>Progreso</span>
            <span className="text-indigo-600 font-extrabold">{stats.progressPercent}%</span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden my-1">
            <div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${stats.progressPercent}%` }}></div>
          </div>
          <span className="text-[10px] text-slate-400 font-semibold text-right block">
            {stats.marked} / {stats.total} Calificados
          </span>
        </div>
      </div>

      {/* Real-time sync feedback banner */}
      {showSaveFeedback && (
        <div className="bg-emerald-500/10 backdrop-blur-md border border-emerald-500/20 text-emerald-900 rounded-2xl p-4 flex items-center justify-between animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-2 text-xs">
            <div className="bg-emerald-500 text-white p-1 rounded-full">
              <Check className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold">¡Asistencias Sincronizadas!</span> Las marcas del Día {selectedDay} se han guardado de forma segura en la base de datos de FDR.
            </div>
          </div>
          <button 
            onClick={() => setShowSaveFeedback(false)}
            className="text-emerald-700 hover:text-emerald-900 font-bold text-xs cursor-pointer"
          >
            Entendido
          </button>
        </div>
      )}

      {/* Main Grid: Days tabs & Table */}
      <div className="glass-card rounded-2xl overflow-hidden shadow-md">
        {/* Day selection tabs & Controls */}
        <div className="bg-slate-950/5 border-b border-white/10 p-4 space-y-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider mr-2">Día de Control:</span>
              {trainingDays.map(day => (
                <button
                  key={day}
                  onClick={() => {
                    setSelectedDay(day);
                    setSelectedParticipants([]);
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    selectedDay === day
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
                  }`}
                >
                  Día {day}
                  <span className="block text-[9px] font-normal opacity-80 mt-0.5">{getDayDate(day).substring(5)}</span>
                </button>
              ))}
            </div>

            {/* Controls Bar: Search, Filters toggle, Sync */}
            <div className="flex items-center gap-2 w-full lg:w-auto">
              <div className="relative flex-1 lg:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                <input
                  type="text"
                  placeholder="Buscar por DNI o Nombre..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full text-xs bg-white rounded-lg pl-8 pr-3 py-1.5 border border-slate-200 focus:ring-1 focus:ring-indigo-500 outline-hidden"
                />
              </div>

              <button
                onClick={() => setShowFiltersPanel(!showFiltersPanel)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  showFiltersPanel || filterAttendanceStatus !== 'Todos' || filterFinalStatus !== 'Todos' || filterAltaStatus !== 'Todos' || filterObservationsOnly !== 'Todos' || filterUnmarkedOnly !== 'Todos'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Filtros</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showFiltersPanel ? 'rotate-180' : ''}`} />
              </button>

              <button
                onClick={() => {
                  if (isTimeLocked) return;
                  setShowSaveFeedback(true);
                  setTimeout(() => setShowSaveFeedback(false), 5000);
                }}
                disabled={isTimeLocked}
                className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                title="Sincronizar y Confirmar Marcas en FDR"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Confirmar Marcas</span>
              </button>
            </div>
          </div>

          {/* Collapsible Filter Panel (Item 4) */}
          {showFiltersPanel && (
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-inner grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Filter 1: Attendance Status */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Estado en Día {selectedDay}</label>
                <select
                  value={filterAttendanceStatus}
                  onChange={(e) => setFilterAttendanceStatus(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-1.5 outline-hidden focus:ring-1 focus:ring-indigo-500 font-semibold"
                >
                  <option value="Todos">Todos</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Asistió">Asistió</option>
                  <option value="Tardanza">Tardanza</option>
                  <option value="Faltó">Faltó</option>
                  <option value="Descanso médico">Descanso médico (DM)</option>
                  <option value="Feriado">Feriado</option>
                  <option value="Desistió">Desistió</option>
                  <option value="Baja">Baja</option>
                </select>
              </div>

              {/* Filter 2: Final Status */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Estado Final</label>
                <select
                  value={filterFinalStatus}
                  onChange={(e) => setFilterFinalStatus(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-1.5 outline-hidden focus:ring-1 focus:ring-indigo-500 font-semibold"
                >
                  <option value="Todos">Todos</option>
                  <option value="Pendiente de gestión">Pendiente de gestión</option>
                  <option value="En formación">En formación</option>
                  <option value="Completó capacitación">Completó capacitación</option>
                  <option value="Desistió">Desistió</option>
                  <option value="No asistió">No asistió</option>
                  <option value="En riesgo">En riesgo</option>
                  <option value="Pendiente de alta">Pendiente de alta</option>
                  <option value="Alta confirmada">Alta confirmada</option>
                </select>
              </div>

              {/* Filter 3: Alta Status */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Estado de Alta</label>
                <select
                  value={filterAltaStatus}
                  onChange={(e) => setFilterAltaStatus(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-1.5 outline-hidden focus:ring-1 focus:ring-indigo-500 font-semibold"
                >
                  <option value="Todos">Todos</option>
                  <option value="Alta confirmada">Alta confirmada</option>
                  <option value="Pendiente de alta">Pendiente de alta</option>
                  <option value="No alta">No alta</option>
                </select>
              </div>

              {/* Filter 4: Observations */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Novedades / Observaciones</label>
                <select
                  value={filterObservationsOnly}
                  onChange={(e) => setFilterObservationsOnly(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-1.5 outline-hidden focus:ring-1 focus:ring-indigo-500 font-semibold"
                >
                  <option value="Todos">Todos</option>
                  <option value="Con observaciones">Con novedades / Obs</option>
                  <option value="Sin observaciones">Sin novedades / Obs</option>
                </select>
              </div>

              {/* Filter 5: Registration state & Clean */}
              <div className="space-y-1 flex flex-col justify-between">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Registro Asistencia</label>
                  <select
                    value={filterUnmarkedOnly}
                    onChange={(e) => setFilterUnmarkedOnly(e.target.value)}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-1.5 outline-hidden focus:ring-1 focus:ring-indigo-500 font-semibold"
                  >
                    <option value="Todos">Todos</option>
                    <option value="Sin registrar">Pendientes de marcas</option>
                    <option value="Registrado">Marcados</option>
                  </select>
                </div>
                
                <button
                  onClick={() => {
                    setFilterAttendanceStatus('Todos');
                    setFilterFinalStatus('Todos');
                    setFilterAltaStatus('Todos');
                    setFilterObservationsOnly('Todos');
                    setFilterUnmarkedOnly('Todos');
                  }}
                  className="w-full mt-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold py-1 rounded-md flex items-center justify-center gap-1 border border-slate-300 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Limpiar Filtros
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bulk Actions Bar */}
        {!isTimeLocked && filteredParts.length > 0 && (
          <div className="bg-slate-50/50 px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Marcado Masivo:</span>
              <span className="bg-indigo-100 text-indigo-700 font-bold px-2.5 py-0.5 rounded-full text-[10px]">
                {selectedParticipants.length} seleccionados
              </span>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value as AttendanceStatus)}
                className="bg-white border rounded-lg p-1.5 text-xs text-slate-700 font-semibold"
              >
                <option value="Asistió">Marcar Asistencia</option>
                <option value="Tardanza">Marcar Tardanza</option>
                <option value="Faltó">Marcar Faltó</option>
                <option value="Descanso médico">Marcar Descanso médico (DM)</option>
                <option value="Feriado">Marcar Feriado</option>
                <option value="Desistió">Marcar Desistencia</option>
                <option value="Baja">Marcar Baja</option>
              </select>

              <button
                onClick={handleBulkApply}
                disabled={selectedParticipants.length === 0}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                Aplicar a Selección
              </button>
            </div>
          </div>
        )}

        {/* Participants Table */}
        {filteredParts.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            No se encontraron participantes inscritos para esta capacitación.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  {!isTimeLocked && (
                    <th className="p-4 w-10">
                      <input
                        type="checkbox"
                        checked={selectedParticipants.length === filteredParts.length}
                        onChange={toggleSelectAll}
                        className="rounded text-indigo-600"
                      />
                    </th>
                  )}
                  <th className="p-4">DNI / Candidato</th>
                  {trainingDays.map(dayNum => (
                    <th key={dayNum} className={`p-4 text-center ${selectedDay === dayNum ? 'bg-indigo-50/50 text-indigo-700 font-bold' : ''}`}>
                      Día {dayNum}
                    </th>
                  ))}
                  <th className="p-4 text-center">Evaluación</th>
                  <th className="p-4 text-center">Resultado formación</th>
                  <th className="p-4">Estado Final</th>
                  <th className="p-4">Deserción / Obs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredParts.map((part) => {
                  const isSelected = selectedParticipants.includes(part.id);

                  const rowAttendance = trainingDays.map(d => attendanceMap[`${part.id}_${d}`]);
                  const hasDesistio = rowAttendance.some(a => isDropoutStatus(a?.estado_asistencia));
                  const d1 = attendanceMap[`${part.id}_1`]?.estado_asistencia;

                  // Dynamic final status calculations
                  let computedStatus = part.estado_final;
                  if (hasDesistio) {
                    computedStatus = 'Desistió';
                  } else if (isAbsenceStatus(d1) && rowAttendance.filter(Boolean).every(a => isAbsenceStatus(a?.estado_asistencia))) {
                    computedStatus = 'No asistió';
                  } else if (rowAttendance.some(a => isAbsenceStatus(a?.estado_asistencia))) {
                    computedStatus = 'En riesgo';
                  } else if (rowAttendance.filter(a => isPresentStatus(a?.estado_asistencia)).length === trainingDays.length) {
                    const conf = confirmationsMap[part.id];
                    computedStatus = conf?.estado_alta === 'Alta confirmada' || part.estado_alta === 'Alta confirmada' || part.estado_final === 'Alta confirmada'
                      ? 'Alta confirmada'
                      : conf?.estado_alta === 'No alta' || part.estado_alta === 'No alta' || part.resultado_formacion === 'No apto'
                        ? 'Completó capacitación'
                        : 'Pendiente de alta';
                  } else if (rowAttendance.some(a => isPresentStatus(a?.estado_asistencia))) {
                    computedStatus = 'En formación';
                  }

                  const activeDesistioRecord = rowAttendance.find(a => isDropoutStatus(a?.estado_asistencia));
                  const activeMedicalLeaveRecord = rowAttendance.find(a => isMedicalLeaveStatus(a?.estado_asistencia));

                  return (
                    <tr key={part.id} className={`hover:bg-slate-50/40 transition-colors ${isSelected ? 'bg-indigo-50/20' : ''}`}>
                      {!isTimeLocked && (
                        <td className="p-4">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectOne(part.id)}
                            className="rounded text-indigo-600"
                          />
                        </td>
                      )}

                      {/* Candidate details */}
                      <td className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-slate-800 text-sm">
                            {part.nombres} {part.apellidos}
                          </div>
                          <div className="flex items-center gap-1">
                            {hasViewableCv(part) && (
                              <button
                                onClick={() => void handleViewCv(part)}
                                className="text-slate-400 hover:text-emerald-600 p-1 rounded-lg hover:bg-emerald-50 transition-colors cursor-pointer"
                                title="Visualizar CV"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {onUpdateParticipantDetails && (
                              <button
                                onClick={() => openParticipantEditor(part)}
                                className="text-slate-400 hover:text-indigo-600 p-1 rounded-lg hover:bg-indigo-50 transition-colors cursor-pointer"
                                title="Editar solo datos del postulante"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {currentUser.rol === 'Administrador' && onDeleteParticipant && (
                              <button
                                onClick={() => onDeleteParticipant(part.id)}
                                className="text-slate-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Eliminar postulante"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                          <span>DNI: {part.dni}</span>
                          <span>?</span>
                          <span>Cel: {part.celular}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500 font-semibold">
                          Perfil: <span className="text-slate-700">{part.puesto || 'Sin perfil'}</span>
                        </div>
                      </td>

                      {/* Days markings */}
                      {trainingDays.map((dayNum) => {
                        const record = attendanceMap[`${part.id}_${dayNum}`];
                        const isCurrentDay = selectedDay === dayNum;
                        const isDayEditLocked = isTimeLocked || !isCurrentDay || !canRoleEditAttendanceDay(dayNum);

                        return (
                          <td key={dayNum} className={`p-2 text-center ${isCurrentDay ? 'bg-indigo-50/20' : ''}`}>
                            {isDayEditLocked && !isCurrentDay ? (
                              // Passive static display
                              record ? (
                                <span className={`inline-flex items-center justify-center font-bold px-2.5 py-1 rounded-full text-[10px] ${
                                  record.estado_asistencia === 'Asistió' ? 'bg-emerald-50 text-emerald-700' :
                                  record.estado_asistencia === 'Tardanza' ? 'bg-amber-50 text-amber-700' :
                                  record.estado_asistencia === 'Faltó' ? 'bg-rose-50 text-rose-700' :
                                  record.estado_asistencia === 'Descanso médico' ? 'bg-sky-50 text-sky-700' :
                                  record.estado_asistencia === 'Feriado' ? 'bg-violet-50 text-violet-700' :
                                  record.estado_asistencia === 'Baja' ? 'bg-orange-50 text-orange-800' :
                                  'bg-red-50 text-red-800'
                                }`}>
                                  {record.estado_asistencia === 'Asistió' ? 'Asistió' :
                                   record.estado_asistencia === 'Tardanza' ? 'Tarde' :
                                   record.estado_asistencia === 'Faltó' ? 'Faltó' :
                                   record.estado_asistencia === 'Descanso médico' ? 'DM' :
                                   record.estado_asistencia === 'Feriado' ? 'Feriado' :
                                   record.estado_asistencia === 'Baja' ? 'Baja' : 'Desistió'}
                                </span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )
                            ) : (
                              // Interactive selectors for selectedDay
                              <div className="flex items-center justify-center gap-1">
                                {isDayEditLocked ? (
                                  record ? (
                                    <span className={`inline-flex items-center justify-center font-bold px-2.5 py-1 rounded-full text-[10px] ${
                                      record.estado_asistencia === 'Asistió' ? 'bg-emerald-100 text-emerald-800' :
                                      record.estado_asistencia === 'Tardanza' ? 'bg-amber-100 text-amber-800' :
                                      record.estado_asistencia === 'Faltó' ? 'bg-rose-100 text-rose-800' :
                                      record.estado_asistencia === 'Descanso médico' ? 'bg-sky-100 text-sky-800' :
                                      record.estado_asistencia === 'Feriado' ? 'bg-violet-100 text-violet-800' :
                                      record.estado_asistencia === 'Baja' ? 'bg-orange-100 text-orange-800' :
                                      'bg-red-100 text-red-900'
                                    }`}>
                                      {record.estado_asistencia}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 italic">No marcado</span>
                                  )
                                ) : (
                                  <select
                                    value={record?.estado_asistencia || ''}
                                    onChange={(e) => handleStatusChange(part, dayNum, e.target.value as AttendanceStatus)}
                                    className={`text-[11px] font-bold rounded-lg p-1.5 border ${
                                      record?.estado_asistencia === 'Asistió' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                                      record?.estado_asistencia === 'Tardanza' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                      record?.estado_asistencia === 'Faltó' ? 'bg-rose-50 border-rose-200 text-rose-700' :
                                      record?.estado_asistencia === 'Descanso médico' ? 'bg-sky-50 border-sky-200 text-sky-700' :
                                      record?.estado_asistencia === 'Feriado' ? 'bg-violet-50 border-violet-200 text-violet-700' :
                                      record?.estado_asistencia === 'Baja' ? 'bg-orange-50 border-orange-200 text-orange-800' :
                                      record?.estado_asistencia === 'Desistió' ? 'bg-red-50 border-red-200 text-red-800' :
                                      'bg-white border-slate-200 text-slate-500'
                                    }`}
                                  >
                                    <option value="" disabled>-- Marcar --</option>
                                    <option value="Asistió">Asistió</option>
                                    <option value="Tardanza">Tardanza</option>
                                    <option value="Faltó">Faltó</option>
                                    <option value="Descanso médico">Descanso médico (DM)</option>
                                    <option value="Feriado">Feriado</option>
                                    <option value="Desistió">Desistió</option>
                                    <option value="Baja">Baja</option>
                                  </select>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}

                      {/* Evaluation score cell */}
                      <td className="p-2 text-center bg-slate-50/60 min-w-[190px]">
                        {(() => {
                          const editable = canEditEvaluation(part);
                          const currentScore = part.evaluacion_nota ?? '';
                          const currentObservation = part.observacion_evaluacion || '';
                          const scoreNumber = typeof currentScore === 'number' ? currentScore : Number(currentScore);
                          const scored = currentScore !== '' && Number.isFinite(scoreNumber);
                          const approved = scored && scoreNumber >= 16;
                          return (
                            <div className="flex flex-col items-center gap-1.5">
                              <input
                                type="number"
                                min="0"
                                max="20"
                                step="0.01"
                                defaultValue={currentScore}
                                disabled={!editable}
                                onBlur={(event) => saveEvaluation(part, event.currentTarget.value, part.observacion_evaluacion || '')}
                                className={`w-20 text-center text-xs font-black rounded-lg border px-2 py-1 outline-hidden ${
                                  !editable ? 'bg-slate-100 text-slate-400 border-slate-200' :
                                  approved ? 'bg-emerald-50 text-emerald-700 border-emerald-200 focus:ring-1 focus:ring-emerald-500' :
                                  scored ? 'bg-rose-50 text-rose-700 border-rose-200 focus:ring-1 focus:ring-rose-500' :
                                  'bg-white text-slate-700 border-slate-200 focus:ring-1 focus:ring-indigo-500'
                                }`}
                                placeholder="0-20"
                              />
                              <textarea
                                defaultValue={currentObservation}
                                disabled={!editable}
                                rows={2}
                                onBlur={(event) => saveEvaluation(part, String(part.evaluacion_nota ?? ''), event.currentTarget.value)}
                                className="w-36 resize-none rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 outline-hidden focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                                placeholder="Observación"
                              />
                              {scored && (
                                <span className={`text-[9px] font-black uppercase ${approved ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  {approved ? 'Aprobado' : 'Desaprobado'}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Resultado formación cell */}
                      <td className="p-2 text-center bg-indigo-50/5">
                        {(() => {
                          const canMarkOutcome = canEditOutcome(part);

                          const outcome = part.resultado_formacion || 'Marcar';

                          if (canMarkOutcome) {
                            return (
                              <div className="flex flex-col items-center gap-1">
                                <select
                                  value={outcome}
                                  onChange={(e) => handleOutcomeSelect(part, e.target.value as any)}
                                  className={`text-[11px] font-bold rounded-lg p-1.5 border outline-hidden cursor-pointer ${
                                    outcome === 'Apto' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                                    outcome === 'No apto' ? 'bg-rose-50 border-rose-200 text-rose-700' :
                                    'bg-white border-slate-200 text-slate-500'
                                  }`}
                                >
                                  <option value="Marcar">Marcar</option>
                                  <option value="Apto">Apto</option>
                                  <option value="No apto">No apto</option>
                                </select>
                                {outcome === 'Apto' && part.comentario_aptitud && (
                                  <span className="text-[9px] text-emerald-600 max-w-[120px] truncate block italic font-medium" title={part.comentario_aptitud}>
                                    {part.comentario_aptitud}
                                  </span>
                                )}
                                {outcome === 'No apto' && part.motivo_no_apt && (
                                  <span className="text-[9px] text-rose-600 max-w-[120px] truncate block italic font-medium" title={part.motivo_no_apt}>
                                    {part.motivo_no_apt}
                                  </span>
                                )}
                                {outcome !== 'Apto' && (
                                  <button
                                    onClick={() => handleEarlyAlta(part)}
                                    className="mt-1 inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                                    title="Marcar alta anticipada y habilitar encuesta si corresponde"
                                  >
                                    <ShieldCheck className="w-3 h-3" />
                                    Alta anticipada
                                  </button>
                                )}
                              </div>
                            );
                          } else {
                            // Read-only view for Reclutador, Coordinador, Sistemas, etc.
                            return (
                              <div className="flex flex-col items-center">
                                <span className={`inline-flex items-center justify-center font-bold px-2 py-0.5 rounded-full text-[10px] ${
                                  outcome === 'Apto' ? 'bg-emerald-100 text-emerald-800' :
                                  outcome === 'No apto' ? 'bg-rose-100 text-rose-800' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {outcome}
                                </span>
                                {outcome === 'Apto' && part.comentario_aptitud && (
                                  <span className="text-[9px] text-slate-400 max-w-[120px] truncate block italic mt-0.5" title={part.comentario_aptitud}>
                                    {part.comentario_aptitud}
                                  </span>
                                )}
                                {outcome === 'No apto' && part.motivo_no_apt && (
                                  <span className="text-[9px] text-slate-400 max-w-[120px] truncate block italic mt-0.5" title={part.motivo_no_apt}>
                                    {part.motivo_no_apt}
                                  </span>
                                )}
                              </div>
                            );
                          }
                        })()}
                      </td>

                      {/* Final status display */}
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full font-bold text-[10px] ${
                          computedStatus === 'Alta confirmada' ? 'bg-emerald-100 text-emerald-800' :
                          computedStatus === 'En formación' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                          computedStatus === 'Pendiente de alta' || computedStatus === 'Completó capacitación' ? 'bg-indigo-100 text-indigo-800' :
                          computedStatus === 'En riesgo' ? 'bg-amber-100 text-amber-800 font-semibold' :
                          computedStatus === 'Desistió' ? 'bg-red-100 text-red-800' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {computedStatus}
                        </span>
                      </td>

                      {/* Observation/Deserción Reason info */}
                      <td className="p-4 max-w-[150px] truncate">
                        {activeDesistioRecord || activeMedicalLeaveRecord ? (
                          <div className="text-[10px]" title={(activeDesistioRecord || activeMedicalLeaveRecord)?.observacion}>
                            <p className={`font-semibold truncate ${activeMedicalLeaveRecord ? 'text-sky-700' : 'text-rose-600'}`}>
                              {activeMedicalLeaveRecord ? 'Descanso médico' : activeDesistioRecord?.motivo_desercion}
                            </p>
                            <p className="text-slate-400 truncate italic">{(activeDesistioRecord || activeMedicalLeaveRecord)?.observacion}</p>
                            {(activeDesistioRecord || activeMedicalLeaveRecord)?.evidencia_imagen && (
                              <button
                                type="button"
                                onClick={() =>
                                  setEvidencePreview({
                                    src: (activeDesistioRecord || activeMedicalLeaveRecord)?.evidencia_imagen || '',
                                    name: (activeDesistioRecord || activeMedicalLeaveRecord)?.evidencia_nombre || 'Evidencia',
                                  })
                                }
                                className="mt-1 inline-flex text-[9px] font-bold text-indigo-600 underline"
                              >
                                Ver sustento
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300 italic">Sin novedades</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: EVIDENCE PREVIEW */}
      {evidencePreview && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-4 max-w-3xl w-full border border-white/40 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-black text-slate-800 text-sm">Evidencia de asistencia</h3>
                <p className="text-[11px] text-slate-400 truncate">{evidencePreview.name}</p>
              </div>
              <button
                onClick={() => setEvidencePreview(null)}
                className="text-slate-400 hover:text-slate-700 text-xl leading-none"
              >
                x
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-xl bg-slate-50 border border-slate-100 p-2">
              {evidencePreview.src.startsWith('data:image/') ? (
                <img src={evidencePreview.src} alt={evidencePreview.name} className="mx-auto max-h-[66vh] w-auto max-w-full rounded-lg object-contain" />
              ) : evidencePreview.src.startsWith('data:application/pdf') ? (
                <iframe src={evidencePreview.src} title={evidencePreview.name} className="h-[66vh] w-full rounded-lg" />
              ) : (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
                  <FileUp className="h-10 w-10 text-indigo-500" />
                  <p className="text-sm font-semibold text-slate-700">Este documento está listo para descargar.</p>
                  <a href={evidencePreview.src} download={evidencePreview.name} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700">
                    Descargar documento
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT PARTICIPANT DETAILS ONLY */}
      {editingParticipant && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white/95 rounded-2xl p-6 max-w-2xl w-full border border-white/40 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-black text-slate-800 text-base flex items-center gap-2">
                  <Pencil className="w-4.5 h-4.5 text-indigo-600" />
                  Editar datos del postulante
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Solo corrige información del postulante. La asistencia y evaluación no se modifican aquí.
                </p>
              </div>
              <button
                onClick={closeParticipantEditor}
                className="text-slate-400 hover:text-slate-700 text-xl leading-none"
              >
                x
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {[
                ['nombres', 'Nombres'],
                ['apellidos', 'Apellidos'],
                ['celular', 'Celular'],
                ['correo', 'Correo'],
                ['puesto', 'Perfil / Puesto'],
                ['fuente_reclutamiento', 'Fuente reclutamiento'],
                ['coordinador', 'Coordinador / Supervisor'],
                ['ciudad', 'Ciudad']
              ].map(([field, label]) => (
                <label key={field} className="space-y-1">
                  <span className="block font-bold text-slate-600">{label}</span>
                  <input
                    value={participantDraft[field as keyof typeof participantDraft]}
                    onChange={(event) =>
                      setParticipantDraft((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 outline-hidden focus:ring-1 focus:ring-indigo-500 text-slate-800"
                  />
                </label>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h4 className="text-sm font-black text-slate-800">Curriculum Vitae / CV</h4>
                  <p className="text-[11px] text-slate-500">
                    {selectedCvFile
                      ? `Archivo seleccionado: ${selectedCvFile.name}`
                      : editingParticipant.cv_file_name
                        ? `Archivo actual: ${editingParticipant.cv_file_name}`
                        : 'No hay CV cargado para este postulante.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {editingParticipant.cv_file_path && (
                    <button
                      type="button"
                      onClick={() => void handleViewCv(editingParticipant)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 border border-slate-200 hover:bg-emerald-50 hover:text-emerald-700"
                    >
                      <Eye className="w-4 h-4" />
                      Visualizar
                    </button>
                  )}
                  {canUploadCv && (
                    <label className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white border border-transparent ${isUploadingCv ? 'bg-slate-400 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}>
                      <FileUp className="w-4 h-4" />
                      {selectedCvFile ? 'Cambiar archivo' : 'Seleccionar CV'}
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        disabled={isUploadingCv}
                        onChange={(event) => handleCvFileChange(event.target.files?.[0])}
                        className="hidden"
                      />
                    </label>
                  )}
                  {canUploadCv && (
                    <button
                      type="button"
                      onClick={() => void handleSaveCv()}
                      disabled={isUploadingCv}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white ${isUploadingCv ? 'bg-slate-400 cursor-wait' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                    >
                      <FileUp className="w-4 h-4" />
                      {isUploadingCv ? 'Guardando CV...' : 'Guardar CV'}
                    </button>
                  )}
                </div>
              </div>
              {!canUploadCv && (
                <p className="text-[11px] text-slate-500">
                  Tu perfil solo permite visualizar el CV, no cargar ni reemplazar documentos.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                onClick={closeParticipantEditor}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2 rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={saveParticipantDetails}
                disabled={isUploadingCv}
                className={`text-white font-bold text-xs px-5 py-2 rounded-xl ${isUploadingCv ? 'bg-slate-400 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                Guardar datos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SINGLE PARTICIPANT DESERTION REASON */}
      {showDesistioModal && modalParticipant && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white/90 backdrop-blur-md rounded-2xl p-6 max-w-md w-full border border-white/40 shadow-xl space-y-4 animate-in fade-in-50 zoom-in-95 animate-duration-200">
            <div className="flex items-center gap-2.5 text-rose-600 border-b border-slate-100 pb-2">
              <AlertTriangle className="w-5 h-5 animate-bounce" />
              <h3 className="font-bold text-base">Registrar {desistioStatus === 'Baja' ? 'Baja' : 'Deserción'} de FDR</h3>
            </div>

            <p className="text-slate-600 text-xs leading-relaxed">
              Estás marcando al participante <strong>{modalParticipant.nombres} {modalParticipant.apellidos}</strong> como <strong>{desistioStatus}</strong> en el Día {selectedDay}. Este cambio es irreversible sin reapertura. Indica el motivo:
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 mb-1">Motivo de {desistioStatus === 'Baja' ? 'Baja' : 'Deserción'} *</label>
                <select
                  value={desistioMotivo}
                  onChange={(e) => setDesistioMotivo(e.target.value)}
                  className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-rose-500"
                >
                  {MOTIVOS_DESERCION.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">Observaciones / Comentario de {desistioStatus === 'Baja' ? 'Baja' : 'Deserción'} *</label>
                <textarea
                  value={desistioComentario}
                  onChange={(e) => setDesistioComentario(e.target.value)}
                  placeholder="Explique las condiciones o comentarios vertidos por el candidato al retirarse..."
                  rows={3}
                  className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">Imagen de evidencia (opcional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    readEvidenceFile(event.currentTarget.files?.[0], (name, image) => {
                      setDesistioEvidenceName(name);
                      setDesistioEvidenceImage(image);
                    })
                  }
                  className="w-full text-xs bg-slate-50 border rounded-xl p-2.5 text-slate-600"
                />
                {desistioEvidenceName && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    {desistioEvidenceImage && (
                      <img src={desistioEvidenceImage} alt="Evidencia de baja" className="h-12 w-12 rounded-lg object-cover border border-slate-200" />
                    )}
                    <span className="text-[10px] font-semibold text-slate-600 truncate">{desistioEvidenceName}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                onClick={() => {
                  setShowDesistioModal(false);
                  setModalParticipant(null);
                  setDesistioEvidenceName('');
                  setDesistioEvidenceImage('');
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2 rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDesistio}
                disabled={!desistioComentario.trim()}
                className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl"
              >
                Confirmar {desistioStatus === 'Baja' ? 'Baja' : 'Deserción'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SUBMIT REOPEN REQUEST */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white/90 backdrop-blur-md rounded-2xl p-6 max-w-md w-full border border-white/40 shadow-xl space-y-4">
            <div className="flex items-center gap-2.5 text-amber-600 border-b border-slate-100 pb-2">
              <Clock className="w-5 h-5" />
              <h3 className="font-bold text-base">Solicitar Reapertura de Asistencia</h3>
            </div>

            <p className="text-slate-600 text-xs">
              Envía una solicitud formal al administrador para abrir la edición de asistencia del{' '}
              <strong>Día {selectedDay}</strong> en la campaña <strong>{session.campaña}</strong> ({session.nombre_generacion}).
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 mb-1">Motivo Oficial *</label>
                <select
                  value={reopenMotivo}
                  onChange={(e) => setReopenMotivo(e.target.value)}
                  className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-amber-500"
                >
                  <option value="Se me pasó el horario de registro">Se me pasó el horario de registro</option>
                  <option value="Error al registrar asistencia">Error al registrar asistencia</option>
                  <option value="Problemas técnicos">Problemas técnicos</option>
                  <option value="Participante se incorporó tarde">Participante se incorporó tarde</option>
                  <option value="Validación pendiente con reclutamiento">Validación pendiente con reclutamiento</option>
                  <option value="Otro motivo">Otro motivo</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">Comentarios o Justificación *</label>
                <textarea
                  value={reopenComentario}
                  onChange={(e) => setReopenComentario(e.target.value)}
                  placeholder="Escriba los detalles de por qué requiere editar la asistencia..."
                  rows={3}
                  className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                onClick={() => setShowReopenModal(false)}
                disabled={isSubmittingReopen}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2 rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmitReopen}
                disabled={!reopenComentario.trim() || isSubmittingReopen}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl"
              >
                {isSubmittingReopen ? 'Enviando...' : 'Enviar Solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REGISTRAR NOVEDAD / OBSERVACION (Faltó/Tardanza) (Item 5) */}
      {showObservationModal && obsModalParticipant && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white/90 backdrop-blur-md rounded-2xl p-6 max-w-md w-full border border-white/40 shadow-xl space-y-4 animate-in fade-in-50 zoom-in-95 animate-duration-200">
            <div className={`flex items-center gap-2.5 border-b border-slate-100 pb-2 ${
              obsModalStatus === 'Faltó' ? 'text-rose-600' : isMedicalLeaveStatus(obsModalStatus) ? 'text-sky-600' : 'text-amber-600'
            }`}>
              <AlertTriangle className="w-5 h-5 animate-pulse" />
              <h3 className="font-bold text-base">Registrar Observación / Novedad</h3>
            </div>

            <p className="text-slate-600 text-xs leading-relaxed">
              Estás registrando un estado de <strong>{isMedicalLeaveStatus(obsModalStatus) ? 'DESCANSO MÉDICO (DM)' : obsModalStatus === 'Faltó' ? 'FALTA' : 'TARDANZA'}</strong> para{' '}
              <strong>{obsModalParticipant.nombres} {obsModalParticipant.apellidos}</strong> en el Día {obsModalDay}.
            </p>

            {isMedicalLeaveStatus(obsModalStatus) ? (
              <div className="bg-sky-50 text-sky-800 text-[11px] p-3 rounded-lg border border-sky-100 font-medium">
                Adjunta el documento o imagen que sustenta el descanso médico.
              </div>
            ) : obsModalStatus === 'Faltó' ? (
              <div className="bg-rose-50 text-rose-800 text-[11px] p-3 rounded-lg border border-rose-100 font-medium">
                El ingreso de observación o novedad es obligatorio para registrar una inasistencia (Faltó) en FDR.
              </div>
            ) : (
              <div className="bg-amber-50 text-amber-800 text-[11px] p-3 rounded-lg border border-amber-100 font-medium">
                Se recomienda detallar los minutos de tardanza o justificaciones entregadas por el participante.
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 mb-1">Descripción de la Novedad *</label>
                <textarea
                  value={obsModalValue}
                  onChange={(e) => setObsModalValue(e.target.value)}
                  placeholder={isMedicalLeaveStatus(obsModalStatus) ? 'Detalle el período o indicación del descanso médico...' : obsModalStatus === 'Faltó' ? 'Indicar motivo (ej: Celular apagado, problema médico con certificado, no responde...)' : 'Detalle la tardanza (ej: Ingresó 15 minutos tarde por congestión vehicular...)'}
                  rows={3}
                  className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-indigo-500 text-xs text-slate-800"
                />
              </div>
              {isMedicalLeaveStatus(obsModalStatus) && (
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Documento o imagen de sustento</label>
                  <input
                    type="file"
                    accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(event) =>
                      readEvidenceFile(event.currentTarget.files?.[0], (name, content) => {
                        setObsEvidenceName(name);
                        setObsEvidenceFile(content);
                      })
                    }
                    className="w-full text-xs bg-slate-50 border rounded-xl p-2.5 text-slate-600"
                  />
                  {obsEvidenceName && (
                    <p className="mt-2 truncate rounded-lg bg-sky-50 px-3 py-2 text-[10px] font-semibold text-sky-700">
                      {obsEvidenceName}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                onClick={() => {
                  setShowObservationModal(false);
                  setObsModalParticipant(null);
                  setObsEvidenceName('');
                  setObsEvidenceFile('');
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (obsModalStatus === 'Faltó' && !obsModalValue.trim()) {
                    alert('Debe rellenar obligatoriamente la observación para registrar una Falta.');
                    return;
                  }
                  onSaveAttendance({
                    participant_id: obsModalParticipant.id,
                    training_session_id: session.id,
                    dia: obsModalDay,
                    fecha: getDayDate(obsModalDay),
                    estado_asistencia: obsModalStatus,
                    observacion: obsModalValue,
                    evidencia_nombre: obsEvidenceName || undefined,
                    evidencia_imagen: obsEvidenceFile || undefined,
                    registrado_por: currentUser.id
                  });
                  setShowObservationModal(false);
                  setObsModalParticipant(null);
                  setObsEvidenceName('');
                  setObsEvidenceFile('');
                }}
                disabled={obsModalStatus === 'Faltó' && !obsModalValue.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl cursor-pointer"
              >
                Guardar Novedad
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: BULK MARKING ACTION WITH OBSERVATIONS DIALOG (Item 7) */}
      {showBulkDialogModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white/90 backdrop-blur-md rounded-2xl p-6 max-w-md w-full border border-white/40 shadow-xl space-y-4 animate-in fade-in-50 zoom-in-95 animate-duration-200">
            <div className="flex items-center gap-2.5 text-indigo-600 border-b border-slate-100 pb-2">
              <PlusCircle className="w-5 h-5 animate-pulse" />
              <h3 className="font-bold text-base">Marcado Masivo de Asistencia</h3>
            </div>

            <p className="text-slate-600 text-xs leading-relaxed">
              Vas a aplicar el estado <strong>{bulkStatus.toUpperCase()}</strong> a{' '}
              <strong>{selectedParticipants.length} participantes</strong> seleccionados en el Día {selectedDay}.
            </p>

            <div className="space-y-3 text-xs">
              {(bulkStatus === 'Desistió' || bulkStatus === 'Baja') && (
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Motivo de {bulkStatus === 'Baja' ? 'Baja' : 'Deserción'} Masiva *</label>
                  <select
                    value={bulkMotivoDesercion}
                    onChange={(e) => setBulkMotivoDesercion(e.target.value)}
                    className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-indigo-500 text-xs text-slate-800"
                  >
                    {MOTIVOS_DESERCION.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-600 mb-1">
                  Observación / Novedad {bulkStatus === 'Desistió' || bulkStatus === 'Baja' || bulkStatus === 'Faltó' ? '(Obligatorio) *' : '(Opcional)'}
                </label>
                <textarea
                  value={bulkComentario}
                  onChange={(e) => setBulkComentario(e.target.value)}
                  placeholder={bulkStatus === 'Desistió' || bulkStatus === 'Baja' || bulkStatus === 'Faltó' ? 'Escribe la justificación o comentario para este grupo...' : 'Ingresa comentarios o novedades si aplica...'}
                  rows={3}
                  className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-indigo-500 text-xs text-slate-800"
                />
              </div>

              {(bulkStatus === 'Desistió' || bulkStatus === 'Baja' || bulkStatus === 'Descanso médico') && (
                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    {bulkStatus === 'Descanso médico' ? 'Documento o imagen de sustento' : 'Evidencia masiva (opcional)'}
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(event) =>
                      readEvidenceFile(event.currentTarget.files?.[0], (name, image) => {
                        setBulkEvidenceName(name);
                        setBulkEvidenceImage(image);
                      })
                    }
                    className="w-full text-xs bg-slate-50 border rounded-xl p-2.5 text-slate-600"
                  />
                  {bulkEvidenceName && (
                    <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                      {bulkEvidenceImage.startsWith('data:image/') && (
                        <img src={bulkEvidenceImage} alt="Evidencia masiva" className="h-12 w-12 rounded-lg object-cover border border-slate-200" />
                      )}
                      <span className="text-[10px] font-semibold text-slate-600 truncate">{bulkEvidenceName}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                onClick={() => {
                  setShowBulkDialogModal(false);
                  setBulkEvidenceName('');
                  setBulkEvidenceImage('');
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmBulkApply}
                disabled={(bulkStatus === 'Desistió' || bulkStatus === 'Baja' || bulkStatus === 'Faltó') && !bulkComentario.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl cursor-pointer"
              >
                Confirmar Marcado Masivo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REGISTRAR RESULTADO FORMACION (Apto / No apto) */}
      {showOutcomeModal && outcomeParticipant && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white/90 backdrop-blur-md rounded-2xl p-6 max-w-md w-full border border-white/40 shadow-xl space-y-4 animate-in fade-in-50 zoom-in-95 animate-duration-200">
            <div className={`flex items-center gap-2.5 border-b border-slate-100 pb-2 ${
              activeOutcome === 'Apto' ? 'text-emerald-600' : 'text-rose-600'
            }`}>
              <CheckCircle className="w-5 h-5" />
              <h3 className="font-bold text-base">Registrar Resultado Formación: {activeOutcome}</h3>
            </div>

            <p className="text-slate-600 text-xs leading-relaxed">
              Estás calificando al participante <strong>{outcomeParticipant.nombres} {outcomeParticipant.apellidos}</strong> como <strong>{activeOutcome.toUpperCase()}</strong>.
            </p>

            {outcomeError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs font-semibold">
                {outcomeError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              {activeOutcome === 'Apto' ? (
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Comentario de aptitud *</label>
                  <textarea
                    value={outcomeComment}
                    onChange={(e) => {
                      setOutcomeComment(e.target.value);
                      if (e.target.value.trim()) setOutcomeError('');
                    }}
                    placeholder="Escriba un comentario sobre el desempeño sobresaliente, actitud y potencial del ejecutivo..."
                    rows={4}
                    className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-emerald-500 text-xs text-slate-800"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Este comentario es obligatorio para ejecutivos Aptos.</p>
                </div>
              ) : (
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Motivo de no aptitud *</label>
                  <textarea
                    value={outcomeReason}
                    onChange={(e) => {
                      setOutcomeReason(e.target.value);
                      if (e.target.value.trim()) setOutcomeError('');
                    }}
                    placeholder="Detalle el motivo por el cual el ejecutivo no califica (ej: No supera evaluaciones técnicas, inasistencias acumuladas, bajo nivel de comunicación...)"
                    rows={4}
                    className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-rose-500 text-xs text-slate-800"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">El motivo de no aptitud es obligatorio para ejecutivos No aptos.</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                onClick={() => {
                  setShowOutcomeModal(false);
                  setOutcomeParticipant(null);
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveOutcome}
                className={`font-bold text-xs px-5 py-2 rounded-xl text-white cursor-pointer ${
                  activeOutcome === 'Apto' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                Guardar Resultado
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
