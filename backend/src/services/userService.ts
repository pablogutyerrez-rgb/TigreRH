import bcrypt from 'bcryptjs';
import type { DocumentData } from 'firebase-admin/firestore';
import { adminAuth } from '../firebaseAdmin.js';
import { dataDb as adminDb } from '../hybridDb.js';
import { normalizeUsername } from '../utils/normalizeUsername.js';
import { createAuditLog } from './auditService.js';

export interface Actor {
  uid: string;
  nombre: string;
}

export interface CreatePlatformUserData {
  nombre: string;
  correo?: string;
  usuario: string;
  password: string;
  rol: string;
  estado: 'Activo' | 'Inactivo';
  areas?: string[];
  module_access?: string[];
}

export interface UpdatePlatformUserData {
  nombre?: string;
  correo?: string;
  usuario?: string;
  rol?: string;
  estado?: 'Activo' | 'Inactivo';
  areas?: string[];
  module_access?: string[];
}

const getBcryptRounds = () => {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  return Number.isFinite(rounds) && rounds >= 8 ? rounds : 10;
};

const getAuthErrorCode = (error: unknown) => (error as { code?: string })?.code;

const userForClient = (uid: string, data: DocumentData) => ({
  id: uid,
  nombre: data.nombre,
  correo: data.correo || '',
  usuario: data.usuario,
  usuario_normalizado: data.usuario_normalizado,
  rol: data.rol,
  estado: data.estado,
  fecha_creacion: data.fecha_creacion,
  creado_por: data.creado_por,
  requiere_cambio_password: data.requiere_cambio_password,
  areas: Array.isArray(data.areas) ? data.areas : [],
  module_access: Array.isArray(data.module_access) ? data.module_access : [],
});

const assertUsernameAvailable = async (
  usuarioNormalizado: string,
  currentUid?: string,
) => {
  const credentialSnapshot = await adminDb
    .collection('user_credentials')
    .where('usuario_normalizado', '==', usuarioNormalizado)
    .limit(1)
    .get();

  if (!credentialSnapshot.empty && credentialSnapshot.docs[0].id !== currentUid) {
    throw new Error('El usuario ya existe.');
  }

  const usersSnapshot = await adminDb.collection('users').get();
  for (const userDoc of usersSnapshot.docs) {
    if (userDoc.id === currentUid) continue;
    const profile = userDoc.data();
    const profileUsername = String(profile.usuario_normalizado || profile.usuario || '');
    if (!profileUsername || normalizeUsername(profileUsername) !== usuarioNormalizado) {
      continue;
    }

    const duplicatedCredential = await adminDb
      .collection('user_credentials')
      .doc(userDoc.id)
      .get();

    if (duplicatedCredential.exists || profile.estado === 'Activo') {
      throw new Error('El usuario ya existe.');
    }
  }
};

const ensureAuthUser = async (uid: string, nombre: string, disabled: boolean) => {
  try {
    await adminAuth.createUser({
      uid,
      displayName: nombre,
      disabled,
    });
  } catch (error) {
    if (getAuthErrorCode(error) === 'auth/uid-already-exists') {
      await adminAuth.updateUser(uid, {
        displayName: nombre,
        disabled,
      });
      return;
    }

    throw error;
  }
};

export const createPlatformUser = async (
  data: CreatePlatformUserData,
  createdBy: Actor,
) => {
  const usuarioNormalizado = normalizeUsername(data.usuario);
  await assertUsernameAvailable(usuarioNormalizado);

  const uid = adminDb.collection('users').doc().id;
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(data.password, getBcryptRounds());

  await ensureAuthUser(uid, data.nombre, data.estado !== 'Activo');

  const profile = {
    id: uid,
    nombre: data.nombre,
    correo: data.correo || '',
    usuario: data.usuario,
    usuario_normalizado: usuarioNormalizado,
    rol: data.rol,
    estado: data.estado,
    areas: Array.isArray(data.areas) ? data.areas : [],
    module_access: Array.isArray(data.module_access) ? data.module_access : [],
    requiere_cambio_password: true,
    fecha_creacion: now,
    creado_por: createdBy.uid,
  };

  await adminDb.collection('users').doc(uid).set(profile);
  await adminDb.collection('user_credentials').doc(uid).set({
    uid,
    usuario_normalizado: usuarioNormalizado,
    password_hash: passwordHash,
    created_at: now,
    updated_at: now,
  });

  await createAuditLog({
    modulo: 'Usuarios',
    accion: 'Crear usuario',
    usuario_id: createdBy.uid,
    usuario_nombre: createdBy.nombre,
    entityType: 'user',
    entityId: uid,
    detalle: `Usuario creado: ${data.usuario}`,
  });

  return userForClient(uid, profile);
};

