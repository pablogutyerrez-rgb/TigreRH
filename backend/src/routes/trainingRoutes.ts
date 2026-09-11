import { Router, type Response } from 'express';
import { z } from 'zod';
import { dataDb as adminDb } from '../hybridDb.js';
import {
  type AuthenticatedRequest,
  requireAuth,
  requireRole,
} from '../utils/authMiddleware.js';

const router = Router();
const canManageTraining = [
  requireAuth,
  requireRole(['Administrador', 'Analista', 'Reclutador', 'Coordinador']),
];
const canPatchTraining = [
  requireAuth,
  requireRole(['Administrador', 'Analista', 'Reclutador', 'Coordinador', 'Formador']),
];
const entitySchema = z.object({ id: z.string().min(1) }).passthrough();

const isAssignedTrainer = (data: Record<string, unknown> | undefined, userId: string) =>
  data?.formador_id === userId ||
  (Array.isArray(data?.formador_ids) && data.formador_ids.includes(userId));

const getTrainingCode = (session: Record<string, unknown>) =>
  String(session.generation_code || session.nombre_generacion || '').trim();

const hasDuplicateTrainingCode = async (code: string, sessionId: string) => {
  if (!code) return false;
  const [byGenerationCode, byName] = await Promise.all([
    adminDb.collection('sessions').where('generation_code', '==', code).limit(1).get(),
    adminDb.collection('sessions').where('nombre_generacion', '==', code).limit(1).get(),
  ]);
  return [...byGenerationCode.docs, ...byName.docs].some((doc) => doc.id !== sessionId);
};

const assertTrainingAccess = async (
  req: AuthenticatedRequest,
  sessionId: string,
) => {
  if (req.user!.rol !== 'Formador') return true;
  const session = await adminDb.collection('sessions').doc(sessionId).get();
  if (!session.exists) return false;
  return isAssignedTrainer(session.data(), req.user!.uid);
};

router.post('/', canManageTraining, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = z.object({
    session: entitySchema,
    survey: entitySchema,
    participants: z.array(entitySchema).max(2000),
    attendance: z.array(entitySchema).max(10000),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Datos de capacitacion invalidos.' });
    return;
  }

  const { session, survey, participants, attendance } = parsed.data;
  const trainingCode = getTrainingCode(session);
  if (await hasDuplicateTrainingCode(trainingCode, session.id)) {
    res.status(409).json({ message: `Ya existe una capacitacion con el codigo ${trainingCode}.` });
    return;
  }

  if (req.user!.rol === 'Reclutador') {
    session.reclutador_id = req.user!.uid;
    session.reclutador_nombre = req.user!.nombre;
  }

  const writer = adminDb.bulkWriter();
  writer.set(adminDb.collection('sessions').doc(session.id), session);
  writer.set(adminDb.collection('surveys').doc(survey.id), survey);
  participants.forEach((participant) =>
    writer.set(adminDb.collection('participants').doc(participant.id), participant),
  );
  attendance.forEach((record) =>
    writer.set(adminDb.collection('attendance').doc(record.id), record),
  );
  await writer.close();
  res.status(201).json({ ok: true });
});

