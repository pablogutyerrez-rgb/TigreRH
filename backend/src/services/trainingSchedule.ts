const campaignKey = (campaign: unknown) => String(campaign || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const isInitialOnlyCampaign = (campaign: unknown) => ['gpon', 'equifax', 'fija'].includes(campaignKey(campaign));

export const hasCampaignOjt = (campaign: unknown) =>
  ['entelempresasruc10', 'entelempresasruc20', 'entelruc10', 'entelruc20', 'ruc10', 'ruc20', 'culqi', 'tigreacademy'].includes(campaignKey(campaign));

export const getScheduledTrainingDays = (campaign: unknown): 5 | 10 =>
  hasCampaignOjt(campaign) && campaignKey(campaign) !== 'tigreacademy' ? 10 : 5;

export const isBusinessDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && ![0, 6].includes(date.getUTCDay());
};

export const isInitialAttendanceComplete = (
  sessionId: string,
  participants: Array<{ id: string }>,
  records: Array<{ participant_id: string; training_session_id: string; dia: number; estado_asistencia: string }>,
) => participants.length > 0 && participants.every((participant) => {
  const attendance = records.filter((record) => record.participant_id === participant.id && record.training_session_id === sessionId);
  return [1, 2, 3, 4, 5].every((day) => attendance.some((record) =>
    (Number(record.dia) === day && ['Asistió', 'Tardanza', 'Faltó', 'Descanso médico', 'Feriado', 'Desistió', 'Baja'].includes(record.estado_asistencia)) ||
    (Number(record.dia) < day && ['Desistió', 'Baja'].includes(record.estado_asistencia))));
});
