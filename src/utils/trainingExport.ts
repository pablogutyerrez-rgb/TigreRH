import * as XLSX from 'xlsx';
import type { TrainingSession, OjtModule, Participant, AttendanceRecord, OperationConfirmation } from '../types';

export const buildTrainingWorkbook = (
  sessions: TrainingSession[], modules: OjtModule[], participants: Participant[],
  attendance: AttendanceRecord[], confirmations: OperationConfirmation[],
) => {
  const workbook = XLSX.utils.book_new();
  const ids = new Set(sessions.map((session) => session.id));
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const people = participants.filter((person) => ids.has(person.training_session_id));
  const personMap = new Map(people.map((person) => [person.id, person]));
  const records = attendance.filter((record) => ids.has(record.training_session_id) && personMap.has(record.participant_id));
  const highs = confirmations.filter((record) => ids.has(record.training_session_id) && personMap.has(record.participant_id));
  const byDay = new Map<string, AttendanceRecord>();
  for (const record of records) {
    const key = `${record.training_session_id}/${record.participant_id}/${record.dia}`;
    const previous = byDay.get(key);
    if (!previous || record.fecha_registro > previous.fecha_registro) byDay.set(key, record);
  }
  const context = (sessionId: string, personId?: string) => {
    const session = sessionMap.get(sessionId);
    const person = personId ? personMap.get(personId) : undefined;
    return {
      Campaña: session?.campaña || '', Generación: session?.nombre_generacion || '',
      Código: session?.generation_code || session?.nombre_generacion || '',
      ...(person ? { Nombres: person.nombres, Apellidos: person.apellidos, Documento: person.dni } : {}),
    };
  };
  const extended: Record<string, unknown>[] = [];
  const append = (name: string, rows: Record<string, unknown>[]) => {
    const data = rows.map((row, index) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      const cell = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value;
      if (typeof cell !== 'string' || cell.length <= 30000) return [key, cell];
      for (let offset = 0; offset < cell.length; offset += 30000) {
        extended.push({ Hoja: name, Fila: index + 2, Campo: key, Parte: offset / 30000 + 1, Contenido: cell.slice(offset, offset + 30000) });
      }
      return [key, 'Ver hoja Datos extensos'];
    })));
    const sheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };
  append('Capacitaciones', sessions.map((session) => ({ ...context(session.id), ...session })));
  append('OJT', modules.map((module) => {
    const generationIds = module.generation_ids.filter((id) => ids.has(id));
    return {
      ...module, generation_ids: generationIds,
      generation_codes: generationIds.map((id) => sessionMap.get(id)?.generation_code || sessionMap.get(id)?.nombre_generacion || id),
      participant_ids: module.participant_ids.filter((id) => personMap.has(id)),
    };
  }));
  append('Postulantes', people.map((person) => {
    const row: Record<string, unknown> = { ...context(person.training_session_id, person.id), ...person };
    for (let day = 1; day <= 10; day++) {
      const record = byDay.get(`${person.training_session_id}/${person.id}/${day}`);
      row[`Día ${day}`] = record?.estado_asistencia || '';
      row[`Fecha día ${day}`] = record?.fecha || '';
      row[`Observación día ${day}`] = record?.observacion || '';
      row[`Motivo día ${day}`] = record?.motivo_desercion || '';
    }
    const confirmation = highs.filter((item) => item.participant_id === person.id && !item.isDeleted && item.estado_alta !== 'Eliminada')
      .sort((a, b) => b.fecha_registro.localeCompare(a.fecha_registro))[0];
    row.Alta = confirmation?.estado_alta || person.estado_alta || '';
    return row;
  }));
  append('Asistencia', records.map((record) => ({ ...context(record.training_session_id, record.participant_id), ...record })));
  append('Altas', highs.map((record) => ({ ...context(record.training_session_id, record.participant_id), ...record })));
  if (extended.length) append('Datos extensos', extended);
  return workbook;
};
