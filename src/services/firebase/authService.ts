import {
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { getRuntimeEnv } from '../../lib/runtimeConfig';
import type { User } from '../../types';

type UserProfile = Omit<User, 'password'>;

interface LoginWithUsernameResponse {
  customToken: string;
  user: {
    id: string;
    nombre: string;
    usuario: string;
    usuario_normalizado: string;
    rol: User['rol'];
    estado: User['estado'];
    correo?: string;
    areas?: User['areas'];
    module_access?: string[];
  };
}

const API_BASE_URL =
  getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');

const getRequiredAuth = () => {
  if (!auth) throw new Error('Firebase Auth is not configured. Check .env.local.');
  return auth;
};

const mapUserProfile = (id: string, data: unknown): UserProfile => {
  const profile = data as UserProfile;
  return {
    ...profile,
    id,
    correo: profile.correo || '',
  };
};

export const getCurrentUserProfile = async (uid: string) => {
  const token = await getRequiredAuth().currentUser?.getIdToken();
  if (!token) return null;
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || 'No se pudo validar la sesion.');
  }
  const payload = await response.json() as { user?: UserProfile & { uid?: string; id?: string } };
  if (!payload.user) return null;
  return mapUserProfile(payload.user.id || payload.user.uid || uid, payload.user);
};

export const loginWithUsername = async (username: string, password: string) => {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  const payload = (await response.json().catch(() => null)) as
    | (LoginWithUsernameResponse & { message?: string })
    | null;

  if (!response.ok || !payload?.customToken) {
    throw new Error(payload?.message || 'No se pudo iniciar sesion.');
  }

  const credential = await signInWithCustomToken(getRequiredAuth(), payload.customToken);
  const profile = mapUserProfile(credential.user.uid, payload.user);

  if (!profile) {
    await signOut(getRequiredAuth());
    throw new Error('La sesion fue creada, pero no se encontro el perfil del usuario.');
  }

  return profile;
};

export const logoutFirebase = () => signOut(getRequiredAuth());

export const subscribeToAuthChanges = (
  callback: (profile: UserProfile | null, firebaseUser: FirebaseUser | null) => void,
) => {
  let requestVersion = 0;
  return onAuthStateChanged(getRequiredAuth(), async (firebaseUser) => {
    const currentRequest = ++requestVersion;
    try {
      if (!firebaseUser) {
        callback(null, null);
        return;
      }

      const profile = await getCurrentUserProfile(firebaseUser.uid);
      if (
        currentRequest !== requestVersion ||
        getRequiredAuth().currentUser?.uid !== firebaseUser.uid
      ) return;
      callback(profile, firebaseUser);
    } catch (error) {
      if (
        currentRequest !== requestVersion ||
        getRequiredAuth().currentUser?.uid !== firebaseUser?.uid
      ) return;
      console.error('Error loading Firebase user profile:', error);
      callback(null, firebaseUser);
    }
  });
};
