import { Router } from 'express';
import { z } from 'zod';
import {
  getRotationDashboard, normalizeTerminations, rotationDate, saveRotationImport,
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
  months: z.preprocess((v) => typeof v === 'string' ? v.split(',').filter(Boolean) : v, z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).optional()),
  from: z.string().refine((date) => rotationDate(date) === date).optional(),
  to: z.string().refine((date) => rotationDate(date) === date).optional(),
  search: z.string().trim().max(200).optional(),
}).refine((filters) => !filters.from || !filters.to || filters.from <= filters.to);

const validate = (
  req: AuthenticatedRequest, res: import('express').Response, next: import('express').NextFunction,
) => {
  const parsed = rowsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'La carga debe contener filas de Excel válidas.' });
  try {
    normalizeTerminations(parsed.data.rows);
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

router.post('/bajas', requireAuth, requireRoleOrModule(allowed, MODULE), requireWritableModule(MODULE), validate, async (req: AuthenticatedRequest, res) => {
  try { res.status(201).json(await saveRotationImport(req.body.rows, { uid: req.user!.uid, nombre: req.user!.nombre })); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('El archivo contiene versiones')) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'No se pudo guardar las bajas.' });
  }
});

export { router as rotationRoutes };

