import bcrypt from 'bcryptjs';
import { adminAuth } from '../firebaseAdmin.js';
import { dataDb as adminDb } from '../hybridDb.js';
import { normalizeUsername } from '../utils/normalizeUsername.js';

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode = 401,
  ) {
    super(message);
  }
}

interface UserProfile {
  id: string;
  nombre: string;
  usuario: string;
  usuario_normalizado: string;
  rol: string;
  estado: string;
  correo?: string;
  areas?: string[];
  module_access?: string[];
}

const genericCredentialsError = () =>
  new AuthError('Usuario o contrasena incorrectos.', 401);

const findCredentialByUsername = async (usuarioNormalizado: string) => {
  const credentialSnapshot = await adminDb
    .collection('user_credentials')
    .where('usuario_normalizado', '==', usuarioNormalizado)
    .limit(1)
    .get();

  if (!credentialSnapshot.empty) {
    return credentialSnapshot.docs[0];
  }

  const usersSnapshot = await adminDb
    .collection('users')
    .where('usuario_normalizado', '==', usuarioNormalizado)
    .limit(1)
    .get();
  const profileDoc = usersSnapshot.docs[0];

  if (!profileDoc) {
    return null;
  }

  const credentialDoc = await adminDb
    .collection('user_credentials')
    .doc(profileDoc.id)
    .get();

  if (!credentialDoc.exists) {
    return null;
  }

  if (!credentialDoc.data()?.usuario_normalizado) {
    await credentialDoc.ref.set(
      {
        uid: profileDoc.id,
        usuario_normalizado: usuarioNormalizado,
        updated_at: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  if (!profileDoc.data().usuario_normalizado) {
    await profileDoc.ref.set(
      {
        usuario_normalizado: usuarioNormalizado,
      },
      { merge: true },
    );
  }

  return credentialDoc;
};

export const loginWithUsername = async (username: string, password: string) => {
  const usuarioNormalizado = normalizeUsername(username);

  const credentialDoc = await findCredentialByUsername(usuarioNormalizado);
  if (!credentialDoc) {
    throw genericCredentialsError();
  }

  const credential = credentialDoc.data() || {};
  const passwordHash = credential.password_hash;

  if (typeof passwordHash !== 'string') {
    throw genericCredentialsError();
  }

  const passwordOk = await bcrypt.compare(password, passwordHash);
  if (!passwordOk) {
    throw genericCredentialsError();
  }

  const storedUid = String(credential.uid || '').trim();
  const candidateUids = Array.from(new Set([storedUid, credentialDoc.id]))
    .filter((uid) => uid && !uid.includes('/'));
  let userDoc = null;
  for (const candidateUid of candidateUids) {
    const candidate = await adminDb.collection('users').doc(candidateUid).get();
    if (candidate.exists) {
      userDoc = candidate;
      break;
    }
  }

  if (!userDoc) {
    const profileSnapshot = await adminDb
      .collection('users')
      .where('usuario_normalizado', '==', usuarioNormalizado)
      .limit(1)
      .get();
    userDoc = profileSnapshot.docs[0] || null;
  }
  if (!userDoc) {
    throw new AuthError('Perfil de usuario no encontrado.', 500);
  }

  const uid = userDoc.id;
  const profile = userDoc.data() as UserProfile;
  if (profile.estado !== 'Activo') {
    throw new AuthError('Usuario inactivo.', 403);
  }

  if (!profile.usuario_normalizado || storedUid !== uid) {
    try {
      await Promise.all([
        userDoc.ref.set({ usuario_normalizado: usuarioNormalizado }, { merge: true }),
        credentialDoc.ref.set({
          uid,
          usuario_normalizado: usuarioNormalizado,
          updated_at: new Date().toISOString(),
        }, { merge: true }),
      ]);
    } catch (error) {
      console.warn('Login metadata repair failed:', error);
    }
  }

  const customToken = await adminAuth.createCustomToken(uid, {
    rol: profile.rol,
    usuario: profile.usuario_normalizado || usuarioNormalizado,
  });

  return {
    customToken,
    user: {
      id: uid,
      nombre: profile.nombre,
      usuario: profile.usuario,
      usuario_normalizado: profile.usuario_normalizado || usuarioNormalizado,
      rol: profile.rol,
      estado: profile.estado,
      correo: profile.correo || '',
      areas: Array.isArray(profile.areas) ? profile.areas : [],
      module_access: Array.isArray(profile.module_access) ? profile.module_access : [],
    },
  };
};
