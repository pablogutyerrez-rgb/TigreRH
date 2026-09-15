import { Router, type Response } from 'express';
import { z } from 'zod';
import { dataDb as adminDb } from '../hybridDb.js';

const router = Router();

const tokenSchema = z.string().trim().min(1).max(160);
const dniSchema = z.string().trim().regex(/^\d{8,15}$/);
const SURVEY_ELIGIBILITY_DAY = 5;
const normalizeDocument = (value: unknown) => String(value ?? '').trim().replace(/^0+(?=\d)/, '');

const readStringField = (data: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const normalizeSurveyToken = (value: string) =>
  value.trim().replace(/\s+/g, '-').toLowerCase();

const findSurvey = async (token: string) => {
  const cleanToken = normalizeSurveyToken(token);
  const byToken = await adminDb
    .collection('surveys')
    .where('token', '==', token)
    .limit(1)
    .get();
  if (byToken.docs[0]) return byToken.docs[0];

  const byId = await adminDb.collection('surveys').doc(token).get();
  if (byId.exists) return byId;

  const snapshot = await adminDb.collection('surveys').get();
  return snapshot.docs.find((doc) => {
    const survey = doc.data();
    const surveyToken = normalizeSurveyToken(String(survey.token || ''));
    const generation = normalizeSurveyToken(String(survey.codigo_generacion || ''));
    const slug = generation.replace(/\s+/g, '-');
    return surveyToken === cleanToken || generation === cleanToken || slug === cleanToken;
  }) || null;
};

const getPublicSurvey = async (surveyDoc: Awaited<ReturnType<typeof findSurvey>>) => {
  if (!surveyDoc) return null;
  const survey = { id: surveyDoc.id, ...surveyDoc.data() } as Record<string, unknown>;
  const sessionId = String(survey.training_session_id || '');
  const sessionDoc = sessionId ? await adminDb.collection('sessions').doc(sessionId).get() : null;
  const session = sessionDoc?.exists
    ? ({ id: sessionDoc.id, ...sessionDoc.data() } as Record<string, unknown>)
    : null;
  return {
    id: survey.id,
    training_session_id: sessionId,
    estado: survey.estado,
    token: String(survey.token || ''),
    campaña:
      readStringField(survey, ['campaña', 'campana', 'campa�a']) ||
      readStringField(session || {}, ['campaña', 'campana', 'campa�a']),
    codigo_generacion:
      readStringField(session || {}, ['generation_code', 'nombre_generacion']) ||
      readStringField(survey, ['codigo_generacion']),
    formador_id:
      readStringField(session || {}, ['formador_id']) ||
      readStringField(survey, ['formador_id']),
    formador_nombre:
      readStringField(session || {}, ['formador_nombre']) ||
      readStringField(survey, ['formador_nombre']),
  };
};

router.get('/:token/metadata', async (req, res: Response) => {
  const token = tokenSchema.safeParse(req.params.token);
  if (!token.success) {
    res.status(400).json({ message: 'Enlace de encuesta invalido.' });
    return;
  }
  const surveyDoc = await findSurvey(token.data);
  const survey = await getPublicSurvey(surveyDoc);
  if (!survey) {
    res.status(404).json({ message: 'No se encontro la encuesta solicitada.' });
    return;
  }
  if (survey.estado !== 'Habilitada') {
    res.status(410).json({ message: 'Esta encuesta no se encuentra habilitada.' });
    return;
  }
  res.set('Cache-Control', 'no-store').json({ survey });
});

const findParticipant = async (sessionId: string, dni: string) => {
  const snapshot = await adminDb
    .collection('participants')
    .where('training_session_id', '==', sessionId)
    .get();
  return snapshot.docs.find((item) => normalizeDocument(item.data().dni) === normalizeDocument(dni)) || null;
};

const canAnswerSurvey = (
  participant: Record<string, unknown>,
  attendance: Array<Record<string, unknown>>,
) => {
  const participantId = String(participant.id || '');
  return attendance.some(
    (item) =>
      String(item.participant_id || '') === participantId &&
      Number(item.dia) === SURVEY_ELIGIBILITY_DAY,
  );
};

router.get('/:token', async (req, res: Response) => {
  const token = tokenSchema.safeParse(req.params.token);
  const dni = dniSchema.safeParse(req.query.dni);
  if (!token.success || !dni.success) {
    res.status(400).json({ message: 'Enlace o DNI invalido.' });
    return;
  }

  const surveyDoc = await findSurvey(token.data);
  if (!surveyDoc) {
    res.status(404).json({ message: 'No se encontro la encuesta solicitada.' });
    return;
  }

  const surveyData = { id: surveyDoc.id, ...surveyDoc.data() } as Record<string, unknown>;
  if (surveyData.estado !== 'Habilitada') {
    res.status(410).json({ message: 'Esta encuesta no se encuentra habilitada.' });
    return;
  }

  const sessionId = String(surveyData.training_session_id || '');
  const currentSurvey = await getPublicSurvey(surveyDoc);
  const participantDoc = await findParticipant(sessionId, dni.data);
  if (!participantDoc) {
    res.status(404).json({
      message: 'No se encontro tu registro en esta capacitacion. Verifica tu DNI.',
    });
    return;
  }

  const participant = {
    id: participantDoc.id,
    ...participantDoc.data(),
  } as Record<string, unknown>;
  const responseSnapshot = await adminDb
    .collection('responses')
    .where('training_survey_id', '==', surveyData.id)
    .get();

  if (responseSnapshot.docs.some((item) => normalizeDocument(item.data().dni) === normalizeDocument(dni.data))) {
    res.status(409).json({ message: 'Ya registraste esta encuesta de satisfaccion.' });
    return;
  }

  const attendanceSnapshot = await adminDb
    .collection('attendance')
    .where('participant_id', '==', participant.id)
    .get();
  const attendance = attendanceSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as Array<Record<string, unknown>>;
  if (!canAnswerSurvey(participant, attendance)) {
    res.status(403).json({
      message: 'No existe un registro de asistencia para el Dia 5 de capacitacion.',
    });
    return;
  }

  res.json({ survey: currentSurvey, participant, attendance });
});

const responseSchema = z.object({
  dni: dniSchema,
  q1: z.number().int().min(1).max(5),
  q2: z.number().int().min(1).max(5),
  q3: z.number().int().min(1).max(5),
  q4: z.number().int().min(1).max(5),
  q5: z.number().int().min(1).max(5),
  q6: z.number().int().min(1).max(5),
  q7: z.number().int().min(1).max(5),
  q8: z.number().int().min(1).max(5),
  comentario_positivo: z.string().trim().min(1).max(500),
  aspecto_mejora: z.string().trim().min(1).max(500),
});

router.post('/:token/responses', async (req, res: Response) => {
  const token = tokenSchema.safeParse(req.params.token);
  const payload = responseSchema.safeParse(req.body);
  if (!token.success || !payload.success) {
    res.status(400).json({ message: 'La respuesta contiene datos invalidos.' });
    return;
  }

  const surveyDoc = await findSurvey(token.data);
  if (!surveyDoc) {
    res.status(404).json({ message: 'No se encontro la encuesta solicitada.' });
    return;
  }

  const survey = { id: surveyDoc.id, ...surveyDoc.data() } as Record<string, unknown>;
  if (survey.estado !== 'Habilitada') {
    res.status(410).json({ message: 'Esta encuesta no se encuentra habilitada.' });
    return;
  }
  const sessionId = String(survey.training_session_id || '');
  const sessionDoc = sessionId ? await adminDb.collection('sessions').doc(sessionId).get() : null;
  const session = sessionDoc?.exists ? ({ id: sessionDoc.id, ...sessionDoc.data() } as Record<string, unknown>) : null;

  const participantDoc = await findParticipant(
    sessionId,
    payload.data.dni,
  );
  if (!participantDoc) {
    res.status(404).json({ message: 'No se encontro el participante.' });
    return;
  }

  const participant = { id: participantDoc.id, ...participantDoc.data() } as Record<string, unknown>;
  const attendanceSnapshot = await adminDb
    .collection('attendance')
    .where('participant_id', '==', participantDoc.id)
    .get();
  const attendance = attendanceSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  })) as Array<Record<string, unknown>>;
  if (!canAnswerSurvey(participant, attendance)) {
    res.status(403).json({
      message: 'No existe un registro de asistencia para el Dia 5 de capacitacion.',
    });
    return;
  }

  const responseId = `resp-${survey.id}-${participantDoc.id}`;
  const values = [
    payload.data.q1,
    payload.data.q2,
    payload.data.q3,
    payload.data.q4,
    payload.data.q5,
    payload.data.q6,
    payload.data.q7,
    payload.data.q8,
  ];
  const totalScore = Number((values.reduce((sum, value) => sum + value, 0) * 1.25).toFixed(2));
  const finalScore = Number(((totalScore / 50) * 20).toFixed(2));
  const classification =
    finalScore >= 18 ? 'Excelente' : finalScore >= 15 ? 'Bueno' : finalScore >= 11 ? 'Regular' : 'Crítico';
  const campaignName =
    readStringField(survey, ['campaña', 'campana', 'campa�a']) ||
    readStringField(session || {}, ['campaña', 'campana', 'campa�a']);
  const generationCode =
    readStringField(session || {}, ['generation_code', 'nombre_generacion']) ||
    readStringField(survey, ['codigo_generacion']);
  const trainerId =
    readStringField(session || {}, ['formador_id']) ||
    readStringField(survey, ['formador_id']);
  const trainerName =
    readStringField(session || {}, ['formador_nombre']) ||
    readStringField(survey, ['formador_nombre']);

  const responseData = {
    id: responseId,
    training_survey_id: survey.id,
    participant_id: participantDoc.id,
    nombre_ejecutivo: `${participant.nombres || ''} ${participant.apellidos || ''}`.trim(),
    campaña: campaignName,
    campana: campaignName,
    codigo_generacion: generationCode,
    formador_id: trainerId,
    formador_nombre: trainerName,
    fecha_respuesta: new Date().toISOString(),
    ...payload.data,
    q9: 5,
    q10: 5,
    p1: payload.data.q1,
    p2: payload.data.q2,
    p3: payload.data.q3,
    p4: payload.data.q4,
    p5: payload.data.q5,
    p6: payload.data.q6,
    p7: payload.data.q7,
    p8: payload.data.q8,
    total_score: totalScore,
    final_score_20: finalScore,
    classification,
    promedio_individual: Number(
      (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2),
    ),
  };

  const existing = await adminDb
    .collection('responses')
    .where('training_survey_id', '==', survey.id)
    .get();
  if (existing.docs.some((item) => normalizeDocument(item.data().dni) === normalizeDocument(payload.data.dni))) {
    res.status(409).json({ message: 'Ya registraste esta encuesta de satisfaccion.' });
    return;
  }

  await adminDb.collection('responses').doc(responseId).create(responseData);
  res.status(201).json({ ok: true, response: responseData });
});

export { router as publicSurveyRoutes };
