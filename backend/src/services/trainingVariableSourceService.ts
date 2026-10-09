import { calculatePhaseMetrics } from './trainingPhaseMetrics.js';
import { dataDb as adminDb } from '../hybridDb.js';

type StoredRecord = Record<string, unknown> & { id: string };

export interface TrainingVariableSource {
  id: string;
  codigo: string;
  campana: string;
  fecha_inicio: string;
  fecha_fin: string;
  formadores: Array<{ id: string; nombre: string }>;
}

export interface AutomaticTrainingVariableResult {
  generation_ids: string[];
  codigos_generacion: string[];
  porcentaje_retencion: number;
  porcentaje_produccion_individual: number;
  porcentaje_produccion_grupal: number;
  porcentaje_satisfaccion: number;
  porcentaje_rotacion: number;
  detalle: {
    participantes_dia_1: number;
    participantes_dia_final: number;
    prospectos_generados: number;
    prospectos_venta_alta: number;
    respuestas_encuesta: number;
    altas_operacion: number;
    ventas_reales: number;
    productividad_disponible: boolean;
    rotacion_disponible: boolean;
    bajas_rotacion: number;
    dotacion_rotacion: number;
  };
}

const roundPercent = (value: number) => Math.round(value * 100) / 100;
const normalizeText = (value: unknown) => String(value || '').trim();
const normalizeKey = (value: unknown) => normalizeText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();
const normalizeCampaignKey = (value: unknown) => normalizeKey(value)
  .replace(/\bempresas\b/g, '')
  .replace(/[^a-z0-9]/g, '');
const normalizeStatusKey = (value: unknown) => normalizeKey(value).replace(/[^a-z0-9]/g, '');
const normalizeIds = (value: unknown) => Array.isArray(value)
  ? value.map(normalizeText).filter(Boolean)
  : [];

const productivityCampaign = (campaign: unknown): 'ruc10' | 'culqi' | null => {
  const normalized = normalizeCampaignKey(campaign);
  if (normalized === 'culqi') return 'culqi';
  if (normalized === 'entelruc10' || normalized === 'entelempresasruc10') return 'ruc10';
  return null;
};

const assignedTrainerIds = (session: StoredRecord) => Array.from(new Set([
  normalizeText(session.formador_id),
  ...normalizeIds(session.formador_ids),
  ...normalizeIds(session.formador_capacitacion_inicial_ids),
  ...normalizeIds(session.formador_ojt_ids),
].filter(Boolean)));

const isAssignedTrainer = (session: StoredRecord, trainerId: string) => {
  return assignedTrainerIds(session).includes(trainerId);
};

const isInPeriod = (session: StoredRecord, year: number, month: number) => {
  const startDate = normalizeText(session.fecha_inicio);
  const match = /^(\d{4})-(\d{2})-/.exec(startDate);
  return Boolean(match && Number(match[1]) === year && Number(match[2]) === month);
};

const sourceFromSession = (
  session: StoredRecord,
  trainerNames = new Map<string, string>(),
): TrainingVariableSource => ({
  id: session.id,
  codigo: normalizeText(session.generation_code || session.nombre_generacion || session.id),
  campana: normalizeText(session.campana || session['campaña']),
  fecha_inicio: normalizeText(session.fecha_inicio),
  fecha_fin: normalizeText(session.fecha_fin),
  formadores: assignedTrainerIds(session).map((id) => ({
    id,
    nombre: trainerNames.get(id) || id,
  })),
});

const readCollection = async (name: string) => {
  const snapshot = await adminDb.collection(name).get();
  return snapshot.docs.map((document) => ({ ...document.data(), id: document.id }) as StoredRecord);
};

export const listTrainingVariableSources = async (
  year: number,
  month: number,
  trainerId?: string,
  months?: number[],
) => {
  const [sessions, users] = await Promise.all([readCollection('sessions'), readCollection('users')]);
  const trainerNames = new Map(users.map((user) => [user.id, normalizeText(user.nombre)]));
  return sessions
    .filter((session) => (months?.length ? months : [month]).some((m) => isInPeriod(session, year, m)))
    .filter((session) => !trainerId || isAssignedTrainer(session, trainerId))
    .map((session) => sourceFromSession(session, trainerNames))
    .filter((source) => source.formadores.length > 0)
    .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio) || a.codigo.localeCompare(b.codigo));
};

