import { Router, type Response } from 'express';
import { z } from 'zod';
import { dataDb as adminDb } from '../hybridDb.js';
import {
  type AuthenticatedRequest,
  requireAuth,
  requireRole,
} from '../utils/authMiddleware.js';

const router = Router();
const surveyStatusSchema = z.enum(['Borrador', 'Habilitada', 'Deshabilitada', 'Cerrada', 'Eliminada']);
const surveySchema = z.object({
  id: z.string().min(1),
  training_session_id: z.string().min(1),
  codigo_generacion: z.string().min(1),
  campaña: z.string().min(1),
  formador_id: z.string(),
  formador_nombre: z.string(),
  estado: surveyStatusSchema,
  token: z.string().trim().min(1).max(160),
}).passthrough();

const normalizeSurveyToken = (value: unknown) =>
  String(value || '').trim().replace(/\s+/g, '-').toUpperCase();

const findSurveyWithToken = async (token: string, excludedSurveyId = '') => {
  const normalized = normalizeSurveyToken(token).toLowerCase();
  const surveys = await adminDb.collection('surveys').get();
  return surveys.docs.find((doc) =>
    doc.id !== excludedSurveyId &&
    normalizeSurveyToken(doc.data().token).toLowerCase() === normalized,
  );
};

router.post(
  '/',
  requireAuth,
  requireRole(['Administrador', 'Analista', 'Reclutador', 'Coordinador']),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = surveySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Datos de encuesta invalidos.' });
      return;
    }
    const survey = { ...parsed.data, token: normalizeSurveyToken(parsed.data.token) };
    const session = await adminDb.collection('sessions').doc(survey.training_session_id).get();
    if (!session.exists) {
      res.status(404).json({ message: 'La capacitacion vinculada no existe.' });
      return;
    }
    if (await findSurveyWithToken(survey.token)) {
      res.status(409).json({ message: 'El token del enlace ya pertenece a otra encuesta.' });
      return;
    }
    const existingForSession = await adminDb.collection('surveys')
      .where('training_session_id', '==', survey.training_session_id)
      .get();
    if (existingForSession.docs.some((doc) => doc.data().estado !== 'Eliminada')) {
      res.status(409).json({ message: 'La capacitacion ya tiene una encuesta activa.' });
      return;
    }
    await adminDb.collection('surveys').doc(survey.id).create(survey);
    res.status(201).json({ ok: true, survey });
  },
);

router.patch(
  '/:surveyId/link-assignments',
  requireAuth,
  requireRole(['Administrador']),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = z.object({ userIds: z.array(z.string().min(1)) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'La lista de usuarios asignados es invalida.' });
      return;
    }
    const surveyRef = adminDb.collection('surveys').doc(req.params.surveyId);
    const surveyDoc = await surveyRef.get();
    if (!surveyDoc.exists) {
      res.status(404).json({ message: 'Encuesta no encontrada.' });
      return;
    }
    await surveyRef.set({ link_assigned_user_ids: Array.from(new Set(parsed.data.userIds)) }, { merge: true });
    res.json({ ok: true });
  },
);

router.patch(
  '/:surveyId/status',
  requireAuth,
  requireRole(['Administrador', 'Analista', 'Reclutador', 'Coordinador']),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = z.object({
      status: surveyStatusSchema,
      changes: z.record(z.string(), z.unknown()).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Estado de encuesta invalido.' });
      return;
    }
    const requestedAssignments = parsed.data.changes?.link_assigned_user_ids;
    if (requestedAssignments !== undefined) {
      if (req.user!.rol !== 'Administrador') {
        res.status(403).json({ message: 'Solo el Administrador puede asignar enlaces de encuestas.' });
        return;
      }
      if (!Array.isArray(requestedAssignments) || requestedAssignments.some((id) => typeof id !== 'string')) {
        res.status(400).json({ message: 'La lista de usuarios asignados es invalida.' });
        return;
      }
    }

    const surveyRef = adminDb.collection('surveys').doc(req.params.surveyId);
    const surveyDoc = await surveyRef.get();
    if (!surveyDoc.exists) {
      res.status(404).json({ message: 'Encuesta no encontrada.' });
      return;
    }

    const survey = surveyDoc.data();
    if (req.user!.rol === 'Reclutador') {
      const session = await adminDb
        .collection('sessions')
        .doc(String(survey?.training_session_id || ''))
        .get();
      if (!session.exists || session.data()?.reclutador_id !== req.user!.uid) {
        res.status(403).json({ message: 'Solo puedes gestionar encuestas de tus capacitaciones.' });
        return;
      }
    }

    const requestedToken = normalizeSurveyToken(
      parsed.data.changes?.token || survey?.token || survey?.codigo_generacion,
    );
    if (parsed.data.status === 'Habilitada' && !requestedToken) {
      res.status(400).json({ message: 'La encuesta necesita un token antes de habilitarse.' });
      return;
    }
    if (requestedToken && await findSurveyWithToken(requestedToken, req.params.surveyId)) {
      res.status(409).json({ message: 'El token del enlace ya pertenece a otra encuesta.' });
      return;
    }

    const updateData: Record<string, unknown> = {
      ...(parsed.data.changes || {}),
      estado: parsed.data.status,
      token: requestedToken,
    };
    delete updateData.id;
    await surveyRef.set(updateData, { merge: true });
    res.json({ ok: true });
  },
);

export { router as surveyRoutes };
