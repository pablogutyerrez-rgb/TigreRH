/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import {
  TrendingUp,
  Users,
  UserCheck,
  UserX,
  Clock,
  Briefcase,
  Layers,
  Calendar,
  Filter,
  RefreshCw,
  Award,
  Eye,
  X,
  FileUp
} from 'lucide-react';
import { TrainingSession, Participant, AttendanceRecord, OperationConfirmation, AttendanceReopenRequest, User as AppUser } from '../types';
import {
  getSessionActivityMonths,
  getTrainingTemporalStatus,
  sessionHasActivityInMonth,
  type TrainingTemporalStatus,
} from '../utils/trainingMonthly';
import { BPO_CAMPAIGNS } from '../constants/campaigns';
import MonthlyTrainingView from './MonthlyTrainingView';
import { getSessionTrainerIds, isSessionAssignedTrainer } from '../utils/trainingAssignments';
import CampaignMultiSelect from './CampaignMultiSelect';

interface DashboardProps {
  sessions: TrainingSession[];
  participants: Participant[];
  attendance: AttendanceRecord[];
  confirmations: OperationConfirmation[];
  reopens: AttendanceReopenRequest[];
  trainers: { id: string; nombre: string }[];
  recruiters: { id: string; nombre: string }[];
  currentUser: AppUser;
  onViewDetail?: (sessionId: string) => void;
}