const responseScorePercent = (response: StoredRecord) => {
  const finalScore = response.final_score_20 == null || response.final_score_20 === '' ? NaN : Number(response.final_score_20);
  if (Number.isFinite(finalScore)) return Math.max(0, Math.min(100, finalScore * 5));

  const average = response.promedio_individual == null || response.promedio_individual === '' ? NaN : Number(response.promedio_individual);
  if (Number.isFinite(average)) return Math.max(0, Math.min(100, average * 20));

  const questionValues = Array.from({ length: 10 }, (_, index) => Number(response[`q${index + 1}`]))
    .filter(Number.isFinite);
  if (!questionValues.length) return null;
  return Math.max(0, Math.min(100, (questionValues.reduce((sum, value) => sum + value, 0) / questionValues.length) * 20));
};

export const calculateTrainingVariableFromSources = async (
  trainerId: string,
  generationIds: string[],
  year: number,
  month: number,
  filters?: { meses?: number[]; formador_ids?: string[]; campanas?: string[] },
): Promise<AutomaticTrainingVariableResult> => {
  const selectedIds = Array.from(new Set(generationIds.map(normalizeText).filter(Boolean)));
  if (!selectedIds.length) throw new Error('Selecciona una capacitación para calcular la variable.');

  const [sessions, participants, attendance, surveys, responses, confirmations, prospects] = await Promise.all([
    readCollection('sessions'),
    readCollection('participants'),
    readCollection('attendance'),
    readCollection('surveys'),
    readCollection('responses'),
    readCollection('confirmations'),
    readCollection('prospects'),
  ]);

  return calculateTrainingVariableFromData(trainerId, selectedIds, year, month, { sessions, participants, attendance, surveys, responses, confirmations, prospects }, filters);
};

