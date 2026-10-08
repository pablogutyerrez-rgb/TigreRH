import { auth } from '../../lib/firebase';
import { getRuntimeEnv } from '../../lib/runtimeConfig';
import type { User, UserRole } from '../../types';

export interface CreatePlatformUserData {
  nombre: string;
  correo?: string;
  usuario: string;
  password: string;
  rol: UserRole;
  estado: 'Activo' | 'Inactivo';
  areas?: User['areas'];
  module_access?: string[];
  module_view_only?: string[];
}

type PlatformUserProfile = Omit<User, 'password'>;

const API_BASE_URL =
  getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');

const getIdToken = async () => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) {
    throw new Error('Sesion no disponible. Vuelve a iniciar sesion.');
  }

  return token;
};

const backendRequest = async <T>(
  path: string,
  options: RequestInit = {},
): Promise<T> => {
  const token = await getIdToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | (T & { message?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.message || 'No se pudo completar la operacion.');
  }

  return payload as T;
};

export const createPlatformUser = async (data: CreatePlatformUserData) => {
  const result = await backendRequest<{ user: PlatformUserProfile }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  return {
    ...result.user,
    correo: result.user.correo || '',
  };
};

export const updatePlatformUser = async (
  uid: string,
  data: Partial<Omit<User, 'id' | 'password' | 'fecha_creacion'>>,
) => {
  await backendRequest(`/api/users/${uid}`, {
    method: 'PATCH',
    body: JSON.stringify({
      nombre: data.nombre,
      correo: data.correo,
      usuario: data.usuario,
      rol: data.rol,
      estado: data.estado,
      areas: data.areas,
      module_access: data.module_access,
    }),
  });
};

export const deactivatePlatformUser = async (uid: string) => {
  await backendRequest(`/api/users/${uid}/deactivate`, {
    method: 'PATCH',
  });
};

export const changeUserPasswordByAdmin = async (
  uid: string,
  newPassword: string,
) => {
  await backendRequest(`/api/users/${uid}/password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
};
