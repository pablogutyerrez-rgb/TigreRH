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

    const updateData: Record<string, unknown> = {
      ...(parsed.data.changes || {}),
      estado: parsed.data.status,
    };
    delete updateData.id;
    await surveyRef.set(updateData, { merge: true });
    res.json({ ok: true });
  },
);

export { router as surveyRoutes };
