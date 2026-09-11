import bcrypt from 'bcryptjs';
import { adminAuth } from '../firebaseAdmin.js';
import { dataDb as adminDb } from '../hybridDb.js';
import { normalizeUsername } from '../utils/normalizeUsername.js';

const getArg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const getBcryptRounds = () => {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  return Number.isFinite(rounds) && rounds >= 8 ? rounds : 10;
};

const ensureAuthUser = async (uid: string, displayName: string) => {
  try {
    await adminAuth.createUser({
      uid,
      displayName,
      disabled: false,
    });
  } catch (error) {
    const authError = error as { code?: string };
    if (authError.code === 'auth/uid-already-exists') {
      await adminAuth.updateUser(uid, {
        displayName,
        disabled: false,
      });
      return;
    }

    throw error;
  }
};

const main = async () => {
  const username = getArg('username');
  const password = getArg('password');

  if (!username || !password) {
    throw new Error('Uso: npm run create:admin -- --username admin --password 123456');
  }

  const usuarioNormalizado = normalizeUsername(username);
  const passwordHash = await bcrypt.hash(password, getBcryptRounds());
  const now = new Date().toISOString();

  const credentialSnapshot = await adminDb
    .collection('user_credentials')
    .where('usuario_normalizado', '==', usuarioNormalizado)
    .limit(1)
    .get();

  if (!credentialSnapshot.empty) {
    const credentialDoc = credentialSnapshot.docs[0];
    const uid = String(credentialDoc.data().uid || credentialDoc.id);

    await ensureAuthUser(uid, 'Administrador');
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
        id: uid,
        nombre: 'Administrador',
        usuario: username,
        usuario_normalizado: usuarioNormalizado,
        rol: 'Administrador',
        estado: 'Activo',
        requiere_cambio_password: true,
        fecha_creacion: now,
      },
      { merge: true },
    );

    console.log(`Admin actualizado: ${usuarioNormalizado}`);
    return;
  }

  const uid = adminDb.collection('users').doc().id;
  await ensureAuthUser(uid, 'Administrador');

  await adminDb.collection('users').doc(uid).set({
    id: uid,
    nombre: 'Administrador',
    correo: '',
    usuario: username,
    usuario_normalizado: usuarioNormalizado,
    rol: 'Administrador',
    estado: 'Activo',
    requiere_cambio_password: true,
    fecha_creacion: now,
  });

  await adminDb.collection('user_credentials').doc(uid).set({
    uid,
    usuario_normalizado: usuarioNormalizado,
    password_hash: passwordHash,
    created_at: now,
    updated_at: now,
  });

  console.log(`Admin creado: ${usuarioNormalizado}`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
