import * as XLSX from 'xlsx';
import type { TrainingSession, OjtModule, Participant, AttendanceRecord, OperationConfirmation } from '../types';

export const TRAINING_EXPORT_HEADERS = [
  'Campaña', 'Código de generación', 'Nombre del postulante',
  'Asistencia D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10',
  'Desistió (Sí/No)', 'Motivo de desistimiento/baja', 'Apto/No apto', 'Nota del examen',
];
const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export const buildTrainingWorkbook = (
  sessions: TrainingSession[], _modules: OjtModule[], participants: Participant[],
  attendance: AttendanceRecord[], _confirmations: OperationConfirmation[],
) => {
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const byDay = new Map<string, AttendanceRecord>();
  for (const record of attendance) {
    if (!sessionMap.has(record.training_session_id)) continue;
    const id = `${record.training_session_id}/${record.participant_id}/${record.dia}`;
    const previous = byDay.get(id);
    if (!previous || record.fecha_registro > previous.fecha_registro) byDay.set(id, record);
  }
  const people = [...new Map(participants.filter((p) => sessionMap.has(p.training_session_id))
    .map((p) => [`${p.training_session_id}/${p.id}`, p])).values()];
  const rows = people.map((person) => {
    const session = sessionMap.get(person.training_session_id)!;
    const records = Array.from({ length: 10 }, (_, index) =>
      byDay.get(`${person.training_session_id}/${person.id}/${index + 1}`));
    const states = records.map((record, index) => record?.estado_asistencia
      ?? person[`asistencia_dia_${index + 1}` as keyof Participant] ?? '');
    const reasons = records.filter((record) => record && ['desistio', 'baja'].includes(key(record.estado_asistencia)))
      .map((record) => record!.motivo_desercion || record!.observacion || '').filter(Boolean);
    const outcome = session.training_model === 'split_ojt' && person.resultado_formacion_ojt && person.resultado_formacion_ojt !== 'Marcar'
      ? person.resultado_formacion_ojt : person.resultado_formacion;
    return [session.campaña || '', session.generation_code || session.nombre_generacion || '',
      `${person.nombres || ''} ${person.apellidos || ''}`.trim(), ...states,
      states.some((state) => key(String(state)) === 'desistio') ? 'Sí' : 'No',
      [...new Set(reasons.length ? reasons : person.motivo_desercion ? [person.motivo_desercion] : [])].join('; '), outcome === 'Marcar' ? '' : outcome || '', person.evaluacion_nota ?? ''];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'es') || String(a[1]).localeCompare(String(b[1]), 'es'));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([TRAINING_EXPORT_HEADERS, ...rows]), 'Postulantes');
  return workbook;
};
