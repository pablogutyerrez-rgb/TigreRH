import { Router } from 'express';
import { z } from 'zod';
import { getCommercialDashboard, inspectCommercialImport, saveCommercialImport } from '../services/commercialService.js';
import { type AuthenticatedRequest, requireAuth } from '../utils/authMiddleware.js';

const router = Router(); const MODULE = 'comercial:dashboard';
const requireCommercialAccess = (req: AuthenticatedRequest, res: import('express').Response, next: import('express').NextFunction) => {
  if (req.user?.rol === 'Administrador' || req.user?.module_access.some((moduleId) => moduleId.startsWith('comercial:'))) return next();
  res.status(403).json({ message: 'No tienes permisos para Gestión Comercial.' });
};
const requireCommercialWrite = (req: AuthenticatedRequest, res: import('express').Response, next: import('express').NextFunction) => {
  if (req.user?.rol === 'Administrador' || (req.user?.module_access.includes('comercial:datos') && !req.user.module_view_only.includes('comercial:datos'))) return next();
  res.status(403).json({ message: 'No tienes permisos para modificar Gestión Comercial.' });
};
const sheet = z.object({ name: z.string().min(1), headers: z.array(z.string()), rows: z.array(z.record(z.string(), z.unknown())).max(25000), formulas: z.array(z.string()), row_count: z.number().int().nonnegative() });
const input = z.object({ campaign: z.enum(['Culqi', 'Entel']), file: z.object({ name: z.string().min(1), mime: z.string(), content_base64: z.string().min(1), sha256: z.string().min(16) }), sheets: z.array(sheet).min(1).max(40), cutoff_date: z.string().optional() });
router.get('/dashboard', requireAuth, requireCommercialAccess, async (req, res) => { try { res.json(await getCommercialDashboard({ campaign: typeof req.query.campaign === 'string' ? req.query.campaign : undefined, year: req.query.year ? Number(req.query.year) : undefined, month: req.query.month ? Number(req.query.month) : undefined, from: typeof req.query.from === 'string' ? req.query.from : undefined, to: typeof req.query.to === 'string' ? req.query.to : undefined, supervisor: typeof req.query.supervisor === 'string' ? req.query.supervisor : undefined, executive: typeof req.query.executive === 'string' ? req.query.executive : undefined })); } catch { res.status(500).json({ message: 'No se pudo consultar Gestión Comercial.' }); } });
router.post('/inspect', requireAuth, requireCommercialAccess, requireCommercialWrite, (req, res) => { const parsed = input.safeParse(req.body); if (!parsed.success) return res.status(400).json({ message: 'Archivo comercial inválido.' }); try { res.json(inspectCommercialImport(parsed.data)); } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : 'No se pudo inspeccionar el archivo.' }); } });
router.post('/imports', requireAuth, requireCommercialAccess, requireCommercialWrite, async (req: AuthenticatedRequest, res) => { const parsed = input.safeParse(req.body); if (!parsed.success) return res.status(400).json({ message: 'Archivo comercial inválido.' }); try { res.status(201).json(await saveCommercialImport(parsed.data, { uid: req.user!.uid, nombre: req.user!.nombre })); } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : 'No se pudo guardar la carga.' }); } });
export { router as commercialRoutes };
