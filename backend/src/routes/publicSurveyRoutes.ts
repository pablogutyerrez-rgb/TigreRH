import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { dataDb as adminDb } from '../hybridDb.js';
import { isEligibleForOjt } from '../services/surveyAutomationService.js';
import { hasCampaignOjt } from '../services/trainingSchedule.js';

const router = Router();
const tokenSchema = z.string().trim().min(1).max(160);
const dniSchema = z.string().trim().regex(/^\d{8,15}$/);
const normalizeDocument = (value: unknown) => String(value ?? '').trim().replace(/^0+(?=\d)/, '');
const normalize = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('es-PE');
const readString = (data: Record<string, unknown> | null | undefined, keys: string[]) => {
  for (const key of keys) if (typeof data?.[key] === 'string' && String(data[key]).trim()) return String(data[key]).trim();
  return '';
};
const surveyType = (survey: Record<string, unknown>) =>
  survey.survey_type === 'ojt' || survey.survey_type === 'operaciones' ? survey.survey_type : 'inicial';
const normalizeToken = (value: string) => value.trim().replace(/\s+/g, '-').toLowerCase();

const findSurvey = async (token: string) => {
  const exact = await adminDb.collection('surveys').where('token', '==', token).limit(1).get();
  if (exact.docs[0]) return exact.docs[0];
  const byId = await adminDb.collection('surveys').doc(token).get();
  if (byId.exists) return byId;
  const normalized = normalizeToken(token);
  const surveys = await adminDb.collection('surveys').get();
  return surveys.docs.find((doc) => normalizeToken(String(doc.data().token || '')) === normalized || normalizeToken(String(doc.data().codigo_generacion || '')) === normalized) || null;
};

const getOjtContext = async (survey: Record<string, unknown>) => {
  const moduleId = String(survey.ojt_module_id || '');
  const moduleDoc = moduleId ? await adminDb.collection('ojt_modules').doc(moduleId).get() : null;
  if (!moduleDoc?.exists) return null;
  const module = { id: moduleDoc.id, ...moduleDoc.data() } as Record<string, unknown>;
  const generationIds = new Set((Array.isArray(module.generation_ids) ? module.generation_ids : []).map(String));
  const sessionDocs = await adminDb.collection('sessions').get();
  const sessions = sessionDocs.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, unknown>))
    .filter((session) => (String(session.ojt_module_id || '') === moduleId || generationIds.has(String(session.id))) &&
      hasCampaignOjt(readString(session, ['campaña', 'campana', 'campa�a'])));
  return sessions.length > 0 ? { module, sessions } : null;
};

const getPublicSurvey = async (surveyDoc: Awaited<ReturnType<typeof findSurvey>>) => {
  if (!surveyDoc) return null;
  const survey = { id: surveyDoc.id, ...surveyDoc.data() } as Record<string, unknown>;
  const type = surveyType(survey);
  const sessionDoc = survey.training_session_id ? await adminDb.collection('sessions').doc(String(survey.training_session_id)).get() : null;
  const session = sessionDoc?.exists ? ({ id: sessionDoc.id, ...sessionDoc.data() } as Record<string, unknown>) : null;
  const ojt = type === 'ojt' ? await getOjtContext(survey) : null;
  if (type === 'ojt' && !ojt) return null;
  const ojtSession = ojt?.sessions[0];
  const ojtCampaigns = type === 'ojt'
    ? Array.from(new Set(ojt!.sessions.map((item) => readString(item, ['campaña', 'campana', 'campa�a'])).filter(Boolean)))
    : [];
  return {
    id: survey.id, survey_type: type, training_session_id: String(survey.training_session_id || ''), ojt_module_id: String(survey.ojt_module_id || ''), estado: survey.estado, token: String(survey.token || ''),
    campaña: type === 'ojt'
      ? ojtCampaigns.join(', ')
      : readString(survey, ['campaña', 'campana', 'campa�a']) || readString(session || ojtSession, ['campaña', 'campana', 'campa�a']),
    subcampaña: readString(survey, ['subcampaña', 'subcampana']),
    codigo_generacion: type === 'ojt'
      ? String(survey.grupo_ojt || ojt!.module.nombre || '')
      : readString(session, ['generation_code', 'nombre_generacion']) || readString(survey, ['codigo_generacion']) || String(ojt?.module.nombre || ''),
    grupo_ojt: String(survey.grupo_ojt || ojt?.module.nombre || ''),
    formador_id: type === 'ojt' ? String((ojt?.module.formador_ojt_ids as string[] | undefined)?.[0] || '') : readString(session, ['formador_id']) || readString(survey, ['formador_id']),
    formador_nombre: type === 'ojt' ? String((ojt?.module.formador_ojt_nombres as string[] | undefined)?.join(', ') || survey.formador_nombre || '') : readString(session, ['formador_nombre']) || readString(survey, ['formador_nombre']),
    supervisor_nombres: Array.from(new Set((Array.isArray(survey.supervisor_nombres) ? survey.supervisor_nombres : []).filter((name): name is string => typeof name === 'string' && Boolean(name.trim())))),
    start_date: String(survey.start_date || ojt?.module.fecha_inicio || session?.fecha_inicio || ''), end_date: String(survey.end_date || ojt?.module.fecha_fin || session?.fecha_fin || ''),
  };
};

