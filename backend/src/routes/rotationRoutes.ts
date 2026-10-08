import { Router } from 'express';
import { z } from 'zod';
import {
  getRotationDashboard, normalizeHeadcounts, normalizeTerminations, saveRotationImport,
} from '../services/rotationService.js';
import { type AuthenticatedRequest, requireAuth, requireRoleOrModule, requireWritableModule } from '../utils/authMiddleware.js';

const router = Router();
const MODULE = 'formacion:rotacion';
const allowed = ['Administrador'];

const rowsSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(20_000),
});
const querySchema = z.object({
  campaigns: z.preprocess((v) => typeof v === 'string' ? v.split(',').filter(Boolean) : v, z.array(z.string()).optional()),
  years: z.preprocess((v) => typeof v === 'string' ? v.split(',').map(Number) : v, z.array(z.coerce.number().int()).optional()),
  periods: z.preprocess((v) => typeof v === 'string' ? v.split(',').filter(Boolean) : v, z.array(z.string()).optional()),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
});

const validate = (type: 'bajas' | 'dotacion') => (
  req: AuthenticatedRequest, res: import('express').Response, next: import('express').NextFunction,
) => {
  const parsed = rowsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'La carga debe contener filas de Excel válidas.' });
  try {
    type === 'bajas' ? normalizeTerminations(parsed.data.rows) : normalizeHeadcounts(parsed.data.rows);
    req.body.rows = parsed.data.rows;
    next();
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Archivo inválido.' });
  }
};

router.get('/', requireAuth, requireRoleOrModule(allowed, MODULE), async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: 'Filtros de rotación inválidos.' });
  try { res.json(await getRotationDashboard(parsed.data)); }
  catch { res.status(500).json({ message: 'No se pudo consultar rotación.' }); }
});

router.post('/bajas', requireAuth, requireRoleOrModule(allowed, MODULE), requireWritableModule(MODULE), validate('bajas'), async (req: AuthenticatedRequest, res) => {
  try { res.status(201).json(await saveRotationImport('bajas', req.body.rows, { uid: req.user!.uid, nombre: req.user!.nombre })); }
  catch { res.status(500).json({ message: 'No se pudo guardar las bajas.' }); }
});

router.post('/dotacion', requireAuth, requireRoleOrModule(allowed, MODULE), requireWritableModule(MODULE), validate('dotacion'), async (req: AuthenticatedRequest, res) => {
  try { res.status(201).json(await saveRotationImport('dotacion', req.body.rows, { uid: req.user!.uid, nombre: req.user!.nombre })); }
  catch { res.status(500).json({ message: 'No se pudo guardar la dotación.' }); }
});

export { router as rotationRoutes };

