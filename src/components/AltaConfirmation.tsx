/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  Award,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Filter,
  UserCheck,
  UserX,
  Briefcase,
  AlertCircle,
  Trash2,
  AlertTriangle,
  Save,
  Undo
} from 'lucide-react';
import { TrainingSession, Participant, AttendanceRecord, OperationConfirmation, AltaStatus, User as AppUser } from '../types';
import { permissions } from '../utils/permissions';
import { isSessionAssignedTrainer } from '../utils/trainingAssignments';

interface AltaConfirmationProps {
  sessions: TrainingSession[];
  participants: Participant[];
  attendance: AttendanceRecord[];
  confirmations: OperationConfirmation[];
  currentUser: AppUser;
  coordinators?: AppUser[];
  onSaveConfirmation: (newConf: Omit<OperationConfirmation, 'id' | 'fecha_registro'>) => void;
  onDeleteConfirmation?: (id: string) => void;
  onAuditLog?: (
    accion: string,
    modulo: string,
    detalle: string,
    campaña?: string,
    generacion?: string
  ) => void;
}

const MOTIVOS_NO_ALTA = [
  'No se presentó a operación',
  'No completó capacitación',
  'No aprobado por formación',
  'Desistió antes del alta',
  'No validado por operaciones',
  'Documentación incompleta',
  'Otro motivo'
];