export const updatePlatformUser = async (
  uid: string,
  data: UpdatePlatformUserData,
  updatedBy: Actor,
) => {
  const userRef = adminDb.collection('users').doc(uid);
  const current = await userRef.get();
  if (!current.exists) {
    throw new Error('Usuario no encontrado.');
  }

  const currentData = current.data() || {};
  const updateData: Record<string, unknown> = {};

  if (data.nombre !== undefined) updateData.nombre = data.nombre;
  if (data.correo !== undefined) updateData.correo = data.correo;
  if (data.rol !== undefined) updateData.rol = data.rol;
  if (data.estado !== undefined) updateData.estado = data.estado;
  if (data.areas !== undefined) updateData.areas = Array.isArray(data.areas) ? data.areas : [];
  if (data.module_access !== undefined) {
    updateData.module_access = Array.isArray(data.module_access) ? data.module_access : [];
  }

  if (data.usuario !== undefined) {
    const usuarioNormalizado = normalizeUsername(data.usuario);
    await assertUsernameAvailable(usuarioNormalizado, uid);
    updateData.usuario = data.usuario;
    updateData.usuario_normalizado = usuarioNormalizado;
    await adminDb.collection('user_credentials').doc(uid).set(
      {
        uid,
        usuario_normalizado: usuarioNormalizado,
        updated_at: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  await userRef.set(updateData, { merge: true });

  await ensureAuthUser(
    uid,
    String(data.nombre ?? currentData.nombre ?? ''),
    (data.estado ?? currentData.estado) !== 'Activo',
  );

  await createAuditLog({
    modulo: 'Usuarios',
    accion: 'Actualizar usuario',
    usuario_id: updatedBy.uid,
    usuario_nombre: updatedBy.nombre,
    entityType: 'user',
    entityId: uid,
    detalle: `Usuario actualizado: ${uid}`,
  });
};

export const changeUserPasswordByAdmin = async (
  uid: string,
  newPassword: string,
  changedBy: Actor,
) => {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    throw new Error('Usuario no encontrado.');
  }

  const profile = userDoc.data() || {};
  const usuario = String(profile.usuario || '').trim();
  if (!usuario) {
    throw new Error('El usuario no tiene un nombre de acceso configurado.');
  }

  const usuarioNormalizado = normalizeUsername(
    String(profile.usuario_normalizado || usuario),
  );
  await assertUsernameAvailable(usuarioNormalizado, uid);

  const passwordHash = await bcrypt.hash(newPassword, getBcryptRounds());
  const now = new Date().toISOString();

  await ensureAuthUser(
    uid,
    String(profile.nombre || usuario),
    profile.estado !== 'Activo',
  );

  await adminDb.collection('user_credentials').doc(uid).set(
    {
      uid,
      usuario_normalizado: usuarioNormalizado,
      password_hash: passwordHash,
      updated_at: now,
    },
    { merge: true },
  );

  await adminDb.collection('users').doc(uid).set(
    {
      usuario_normalizado: usuarioNormalizado,
      requiere_cambio_password: true,
    },
    { merge: true },
  );

  await createAuditLog({
    modulo: 'Usuarios',
    accion: 'Cambiar contrasena',
    usuario_id: changedBy.uid,
    usuario_nombre: changedBy.nombre,
    entityType: 'user',
    entityId: uid,
    detalle: `Contrasena actualizada para usuario: ${uid}`,
  });
};

export const deactivatePlatformUser = async (uid: string, changedBy: Actor) => {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    throw new Error('Usuario no encontrado.');
  }

  const profile = userDoc.data() || {};
  await adminDb.collection('users').doc(uid).set(
    {
      estado: 'Inactivo',
    },
    { merge: true },
  );
  await ensureAuthUser(uid, String(profile.nombre || profile.usuario || uid), true);

  await createAuditLog({
    modulo: 'Usuarios',
    accion: 'Desactivar usuario',
    usuario_id: changedBy.uid,
    usuario_nombre: changedBy.nombre,
    entityType: 'user',
    entityId: uid,
    detalle: `Usuario desactivado: ${uid}`,
  });
};