router.patch('/:sessionId', canPatchTraining, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await assertTrainingAccess(req, req.params.sessionId))) {
    res.status(403).json({ message: 'Solo puedes editar tus propias capacitaciones.' });
    return;
  }
  const changes = z.record(z.string(), z.unknown()).safeParse(req.body);
  if (!changes.success) {
    res.status(400).json({ message: 'Cambios de capacitacion invalidos.' });
    return;
  }
  delete changes.data.id;
  if (req.user!.rol === 'Formador') {
    const keys = Object.keys(changes.data);
    const statusOnly = keys.length === 1 && keys[0] === 'estado';
    const allowedStatus = ['Capacitación cerrada', 'En curso'].includes(String(changes.data.estado || ''));
    if (!statusOnly || !allowedStatus) {
      res.status(403).json({ message: 'El Formador solo puede actualizar el estado de su capacitación asignada.' });
      return;
    }
  }

  const requestedCode = String(changes.data.generation_code || changes.data.nombre_generacion || '').trim();
  if (requestedCode && await hasDuplicateTrainingCode(requestedCode, req.params.sessionId)) {
    res.status(409).json({ message: `Ya existe una capacitacion con el codigo ${requestedCode}.` });
    return;
  }

  if (requestedCode) {
    changes.data.generation_code = requestedCode;
    changes.data.nombre_generacion = requestedCode;
  }

  const shouldSyncRelatedRecords = req.user!.rol === 'Administrador' && Boolean(
    requestedCode || changes.data.campaña || changes.data.formador_id || changes.data.formador_nombre,
  );
  if (!shouldSyncRelatedRecords) {
    await adminDb.collection('sessions').doc(req.params.sessionId).set(changes.data, { merge: true });
    res.json({ ok: true });
    return;
  }

  const surveysSnapshot = await adminDb.collection('surveys')
    .where('training_session_id', '==', req.params.sessionId)
    .get();
  const responseSnapshots = await Promise.all(surveysSnapshot.docs.map((survey) =>
    adminDb.collection('responses').where('training_survey_id', '==', survey.id).get(),
  ));
  const relatedChanges: Record<string, unknown> = {
    ...(requestedCode ? { codigo_generacion: requestedCode } : {}),
    ...(changes.data.campaña ? { campaña: changes.data.campaña } : {}),
    ...(changes.data.formador_id ? { formador_id: changes.data.formador_id } : {}),
    ...(changes.data.formador_nombre ? { formador_nombre: changes.data.formador_nombre } : {}),
  };
  const writer = adminDb.bulkWriter();
  writer.set(adminDb.collection('sessions').doc(req.params.sessionId), changes.data, { merge: true });
  surveysSnapshot.docs.forEach((survey) => writer.set(survey.ref, relatedChanges, { merge: true }));
  responseSnapshots.forEach((snapshot) =>
    snapshot.docs.forEach((response) => writer.set(response.ref, relatedChanges, { merge: true })),
  );
  await writer.close();
  res.json({ ok: true });
});

router.delete('/:sessionId', canManageTraining, async (req: AuthenticatedRequest, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!(await assertTrainingAccess(req, sessionId))) {
    res.status(403).json({ message: 'Solo puedes eliminar tus propias capacitaciones.' });
    return;
  }

  const [
    participantsSnapshot,
    attendanceSnapshot,
    confirmationsSnapshot,
    surveysSnapshot,
  ] = await Promise.all([
    adminDb.collection('participants').where('training_session_id', '==', sessionId).get(),
    adminDb.collection('attendance').where('training_session_id', '==', sessionId).get(),
    adminDb.collection('confirmations').where('training_session_id', '==', sessionId).get(),
    adminDb.collection('surveys').where('training_session_id', '==', sessionId).get(),
  ]);

  const surveyIds = surveysSnapshot.docs.map((doc) => doc.id);
  const responseSnapshots = await Promise.all(
    surveyIds.map((surveyId) =>
      adminDb.collection('responses').where('training_survey_id', '==', surveyId).get(),
    ),
  );

  const writer = adminDb.bulkWriter();
  writer.delete(adminDb.collection('sessions').doc(sessionId));
  participantsSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
  attendanceSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
  confirmationsSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
  surveysSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
  responseSnapshots.forEach((snapshot) =>
    snapshot.docs.forEach((doc) => writer.delete(doc.ref)),
  );
  await writer.close();

  res.json({ ok: true });
});

router.post(
  '/:sessionId/participants',
  canManageTraining,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!(await assertTrainingAccess(req, req.params.sessionId))) {
      res.status(403).json({ message: 'Solo puedes cargar personas en tus propias capacitaciones.' });
      return;
    }
    const parsed = z.object({
      participants: z.array(entitySchema).min(1).max(2000),
      attendance: z.array(entitySchema).max(10000),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Datos de participantes invalidos.' });
      return;
    }
    const writer = adminDb.bulkWriter();
    parsed.data.participants.forEach((participant) =>
      writer.set(adminDb.collection('participants').doc(participant.id), participant),
    );
    parsed.data.attendance.forEach((record) =>
      writer.set(adminDb.collection('attendance').doc(record.id), record),
    );
    await writer.close();
    res.status(201).json({ ok: true, added: parsed.data.participants.length });
  },
);

export { router as trainingRoutes };
