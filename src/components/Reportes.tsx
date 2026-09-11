/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  Filter,
  Search,
  CheckCircle,
  AlertTriangle,
  Award,
  BookOpen
} from 'lucide-react';
import { TrainingSession, Participant, AttendanceRecord, OperationConfirmation, User as AppUser } from '../types';
import { BPO_CAMPAIGNS } from '../constants/campaigns';

interface ReportesProps {
  sessions: TrainingSession[];
  participants: Participant[];
  attendance: AttendanceRecord[];
  confirmations: OperationConfirmation[];
  currentUser: AppUser;
  onAuditLog?: (action: string, module: string, detail: string, campaign?: string, generation?: string) => void;
}

export default function Reportes({
  sessions,
  participants,
  attendance,
  confirmations,
  currentUser,
  onAuditLog
}: ReportesProps) {
  const [reportType, setReportType] = useState<'asistencia' | 'desercion' | 'altas' | 'consolidado'>('consolidado');
  const [filterCampaña, setFilterCampaña] = useState('todos');
  const [filterGeneracion, setFilterGeneracion] = useState('todos');
  const [searchTerm, setSearchTerm] = useState('');

  // Map sessions for fast lookup
  const sessionMap = useMemo(() => {
    const map: { [key: string]: TrainingSession } = {};
    sessions.forEach(s => { map[s.id] = s; });
    return map;
  }, [sessions]);

  // Map confirmations by participant_id (ignoring deleted/Eliminada ones)
  const confirmationsMap = useMemo(() => {
    const map: { [key: string]: OperationConfirmation } = {};
    confirmations.filter(c => !c.isDeleted && c.estado_alta !== 'Eliminada').forEach(c => { map[c.participant_id] = c; });
    return map;
  }, [confirmations]);

  // Map attendance into list of attendance counts
  const attendanceCounts = useMemo(() => {
    const map: { [key: string]: { asistio: number; tardanza: number; falto: number; desistio: number } } = {};
    attendance.forEach(a => {
      if (!map[a.participant_id]) {
        map[a.participant_id] = { asistio: 0, tardanza: 0, falto: 0, desistio: 0 };
      }
      if (a.estado_asistencia === 'Asistió') map[a.participant_id].asistio++;
      if (a.estado_asistencia === 'Tardanza') map[a.participant_id].tardanza++;
      if (a.estado_asistencia === 'Faltó') map[a.participant_id].falto++;
      if (a.estado_asistencia === 'Desistió') map[a.participant_id].desistio++;
    });
    return map;
  }, [attendance]);

  const attendanceByParticipantDay = useMemo(() => {
    const map: Record<string, Record<number, AttendanceRecord>> = {};
    attendance.forEach(record => {
      if (!map[record.participant_id]) map[record.participant_id] = {};
      map[record.participant_id][record.dia] = record;
    });
    return map;
  }, [attendance]);

  const generationOptions = useMemo(() => {
    return Array.from(new Set(
      sessions
        .filter(session => filterCampaña === 'todos' || session.campaña === filterCampaña)
        .map(session => session.nombre_generacion)
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
  }, [sessions, filterCampaña]);

  const getAttendanceStatus = (participant: Participant, day: number) => {
    const recordStatus = attendanceByParticipantDay[participant.id]?.[day]?.estado_asistencia;
    if (recordStatus) return recordStatus;

    const directStatus = participant[`asistencia_dia_${day}` as keyof Participant];
    return typeof directStatus === 'string' && directStatus !== 'Seleccionar'
      ? directStatus
      : 'Sin registro';
  };

  const getFinalResult = (participant: Participant) => {
    return participant.resultado_formacion && participant.resultado_formacion !== 'Marcar'
      ? participant.resultado_formacion
      : participant.estado_final;
  };

  const getObservation = (participant: Participant) => {
    const participantAttendance: Record<number, AttendanceRecord> =
      attendanceByParticipantDay[participant.id] || {};
    const latestAttendanceObservation = Object.values(participantAttendance)
      .sort((a, b) => b.dia - a.dia)
      .find(record => record.observacion?.trim())?.observacion;

    return participant.observacion_general
      || participant.observacion_evaluacion
      || latestAttendanceObservation
      || '';
  };

  // Filter and build current report data
  const reportData = useMemo(() => {
    return participants.filter(p => {
      const s = sessionMap[p.training_session_id];
      if (!s) return false;

      // Filter by Campaign
      if (filterCampaña !== 'todos' && s.campaña !== filterCampaña) return false;

      // Filter by generation code
      if (filterGeneracion !== 'todos' && s.nombre_generacion !== filterGeneracion) return false;

      // Search term
      const matchesSearch = p.nombres.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.apellidos.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.dni.includes(searchTerm);
      if (!matchesSearch) return false;

      // Filter by Report Type specific conditions
      if (reportType === 'desercion') {
        return p.estado_final === 'Desistió';
      }
      if (reportType === 'altas') {
        const conf = confirmationsMap[p.id];
        return conf?.estado_alta === 'Alta confirmada';
      }

      return true;
    });
  }, [participants, sessionMap, confirmationsMap, reportType, filterCampaña, filterGeneracion, searchTerm]);

  // CSV Generation & Browser Download
  const handleExportCSV = () => {
    if (reportData.length === 0) {
      alert('No hay datos para exportar con los filtros actuales.');
      return;
    }

    let headers: string[] = [];
    let rows: string[][] = [];
    let fileName = `FDR_Reporte_${reportType}`;

    if (reportType === 'consolidado') {
      headers = ['DNI', 'Nombres', 'Apellidos', 'Campaña', 'Generación', 'Formador', 'Estado Final FDR', 'Estado Alta'];
      rows = reportData.map(p => {
        const s = sessionMap[p.training_session_id];
        const conf = confirmationsMap[p.id];
        return [
          p.dni,
          p.nombres,
          p.apellidos,
          s?.campaña || '',
          s?.nombre_generacion || '',
          s?.formador_nombre || '',
          p.estado_final,
          conf?.estado_alta || 'Pendiente de alta'
        ];
      });
    } else if (reportType === 'asistencia') {
      headers = [
        'DNI', 'Nombres', 'Apellidos', 'Campaña', 'Generación',
        ...Array.from({ length: 10 }, (_, index) => `Día ${index + 1}`),
        'Asistencias', 'Tardanzas', 'Faltas', 'Retiros', 'Resultado Final', 'Observación'
      ];
      rows = reportData.map(p => {
        const s = sessionMap[p.training_session_id];
        const counts = attendanceCounts[p.id] || { asistio: 0, tardanza: 0, falto: 0, desistio: 0 };
        return [
          p.dni,
          p.nombres,
          p.apellidos,
          s?.campaña || '',
          s?.nombre_generacion || '',
          ...Array.from({ length: 10 }, (_, index) => getAttendanceStatus(p, index + 1)),
          String(counts.asistio),
          String(counts.tardanza),
          String(counts.falto),
          String(counts.desistio),
          getFinalResult(p),
          getObservation(p)
        ];
      });
    } else if (reportType === 'desercion') {
      headers = ['DNI', 'Nombres', 'Apellidos', 'Campaña', 'Generación', 'Puesto', 'Fuente Reclutamiento', 'Motivo Deserción', 'Observación'];
      rows = reportData.map(p => {
        const s = sessionMap[p.training_session_id];
        // Find latest deserción details in attendance
        const latestDeserción = attendance.find(a => a.participant_id === p.id && a.estado_asistencia === 'Desistió');
        return [
          p.dni,
          p.nombres,
          p.apellidos,
          s?.campaña || '',
          s?.nombre_generacion || '',
          p.puesto,
          p.fuente_reclutamiento,
          p.motivo_desercion || latestDeserción?.motivo_desercion || 'No especificado',
          p.observacion_general || latestDeserción?.observacion || ''
        ];
      });
    } else if (reportType === 'altas') {
      headers = ['DNI', 'Nombres', 'Apellidos', 'Campaña', 'Generación', 'Fecha Alta', 'Registrado Por'];
      rows = reportData.map(p => {
        const s = sessionMap[p.training_session_id];
        const conf = confirmationsMap[p.id];
        return [
          p.dni,
          p.nombres,
          p.apellidos,
          s?.campaña || '',
          s?.nombre_generacion || '',
          conf?.fecha_alta || '',
          conf?.registrado_por || ''
        ];
      });
    }

    // Convert arrays to CSV format
    const csvContent = "\uFEFF" + [
      headers.join(';'),
      ...rows.map(r => r.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    // Blob & Download execution
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${fileName}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Audit logs for role-based export
    if (onAuditLog) {
      if (currentUser.rol === 'Coordinador') {
        onAuditLog(
          'Exportación realizada por Coordinador',
          'Reportes exportables',
          `El Coordinador "${currentUser.nombre}" realizó una exportación de tipo "${reportType}" para la campaña "${filterCampaña}".`,
          filterCampaña !== 'todos' ? filterCampaña : undefined,
          filterGeneracion !== 'todos' ? filterGeneracion : undefined
        );
      } else if (currentUser.rol === 'Sistemas') {
        onAuditLog(
          'Exportación realizada por Sistemas',
          'Reportes exportables',
          `El usuario de Sistemas "${currentUser.nombre}" realizó una exportación de tipo "${reportType}" para la campaña "${filterCampaña}".`,
          filterCampaña !== 'todos' ? filterCampaña : undefined,
          filterGeneracion !== 'todos' ? filterGeneracion : undefined
        );
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-slate-800 text-2xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="text-fuchsia-600" />
            Reportes y Descarga de Bases
          </h2>
          <p className="text-slate-500 text-sm">
            Filtra, consolida y descarga el reporte general de FDR en formatos listos para Excel (.CSV).
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          className="bg-linear-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-700 hover:to-indigo-700 text-white font-bold rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 shadow-xs transition-colors"
        >
          <Download className="w-4 h-4" />
          Exportar Reporte Activo (.CSV)
        </button>
      </div>

      {/* Preset Reports Selector Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={() => setReportType('consolidado')}
          className={`p-4 rounded-2xl border text-left flex flex-col justify-between h-28 transition-all ${
            reportType === 'consolidado'
              ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
              : 'bg-white hover:bg-slate-50 border-slate-100 text-slate-700'
          }`}
        >
          <BookOpen className={`w-6 h-6 ${reportType === 'consolidado' ? 'text-white' : 'text-indigo-600'}`} />
          <div>
            <h4 className="font-bold text-xs uppercase tracking-wider">Consolidado</h4>
            <p className={`text-[10px] ${reportType === 'consolidado' ? 'text-indigo-100' : 'text-slate-400'} truncate`}>
              Capacitación + Altas generales
            </p>
          </div>
        </button>

        <button
          onClick={() => setReportType('asistencia')}
          className={`p-4 rounded-2xl border text-left flex flex-col justify-between h-28 transition-all ${
            reportType === 'asistencia'
              ? 'bg-fuchsia-600 border-fuchsia-600 text-white shadow-md'
              : 'bg-white hover:bg-slate-50 border-slate-100 text-slate-700'
          }`}
        >
          <FileSpreadsheet className={`w-6 h-6 ${reportType === 'asistencia' ? 'text-white' : 'text-fuchsia-600'}`} />
          <div>
            <h4 className="font-bold text-xs uppercase tracking-wider">Asistencia</h4>
            <p className={`text-[10px] ${reportType === 'asistencia' ? 'text-fuchsia-100' : 'text-slate-400'} truncate`}>
              Suma de faltas, tardanzas y asistencia
            </p>
          </div>
        </button>

        <button
          onClick={() => setReportType('desercion')}
          className={`p-4 rounded-2xl border text-left flex flex-col justify-between h-28 transition-all ${
            reportType === 'desercion'
              ? 'bg-rose-600 border-rose-600 text-white shadow-md'
              : 'bg-white hover:bg-slate-50 border-slate-100 text-slate-700'
          }`}
        >
          <AlertTriangle className={`w-6 h-6 ${reportType === 'desercion' ? 'text-white' : 'text-rose-600'}`} />
          <div>
            <h4 className="font-bold text-xs uppercase tracking-wider">Deserciones</h4>
            <p className={`text-[10px] ${reportType === 'desercion' ? 'text-rose-100' : 'text-slate-400'} truncate`}>
              Bajas con motivos de retiro
            </p>
          </div>
        </button>

        <button
          onClick={() => setReportType('altas')}
          className={`p-4 rounded-2xl border text-left flex flex-col justify-between h-28 transition-all ${
            reportType === 'altas'
              ? 'bg-emerald-600 border-emerald-600 text-white shadow-md'
              : 'bg-white hover:bg-slate-50 border-slate-100 text-slate-700'
          }`}
        >
          <Award className={`w-6 h-6 ${reportType === 'altas' ? 'text-white' : 'text-emerald-600'}`} />
          <div>
            <h4 className="font-bold text-xs uppercase tracking-wider">Altas Confirmadas</h4>
            <p className={`text-[10px] ${reportType === 'altas' ? 'text-emerald-100' : 'text-slate-400'} truncate`}>
              Egresados insertados en operación
            </p>
          </div>
        </button>
      </div>

      {/* Query Filters */}
      <div className="glass-card rounded-2xl p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Filtrar por DNI o Nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full glass-input text-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-xs outline-hidden"
            />
          </div>

          <div>
            <select
              value={filterCampaña}
              onChange={(e) => {
                setFilterCampaña(e.target.value);
                setFilterGeneracion('todos');
              }}
              className="w-full glass-input text-slate-700 rounded-xl px-3 py-2.5 text-xs outline-hidden"
            >
              <option value="todos">Todas las Campañas</option>
              {BPO_CAMPAIGNS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>

          <div>
            <select
              value={filterGeneracion}
              onChange={(e) => setFilterGeneracion(e.target.value)}
              className="w-full glass-input text-slate-700 rounded-xl px-3 py-2.5 text-xs outline-hidden"
            >
              <option value="todos">Todos los códigos de generación</option>
              {generationOptions.map(generation => (
                <option key={generation} value={generation}>{generation}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end text-xs text-slate-500 font-semibold">
            Se encontraron {reportData.length} registros para exportación
          </div>
        </div>
      </div>

      {/* Grid Table Preview */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between">
          <h4 className="font-bold text-slate-800 text-sm">Vista Previa del Reporte Seleccionado</h4>
          <span className="text-slate-400 text-[10px] font-mono capitalize">Reporte: {reportType}</span>
        </div>

        {reportData.length === 0 ? (
          <div className="p-12 text-center text-slate-400 italic">
            No se registran datos para la vista previa con estos filtros.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] sticky top-0">
                {reportType === 'consolidado' && (
                  <tr>
                    <th className="p-3">DNI</th>
                    <th className="p-3">Candidato</th>
                    <th className="p-3">Campaña / Generación</th>
                    <th className="p-3">Formador</th>
                    <th className="p-3">Estado FDR</th>
                    <th className="p-3">Estado Alta</th>
                  </tr>
                )}
                {reportType === 'asistencia' && (
                  <tr>
                    <th className="p-3">DNI</th>
                    <th className="p-3">Candidato</th>
                    <th className="p-3">Campaña / Generación</th>
                    {Array.from({ length: 10 }, (_, index) => (
                      <th key={`day-header-${index + 1}`} className="p-3 text-center whitespace-nowrap">Día {index + 1}</th>
                    ))}
                    <th className="p-3 text-center">Asistencias</th>
                    <th className="p-3 text-center">Tardanzas</th>
                    <th className="p-3 text-center">Faltas</th>
                    <th className="p-3 text-center">Retiros</th>
                    <th className="p-3 whitespace-nowrap">Resultado Final</th>
                    <th className="p-3 min-w-56">Observación</th>
                  </tr>
                )}
                {reportType === 'desercion' && (
                  <tr>
                    <th className="p-3">DNI</th>
                    <th className="p-3">Candidato</th>
                    <th className="p-3">Campaña</th>
                    <th className="p-3">Puesto</th>
                    <th className="p-3">Fuente Recluta</th>
                    <th className="p-3">Motivo Deserción</th>
                    <th className="p-3">Observación</th>
                  </tr>
                )}
                {reportType === 'altas' && (
                  <tr>
                    <th className="p-3">DNI</th>
                    <th className="p-3">Candidato</th>
                    <th className="p-3">Campaña</th>
                    <th className="p-3">Generación</th>
                    <th className="p-3">Fecha Alta</th>
                    <th className="p-3">Registrado Por</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-600">
                {reportData.map((p, idx) => {
                  const s = sessionMap[p.training_session_id];
                  const conf = confirmationsMap[p.id];
                  const counts = attendanceCounts[p.id] || { asistio: 0, tardanza: 0, falto: 0, desistio: 0 };

                  return (
                    <tr key={p.id || idx} className="hover:bg-slate-50/40">
                      {reportType === 'consolidado' && (
                        <>
                          <td className="p-3 font-mono text-slate-500">{p.dni}</td>
                          <td className="p-3 font-semibold text-slate-800">{p.nombres} {p.apellidos}</td>
                          <td className="p-3">
                            <span className="font-semibold">{s?.nombre_generacion}</span>
                            <span className="block text-[10px] text-slate-400">{s?.campaña}</span>
                          </td>
                          <td className="p-3 text-slate-500">{s?.formador_nombre}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] ${
                              p.estado_final === 'Alta confirmada' ? 'bg-emerald-100 text-emerald-800' :
                              p.estado_final === 'Desistió' ? 'bg-rose-100 text-rose-800' :
                              'bg-indigo-100 text-indigo-800'
                            }`}>{p.estado_final}</span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] ${
                              conf?.estado_alta === 'Alta confirmada' ? 'bg-emerald-100 text-emerald-800' :
                              conf?.estado_alta === 'No alta' ? 'bg-rose-100 text-rose-800' :
                              'bg-amber-100 text-amber-800'
                            }`}>{conf?.estado_alta || 'Pendiente de alta'}</span>
                          </td>
                        </>
                      )}

                      {reportType === 'asistencia' && (
                        <>
                          <td className="p-3 font-mono text-slate-500">{p.dni}</td>
                          <td className="p-3 font-semibold text-slate-800">{p.nombres} {p.apellidos}</td>
                          <td className="p-3 whitespace-nowrap">
                            <span className="font-semibold">{s?.nombre_generacion}</span>
                            <span className="block text-[10px] text-slate-400">{s?.campaña}</span>
                          </td>
                          {Array.from({ length: 10 }, (_, index) => (
                            <td key={`${p.id}-day-${index + 1}`} className="p-3 text-center whitespace-nowrap">
                              {getAttendanceStatus(p, index + 1)}
                            </td>
                          ))}
                          <td className="p-3 text-center font-bold font-mono text-emerald-600">{counts.asistio}</td>
                          <td className="p-3 text-center font-bold font-mono text-amber-600">{counts.tardanza}</td>
                          <td className="p-3 text-center font-bold font-mono text-rose-500">{counts.falto}</td>
                          <td className="p-3 text-center font-bold font-mono text-rose-800">{counts.desistio}</td>
                          <td className="p-3 font-semibold whitespace-nowrap">{getFinalResult(p)}</td>
                          <td className="p-3 text-slate-500 min-w-56">{getObservation(p) || 'S/O'}</td>
                        </>
                      )}

                      {reportType === 'desercion' && (
                        <>
                          <td className="p-3 font-mono text-slate-500">{p.dni}</td>
                          <td className="p-3 font-semibold text-slate-800">{p.nombres} {p.apellidos}</td>
                          <td className="p-3">{s?.campaña}</td>
                          <td className="p-3">{p.puesto}</td>
                          <td className="p-3">{p.fuente_reclutamiento}</td>
                          <td className="p-3 text-rose-600 font-bold font-semibold">
                            {p.motivo_desercion || attendance.find(a => a.participant_id === p.id && a.estado_asistencia === 'Desistió')?.motivo_desercion || 'No registra'}
                          </td>
                          <td className="p-3 italic text-slate-400">
                            "{p.observacion_general || attendance.find(a => a.participant_id === p.id && a.estado_asistencia === 'Desistió')?.observacion || 'S/O'}"
                          </td>
                        </>
                      )}

                      {reportType === 'altas' && (
                        <>
                          <td className="p-3 font-mono text-slate-500">{p.dni}</td>
                          <td className="p-3 font-semibold text-slate-800">{p.nombres} {p.apellidos}</td>
                          <td className="p-3">{s?.campaña}</td>
                          <td className="p-3">{s?.nombre_generacion}</td>
                          <td className="p-3 font-mono font-semibold text-emerald-600">{conf?.fecha_alta}</td>
                          <td className="p-3 text-slate-400">{conf?.registrado_por}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
