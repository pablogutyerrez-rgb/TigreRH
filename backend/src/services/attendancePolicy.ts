import { getScheduledTrainingDays } from './trainingSchedule.js';

export const isAttendanceMinutesOpen = (minutes: number) => minutes >= 8 * 60 && minutes <= 19 * 60;

export const isToolsDropout = (record: { estado_asistencia?: unknown; motivo_desercion?: unknown } | Record<string, unknown>) => {
  const normalize = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return ['baja', 'desistio'].includes(normalize(record.estado_asistencia)) && normalize(record.motivo_desercion) === 'herramientas';
};

export const peruAttendanceMinutes = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === 'hour')?.value) * 60 +
    Number(parts.find((part) => part.type === 'minute')?.value);
};

export const isOperationalOjtClosed = (session: { campaña?: unknown; estado?: unknown }, moduleStatus?: unknown) =>
  getScheduledTrainingDays(session.campaña) === 10 &&
  [session.estado, moduleStatus].some((value) => /cerrad[ao]/i.test(String(value || '')));