const ratingSchema = z.object({ q1: z.number().int().min(1).max(5), q2: z.number().int().min(1).max(5), q3: z.number().int().min(1).max(5), q4: z.number().int().min(1).max(5), q5: z.number().int().min(1).max(5), q6: z.number().int().min(1).max(5), q7: z.number().int().min(1).max(5), q8: z.number().int().min(1).max(5) });
const initialSchema = ratingSchema.extend({ dni: dniSchema, comentario_positivo: z.string().trim().min(1).max(500), aspecto_mejora: z.string().trim().min(1).max(500) });
const ojtSchema = ratingSchema.extend({ dni: dniSchema, comentario_positivo: z.string().trim().max(500).optional().default(''), aspecto_mejora: z.string().trim().max(500).optional().default('') });
const operationsSchema = ratingSchema.extend({
  submission_nonce: z.string().uuid(), supervisor_nombre: z.string().trim().max(160).optional().default(''),
  dificultades: z.array(z.enum(['Herramientas/sistemas', 'Metas de ventas', 'Falta de acompañamiento', 'Comunicación o trato', 'Condiciones laborales', 'Motivos personales', 'Otras dificultades', 'Ninguna'])).max(8).optional().default([]),
  intencion_salida: z.enum(['Sí', 'No', 'Tengo dudas', 'Prefiero no responder']).optional(), motivo_salida: z.string().trim().max(500).optional().default(''), comentario_q11: z.string().trim().max(500).optional().default(''), comentario_q12: z.string().trim().max(500).optional().default(''),
});
const calculate = (answers: z.infer<typeof ratingSchema>) => {
  const values = [answers.q1, answers.q2, answers.q3, answers.q4, answers.q5, answers.q6, answers.q7, answers.q8];
  const final_score_20 = Number((values.reduce((sum, value) => sum + value, 0) / 2).toFixed(2));
  return { values, final_score_20, total_score: Number((final_score_20 * 2.5).toFixed(2)), classification: final_score_20 >= 18 ? 'Excelente' : final_score_20 >= 15 ? 'Bueno' : final_score_20 >= 11 ? 'Regular' : 'Crítico' };
};
const findParticipantForOjt = async (survey: Record<string, unknown>, dni: string) => {
  const context = await getOjtContext(survey);
  const participantIds = new Set((Array.isArray(context?.module.participant_ids) ? context!.module.participant_ids : []).map(String));
  const sessionsById = new Map((context?.sessions || []).map((session) => [String(session.id), session]));
  const participants = await adminDb.collection('participants').get();
  const participantDoc = participants.docs.find((doc) => normalizeDocument(doc.data().dni) === normalizeDocument(dni) && (
    participantIds.has(doc.id) || (participantIds.size === 0 && sessionsById.has(String(doc.data().training_session_id || '')))
  ));
  if (!participantDoc) return null;
  const session = sessionsById.get(String(participantDoc.data().training_session_id || ''));
  return session ? { participantDoc, session } : null;
};
const findParticipantForInitial = async (sessionId: string, dni: string) => {
  const participants = await adminDb.collection('participants').where('training_session_id', '==', sessionId).get();
  return participants.docs.find((doc) => normalizeDocument(doc.data().dni) === normalizeDocument(dni)) || null;
};

router.get('/:token/metadata', async (req, res: Response) => {
  const token = tokenSchema.safeParse(req.params.token);
  if (!token.success) return void res.status(400).json({ message: 'Enlace de encuesta invalido.' });
  const survey = await getPublicSurvey(await findSurvey(token.data));
  if (!survey) return void res.status(404).json({ message: 'No se encontro la encuesta solicitada.' });
  if (survey.estado !== 'Habilitada') return void res.status(410).json({ message: 'Esta encuesta no se encuentra habilitada.' });
  let submission_nonce: string | undefined;
  if (survey.survey_type === 'operaciones') {
    submission_nonce = randomUUID();
    await adminDb.collection('survey_public_nonces').doc(submission_nonce).create({ survey_id: survey.id, expires_at: Date.now() + 1_800_000, used_at: null });
  }
  res.set('Cache-Control', 'no-store').json({ survey, submission_nonce });
});

