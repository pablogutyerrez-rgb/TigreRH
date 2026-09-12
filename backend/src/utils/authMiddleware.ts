import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from '../firebaseAdmin.js';
import { dataDb as adminDb } from '../hybridDb.js';

export interface AuthenticatedUser {
  uid: string;
  id: string;
  rol: string;
  usuario: string;
  usuario_normalizado: string;
  nombre: string;
  correo: string;
  estado: 'Activo';
  fecha_creacion: string;
  creado_por?: string;
  requiere_cambio_password: boolean;
  areas: string[];
  module_access: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const profileCache = new Map<string, {
  expiresAt: number;
  profile: Record<string, unknown>;
}>();
const PROFILE_CACHE_TTL_MS = 60 * 1000;

export const invalidateProfileCache = (uid: string) => profileCache.delete(uid);

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ message: 'Token requerido.' });
    return;
  }

  let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch (error) {
    const authError = error as { code?: string; message?: string };
    console.error('Firebase token validation failed:', {
      code: authError?.code || 'unknown',
      message: authError?.message || 'Unknown authentication error',
    });
    res.status(401).json({ message: 'Token invalido.' });
    return;
  }

  try {
    const cachedProfile = profileCache.get(decoded.uid);
    let profile = cachedProfile && cachedProfile.expiresAt > Date.now()
      ? cachedProfile.profile
      : undefined;
    if (!profile) {
      const userDoc = await adminDb.collection('users').doc(decoded.uid).get();
      if (!userDoc.exists) {
        res.status(401).json({ message: 'Perfil de usuario no encontrado.' });
        return;
      }
      profile = userDoc.data() as Record<string, unknown>;
      profileCache.set(decoded.uid, {
        profile,
        expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
      });
    }

    if (profile?.estado !== 'Activo') {
      res.status(403).json({ message: 'Usuario inactivo.' });
      return;
    }

    req.user = {
      uid: decoded.uid,
      id: decoded.uid,
      rol: String(profile?.rol || ''),
      usuario: String(profile?.usuario || profile?.usuario_normalizado || ''),
      usuario_normalizado: String(profile?.usuario_normalizado || profile?.usuario || ''),
      nombre: String(profile?.nombre || ''),
      correo: String(profile?.correo || ''),
      estado: 'Activo',
      fecha_creacion: String(profile?.fecha_creacion || ''),
      creado_por: profile?.creado_por ? String(profile.creado_por) : undefined,
      requiere_cambio_password: profile?.requiere_cambio_password === true,
      areas: Array.isArray(profile?.areas) ? profile.areas.map(String) : [],
      module_access: Array.isArray(profile?.module_access) ? profile.module_access.map(String) : [],
    };

    next();
  } catch (error) {
    const profileError = error as { code?: string; message?: string };
    console.error('Firebase user profile load failed:', {
      code: profileError?.code || 'unknown',
      message: profileError?.message || 'Unknown profile error',
    });
    res.status(503).json({ message: 'No se pudo validar el perfil del usuario. Intenta nuevamente.' });
  }
};

export const requireRole =
  (roles: string[]) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ message: 'Token requerido.' });
      return;
    }

    if (!roles.includes(req.user.rol)) {
      res.status(403).json({ message: 'No tienes permisos para esta accion.' });
      return;
    }

    next();
  };

export const requireRoleOrModule = (roles: string[], moduleId: string) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ message: 'Token requerido.' });
      return;
    }
    if (!roles.includes(req.user.rol) && !req.user.module_access.includes(moduleId)) {
      res.status(403).json({ message: 'No tienes permisos para esta accion.' });
      return;
    }
    next();
  };
