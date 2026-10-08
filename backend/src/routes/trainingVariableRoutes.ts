import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  annulTrainingVariableEvaluation,
  closeTrainingVariableEvaluation,
  createTrainingVariableEvaluation,
  deleteTrainingVariableEvaluation,
  getTrainingVariableEvaluationById,
  listTrainingVariableEvaluations,
  reopenTrainingVariableEvaluation,
  updateTrainingVariableEvaluation,
} from '../services/trainingVariableService.js';
import {
  calculateTrainingVariableFromSources,
  listTrainingVariableSources,
} from '../services/trainingVariableSourceService.js';
import {
  type AuthenticatedRequest,
  requireAuth,
  requireRole,
} from '../utils/authMiddleware.js';

const router = Router();

const inputSchema = z.object({
  formula_version: z.number().int().min(1).max(2).optional(),
  porcentaje_rotacion: z.number().min(0).max(100).optional(),
  meses: z.array(z.number().int().min(1).max(12)).min(1).optional(),
  formador_ids: z.array(z.string().trim().min(1)).min(1).optional(),
  campanas: z.array(z.string().trim().min(1)).optional(),
  anio: z.coerce.number().int().min(2020).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
  id_formador: z.string().trim().min(1),
  nombre_formador: z.string().trim().min(1),
  observacion_general: z.string().trim().optional().default(''),
  porcentaje_retencion: z.coerce.number().min(0).max(100),
  porcentaje_produccion_individual: z.coerce.number().min(0).max(100),
  porcentaje_produccion_grupal: z.coerce.number().min(0),
  porcentaje_satisfaccion: z.coerce.number().min(0).max(100),
  porcentaje_administrativo: z.coerce.number().min(0).max(100),
  observacion_administrativa: z.string().trim().optional().default(''),
  generation_ids: z.array(z.string().trim().min(1)).min(1),
  codigos_generacion: z.array(z.string().trim().min(1)).min(1),
  calculo_automatico: z.boolean().optional().default(false),
  calculo_detalle: z.object({
    participantes_dia_1: z.coerce.number().int().min(0),
    participantes_dia_final: z.coerce.number().int().min(0),
    prospectos_generados: z.coerce.number().int().min(0),
    prospectos_venta_alta: z.coerce.number().int().min(0),
    respuestas_encuesta: z.coerce.number().int().min(0),
    altas_operacion: z.coerce.number().int().min(0).optional(),
    ventas_reales: z.coerce.number().min(0).optional(),
    productividad_disponible: z.boolean().optional(),
    rotacion_disponible: z.boolean().optional(),
    bajas_rotacion: z.coerce.number().int().min(0).optional(),
    dotacion_rotacion: z.coerce.number().int().min(0).optional(),
  }).optional(),
});

const sourceQuerySchema = z.object({
  meses: z.preprocess((v) => typeof v === 'string' ? v.split(',').map(Number) : v, z.array(z.number().int().min(1).max(12)).min(1).optional()),
  formador_id: z.string().trim().min(1).optional(),
  anio: z.coerce.number().int().min(2020).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

const automaticCalculationSchema = sourceQuerySchema.extend({
  formador_ids: z.array(z.string().trim().min(1)).min(1).optional(),
  campanas: z.array(z.string().trim().min(1)).optional(),
  formador_id: z.string().trim().min(1),
  generation_ids: z.array(z.string().trim().min(1)).min(1),
});

const asActor = (req: AuthenticatedRequest) => ({
  uid: req.user!.uid,
  rol: req.user!.rol,
  nombre: req.user!.nombre,
});

const sendError = (res: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error interno.';
  const status =
    message.includes('permisos') || message.includes('Solo el administrador') ? 403 :
    message.includes('no encontrada') ? 404 :
    message.includes('Ya existe') ? 409 :
    400;
  res.status(status).json({ message });
};

router.get('/', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const evaluations = await listTrainingVariableEvaluations(asActor(req));
    res.json({ evaluations });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/fuentes/codigos', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = sourceQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message || 'Filtros de códigos inválidos.' });
    return;
  }

  try {
    const sources = await listTrainingVariableSources(parsed.data.anio, parsed.data.mes, parsed.data.formador_id, parsed.data.meses);
    res.json({ sources });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/calcular/automatico', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = automaticCalculationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message || 'Datos para cálculo automático inválidos.' });
    return;
  }

  try {
    const calculation = await calculateTrainingVariableFromSources(
      parsed.data.formador_id,
      parsed.data.generation_ids,
      parsed.data.anio,
      parsed.data.mes,
      parsed.data,
    );
    res.json({ calculation });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/:id', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const evaluation = await getTrainingVariableEvaluationById(req.params.id, asActor(req));
    res.json({ evaluation });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message || 'Datos de evaluación inválidos.' });
    return;
  }

  try {
    const evaluation = await createTrainingVariableEvaluation(parsed.data, asActor(req));
    res.status(201).json({ evaluation });
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/:id', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message || 'Datos de evaluación inválidos.' });
    return;
  }

  try {
    const evaluation = await updateTrainingVariableEvaluation(req.params.id, parsed.data, asActor(req));
    res.json({ evaluation });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/cerrar', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const evaluation = await closeTrainingVariableEvaluation(req.params.id, asActor(req));
    res.json({ evaluation });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/reabrir', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const evaluation = await reopenTrainingVariableEvaluation(req.params.id, asActor(req));
    res.json({ evaluation });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/anular', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const evaluation = await annulTrainingVariableEvaluation(req.params.id, asActor(req));
    res.json({ evaluation });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:id', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await deleteTrainingVariableEvaluation(req.params.id, asActor(req));
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

export { router as trainingVariableRoutes };