const normalizeAttendanceStatus = (status?: string) =>
  (status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const isPresentAttendance = (status?: string) => ['asistio', 'tardanza'].includes(normalizeAttendanceStatus(status));
const isDesertionAttendance = (status?: string) => ['desistio', 'baja'].includes(normalizeAttendanceStatus(status));
const EXCLUDENT_DESERTION_REASONS = new Set([
  'problemas personales',
  'abandono durante capacitacion',
  'no acepta condiciones',
  'otra propuesta laboral',
  'problemas de salud',
  'desistimiento voluntario',
]);
const isExcludentDesertion = (record: AttendanceRecord) =>
  normalizeAttendanceStatus(record.estado_asistencia) === 'desistio' &&
  EXCLUDENT_DESERTION_REASONS.has(normalizeAttendanceStatus(record.motivo_desercion));

const calculatePhaseMetrics = (
  participantIds: Set<string>,
  attendanceRecords: AttendanceRecord[],
  confirmationRecords: OperationConfirmation[],
) => {
  const attendantsByDay = new Map<number, Set<string>>(
    [1, 2, 5, 6, 10].map((day) => [day, new Set<string>()]),
  );
  const ojtParticipantIds = new Set<string>();

  attendanceRecords.forEach((record) => {
    if (!participantIds.has(record.participant_id) || !isPresentAttendance(record.estado_asistencia)) return;
    attendantsByDay.get(record.dia)?.add(record.participant_id);
    if (record.dia >= 6 && record.dia <= 10) ojtParticipantIds.add(record.participant_id);
  });

  const confirmedAltaIds = new Set(
    confirmationRecords
      .filter((confirmation) =>
        participantIds.has(confirmation.participant_id) &&
        confirmation.estado_alta === 'Alta confirmada' &&
        ojtParticipantIds.has(confirmation.participant_id),
      )
      .map((confirmation) => confirmation.participant_id),
  );
  const d1Ids = attendantsByDay.get(1) || new Set<string>();
  const d2Ids = attendantsByDay.get(2) || new Set<string>();
  const d5Ids = attendantsByDay.get(5) || new Set<string>();
  const d6Ids = attendantsByDay.get(6) || new Set<string>();
  const d10Ids = attendantsByDay.get(10) || new Set<string>();
  const desercionesFinales = Math.max(d2Ids.size - d10Ids.size, 0);

  return {
    d1Ids,
    d2Ids,
    d5Ids,
    d6Ids,
    d10Ids,
    ojtParticipantIds,
    confirmedAltaIds,
    retencionCapacitacion: d2Ids.size > 0 ? Math.round((d5Ids.size / d2Ids.size) * 100) : 0,
    retencionOjt: d6Ids.size > 0 ? Math.round((d10Ids.size / d6Ids.size) * 100) : 0,
    desercionesFinales,
    desercionFinalRate: d2Ids.size > 0 ? Math.round((desercionesFinales / d2Ids.size) * 100) : 0,
  };
};

export default function Dashboard({
  sessions,
  participants,
  attendance,
  confirmations,
  reopens,
  trainers,
  currentUser,
  onViewDetail,
}: DashboardProps) {
  // Filters state
  const [filterCampañas, setFilterCampañas] = useState<string[]>([]);
  const [filterFormador, setFilterFormador] = useState<string>('todos');
  const [filterGeneracion, setFilterGeneracion] = useState<string>('todos');
  const [filterFechaInicio, setFilterFechaInicio] = useState<string>('');
  const [filterFechaFin, setFilterFechaFin] = useState<string>('');
  const [filterMes, setFilterMes] = useState<string>('');
  const [filterEstado, setFilterEstado] = useState<'todos' | TrainingTemporalStatus>('todos');
  const [excludeExcludentes, setExcludeExcludentes] = useState(false);
  const [evidencePreview, setEvidencePreview] = useState<{ src: string; name: string } | null>(null);

  const roleScopedSessions = useMemo(() => {
    if (currentUser.rol === 'Formador') {
      return sessions.filter((session) => isSessionAssignedTrainer(session, currentUser.id));
    }
    if (currentUser.rol === 'Reclutador') {
      return sessions.filter((session) => session.reclutador_id === currentUser.id);
    }
    return sessions;
  }, [sessions, currentUser]);

  const campaignScopedSessions = useMemo(
    () => filterCampañas.length === 0
      ? roleScopedSessions
      : roleScopedSessions.filter((session) => filterCampañas.includes(session.campaña)),
    [roleScopedSessions, filterCampañas],
  );

  const scopedTrainerIds = useMemo(
    () => new Set(campaignScopedSessions.flatMap(getSessionTrainerIds).filter(Boolean)),
    [campaignScopedSessions],
  );

  const visibleTrainers = useMemo(
    () => trainers.filter((trainer) => scopedTrainerIds.has(trainer.id)),
    [trainers, scopedTrainerIds],
  );

  const filterOptions = useMemo(() => ({
    campañas: Array.from(new Set(roleScopedSessions.map((session) => session.campaña).filter(Boolean))).sort(),
    generaciones: Array.from(new Set(campaignScopedSessions.map((session) => session.generation_code || session.nombre_generacion).filter(Boolean))).sort(),
    meses: Array.from(new Set(
      campaignScopedSessions.flatMap(getSessionActivityMonths),
    )).sort().reverse(),
  }), [roleScopedSessions, campaignScopedSessions]);

  const handleCampaignChange = (campaigns: string[]) => {
    setFilterCampañas(campaigns);
    setFilterFormador('todos');
    setFilterGeneracion('todos');
    setFilterMes('');
    setFilterEstado('todos');
  };

  // Reset Filters
  const handleResetFilters = () => {
    setFilterCampañas([]);
    setFilterFormador('todos');
    setFilterGeneracion('todos');
    setFilterFechaInicio('');
    setFilterFechaFin('');
    setFilterMes('');
    setFilterEstado('todos');
    setExcludeExcludentes(false);
  };

  // Filtered Sessions
  const filteredSessions = useMemo(() => {
    return roleScopedSessions.filter(s => {
      if (filterCampañas.length > 0 && !filterCampañas.includes(s.campaña)) return false;
      if (filterFormador !== 'todos' && !getSessionTrainerIds(s).includes(filterFormador)) return false;
      if (filterGeneracion !== 'todos' && (s.generation_code || s.nombre_generacion) !== filterGeneracion) return false;
      if (filterFechaInicio && (s.fecha_fin || s.fecha_inicio) < filterFechaInicio) return false;
      if (filterFechaFin && s.fecha_inicio > filterFechaFin) return false;
      if (filterMes && !sessionHasActivityInMonth(s, filterMes)) return false;
      if (filterMes && filterEstado !== 'todos' && getTrainingTemporalStatus(s) !== filterEstado) return false;
      return true;
    });
  }, [roleScopedSessions, filterCampañas, filterFormador, filterGeneracion, filterFechaInicio, filterFechaFin, filterMes, filterEstado]);

  const filteredSessionIds = useMemo(() => new Set(filteredSessions.map(s => s.id)), [filteredSessions]);
  const excludentParticipantIds = useMemo(
    () => new Set(attendance.filter(isExcludentDesertion).map((record) => record.participant_id)),
    [attendance],
  );
  // Filtered Participants
  const filteredParticipants = useMemo(() => {
    return participants.filter(p =>
      filteredSessionIds.has(p.training_session_id) &&
      (!excludeExcludentes || !excludentParticipantIds.has(p.id)),
    );
  }, [participants, filteredSessionIds, excludeExcludentes, excludentParticipantIds]);

  const filteredParticipantIds = useMemo(() => new Set(filteredParticipants.map(p => p.id)), [filteredParticipants]);

  // Filtered Attendance & Confirmations
  const filteredAttendance = useMemo(() => {
    return attendance.filter(a => filteredParticipantIds.has(a.participant_id));
  }, [attendance, filteredParticipantIds]);

  // Helper to filter out deleted altas
  const validConfirmations = useMemo(() => {
    return confirmations.filter(high => !high.isDeleted && high.estado_alta !== 'Eliminada');
  }, [confirmations]);

  const filteredConfirmations = useMemo(() => {
    return validConfirmations.filter(c => filteredParticipantIds.has(c.participant_id));
  }, [validConfirmations, filteredParticipantIds]);

  // KPI Calculations
  const metrics = useMemo(() => {
    const totalCargados = filteredParticipants.length;
    const phase = calculatePhaseMetrics(filteredParticipantIds, filteredAttendance, filteredConfirmations);
    const pendientesAlta = filteredParticipants.filter(p => p.estado_final === 'Pendiente de alta').length;
    const ojtParticipants = filteredParticipants.filter((participant) => phase.ojtParticipantIds.has(participant.id));
    const aptos = ojtParticipants.filter(p => p.resultado_formacion === 'Apto').length;
    const noAptos = ojtParticipants.filter(p => p.resultado_formacion === 'No apto').length;
    const totalConResultado = aptos + noAptos;
    const porcAptos = totalConResultado > 0 ? Math.round((aptos / totalConResultado) * 100) : 0;

    const convocadosVsDia1 = totalCargados > 0 ? Math.round((phase.d1Ids.size / totalCargados) * 100) : 0;

    const reqPendientes = reopens.filter(r => r.estado === 'pendiente').length;
    const reqAprobadas = reopens.filter(r => r.estado === 'aprobada').length;
    const reqRechazadas = reopens.filter(r => r.estado === 'rechazada').length;

    return {
      totalCargados,
      asistieronDia1: phase.d1Ids.size,
      asistieronDia2: phase.d2Ids.size,
      asistieronDia5: phase.d5Ids.size,
      asistieronDia6: phase.d6Ids.size,
      asistieronDia10: phase.d10Ids.size,
      desercionesFinales: phase.desercionesFinales,
      altasConfirmadas: phase.d10Ids.size,
      ojtParticipantIds: phase.ojtParticipantIds,
      pendientesAlta,
      aptos,
      noAptos,
      totalConResultado,
      porcAptos,
      convocadosVsDia1,
      retencionCapacitacion: phase.retencionCapacitacion,
      retencionOjt: phase.retencionOjt,
      desercionFinalRate: phase.desercionFinalRate,
      reqPendientes,
      reqAprobadas,
      reqRechazadas
    };
  }, [filteredParticipants, filteredParticipantIds, filteredAttendance, filteredConfirmations, reopens]);

  // 1. Embudo (Funnel) Data
  const funnelData = useMemo(() => {
    const total = metrics.totalCargados;

    return [
      { name: 'Cargados', valor: total, fill: '#6366f1' },
      { name: 'Asist. Día 1', valor: metrics.asistieronDia1, fill: '#3b82f6' },
      { name: 'Inicio Cap. (D2)', valor: metrics.asistieronDia2, fill: '#06b6d4' },
      { name: 'Cierre Cap. (D5)', valor: metrics.asistieronDia5, fill: '#10b981' },
      { name: 'Inicio OJT (D6)', valor: metrics.asistieronDia6, fill: '#8b5cf6' },
      { name: 'Cierre OJT (D10)', valor: metrics.asistieronDia10, fill: '#a855f7' },
      { name: 'Altas Conf.', valor: metrics.altasConfirmadas, fill: '#ec4899' },
    ];
  }, [metrics]);

  // 2. Comparativo por Campaña
  const campañaData = useMemo(() => {
    const campaigns = filterCampañas.length === 0 ? BPO_CAMPAIGNS : filterCampañas;
    return campaigns.map(camp => {
      const campSessions = filteredSessions.filter(s => s.campaña === camp);
      const campSessionIds = new Set(campSessions.map(s => s.id));
      const campParts = filteredParticipants.filter(p => campSessionIds.has(p.training_session_id));
      const campPartIds = new Set<string>(campParts.map(p => p.id));

      const phase = calculatePhaseMetrics(campPartIds, filteredAttendance, filteredConfirmations);

      return {
        name: camp,
        Cargados: campParts.length,
        'Asist. Día 1': phase.d1Ids.size,
        'Cierre Capacitación': phase.d5Ids.size,
        'Cierre OJT': phase.d10Ids.size,
        Altas: phase.d10Ids.size,
        'Retención Capacitación %': phase.retencionCapacitacion,
        'Retención OJT %': phase.retencionOjt,
        'Deserción Final %': phase.desercionFinalRate,
      };
    });
  }, [filteredSessions, filteredParticipants, filteredAttendance, filteredConfirmations, filterCampañas]);

  // 3. Comparativo por Formador
  const formadorData = useMemo(() => {
    return visibleTrainers.map(t => {
      const trainerSessions = filteredSessions.filter(s => getSessionTrainerIds(s).includes(t.id));
      const sIds = new Set(trainerSessions.map(s => s.id));
      const tParts = filteredParticipants.filter(p => sIds.has(p.training_session_id));
      const tPartIds = new Set<string>(tParts.map(p => p.id));

      const phase = calculatePhaseMetrics(tPartIds, filteredAttendance, filteredConfirmations);

      return {
        name: t.nombre.split(' ')[0] + ' ' + (t.nombre.split(' ')[1] || ''), // Short name
        Asignados: tParts.length,
        'Cierre Capacitación': phase.d5Ids.size,
        'Cierre OJT': phase.d10Ids.size,
        Altas: phase.d10Ids.size,
        'Efectividad %': phase.retencionOjt,
      };
    });
  }, [filteredSessions, visibleTrainers, filteredParticipants, filteredAttendance, filteredConfirmations]);

  // 4. Deserciones por Motivo
  const desertionDetails = useMemo(() => {
    const participantById = new Map(filteredParticipants.map((participant) => [participant.id, participant]));
    const firstDesertionByParticipant = new Map<string, AttendanceRecord>();

    [...filteredAttendance]
      .sort((a, b) => a.dia - b.dia)
      .forEach((record) => {
        if (
          record.dia >= 2 &&
          record.dia <= 10 &&
          isDesertionAttendance(record.estado_asistencia) &&
          !firstDesertionByParticipant.has(record.participant_id)
        ) {
          firstDesertionByParticipant.set(record.participant_id, record);
        }
      });

    return Array.from(firstDesertionByParticipant.values())
      .map((record) => ({ record, participant: participantById.get(record.participant_id) }))
      .filter((item) => item.participant)
      .sort((a, b) => b.record.dia - a.record.dia);
  }, [filteredAttendance, filteredParticipants]);

  const desercionesPorMotivo = useMemo(() => {
    const motivosCounts: { [key: string]: number } = {};
    const firstExcludentDesertionByParticipant = new Map<string, AttendanceRecord>();
    [...filteredAttendance]
      .sort((a, b) => a.dia - b.dia)
      .forEach((record) => {
        if (
          record.dia >= 2 &&
          record.dia <= 10 &&
          isExcludentDesertion(record) &&
          !firstExcludentDesertionByParticipant.has(record.participant_id)
        ) {
          firstExcludentDesertionByParticipant.set(record.participant_id, record);
        }
      });

    firstExcludentDesertionByParticipant.forEach((record) => {
      const motivo = record.motivo_desercion || 'Sin motivo especificado';
      motivosCounts[motivo] = (motivosCounts[motivo] || 0) + 1;
    });

    const colors = ['#f43f5e', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#10b981', '#f59e0b', '#ef4444'];

    return Object.keys(motivosCounts).map((motivo, index) => ({
      name: motivo,
      value: motivosCounts[motivo],
      color: colors[index % colors.length]
    })).sort((a, b) => b.value - a.value);
  }, [filteredAttendance]);

  const desercionesPorMotivoTotal = useMemo(
    () => desercionesPorMotivo.reduce((sum, item) => sum + item.value, 0),
    [desercionesPorMotivo],
  );

  // 5. Evolucion mensual / semanal calculada con datos reales.
  const evolutionData = useMemo(() => {
    const weekBuckets = new Map<string, {
      name: string;
      sortKey: number;
      Cargados: number;
      'Cierre Capacitación': number;
      'Cierre OJT': number;
      Altas: number;
    }>();

    const getWeekKey = (dateValue?: string) => {
      if (!dateValue) return null;

      const date = new Date(`${dateValue.slice(0, 10)}T00:00:00`);
      if (Number.isNaN(date.getTime())) return null;

      const weekOfMonth = Math.ceil(date.getDate() / 7);
      const monthName = date.toLocaleDateString('es-PE', { month: 'short' }).replace('.', '');
      const name = `Sem ${weekOfMonth} ${monthName}`;
      const sortKey = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + weekOfMonth;

      return { name, sortKey };
    };

    filteredSessions.forEach((session) => {
      const week = getWeekKey(session.fecha_inicio || session.fecha_creacion);
      if (!week) return;

      if (!weekBuckets.has(week.name)) {
        weekBuckets.set(week.name, {
          name: week.name,
          sortKey: week.sortKey,
          Cargados: 0,
          'Cierre Capacitación': 0,
          'Cierre OJT': 0,
          Altas: 0,
        });
      }

      const bucket = weekBuckets.get(week.name);
      if (!bucket) return;

      bucket.Cargados += filteredParticipants.filter(
        (participant) => participant.training_session_id === session.id,
      ).length;
      const sessionParts = filteredParticipants.filter((participant) => participant.training_session_id === session.id);
      const sessionPartIds = new Set<string>(sessionParts.map((participant) => participant.id));
      const phase = calculatePhaseMetrics(sessionPartIds, filteredAttendance, filteredConfirmations);
      bucket['Cierre Capacitación'] += phase.d5Ids.size;
      bucket['Cierre OJT'] += phase.d10Ids.size;
      bucket.Altas += phase.d10Ids.size;
    });

    return Array.from(weekBuckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey: _sortKey, ...bucket }) => bucket);
  }, [filteredSessions, filteredParticipants, filteredAttendance, filteredConfirmations]);

  return (
    <div className="space-y-6" id="dashboard-container">
      {/* Filters Bar */}
      <div className="glass-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-2">
            <Filter className="text-indigo-600 w-5 h-5" />
            <h2 className="text-slate-900 font-bold text-base">Filtros Ejecutivos</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:items-center gap-3">
            {/* Campaña */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Campaña</label>
              <CampaignMultiSelect
                options={filterOptions.campañas}
                selected={filterCampañas}
                onChange={handleCampaignChange}
                allLabel="Todas las Campañas"
                summaryClassName="w-full text-xs glass-input text-slate-700 rounded-lg p-2 outline-hidden"
              />
            </div>

            {/* Generación */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Generación</label>
              <select
                value={filterGeneracion}
                onChange={(e) => setFilterGeneracion(e.target.value)}
                className="w-full text-xs glass-input text-slate-700 rounded-lg p-2 outline-hidden"
              >
                <option value="todos">Todas las Generaciones</option>
                {filterOptions.generaciones.map((generacion) => (
                  <option key={generacion} value={generacion}>{generacion}</option>
                ))}
              </select>
            </div>

            {/* Formador */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Formador</label>
              <select
                value={filterFormador}
                onChange={(e) => setFilterFormador(e.target.value)}
                className="w-full text-xs glass-input text-slate-700 rounded-lg p-2 outline-hidden"
              >
                <option value="todos">{currentUser.rol === 'Formador' ? 'Mis capacitaciones' : 'Todos los Formadores'}</option>
                {visibleTrainers.map(t => (
                  <option key={t.id} value={t.id}>{t.nombre}</option>
                ))}
              </select>
            </div>

            {/* Rango de fechas */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Fecha de inicio</label>
              <input
                type="date"
                value={filterFechaInicio}
                max={filterFechaFin || undefined}
                onChange={(e) => setFilterFechaInicio(e.target.value)}
                className="w-full text-xs glass-input text-slate-700 rounded-lg p-2 outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Fecha de fin</label>
              <input
                type="date"
                value={filterFechaFin}
                min={filterFechaInicio || undefined}
                onChange={(e) => setFilterFechaFin(e.target.value)}
                className="w-full text-xs glass-input text-slate-700 rounded-lg p-2 outline-hidden"
              />
            </div>

            {/* Mes */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Ver por mes</label>
              <select
                value={filterMes}
                onChange={(e) => setFilterMes(e.target.value)}
                className="w-full text-xs glass-input text-slate-700 rounded-lg p-2 outline-hidden"
              >
                <option value="">Todos los meses</option>
                {filterOptions.meses.map((monthValue) => {
                  const [year, month] = monthValue.split('-').map(Number);
                  const label = new Intl.DateTimeFormat('es-PE', {
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  }).format(new Date(Date.UTC(year, month - 1, 1)));
                  return <option key={monthValue} value={monthValue}>{label}</option>;
                })}
              </select>
            </div>

            {filterMes && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Estado</label>
                <select
                  value={filterEstado}
                  onChange={(e) => setFilterEstado(e.target.value as 'todos' | TrainingTemporalStatus)}
                  className="w-full text-xs glass-input text-slate-700 rounded-lg p-2 outline-hidden"
                >
                  <option value="todos">Todas</option>
                  <option value="proxima">Próximas</option>
                  <option value="en_curso">En curso</option>
                  <option value="finalizada">Finalizadas</option>
                </select>
              </div>
            )}

            <div className="flex items-end">
              <button
                type="button"
                aria-pressed={excludeExcludentes}
                onClick={() => setExcludeExcludentes((current) => !current)}
                className={`w-full sm:w-auto h-9 rounded-lg text-xs px-3 py-2 flex items-center justify-center gap-1.5 transition-colors font-medium cursor-pointer ${excludeExcludentes ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
              >
                <UserX className="w-3.5 h-3.5" />
                Excluyentes
              </button>
            </div>

            {/* Reset */}
            <div className="flex items-end">
              <button
                onClick={handleResetFilters}
                className="w-full sm:w-auto h-9 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs px-3 py-2 flex items-center justify-center gap-1.5 transition-colors font-medium cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Limpiar
              </button>
            </div>
          </div>
        </div>
      </div>

      {filterMes && (
        <MonthlyTrainingView
          month={filterMes}
          sessions={filteredSessions}
          participants={filteredParticipants}
          attendance={filteredAttendance}
          confirmations={filteredConfirmations}
          onViewDetail={onViewDetail}
        />
      )}

      {/* KPI Cards Grid */}
      {!filterMes && (
      <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" id="kpi-grid">
        {/* Card 1 */}
        <div className="glass-card glass-card-hover rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-indigo-500"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 font-medium text-xs uppercase tracking-wider">Dia 1 / Convocados</p>
              <h3 className="text-slate-900 text-3xl font-black mt-1">{metrics.convocadosVsDia1}%</h3>
              <p className="text-xs text-indigo-500 font-medium mt-1">{metrics.asistieronDia1} de {metrics.totalCargados} llegaron</p>
            </div>
            <div className="bg-indigo-50 rounded-xl p-2.5 text-indigo-600 border border-indigo-100">
              <Users className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Card 2 */}
        <div className="glass-card glass-card-hover rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-cyan-500"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 font-medium text-xs uppercase tracking-wider">Retención Capacitación</p>
              <h3 className="text-slate-900 text-3xl font-black mt-1">{metrics.retencionCapacitacion}%</h3>
              <p className="text-xs text-emerald-600 font-medium mt-1">
                {metrics.asistieronDia5} de {metrics.asistieronDia2} llegaron al Día 5
              </p>
            </div>
            <div className="bg-cyan-50 rounded-xl p-2.5 text-cyan-600 border border-cyan-100">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Card 3 */}
        <div className="glass-card glass-card-hover rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-fuchsia-500"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 font-medium text-xs uppercase tracking-wider">Retención OJT</p>
              <h3 className="text-slate-900 text-3xl font-black mt-1">{metrics.retencionOjt}%</h3>
              <p className="text-xs text-fuchsia-600 font-medium mt-1">
                {metrics.asistieronDia10} de {metrics.asistieronDia6} llegaron al Día 10
              </p>
            </div>
            <div className="bg-fuchsia-50 rounded-xl p-2.5 text-fuchsia-600 border border-fuchsia-100">
              <Award className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Card 4 */}
        <div className="glass-card glass-card-hover rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-rose-500"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 font-medium text-xs uppercase tracking-wider">Deserción Final</p>
              <h3 className="text-slate-900 text-3xl font-black mt-1">{metrics.desercionFinalRate}%</h3>
              <p className="text-xs text-rose-500 font-medium mt-1">
                {metrics.desercionesFinales} de {metrics.asistieronDia2} no llegaron al Día 10
              </p>
            </div>
            <div className="bg-rose-50 rounded-xl p-2.5 text-rose-600 border border-rose-100">
              <UserX className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Card 5 */}
        <div className="glass-card glass-card-hover rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-emerald-500"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 font-medium text-xs uppercase tracking-wider">Altas</p>
              <h3 className="text-slate-900 text-3xl font-black mt-1">{metrics.altasConfirmadas}</h3>
              <p className="text-xs text-emerald-600 font-medium mt-1">Postulantes que llegaron al Día 10</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-2.5 text-emerald-600 border border-emerald-100">
              <UserCheck className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Dashboard Reopen Requests Notifications */}
      {metrics.reqPendientes > 0 && (
        <div className="bg-amber-500/10 backdrop-blur-md border border-amber-500/20 rounded-xl p-4 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/20 text-amber-800 p-2 rounded-lg">
              <Clock className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h4 className="text-amber-900 font-bold text-sm">Solicitudes de Reapertura Pendientes</h4>
              <p className="text-amber-800 text-xs font-medium">Hay {metrics.reqPendientes} solicitudes de formadores esperando aprobación para editar asistencias.</p>
            </div>
          </div>
          <span className="bg-amber-600 text-white font-bold text-xs px-2.5 py-1 rounded-full shadow-xs">
            Pendientes: {metrics.reqPendientes}
          </span>
        </div>
      )}

      {/* Charts Panel Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Embudo de Formación */}
        <div className="glass-card flex flex-col p-5 rounded-2xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-slate-800 font-bold text-base flex items-center gap-1.5">
              <TrendingUp className="text-indigo-600 w-4.5 h-4.5" />
              Embudo de Formación
            </h3>
            <span className="text-slate-400 text-xs font-mono">Conversión</span>
          </div>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={funnelData} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" stroke="#94a3b8" fontSize={11} />
                <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={11} width={85} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}
                  labelStyle={{ fontWeight: 'bold', color: '#1e293b' }}
                />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                  {funnelData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-center text-xs text-slate-500">
            Muestra el flujo de participantes desde la carga inicial hasta el alta en operación.
          </div>
        </div>

        {/* Comparativo por Campaña */}
        <div className="glass-card flex flex-col p-5 rounded-2xl lg:col-span-2">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-slate-800 font-bold text-base flex items-center gap-1.5">
              <Briefcase className="text-fuchsia-600 w-4.5 h-4.5" />
              Comparativo por Campaña BPO
            </h3>
            <span className="text-slate-400 text-xs font-mono">Rendimiento</span>
          </div>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={campañaData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}
                />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Cargados" fill="#818cf8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Asist. Día 1" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Cierre Capacitación" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Cierre OJT" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Altas" fill="#ec4899" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2 pt-3 border-t border-slate-100">
            {campañaData.map(c => (
              <div key={c.name} className="text-center">
                <p className="text-[10px] text-slate-500 font-semibold uppercase truncate">{c.name}</p>
                <p className="text-xs font-bold text-slate-700">OJT: {c['Retención OJT %']}%</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts Panel Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Comparativo por Formador */}
        <div className="glass-card flex flex-col p-5 rounded-2xl lg:col-span-2">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-slate-800 font-bold text-base flex items-center gap-1.5">
              <UserCheck className="text-violet-600 w-4.5 h-4.5" />
              Comparativo por Formador FDR
            </h3>
            <span className="text-slate-400 text-xs font-mono">Efectividad</span>
          </div>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={formadorData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}
                />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Asignados" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Cierre Capacitación" fill="#34d399" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Cierre OJT" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Altas" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-center text-xs text-slate-500">
            Compara la efectividad de los formadores en llevar participantes al alta final.
          </div>
        </div>

        {/* Deserciones por Motivo */}
        <div className="glass-card flex flex-col p-5 rounded-2xl lg:col-span-1">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-slate-800 font-bold text-base flex items-center gap-1.5">
              <UserX className="text-rose-500 w-4.5 h-4.5" />
              Deserciones por Motivo
            </h3>
            <span className="text-slate-400 text-xs font-mono">Día 2 a Día 10</span>
          </div>
          <div className="flex-1 min-h-[220px] flex items-center justify-center">
            {desercionesPorMotivo.length === 0 ? (
              <div className="text-center text-slate-400 py-10">
                <p className="text-sm">No se registran deserciones entre el Día 2 y el Día 10</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={desercionesPorMotivo}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {desercionesPorMotivo.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          {desercionesPorMotivo.length > 0 && (
            <div className="mt-2 space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
              {desercionesPorMotivo.slice(0, 4).map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs text-slate-600">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: item.color }}></span>
                    <span className="truncate">{item.name}</span>
                  </div>
                  <span className="font-bold font-mono">{item.value} ({desercionesPorMotivoTotal > 0 ? Math.round((item.value / desercionesPorMotivoTotal) * 100) : 0}%)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Resultados de Formación (Aptitud) Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Distribución de Aptitud Card */}
        <div className="glass-card flex flex-col p-5 rounded-2xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-slate-800 font-bold text-base flex items-center gap-1.5">
              <Award className="text-emerald-600 w-4.5 h-4.5" />
              Resultados de Calificación
            </h3>
            <span className="text-slate-400 text-xs font-mono">Aptitud</span>
          </div>
          
          <div className="flex-1 min-h-[220px] flex items-center justify-center">
            {metrics.totalConResultado === 0 ? (
              <div className="text-center text-slate-400 py-10">
                <p className="text-sm">No se registran calificaciones de aptitud todavía</p>
                <p className="text-[11px] text-slate-400 mt-1">Registre nota o marque Apto/No apto para participantes activos</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Apto', value: metrics.aptos, color: '#10b981' },
                      { name: 'No apto', value: metrics.noAptos, color: '#f43f5e' }
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#f43f5e" />
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          
          {metrics.totalConResultado > 0 && (
            <div className="mt-2 space-y-2 pt-3 border-t border-slate-100">
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="w-2.5 h-2.5 rounded-full inline-block bg-emerald-500"></span>
                  <span>Ejecutivos Aptos</span>
                </div>
                <span className="font-bold font-mono text-emerald-600">{metrics.aptos} ({metrics.porcAptos}%)</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="w-2.5 h-2.5 rounded-full inline-block bg-rose-500"></span>
                  <span>Ejecutivos No aptos</span>
                </div>
                <span className="font-bold font-mono text-rose-600">{metrics.noAptos} ({100 - metrics.porcAptos}%)</span>
              </div>
            </div>
          )}
        </div>

        {/* Motivos y comentarios de baja/deserción */}
        <div className="glass-card flex flex-col p-5 rounded-2xl lg:col-span-2">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-slate-800 font-bold text-base flex items-center gap-1.5">
              <Users className="text-indigo-600 w-4.5 h-4.5" />
              Detalle de Motivos de Deserción
            </h3>
            <span className="text-slate-400 text-xs font-mono">Comentarios</span>
          </div>
          
          <div className="flex-1 max-h-[280px] overflow-y-auto space-y-3 pr-1">
            {(() => {
              if (desertionDetails.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center text-slate-400 h-full py-16">
                    <p className="text-sm">Sin motivos de deserción registrados</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Los comentarios ingresados por los formadores se verán aquí</p>
                  </div>
                );
              }
              return desertionDetails.map(({ participant, record }) => {
                if (!participant) return null;
                return (
                  <div key={participant.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-xs text-slate-800">{participant.nombres} {participant.apellidos}</h4>
                        <p className="text-[10px] text-slate-400 font-medium">DNI: {participant.dni} · Día {record.dia}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-rose-100 text-rose-800">
                          {record.motivo_desercion || record.estado_asistencia}
                        </span>
                        {record.evidencia_imagen && (
                          <button
                            type="button"
                            onClick={() => setEvidencePreview({
                              src: record.evidencia_imagen || '',
                              name: record.evidencia_nombre || 'Evidencia de deserción',
                            })}
                            className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50"
                            title="Visualizar evidencia"
                            aria-label="Visualizar evidencia"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed italic">
                      &quot;{record.observacion || 'Sin comentario adicional.'}&quot;
                    </p>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* Trend Analysis Graph */}
      <div className="glass-card flex flex-col p-5 rounded-2xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-slate-800 font-bold text-base flex items-center gap-1.5">
            <Layers className="text-blue-600 w-4.5 h-4.5" />
            Evolución de Capacitación FDR (Semanal)
          </h3>
          <span className="text-slate-400 text-xs font-mono">Tendencias</span>
        </div>
        <div className="min-h-[220px]">
          {evolutionData.length === 0 ? (
            <div className="h-[220px] flex flex-col items-center justify-center text-center text-slate-400">
              <Layers className="w-8 h-8 mb-2 text-slate-300" />
              <p className="text-sm font-medium">Sin datos de evolución todavía</p>
              <p className="text-[11px] mt-1">Las tendencias aparecerán cuando existan capacitaciones y altas registradas.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={evolutionData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCargados" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorAltas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="Cargados" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorCargados)" />
                <Area type="monotone" dataKey="Cierre Capacitación" stroke="#10b981" strokeWidth={2} fillOpacity={0} />
                <Area type="monotone" dataKey="Cierre OJT" stroke="#8b5cf6" strokeWidth={2} fillOpacity={0} />
                <Area type="monotone" dataKey="Altas" stroke="#ec4899" strokeWidth={2} fillOpacity={1} fill="url(#colorAltas)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>

      {evidencePreview && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl p-4 max-w-3xl w-full border border-white/40 shadow-xl space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold text-sm text-slate-800 truncate">{evidencePreview.name}</h3>
              <button type="button" onClick={() => setEvidencePreview(null)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Cerrar">
                <X className="w-4 h-4" />
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
                  <a href={evidencePreview.src} download={evidencePreview.name} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700">Descargar documento</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