router.get('/:token', async (req, res: Response) => {
  const token = tokenSchema.safeParse(req.params.token); const dni = dniSchema.safeParse(req.query.dni);
  if (!token.success || !dni.success) return void res.status(400).json({ message: 'Enlace o DNI invalido.' });
  const surveyDoc = await findSurvey(token.data); const publicSurvey = await getPublicSurvey(surveyDoc);
  if (!surveyDoc || !publicSurvey) return void res.status(404).json({ message: 'No se encontro la encuesta solicitada.' });
  if (publicSurvey.estado !== 'Habilitada') return void res.status(410).json({ message: 'Esta encuesta no se encuentra habilitada.' });
  if (publicSurvey.survey_type === 'operaciones') return void res.status(400).json({ message: 'Esta encuesta es anónima y no requiere DNI.' });
  const survey = { id: surveyDoc.id, ...surveyDoc.data() } as Record<string, unknown>;
  const ojtParticipant = publicSurvey.survey_type === 'ojt' ? await findParticipantForOjt(survey, dni.data) : null;
  const participantDoc = ojtParticipant?.participantDoc || (publicSurvey.survey_type === 'ojt' ? null : await findParticipantForInitial(String(survey.training_session_id || ''), dni.data));
  if (!participantDoc) return void res.status(404).json({ message: 'No se encontro tu registro en esta capacitación. Verifica tu DNI.' });
  const participant = { id: participantDoc.id, ...participantDoc.data() } as Record<string, unknown>;
  if (publicSurvey.survey_type === 'ojt' && !isEligibleForOjt(participant)) return void res.status(403).json({ message: 'Debes contar con nota final mayor o igual a 16 para acceder al acompañamiento OJT.' });
  const existing = await adminDb.collection('responses').where('training_survey_id', '==', survey.id).get();
  if (existing.docs.some((doc) => String(doc.data().participant_id || '') === participantDoc.id || normalizeDocument(doc.data().dni) === normalizeDocument(dni.data))) return void res.status(409).json({ message: 'Ya registraste esta encuesta de satisfacción.' });
  const attendance = publicSurvey.survey_type === 'inicial' ? (await adminDb.collection('attendance').where('participant_id', '==', participantDoc.id).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() })) : [];
  if (publicSurvey.survey_type === 'inicial' && !attendance.some((record) => Number((record as Record<string, unknown>).dia) === 5)) return void res.status(403).json({ message: 'No existe un registro de asistencia para el Día 5 de capacitación.' });
  res.json({ survey: publicSurvey, participant, attendance });
});

