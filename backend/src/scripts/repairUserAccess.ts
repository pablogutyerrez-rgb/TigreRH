import { adminAuth } from '../firebaseAdmin.js';
import { dataDb as adminDb } from '../hybridDb.js';
import { normalizeUsername } from '../utils/normalizeUsername.js';

const getAuthErrorCode = (error: unknown) => (error as { code?: string })?.code;

const ensureAuthUser = async (uid: string, displayName: string, disabled: boolean) => {
  try {
    await adminAuth.createUser({
      uid,
      displayName,
      disabled,
    });
    return 'created';
  } catch (error) {
    if (getAuthErrorCode(error) !== 'auth/uid-already-exists') {
      throw error;
    }

    await adminAuth.updateUser(uid, {
      displayName,
      disabled,
    });
    return 'updated';
  }
};

const main = async () => {
  const users = await adminDb.collection('users').get();
  let normalizedProfiles = 0;
  let repairedCredentials = 0;
  let authCreated = 0;
  let authUpdated = 0;
  let missingPasswordHash = 0;

  for (const userDoc of users.docs) {
    const profile = userDoc.data();
    const usuario = String(profile.usuario || '').trim();
    if (!usuario) {
      console.warn(`users/${userDoc.id}: omitido porque no tiene usuario.`);
      continue;
    }

    const usuarioNormalizado = normalizeUsername(
      String(profile.usuario_normalizado || usuario),
    );

    if (profile.usuario_normalizado !== usuarioNormalizado) {
      await userDoc.ref.set(
        {
          usuario_normalizado: usuarioNormalizado,
        },
        { merge: true },
      );
      normalizedProfiles += 1;
    }

    const authResult = await ensureAuthUser(
      userDoc.id,
      String(profile.nombre || usuario),
      profile.estado !== 'Activo',
    );
    if (authResult === 'created') authCreated += 1;
    if (authResult === 'updated') authUpdated += 1;

    const credentialRef = adminDb.collection('user_credentials').doc(userDoc.id);
    const credentialDoc = await credentialRef.get();
    if (!credentialDoc.exists) {
      missingPasswordHash += 1;
      continue;
    }

    const credential = credentialDoc.data() || {};
    if (!credential.password_hash) {
      missingPasswordHash += 1;
    }

    if (credential.usuario_normalizado !== usuarioNormalizado || credential.uid !== userDoc.id) {
      await credentialRef.set(
        {
          uid: userDoc.id,
          usuario_normalizado: usuarioNormalizado,
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );
      repairedCredentials += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        users: users.size,
        normalizedProfiles,
        repairedCredentials,
        authCreated,
        authUpdated,
        usersRequiringPasswordReset: missingPasswordHash,
      },
      null,
      2,
    ),
  );
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
