import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  changeUserPasswordByAdmin,
  createPlatformUser,
  deactivatePlatformUser,
  type CreatePlatformUserData,
  type UpdatePlatformUserData,
  updatePlatformUser,
} from '../services/userService.js';
import {
  type AuthenticatedRequest,
  invalidateProfileCache,
  requireAuth,
  requireRoleOrModule,
} from '../utils/authMiddleware.js';

const router = Router();
const canManageUsers = [requireAuth, requireRoleOrModule(['Administrador', 'Analista'], 'administrador:usuarios')];

const roleSchema = z.enum([
  'Administrador',
  'Analista',
  'Reclutador',
  'Formador',
  'Coordinador',
  'Sistemas',
]);

const stateSchema = z.enum(['Activo', 'Inactivo']);
const normalizedRoleSchema = z.string().trim().pipe(roleSchema);
const normalizedStateSchema = z.string().trim().pipe(stateSchema);
const areaSchema = z.enum(['seleccion', 'formacion', 'administrador']);
const moduleAccessSchema = z.array(z.string().trim().min(1)).default([]);
const getValidationMessage = (fallback: string) => (error: z.ZodError) =>
  error.issues[0]?.message || fallback;

const createUserSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre del usuario es requerido.'),
  correo: z.string().trim().email('El correo no es valido.').or(z.literal('')).optional(),
  usuario: z.string().trim().min(1, 'El usuario de acceso es requerido.'),
  password: z.string().trim().min(6, 'La contrasena temporal debe tener al menos 6 caracteres.'),
  rol: normalizedRoleSchema,
  estado: normalizedStateSchema,
  areas: z.array(areaSchema).default([]),
  module_access: moduleAccessSchema,
  module_view_only: moduleAccessSchema,
});

const updateUserSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre del usuario es requerido.').optional(),
  correo: z.string().trim().email('El correo no es valido.').or(z.literal('')).optional(),
  usuario: z.string().trim().min(1, 'El usuario de acceso es requerido.').optional(),
  rol: normalizedRoleSchema.optional(),
  estado: normalizedStateSchema.optional(),
  areas: z.array(areaSchema).optional(),
  module_access: z.array(z.string().trim().min(1)).optional(),
  module_view_only: z.array(z.string().trim().min(1)).optional(),
});

const passwordSchema = z.object({
  newPassword: z.string().trim().min(6, 'La nueva contrasena debe tener al menos 6 caracteres.'),
});

router.post('/', canManageUsers, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: getValidationMessage('Datos de usuario invalidos.')(parsed.error) });
    return;
  }

  try {
    const user = await createPlatformUser(parsed.data as CreatePlatformUserData, {
      uid: req.user!.uid,
      nombre: req.user!.nombre,
    });
    res.status(201).json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno.';
    res.status(message === 'El usuario ya existe.' ? 409 : 500).json({ message });
  }
});

router.patch('/:uid', canManageUsers, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: getValidationMessage('Datos de usuario invalidos.')(parsed.error) });
    return;
  }

  try {
    await updatePlatformUser(req.params.uid, parsed.data as UpdatePlatformUserData, {
      uid: req.user!.uid,
      nombre: req.user!.nombre,
    });
    invalidateProfileCache(req.params.uid);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno.';
    const status = message === 'El usuario ya existe.' ? 409 : 500;
    res.status(status).json({ message });
  }
});

router.post('/:uid/password', canManageUsers, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: getValidationMessage('La nueva contrasena es requerida.')(parsed.error) });
    return;
  }

  try {
    await changeUserPasswordByAdmin(req.params.uid, parsed.data.newPassword, {
      uid: req.user!.uid,
      nombre: req.user!.nombre,
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Password change error:', error);
    const message = error instanceof Error ? error.message : 'Error interno.';
    res.status(message === 'Usuario no encontrado.' ? 404 : 500).json({ message });
  }
});

router.patch('/:uid/deactivate', canManageUsers, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await deactivatePlatformUser(req.params.uid, {
      uid: req.user!.uid,
      nombre: req.user!.nombre,
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ message: 'Error interno.' });
  }
});

export { router as userRoutes };