export default function AltaConfirmation({
  sessions,
  participants,
  attendance,
  confirmations,
  currentUser,
  coordinators = [],
  onSaveConfirmation,
  onDeleteConfirmation,
  onAuditLog
}: AltaConfirmationProps) {
  const isAdmin = currentUser.rol === 'Administrador';
  const isFormador = currentUser.rol === 'Formador';
  const isReadOnly = !permissions[currentUser.rol]?.canConfirmHigh || !!currentUser.module_view_only?.includes('formacion:altas');

  // Initial Filter States
  const [selectedCampaña, setSelectedCampaña] = useState<string>('todos');
  const [selectedGeneracion, setSelectedGeneracion] = useState<string>('todos');
  const [selectedFormador, setSelectedFormador] = useState<string>(isFormador ? currentUser.nombre : 'todos');
  const [selectedEstadoCapacitacion, setSelectedEstadoCapacitacion] = useState<string>('todos');
  const [selectedEstadoAlta, setSelectedEstadoAlta] = useState<string>('todos');
  const [searchTerm, setSearchTerm] = useState('');

  // Draft changes state (participant_id -> Partial<OperationConfirmation>)
  const [drafts, setDrafts] = useState<{ [key: string]: Partial<OperationConfirmation> }>({});

  // Modal states for 'No alta' and deletion confirmation
  const [showNoAltaModal, setShowNoAltaModal] = useState(false);
  const [modalPart, setModalPart] = useState<Participant | null>(null);
  const [noAltaMotivo, setNoAltaMotivo] = useState(MOTIVOS_NO_ALTA[0]);
  const [noAltaComentario, setNoAltaComentario] = useState('');

  const [deleteConfId, setDeleteConfId] = useState<string | null>(null);
  const [deleteConfPartName, setDeleteConfPartName] = useState('');

  // Helper mapping
  const sessionMap = useMemo(() => {
    const map: { [key: string]: TrainingSession } = {};
    sessions.forEach(s => { map[s.id] = s; });
    return map;
  }, [sessions]);

  // Filter confirmations to ignore logically deleted ones
  const activeConfirmations = useMemo(() => {
    return confirmations.filter(c => !c.isDeleted && c.estado_alta !== 'Eliminada');
  }, [confirmations]);

  const confirmationsMap = useMemo(() => {
    const map: { [key: string]: OperationConfirmation } = {};
    activeConfirmations.forEach(c => { map[c.participant_id] = c; });
    return map;
  }, [activeConfirmations]);

  // Restrict sessions list by Formador role
  const visibleSessions = useMemo(() => {
    if (isFormador) {
      return sessions.filter(s => isSessionAssignedTrainer(s, currentUser.id));
    }
    return sessions;
  }, [sessions, currentUser, isFormador]);

  // Unique lists for selectors
  const campaignsList = useMemo(() => {
    const set = new Set(visibleSessions.map(s => s.campaña));
    return Array.from(set).sort();
  }, [visibleSessions]);

  const generationsList = useMemo(() => {
    let list = visibleSessions;
    if (selectedCampaña !== 'todos') {
      list = list.filter(s => s.campaña === selectedCampaña);
    }
    return list.sort((a, b) => a.nombre_generacion.localeCompare(b.nombre_generacion));
  }, [visibleSessions, selectedCampaña]);

  const trainersList = useMemo(() => {
    const set = new Set(visibleSessions.map(s => s.formador_nombre));
    return Array.from(set).sort();
  }, [visibleSessions]);

  // Main list of filtered candidates
  const filteredCandidates = useMemo(() => {
    return participants.filter(p => {
      // Altas must mirror attendance eligibility and any existing alta records.
      const conf = confirmationsMap[p.id];
      const draft = drafts[p.id];
      const finalAltaStatus = draft?.estado_alta || p.estado_alta || (conf ? conf.estado_alta : 'Pendiente de alta');
      const hasAltaRecord = Boolean(conf || draft || p.estado_alta);
      const session = sessionMap[p.training_session_id];
      const completedTraining = session?.training_model === 'split_ojt'
        ? !!session.ojt_module_id && attendance.some((record) => record.participant_id === p.id && record.dia === 10 && ['Asistió', 'Tardanza', 'Feriado'].includes(record.estado_asistencia))
        : p.resultado_formacion === 'Apto' || p.estado_final === 'Pendiente de alta' || p.estado_final === 'Alta confirmada';
      const blockedByTraining = (session?.training_model === 'split_ojt' ? p.resultado_formacion_ojt === 'No apto' : p.resultado_formacion === 'No apto') || p.estado_final === 'Desistió' || p.estado_final === 'No asistió';

      if (!completedTraining && !hasAltaRecord) return false;
      if (blockedByTraining && !hasAltaRecord) return false;

      const s = sessionMap[p.training_session_id];
      if (!s) return false;

      // Ensure formador only sees their own assigned sessions
      if (isFormador && !isSessionAssignedTrainer(s, currentUser.id)) return false;

      // 1. Campaign Filter
      if (selectedCampaña !== 'todos' && s.campaña !== selectedCampaña) return false;

      // 2. Generation Filter
      if (selectedGeneracion !== 'todos' && s.id !== selectedGeneracion) return false;

      // 3. Formador Filter
      if (selectedFormador !== 'todos' && s.formador_nombre !== selectedFormador) return false;

      // 4. Training Status Filter
      if (selectedEstadoCapacitacion !== 'todos' && s.estado !== selectedEstadoCapacitacion) return false;

      // 5. Search text filter
      const matchesSearch = p.nombres.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.apellidos.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.dni.includes(searchTerm);
      if (!matchesSearch) return false;

      // 6. Alta Status Filter
      if (selectedEstadoAlta !== 'todos' && finalAltaStatus !== selectedEstadoAlta) return false;

      return true;
    });
  }, [participants, attendance, sessionMap, isFormador, currentUser.id, selectedCampaña, selectedGeneracion, selectedFormador, selectedEstadoCapacitacion, searchTerm, confirmationsMap, drafts, selectedEstadoAlta]);

  // Handle changing status in the row
  const handleSelectStatus = (part: Participant, status: AltaStatus) => {
    if (isReadOnly) {
      if (onAuditLog) {
        onAuditLog(
          'Usuario sin permiso intenta editar alta',
          'Confirmación de altas',
          `El usuario "${currentUser.nombre}" con rol "${currentUser.rol}" intentó cambiar el estado de alta del participante ${part.nombres} ${part.apellidos} sin poseer permisos.`
        );
      }
      alert('Tu rol de usuario solo tiene permisos de lectura.');
      return;
    }

    if (status === 'No alta') {
      setModalPart(part);
      setNoAltaMotivo(MOTIVOS_NO_ALTA[0]);
      setNoAltaComentario('');
      setShowNoAltaModal(true);
    } else {
      setDrafts(prev => ({
        ...prev,
        [part.id]: {
          participant_id: part.id,
          training_session_id: part.training_session_id,
          estado_alta: status,
          fecha_alta: status === 'Alta confirmada' ? new Date().toISOString().split('T')[0] : undefined,
          motivo_no_alta: undefined,
          observacion: undefined
        }
      }));
    }
  };

  const handleConfirmNoAlta = () => {
    if (!modalPart) return;
    setDrafts(prev => ({
      ...prev,
      [modalPart.id]: {
        participant_id: modalPart.id,
        training_session_id: modalPart.training_session_id,
        estado_alta: 'No alta',
        fecha_alta: undefined,
        motivo_no_alta: noAltaMotivo,
        observacion: noAltaComentario
      }
    }));
    setShowNoAltaModal(false);
    setModalPart(null);
  };

  // Undo a row's draft changes
  const handleUndoDraft = (partId: string) => {
    setDrafts(prev => {
      const copy = { ...prev };
      delete copy[partId];
      return copy;
    });
  };

  // Save a single participant's draft change
  const handleSaveDraftRow = (partId: string) => {
    const draft = drafts[partId];
    if (!draft) return;

    const part = participants.find(p => p.id === partId);
    const s = part ? sessionMap[part.training_session_id] : undefined;

    onSaveConfirmation({
      participant_id: partId,
      training_session_id: draft.training_session_id!,
      estado_alta: draft.estado_alta!,
      fecha_alta: draft.fecha_alta,
      motivo_no_alta: draft.motivo_no_alta,
      observacion: draft.observacion,
      registrado_por: currentUser.id
    });

    // Remove from drafts
    handleUndoDraft(partId);

    // Audit Log
    if (onAuditLog) {
      const isNew = !confirmationsMap[partId];
      const actionName = isNew ? 
        (isFormador ? 'Formador confirma alta' : 'Administrador confirma alta') : 
        (isFormador ? 'Formador edita alta' : 'Administrador edita alta'); // wait, the prompt asks:
        // "Formador confirma alta", "Formador marca No alta", "Administrador confirma alta", "Administrador edita alta"
      
      let specificActionName = actionName;
      if (isFormador) {
        specificActionName = draft.estado_alta === 'No alta' ? 'Formador marca No alta' : 'Formador confirma alta';
      } else {
        specificActionName = isNew ? 'Administrador confirma alta' : 'Administrador edita alta';
      }

      onAuditLog(
        specificActionName,
        'Confirmación de altas',
        `Se guardaron cambios de alta para ${part ? part.nombres + ' ' + part.apellidos : partId} como "${draft.estado_alta}"${draft.observacion ? ' - Obs: ' + draft.observacion : ''}.`,
        s?.campaña,
        s?.nombre_generacion
      );
    }
  };

  // Save all pending drafts in the table
  const handleSaveAllDrafts = () => {
    const participantIds = Object.keys(drafts);
    if (participantIds.length === 0) return;

    participantIds.forEach(pId => {
      handleSaveDraftRow(pId);
    });
  };

  // Initiating logical delete flow (Admin only)
  const handleDeleteClick = (conf: OperationConfirmation, partName: string) => {
    if (!isAdmin) {
      if (onAuditLog) {
        onAuditLog(
          'Usuario sin permiso intenta eliminar alta',
          'Confirmación de altas',
          `El usuario "${currentUser.nombre}" con rol "${currentUser.rol}" intentó eliminar el alta del participante ${partName} sin poseer permisos.`
        );
      }
      alert('Solo los administradores pueden eliminar registros de alta.');
      return;
    }
    setDeleteConfId(conf.id);
    setDeleteConfPartName(partName);
  };

  const handleConfirmDelete = () => {
    if (deleteConfId && onDeleteConfirmation) {
      onDeleteConfirmation(deleteConfId);

      const conf = confirmations.find(c => c.id === deleteConfId);
      const s = conf ? sessionMap[conf.training_session_id] : undefined;

      if (onAuditLog) {
        onAuditLog(
          'Administrador elimina alta',
          'Confirmación de altas',
          `El administrador eliminó lógicamente el alta de ${deleteConfPartName} (ID: ${deleteConfId}).`,
          s?.campaña,
          s?.nombre_generacion
        );
      }
    }
    setDeleteConfId(null);
    setDeleteConfPartName('');
  };

  const hasDrafts = Object.keys(drafts).length > 0;

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-slate-800 text-2xl font-bold flex items-center gap-2">
            <Award className="text-fuchsia-600 animate-pulse" />
            Confirmación de Altas en Operación
          </h2>
          <p className="text-slate-500 text-sm">
            Filtra por campaña y capacitación para marcar manualmente a los ejecutivos que pasaron a operaciones.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasDrafts && (
            <button
              onClick={handleSaveAllDrafts}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl px-4 py-2.5 shadow-md flex items-center gap-1.5 transition-all cursor-pointer active:scale-98"
            >
              <Save className="w-4 h-4" />
              Guardar {Object.keys(drafts).length} Cambios
            </button>
          )}
        </div>
      </div>

      {/* FILTER PANEL - REDESIGNED */}
      <div className="bg-white rounded-3xl shadow-xs border border-slate-100 p-5 space-y-4">
        <h3 className="text-slate-800 font-bold text-xs flex items-center gap-2 uppercase tracking-wider">
          <Filter className="w-4 h-4 text-slate-400" />
          Filtros de Búsqueda y Selección
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5">
          {/* Campaña */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Campaña</label>
            <select
              value={selectedCampaña}
              onChange={(e) => {
                setSelectedCampaña(e.target.value);
                setSelectedGeneracion('todos'); // reset generation
              }}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-xs outline-hidden focus:ring-1 focus:ring-indigo-500"
            >
              <option value="todos">Todas las Campañas</option>
              {campaignsList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Código de Generación */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Código de Generación</label>
            <select
              value={selectedGeneracion}
              onChange={(e) => setSelectedGeneracion(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-xs outline-hidden focus:ring-1 focus:ring-indigo-500"
            >
              <option value="todos">Todos los Códigos</option>
              {generationsList.map(g => (
                <option key={g.id} value={g.id}>{g.nombre_generacion}</option>
              ))}
            </select>
          </div>

          {/* Formador */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Formador</label>
            <select
              value={selectedFormador}
              onChange={(e) => setSelectedFormador(e.target.value)}
              disabled={isFormador}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-xs outline-hidden focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
            >
              <option value="todos">Todos los Formadores</option>
              {trainersList.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Estado de Capacitación */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Estado Capacitación</label>
            <select
              value={selectedEstadoCapacitacion}
              onChange={(e) => setSelectedEstadoCapacitacion(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-xs outline-hidden focus:ring-1 focus:ring-indigo-500"
            >
              <option value="todos">Todos los Estados</option>
              <option value="Pendiente de inicio">Pendiente de inicio</option>
              <option value="En curso">En curso</option>
              <option value="Activa">Activa</option>
              <option value="Campaña cerrada">Campaña cerrada</option>
            </select>
          </div>

          {/* Estado de Alta */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Estado de Alta</label>
            <select
              value={selectedEstadoAlta}
              onChange={(e) => setSelectedEstadoAlta(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-xs outline-hidden focus:ring-1 focus:ring-indigo-500"
            >
              <option value="todos">Todos los Estados</option>
              <option value="Pendiente de alta">Pendiente de alta</option>
              <option value="Alta confirmada">Alta confirmada</option>
              <option value="No alta">No alta</option>
            </select>
          </div>
        </div>

        {/* Text search row */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Buscar por DNI o Nombre completo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-xs outline-hidden focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* WARNING IF NO SPECIFIC GENERATION SELECTED */}
      {selectedCampaña === 'todos' && selectedGeneracion === 'todos' && !isFormador && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            <strong>Recomendación:</strong> Selecciona una campaña y un código de generación específico en los filtros superiores para enfocar la confirmación de altas en un aula y grupo específico.
          </p>
        </div>
      )}

      {/* MAIN CANDIDATES TABLE CARD */}
      <div className="bg-white rounded-3xl shadow-xs border border-slate-100 overflow-hidden">
        {filteredCandidates.length === 0 ? (
          <div className="p-16 text-center text-slate-500 space-y-2">
            <Briefcase className="w-12 h-12 text-slate-300 mx-auto animate-pulse" />
            <p className="font-semibold text-sm">No se encontraron candidatos elegibles</p>
            <p className="text-xs text-slate-400">Prueba cambiando los filtros superiores o la búsqueda textual.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50/75 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
                <tr>
                  <th className="p-4">DNI / Candidato</th>
                  <th className="p-4">Campaña / Generación</th>
                  <th className="p-4">Formador</th>
                  <th className="p-4">Fecha Inicio</th>
                  <th className="p-4">Asistencia Final</th>
                  <th className="p-4">Estado de Alta</th>
                  <th className="p-4">Fecha Alta</th>
                  <th className="p-4">Observación de Alta</th>
                  <th className="p-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredCandidates.map((p) => {
                  const s = sessionMap[p.training_session_id];
                  const conf = confirmationsMap[p.id];
                  const draft = drafts[p.id];

                  const isRowDrafted = !!draft;
                  const currentAlta = draft?.estado_alta || (conf ? conf.estado_alta : 'Pendiente de alta');
                  const currentObs = draft?.observacion || (conf ? conf.observacion : '');
                  const currentMotivo = draft?.motivo_no_alta || (conf ? conf.motivo_no_alta : '');
                  const currentFecha = draft?.fecha_alta || (conf ? conf.fecha_alta : '');

                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-50/40 transition-colors ${
                        isRowDrafted ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      {/* Name & DNI */}
                      <td className="p-4">
                        <div className="font-semibold text-slate-800 text-sm">
                          {p.nombres} {p.apellidos}
                        </div>
                        <span className="font-mono text-[10px] text-slate-400">DNI: {p.dni}</span>
                      </td>

                      {/* Campaign & Generation */}
                      <td className="p-4">
                        <div className="font-medium text-slate-800">{s?.nombre_generacion}</div>
                        <span className="text-[10px] bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full inline-block mt-0.5">
                          {s?.campaña}
                        </span>
                      </td>

                      {/* Trainer */}
                      <td className="p-4">
                        <span className="text-slate-600 font-medium">{s?.formador_nombre}</span>
                      </td>

                      {/* Training Start Date */}
                      <td className="p-4 font-mono text-slate-500">
                        {s?.fecha_inicio}
                      </td>

                      {/* FDR Final Attendance */}
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                          p.estado_final === 'Alta confirmada' ? 'bg-emerald-100 text-emerald-800' :
                          p.estado_final === 'Desistió' ? 'bg-rose-100 text-rose-800' :
                          p.estado_final === 'No asistió' ? 'bg-red-100 text-red-800' :
                          'bg-indigo-100 text-indigo-800'
                        }`}>
                          {p.estado_final}
                        </span>
                      </td>

                      {/* Alta Selector / Display */}
                      <td className="p-4">
                        {isReadOnly ? (
                          <span className={`inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full text-[10px] ${
                            currentAlta === 'Alta confirmada' ? 'bg-emerald-100 text-emerald-800' :
                            currentAlta === 'No alta' ? 'bg-rose-100 text-rose-800' :
                            'bg-amber-100 text-amber-800'
                          }`}>
                            {currentAlta}
                          </span>
                        ) : (
                          <select
                            value={currentAlta}
                            onChange={(e) => handleSelectStatus(p, e.target.value as AltaStatus)}
                            className={`text-[11px] font-bold rounded-lg p-1 border outline-hidden ${
                              currentAlta === 'Alta confirmada' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                              currentAlta === 'No alta' ? 'bg-rose-50 border-rose-200 text-rose-700' :
                              'bg-amber-50 border-amber-200 text-amber-700'
                            }`}
                          >
                            <option value="Pendiente de alta">Pendiente de alta</option>
                            {(isAdmin || currentAlta === 'Alta confirmada') && <option value="Alta confirmada">Alta confirmada</option>}
                            <option value="No alta">No alta (Baja)</option>
                          </select>
                        )}
                      </td>

                      {/* Fecha Alta */}
                      <td className="p-4 font-mono text-slate-500 text-[11px]">
                        {currentFecha || '-'}
                      </td>

                      {/* Observación / Detalle */}
                      <td className="p-4 max-w-[150px]">
                        {currentAlta === 'No alta' ? (
                          <div className="text-[10px]" title={currentObs}>
                            <p className="font-semibold text-rose-600 truncate">{currentMotivo}</p>
                            <p className="text-slate-400 italic truncate">"{currentObs || 'Sin observación'}"</p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 group">
                            <input
                              type="text"
                              disabled={isReadOnly}
                              value={currentObs}
                              onChange={(e) => {
                                setDrafts(prev => ({
                                  ...prev,
                                  [p.id]: {
                                    participant_id: p.id,
                                    training_session_id: p.training_session_id,
                                    estado_alta: currentAlta,
                                    fecha_alta: currentFecha || undefined,
                                    motivo_no_alta: currentMotivo || undefined,
                                    observacion: e.target.value
                                  }
                                }));
                              }}
                              placeholder={isReadOnly ? '-' : "Ingresar observación..."}
                              className="w-full bg-slate-50 disabled:bg-transparent border border-transparent hover:border-slate-200 disabled:hover:border-transparent focus:border-indigo-500 rounded px-1.5 py-1 text-[11px] outline-hidden"
                            />
                          </div>
                        )}
                      </td>

                      {/* Action buttons (Row actions) */}
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Row Save/Cancel icons */}
                          {isRowDrafted && (
                            <>
                              <button
                                onClick={() => handleSaveDraftRow(p.id)}
                                title="Guardar Cambios de Fila"
                                className="p-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 cursor-pointer transition-all"
                              >
                                <Save className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleUndoDraft(p.id)}
                                title="Deshacer cambios locales"
                                className="p-1 rounded bg-slate-50 hover:bg-slate-100 text-slate-600 cursor-pointer transition-all"
                              >
                                <Undo className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}

                          {/* Delete Alta confirmation - Admin only */}
                          {isAdmin && conf && (
                            <button
                              onClick={() => handleDeleteClick(conf, `${p.nombres} ${p.apellidos}`)}
                              title="Eliminar alta"
                              className="p-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 transition-all cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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

      {/* MODAL: REGISTER NO ALTA DETAIL */}
      {showNoAltaModal && modalPart && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600 border-b border-slate-100 pb-2.5">
              <UserX className="w-5 h-5" />
              <h3 className="font-extrabold text-slate-800 text-base tracking-tight">Registrar "No Alta" en Operación</h3>
            </div>

            <p className="text-slate-600 text-xs leading-relaxed">
              Indique los detalles por los cuales <strong>{modalPart.nombres} {modalPart.apellidos}</strong> no completó su inserción operativa en el primer día laboral.
            </p>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-600 mb-1">Motivo de Rechazo / Baja Operativa *</label>
                <select
                  value={noAltaMotivo}
                  onChange={(e) => setNoAltaMotivo(e.target.value)}
                  className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-rose-500 text-slate-700 font-semibold"
                >
                  {MOTIVOS_NO_ALTA.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">Comentario u Observaciones *</label>
                <textarea
                  value={noAltaComentario}
                  onChange={(e) => setNoAltaComentario(e.target.value)}
                  placeholder="Detalle por qué desistió, no pasó el filtro médico o reprobó las credenciales..."
                  rows={3}
                  className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-rose-500 text-slate-700"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-3 text-xs font-semibold">
              <button
                onClick={() => {
                  setShowNoAltaModal(false);
                  setModalPart(null);
                }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-3 rounded-xl cursor-pointer text-center"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmNoAlta}
                disabled={!noAltaComentario.trim()}
                className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white py-3 rounded-xl cursor-pointer text-center"
              >
                Registrar No Alta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DELETE ALTA CONFIRMATION (ONLY FOR ADMIN) */}
      {deleteConfId && isAdmin && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600 border-b border-slate-100 pb-2.5">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
              <h3 className="font-extrabold text-slate-800 text-base tracking-tight">Confirmar Eliminación</h3>
            </div>

            <p className="text-slate-600 text-xs leading-relaxed">
              ¿Estás seguro de eliminar esta alta? Esta acción quitará el registro del dashboard y de los reportes activos.
            </p>

            <div className="flex gap-3 pt-3 text-xs font-semibold">
              <button
                onClick={() => {
                  setDeleteConfId(null);
                  setDeleteConfPartName('');
                }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl cursor-pointer text-center border border-slate-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-3 rounded-xl cursor-pointer text-center shadow-md active:scale-98"
              >
                Sí, eliminar alta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
