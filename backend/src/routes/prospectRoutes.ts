import { Router, type Response } from 'express';
import { z } from 'zod';
import { dataDb as adminDb } from '../hybridDb.js';
import {
  type AuthenticatedRequest,
  requireAuth,
  requireRole,
  requireRoleOrModule,
} from '../utils/authMiddleware.js';

const router = Router();
const COLLECTION = 'prospects';
const ALLOWED_ROLES = ['Administrador', 'Formador'];
const VIEW_ROLES = ['Administrador', 'Formador', 'Coordinador', 'Analista'];

const prospectSchema = z.object({
  campana: z.string().trim().min(1),
  fecha_registro: z.string().trim().min(1),
  formador_id: z.string().trim().min(1),
  formador_nombre: z.string().trim().min(1),
  training_session_id: z.string().trim().default(''),
  training_session_code: z.string().trim().default(''),
  ejecutivo_nombre: z.string().trim().min(1),
  ejecutivo_dni: z.string().trim().min(1),
  ejecutivo_inconcert: z.string().trim().default(''),
  prospecto_nombre: z.string().trim().min(1),
  ruc: z.string().trim().default(''),
  dni: z.string().trim().default(''),
  telefono: z.string().trim().min(1),
  correo: z.string().trim().default(''),
  producto_interes: z.string().trim().min(1),
  lineas_adicionales: z.string().trim().default(''),
  cantidad_productos: z.coerce.number().int().min(1),
  estado: z.enum(['Nuevo', 'Contactado', 'En seguimiento', 'Interesado', 'Venta / Alta', 'No interesado']),
  observaciones: z.string().trim().default(''),
});

const sendError = (res: Response, error: unknown) => {
  console.error('Prospect request failed:', error);
  res.status(500).json({ message: 'No se pudo procesar el prospecto.' });
};

router.get('/', requireAuth, requireRoleOrModule(VIEW_ROLES, 'formacion:prospectos'), async (_req, res) => {
  try {
    const snapshot = await adminDb.collection(COLLECTION).get();
    const prospects = snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }) as Record<string, unknown> & { id: string })
      .sort((a, b) => String(b.fecha_registro || '').localeCompare(String(a.fecha_registro || '')));
    res.json({ prospects });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/', requireAuth, requireRole(ALLOWED_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = prospectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message || 'Datos del prospecto invalidos.' });
    return;
  }

  try {
    const now = new Date().toISOString();
    const data = {
      ...parsed.data,
      ...(req.user!.rol === 'Formador' && {
        formador_id: req.user!.uid,
        formador_nombre: req.user!.nombre,
      }),
      creado_por: req.user!.uid,
      creado_por_rol: req.user!.rol,
      created_at: now,
      updated_at: now,
    };
    const ref = adminDb.collection(COLLECTION).doc();
    await ref.set(data);
    res.status(201).json({ prospect: { id: ref.id, ...data } });
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/:id', requireAuth, requireRole(ALLOWED_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = prospectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message || 'Datos del prospecto invalidos.' });
    return;
  }

  try {
    const ref = adminDb.collection(COLLECTION).doc(req.params.id);
    const current = await ref.get();
    if (!current.exists) {
      res.status(404).json({ message: 'Prospecto no encontrado.' });
      return;
    }
    const data = {
      ...parsed.data,
      ...(req.user!.rol === 'Formador' && {
        formador_id: req.user!.uid,
        formador_nombre: req.user!.nombre,
      }),
      updated_at: new Date().toISOString(),
    };
    await ref.set(data, { merge: true });
    res.json({ prospect: { id: ref.id, ...current.data(), ...data } });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:id', requireAuth, requireRole(['Administrador']), async (req, res) => {
  try {
    const ref = adminDb.collection(COLLECTION).doc(req.params.id);
    const current = await ref.get();
    if (!current.exists) {
      res.status(404).json({ message: 'Prospecto no encontrado.' });
      return;
    }
    await ref.delete();
    res.status(204).send();
  } catch (error) {
    sendError(res, error);
  }
});

export { router as prospectRoutes };