export const calculateTrainingVariableFromData = async (
  trainerId: string, generationIds: string[], year: number, month: number,
  data: { sessions: StoredRecord[]; participants: StoredRecord[]; attendance: StoredRecord[]; surveys: StoredRecord[]; responses: StoredRecord[]; confirmations: StoredRecord[]; prospects?: StoredRecord[]; rotation?: { disponible: boolean; porcentaje: number | null; bajas: number; dotacion: number } },
  filters?: { meses?: number[]; formador_ids?: string[]; campanas?: string[] },
): Promise<AutomaticTrainingVariableResult> => {
  const selectedIds = [...new Set(generationIds)];
  if (!selectedIds.length) throw new Error('Selecciona al menos una capacitación.');
  const { sessions, participants, attendance, surveys, responses } = data;
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const selectedSessions = selectedIds.map((id) => sessionById.get(id));
  if (selectedSessions.some((session) => !session)) throw new Error('Uno de los códigos seleccionados ya no existe.');

  const validSessions = selectedSessions as StoredRecord[];
  if (filters?.formador_ids?.some((id) => !validSessions.some((session) => isAssignedTrainer(session, id)))) throw new Error('Un formador no tiene capacitaciones seleccionadas.');
  if (validSessions.some((session) => !(filters?.formador_ids?.length ? filters.formador_ids : [trainerId]).some((id) => isAssignedTrainer(session, id)))) {
    throw new Error('Uno de los códigos seleccionados no corresponde al formador.');
  }
  if (validSessions.some((session) => !(filters?.meses?.length ? filters.meses : [month]).some((m) => isInPeriod(session, year, m)))) {
    throw new Error('Uno de los códigos seleccionados no corresponde al periodo indicado.');
  }

  const selectedIdSet = new Set(selectedIds);
  const selectedCodes = validSessions.map((session) => sourceFromSession(session).codigo);
  const selectedParticipants = participants.filter((participant) => selectedIdSet.has(normalizeText(participant.training_session_id)));
  const selectedAttendance = attendance.filter((record) => selectedIdSet.has(normalizeText(record.training_session_id)));

  if (filters?.campanas?.length && validSessions.some((session) =>
    !filters.campanas!.includes(normalizeText(session.campana || session['campaña'])))) {
    throw new Error('Una capacitación no corresponde a las campañas seleccionadas.');
  }
  const phases = validSessions.map((session) => calculatePhaseMetrics(
    new Set(selectedParticipants.filter((p) => p.training_session_id === session.id).map((p) => p.id)),
    selectedAttendance.filter((a) => a.training_session_id === session.id).map((a) => ({
      participant_id: normalizeText(a.participant_id), dia: Number(a.dia), estado_asistencia: normalizeText(a.estado_asistencia),
    })), [],
  ));
  const dayOneCount = phases.reduce((sum, phase) => sum + phase.d1Ids.size, 0);
  const finalDayCount = phases.reduce((sum, phase) => sum + phase.d10Ids.size, 0);
  const initialTraining = phases.reduce((sum, phase) => sum + phase.d2Ids.size, 0);
  const finalTraining = phases.reduce((sum, phase) => sum + phase.d5Ids.size, 0);
  const initialOjt = phases.reduce((sum, phase) => sum + phase.d6Ids.size, 0);
  const finalOjt = phases.reduce((sum, phase) => sum + phase.d10Ids.size, 0);
  const retentionTraining = initialTraining > 0 ? finalTraining / initialTraining * 100 : 0;
  const retentionOjt = initialOjt > 0 ? finalOjt / initialOjt * 100 : 0;
  const retention = (retentionTraining + retentionOjt) / 2;
  const altasOperacion = new Set(phases.flatMap((phase) => [...phase.altasD10Ids]));
  const sessionCampaigns = new Map(validSessions.map((session) => [session.id, productivityCampaign(session.campana || session['campaña'])]));
  const participantById = new Map(selectedParticipants.map((participant) => [participant.id, participant]));
  const altaMetaByCampaign = { ruc10: 0, culqi: 0 };
  altasOperacion.forEach((participantId) => {
    const participant = participantById.get(participantId);
    const campaign = participant && sessionCampaigns.get(normalizeText(participant.training_session_id));
    if (campaign) altaMetaByCampaign[campaign] += 1;
  });
  const altasProductividad = altaMetaByCampaign.ruc10 + altaMetaByCampaign.culqi;
  const metaVentas = altaMetaByCampaign.ruc10 * 2 + altaMetaByCampaign.culqi;
  const prospectSales = [...new Map((data.prospects || [])
    .filter((prospect) => normalizeText(prospect.estado) === 'Venta / Alta')
    .filter((prospect) => {
      const sessionId = normalizeText(prospect.training_session_id);
      const sessionCode = normalizeText(prospect.training_session_code);
      return selectedIdSet.has(sessionId) || selectedCodes.includes(sessionCode);
    })
    .filter((prospect) => {
      const session = sessionById.get(normalizeText(prospect.training_session_id))
        || validSessions.find((candidate) => sourceFromSession(candidate).codigo === normalizeText(prospect.training_session_code));
      return Boolean(session && sessionCampaigns.get(session.id));
    })
    .map((prospect) => [prospect.id, prospect])).values()];
  const ventasReales = prospectSales.reduce((total, prospect) => {
    const quantity = Number(prospect.cantidad_productos);
    return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
  }, 0);
  const productivityAvailable = metaVentas > 0;
  const production = productivityAvailable ? Math.min(100, ventasReales / metaVentas * 100) : 0;

  const selectedSurveyIds = new Set(
    surveys
      .filter((survey) => survey.training_session_id ? selectedIdSet.has(normalizeText(survey.training_session_id)) : selectedCodes.includes(normalizeText(survey.codigo_generacion)))
      .map((survey) => survey.id),
  );
  const selectedResponses = [...new Map(responses.filter((response) =>
    response.training_survey_id ? selectedSurveyIds.has(normalizeText(response.training_survey_id))
    : selectedCodes.includes(normalizeText(response.codigo_generacion)),
  ).map((response) => [response.id, response])).values()];
  const satisfactionScores = selectedResponses
    .map(responseScorePercent)
    .filter((value): value is number => value !== null);
  const satisfaction = satisfactionScores.length > 0
    ? satisfactionScores.reduce((sum, value) => sum + value, 0) / satisfactionScores.length
    : 0;

  const rotation = data.rotation || { disponible: false, porcentaje: null, bajas: 0, dotacion: 0 };

  return {
    generation_ids: selectedIds,
    codigos_generacion: selectedCodes,
    porcentaje_retencion: roundPercent(retention),
    porcentaje_produccion_individual: roundPercent(production),
    porcentaje_produccion_grupal: roundPercent(production),
    porcentaje_satisfaccion: roundPercent(satisfaction),
    detalle: {
      participantes_dia_1: dayOneCount,
      participantes_dia_final: finalDayCount,
      prospectos_generados: 0,
      prospectos_venta_alta: 0,
      respuestas_encuesta: selectedResponses.length,
      altas_operacion: altasProductividad,
      ventas_reales: ventasReales,
      productividad_disponible: productivityAvailable,
      rotacion_disponible: rotation.disponible,
      bajas_rotacion: rotation.bajas,
      dotacion_rotacion: rotation.dotacion,
    },
    porcentaje_rotacion: rotation.porcentaje ?? 0,
  };
};