router.post('/:token/responses', async (req, res: Response) => {
  const token = tokenSchema.safeParse(req.params.token);
  if (!token.success) return void res.status(400).json({ message: 'La respuesta contiene datos invalidos.' });
  const surveyDoc = await findSurvey(token.data); const publicSurvey = await getPublicSurvey(surveyDoc);
  if (!surveyDoc || !publicSurvey) return void res.status(404).json({ message: 'No se encontro la encuesta solicitada.' });
  if (publicSurvey.estado !== 'Habilitada') return void res.status(410).json({ message: 'Esta encuesta no se encuentra habilitada.' });
  const survey = { id: surveyDoc.id, ...surveyDoc.data() } as Record<string, unknown>;
  if (publicSurvey.survey_type === 'operaciones') {
    const payload = operationsSchema.safeParse(req.body);
    if (!payload.success) return void res.status(400).json({ message: 'La respuesta contiene datos invalidos.' });
    const nonce = await adminDb.collection('survey_public_nonces').doc(payload.data.submission_nonce).get();
    if (!nonce.exists || nonce.data()?.survey_id !== survey.id || nonce.data()?.used_at || Number(nonce.data()?.expires_at || 0) < Date.now()) return void res.status(409).json({ message: 'El enlace de envío ya no es válido. Actualiza la página e inténtalo nuevamente.' });
    const supervisor = publicSurvey.supervisor_nombres.find((name) => normalize(name) === normalize(payload.data.supervisor_nombre));
    if (publicSurvey.supervisor_nombres.length > 0 && !supervisor) return void res.status(400).json({ message: 'Selecciona un supervisor válido para este enlace.' });
    const { submission_nonce, supervisor_nombre: _supervisorNombre, ...operationAnswers } = payload.data;
    const score = calculate(payload.data); const id = `resp-${survey.id}-${randomUUID()}`;
    const response = { id, training_survey_id: survey.id, survey_type: 'operaciones', campaña: publicSurvey.campaña, campana: publicSurvey.campaña, subcampaña: publicSurvey.subcampaña, codigo_generacion: '', formador_id: '', formador_nombre: '', supervisor_nombre: supervisor || '', fecha_respuesta: new Date().toISOString(), ...operationAnswers, total_score: score.total_score, final_score_20: score.final_score_20, classification: score.classification, promedio_individual: Number((score.values.reduce((sum, value) => sum + value, 0) / 8).toFixed(2)) };
    await adminDb.collection('responses').doc(id).create(response);
    await adminDb.collection('survey_public_nonces').doc(payload.data.submission_nonce).set({ used_at: new Date().toISOString() }, { merge: true });
    return void res.status(201).json({ ok: true, response });
  }
  const payload = (publicSurvey.survey_type === 'ojt' ? ojtSchema : initialSchema).safeParse(req.body);
  if (!payload.success) return void res.status(400).json({ message: 'La respuesta contiene datos invalidos.' });
  const ojtParticipant = publicSurvey.survey_type === 'ojt' ? await findParticipantForOjt(survey, payload.data.dni) : null;
  const participantDoc = ojtParticipant?.participantDoc || (publicSurvey.survey_type === 'ojt' ? null : await findParticipantForInitial(String(survey.training_session_id || ''), payload.data.dni));
  if (!participantDoc) return void res.status(404).json({ message: 'No se encontro el participante.' });
  if (publicSurvey.survey_type === 'ojt' && !isEligibleForOjt(participantDoc.data())) return void res.status(403).json({ message: 'Debes contar con nota final mayor o igual a 16 para acceder al acompañamiento OJT.' });
  if (publicSurvey.survey_type === 'inicial') {
    const attendance = await adminDb.collection('attendance').where('participant_id', '==', participantDoc.id).get();
    if (!attendance.docs.some((doc) => Number(doc.data().dia) === 5)) return void res.status(403).json({ message: 'No existe un registro de asistencia para el Día 5 de capacitación.' });
  }
  const existing = await adminDb.collection('responses').where('training_survey_id', '==', survey.id).get();
  if (existing.docs.some((doc) => String(doc.data().participant_id || '') === participantDoc.id || normalizeDocument(doc.data().dni) === normalizeDocument(payload.data.dni))) return void res.status(409).json({ message: 'Ya registraste esta encuesta de satisfacción.' });
  const participant = participantDoc.data(); const score = calculate(payload.data);
  const participantSession = ojtParticipant?.session;
  const participantTrainerIds = Array.isArray(participantSession?.formador_ojt_ids) ? participantSession.formador_ojt_ids : [];
  const participantTrainerNames = Array.isArray(participantSession?.formador_ojt_nombres) ? participantSession.formador_ojt_nombres : [];
  const campaign = participantSession ? readString(participantSession, ['campaña', 'campana', 'campa�a']) : publicSurvey.campaña;
  const generation = participantSession ? readString(participantSession, ['generation_code', 'nombre_generacion']) : publicSurvey.codigo_generacion;
  const trainerId = participantSession ? String(participantTrainerIds[0] || '') : publicSurvey.formador_id;
  const trainerName = participantSession ? String(participantTrainerNames[0] || '') : publicSurvey.formador_nombre;
  const { dni, ...answers } = payload.data;
  const response = { id: `resp-${survey.id}-${participantDoc.id}`, training_survey_id: survey.id, survey_type: publicSurvey.survey_type, participant_id: participantDoc.id, dni, nombre_ejecutivo: `${participant.nombres || ''} ${participant.apellidos || ''}`.trim(), training_session_id: participantSession?.id || publicSurvey.training_session_id, ojt_module_id: publicSurvey.survey_type === 'ojt' ? publicSurvey.ojt_module_id : '', campaña: campaign, campana: campaign, codigo_generacion: generation, formador_id: trainerId, formador_nombre: trainerName, fecha_respuesta: new Date().toISOString(), ...answers, q9: 5, q10: 5, p1: payload.data.q1, p2: payload.data.q2, p3: payload.data.q3, p4: payload.data.q4, p5: payload.data.q5, p6: payload.data.q6, p7: payload.data.q7, p8: payload.data.q8, total_score: score.total_score, final_score_20: score.final_score_20, classification: score.classification, promedio_individual: Number((score.values.reduce((sum, value) => sum + value, 0) / 8).toFixed(2)) };
  try {
    await adminDb.collection('responses').doc(response.id).create(response);
  } catch (error) {
    if ((error as { code?: number }).code === 6) {
      return void res.status(409).json({ message: 'Ya registraste esta encuesta de satisfacción.' });
    }
    throw error;
  }
  res.status(201).json({ ok: true, response });
});

export { router as publicSurveyRoutes };
