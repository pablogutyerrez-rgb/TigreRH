/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Clock,
  CheckCircle,
  XCircle,
  FileText,
  AlertTriangle,
  User,
  Calendar,
  Lock,
  Unlock,
  MessageSquare
} from 'lucide-react';
import { AttendanceReopenRequest, User as AppUser } from '../types';

interface ReaperturasProps {
  reopens: AttendanceReopenRequest[];
  currentUser: AppUser;
  onApproveRequest: (requestId: string, adminName: string) => Promise<void>;
  onRejectRequest: (requestId: string, adminName: string, reason: string) => Promise<void>;
}

const MOTIVOS_RECHAZO = [
  'Solicitud fuera de política',
  'Información insuficiente',
  'Ya fue validado previamente',
  'No corresponde la reapertura',
  'Otro motivo'
];

export default function Reaperturas({
  reopens,
  currentUser,
  onApproveRequest,
  onRejectRequest
}: ReaperturasProps) {
  const [selectedRequest, setSelectedRequest] = useState<AttendanceReopenRequest | null>(null);
  const [rejectReason, setRejectReason] = useState(MOTIVOS_RECHAZO[0]);
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);

  const isAdmin = currentUser.rol === 'Administrador';

  // Filter requests based on role
  const visibleRequests = reopens.filter(r => {
    if (isAdmin) return true;
    return r.formador_id === currentUser.id; // Formadores only see their own
  }).sort((a, b) => new Date(b.fecha_solicitud).getTime() - new Date(a.fecha_solicitud).getTime());

  // Handle reject initiation
  const handleStartReject = (req: AttendanceReopenRequest) => {
    setSelectedRequest(req);
    setRejectReason(MOTIVOS_RECHAZO[0]);
    setRejectComment('');
    setShowRejectModal(true);
  };

  // Confirm rejection
  const handleApprove = async (requestId: string) => {
    if (processingRequestId) return;
    setProcessingRequestId(requestId);
    try {
      await onApproveRequest(requestId, currentUser.nombre);
    } catch {
      return;
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!selectedRequest) return;
    setProcessingRequestId(selectedRequest.id);
    try {
      await onRejectRequest(selectedRequest.id, currentUser.nombre, `${rejectReason} - ${rejectComment}`);
      setShowRejectModal(false);
      setSelectedRequest(null);
    } catch {
      return;
    } finally {
      setProcessingRequestId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Module Title */}
      <div>
        <h2 className="text-slate-800 text-2xl font-bold flex items-center gap-2">
          <Clock className="text-fuchsia-600 animate-spin-slow" />
          {isAdmin ? 'Solicitudes de Reapertura (Administrador)' : 'Mis Solicitudes de Reapertura'}
        </h2>
        <p className="text-slate-500 text-sm">
          {isAdmin
            ? 'Aprueba o rechaza peticiones de formadores para modificar asistencias fuera del horario establecido.'
            : 'Sigue el estado de tus solicitudes enviadas para modificar asistencia después del horario de corte.'}
        </p>
      </div>

      {/* Main Table Card */}
      <div className="glass-card rounded-2xl overflow-hidden">
        {visibleRequests.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            No se registran solicitudes de reapertura en el historial.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-4">Fecha Solicitud</th>
                  <th className="p-4">Formador Solicitante</th>
                  <th className="p-4">Campaña / Generación</th>
                  <th className="p-4 text-center">Día a Reabrir</th>
                  <th className="p-4">Motivo Reabrir</th>
                  <th className="p-4">Comentario de Formador</th>
                  <th className="p-4">Estado</th>
                  {isAdmin && <th className="p-4 text-center">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {visibleRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/40">
                    {/* Time */}
                    <td className="p-4 font-mono text-slate-500">
                      {new Date(req.fecha_solicitud).toLocaleString('es-PE', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>

                    {/* Trainer name */}
                    <td className="p-4 font-semibold text-slate-800">
                      {req.formador_nombre}
                    </td>

                    {/* Campaign/Generation */}
                    <td className="p-4">
                      <div className="font-semibold text-slate-800">{req.generacion}</div>
                      <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold mt-1 inline-block">
                        {req.campaña}
                      </span>
                    </td>

                    {/* Day */}
                    <td className="p-4 text-center">
                      <span className="bg-slate-100 text-slate-800 font-bold text-xs px-2.5 py-1 rounded-lg">
                        Día {req.dia_capacitacion}
                      </span>
                    </td>

                    {/* Motive */}
                    <td className="p-4 font-medium text-slate-700">
                      {req.motivo}
                    </td>

                    {/* Trainer comment */}
                    <td className="p-4 max-w-[150px] truncate italic text-slate-500" title={req.comentario}>
                      "{req.comentario || 'Sin comentario'}"
                    </td>

                    {/* Status badge */}
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 font-bold px-2.5 py-1 rounded-full text-[10px] uppercase ${
                        req.estado === 'aprobada' ? 'bg-emerald-100 text-emerald-800' :
                        req.estado === 'rechazada' ? 'bg-rose-100 text-rose-800' :
                        req.estado === 'vencida' ? 'bg-slate-100 text-slate-600' :
                        'bg-amber-100 text-amber-800 animate-pulse'
                      }`}>
                        {req.estado === 'aprobada' ? 'Aprobada' :
                         req.estado === 'rechazada' ? 'Rechazada' :
                         req.estado === 'vencida' ? 'Vencida' : 'Pendiente'}
                      </span>
                      {req.comentario_respuesta && (
                        <p className="text-[10px] text-slate-400 mt-1 truncate max-w-[150px]" title={req.comentario_respuesta}>
                          Respuesta: {req.comentario_respuesta}
                        </p>
                      )}
                    </td>

                    {/* Actions if Admin and is pending */}
                    {isAdmin && (
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-1.5">
                          {req.estado === 'pendiente' ? (
                            <>
                              <button
                                onClick={() => void handleApprove(req.id)}
                                disabled={processingRequestId !== null}
                                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg shadow-xs transition-colors"
                              >
                                {processingRequestId === req.id ? 'Guardando...' : 'Aprobar'}
                              </button>
                              <button
                                onClick={() => handleStartReject(req)}
                                disabled={processingRequestId !== null}
                                className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg shadow-xs transition-colors"
                              >
                                Rechazar
                              </button>
                            </>
                          ) : (
                            <span className="text-slate-400 text-[10px] italic">Atendido</span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: ADMIN REJECTION REASON */}
      {showRejectModal && selectedRequest && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white/90 backdrop-blur-md rounded-2xl p-6 max-w-md w-full border border-white/40 shadow-xl space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600 border-b border-slate-100 pb-2">
              <XCircle className="w-5 h-5" />
              <h3 className="font-bold text-base">Rechazar Solicitud de Reapertura</h3>
            </div>

            <p className="text-slate-600 text-xs">
              Indique el motivo por el cual rechaza la reapertura de asistencia solicitada por{' '}
              <strong>{selectedRequest.formador_nombre}</strong>.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 mb-1">Motivo de Rechazo *</label>
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-rose-500 text-slate-700"
                >
                  {MOTIVOS_RECHAZO.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">Comentario u Observación Adicional *</label>
                <textarea
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  placeholder="Detalle por qué no corresponde aprobar esta reapertura..."
                  rows={3}
                  className="w-full bg-slate-50 border rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-rose-500 text-slate-700"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 text-xs font-semibold">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setSelectedRequest(null);
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleConfirmReject()}
                disabled={!rejectComment.trim() || processingRequestId !== null}
                className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl"
              >
                {processingRequestId ? 'Guardando...' : 'Registrar Rechazo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
