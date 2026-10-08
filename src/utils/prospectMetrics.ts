import type { Prospect, TrainingSession, Participant, AttendanceRecord } from '../types';
import { normalizeCampaignName } from '../constants/campaigns';
export const campaignKey = (value: string) => normalizeCampaignName(value.trim()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\bempresas\b/g, '').replace(/[^a-z0-9]/g, '');
const present = (value: string) => ['asistio', 'tardanza'].includes(value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim());
export const prospectComparison = (
  prospects: Prospect[], sessions: TrainingSession[], participants: Participant[], attendance: AttendanceRecord[],
  from = '', to = '',
) => {
  const groups = new Map<string, { name: string; Postulantes: Set<string>; Ejecutivos: Set<string>; SinEtapa: Set<string>; Ventas: number }>();
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const people = new Map(participants.filter((p) => sessionMap.has(p.training_session_id)).map((p) => [p.id, p]));
  const identity = (document: string, fallback: string) => document.trim() || fallback;
  const group = (campaign: string, code: string, date: string) => {
    const name = [normalizeCampaignName(campaign), code || 'Sin generación', date].join(' · ');
    if (!groups.has(name)) groups.set(name, { name, Postulantes: new Set(), Ejecutivos: new Set(), SinEtapa: new Set(), Ventas: 0 });
    return groups.get(name)!;
  };
  for (const record of attendance) {
    const person = people.get(record.participant_id), session = sessionMap.get(record.training_session_id);
    const date = record.fecha?.slice(0, 10);
    if (!person || !session || !date || from && date < from || to && date > to || !present(record.estado_asistencia)) continue;
    if (record.dia !== 5 && (record.dia < 6 || record.dia > 10)) continue;
    if (record.dia === 5 && person.resultado_formacion !== 'Apto') continue;
    const row = group(session.campaña, session.generation_code || session.nombre_generacion, date);
    row[record.dia === 5 ? 'Postulantes' : 'Ejecutivos'].add(identity(person.dni || '', person.id));
  }
  for (const prospect of new Map(prospects.map((p) => [p.id, p])).values()) {
    const session = prospect.training_session_id ? sessionMap.get(prospect.training_session_id)
      : sessions.find((s) => (s.generation_code || s.nombre_generacion) === prospect.training_session_code);
    const row = group(prospect.campana, session?.generation_code || session?.nombre_generacion || prospect.training_session_code || '', prospect.fecha_registro.slice(0, 10));
    const id = identity(prospect.ejecutivo_dni || '', prospect.ejecutivo_inconcert || prospect.ejecutivo_nombre);
    if (!row.Postulantes.has(id) && !row.Ejecutivos.has(id)) row.SinEtapa.add(id);
    if (['venta', 'alta', 'ventaalta'].includes(prospect.estado.toLowerCase().replace(/[^a-z]/g, ''))) row.Ventas++;
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map((row) => ({
    name: row.name, 'Postulantes/Ejecutivos': new Set([...row.Postulantes, ...row.Ejecutivos, ...row.SinEtapa]).size, 'Sin etapa acreditada': row.SinEtapa.size, 'Postulantes aptos D5': row.Postulantes.size, 'Ejecutivos OJT': row.Ejecutivos.size, 'Ventas realizadas': row.Ventas,
  }));
};

export const filterProspectRecords = (
  prospects: Prospect[],
  filters: { campaigns: string[]; trainer: string; from: string; to: string; generation: string; search: string },
  resolveCode: (prospect: Prospect) => string,
) => {
  const term = filters.search.trim().toLocaleLowerCase('es');
  return prospects.filter((prospect) => {
    if (filters.campaigns.length && !filters.campaigns.some((campaign) => campaignKey(campaign) === campaignKey(prospect.campana))) return false;
    if (filters.trainer !== 'todos' && prospect.formador_id !== filters.trainer) return false;
    const date = prospect.fecha_registro.slice(0, 10);
    if (filters.from && date < filters.from || filters.to && date > filters.to) return false;
    if (filters.generation !== 'todas' && resolveCode(prospect) !== filters.generation) return false;
    return !term || [prospect.ejecutivo_nombre, prospect.ejecutivo_dni, prospect.ejecutivo_inconcert,
      prospect.prospecto_nombre, prospect.ruc, prospect.dni, prospect.telefono].some((value) => String(value || '').toLocaleLowerCase('es').includes(term));
  });
};
