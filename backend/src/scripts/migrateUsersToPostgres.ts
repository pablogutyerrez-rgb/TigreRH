import 'dotenv/config';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firestoreMigrationAdmin.js';
import { closePostgresPool, getPostgresPool } from '../postgres.js';
import { normalizeUsername } from '../utils/normalizeUsername.js';

type SourceDocument = {
  id: string;
  data: DocumentData;
};

type MigratedUser = SourceDocument & {
  usuarioNormalizado: string | null;
};

type MigratedCredential = SourceDocument & {
  uid: string;
  usuarioNormalizado: string;
  passwordHash: string;
};

const apply = process.argv.includes('--apply');

const toSourceDocument = (doc: QueryDocumentSnapshot): SourceDocument => ({
  id: doc.id,
  data: doc.data(),
});

const toJson = (value: unknown) => JSON.stringify(value ?? {});

const toDateValue = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === 'function') return candidate.toDate().toISOString();
  }
  return null;
};

const prepareUsers = (documents: SourceDocument[]) => documents.map((document) => {
  const username = String(
    document.data.usuario_normalizado || document.data.usuario || '',
  ).trim();
  return {
    ...document,
    usuarioNormalizado: username ? normalizeUsername(username) : null,
  } satisfies MigratedUser;
});

const assertUniqueUsernames = (users: MigratedUser[]) => {
  const ownerByUsername = new Map<string, string>();
  for (const user of users) {
    if (!user.usuarioNormalizado) continue;
    const owner = ownerByUsername.get(user.usuarioNormalizado);
    if (owner && owner !== user.id) {
      throw new Error(
        `Usuario normalizado duplicado: ${user.usuarioNormalizado} (${owner}, ${user.id}).`,
      );
    }
    ownerByUsername.set(user.usuarioNormalizado, user.id);
  }
};

const prepareCredentials = (
  documents: SourceDocument[],
  users: MigratedUser[],
) => {
  const userIds = new Set(users.map((user) => user.id));
  const userIdByUsername = new Map(
    users
      .filter((user) => user.usuarioNormalizado)
      .map((user) => [user.usuarioNormalizado!, user.id]),
  );
  const migrated: MigratedCredential[] = [];
  const skipped: string[] = [];

  for (const document of documents) {
    const rawUsername = String(document.data.usuario_normalizado || '').trim();
    const usuarioNormalizado = rawUsername ? normalizeUsername(rawUsername) : '';
    const storedUid = String(document.data.uid || document.id).trim();
    const uid = userIds.has(storedUid)
      ? storedUid
      : userIdByUsername.get(usuarioNormalizado);
    const passwordHash = String(document.data.password_hash || '');

    if (!uid || !usuarioNormalizado || !passwordHash) {
      skipped.push(document.id);
      continue;
    }
    migrated.push({ ...document, uid, usuarioNormalizado, passwordHash });
  }

  const ownerByUsername = new Map<string, string>();
  for (const credential of migrated) {
    const owner = ownerByUsername.get(credential.usuarioNormalizado);
    if (owner && owner !== credential.uid) {
      throw new Error(
        `Credencial duplicada: ${credential.usuarioNormalizado} (${owner}, ${credential.uid}).`,
      );
    }
    ownerByUsername.set(credential.usuarioNormalizado, credential.uid);
  }

  return { migrated, skipped };
};

const createSchema = async (client: any) => {
  await client.query('CREATE SCHEMA IF NOT EXISTS tigre_rh');
  await client.query(`
    CREATE TABLE IF NOT EXISTS tigre_rh.users (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL DEFAULT '',
      correo TEXT NOT NULL DEFAULT '',
      usuario TEXT NOT NULL DEFAULT '',
      usuario_normalizado TEXT UNIQUE,
      rol TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT '',
      areas JSONB NOT NULL DEFAULT '[]'::jsonb,
      module_access JSONB NOT NULL DEFAULT '[]'::jsonb,
      requiere_cambio_password BOOLEAN NOT NULL DEFAULT FALSE,
      fecha_creacion TIMESTAMPTZ,
      creado_por TEXT,
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS tigre_rh.user_credentials (
      uid TEXT PRIMARY KEY REFERENCES tigre_rh.users(id) ON DELETE CASCADE,
      usuario_normalizado TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(
    'CREATE INDEX IF NOT EXISTS users_role_status_idx ON tigre_rh.users (rol, estado)',
  );
};

const migrate = async () => {
  const [usersSnapshot, credentialsSnapshot] = await Promise.all([
    adminDb.collection('users').get(),
    adminDb.collection('user_credentials').get(),
  ]);
  const users = prepareUsers(usersSnapshot.docs.map(toSourceDocument));
  assertUniqueUsernames(users);
  const credentials = prepareCredentials(
    credentialsSnapshot.docs.map(toSourceDocument),
    users,
  );

  console.log(`Firestore users: ${users.length}`);
  console.log(`Firestore credentials: ${credentialsSnapshot.size}`);
  console.log(`Credenciales transferibles: ${credentials.migrated.length}`);
  console.log(`Credenciales omitidas por datos incompletos: ${credentials.skipped.length}`);

  const pool = getPostgresPool();
  const connectivity = await pool.query(
    'SELECT current_database() AS database, current_user AS username',
  );
  console.log(`PostgreSQL: ${connectivity.rows[0].database} (${connectivity.rows[0].username})`);

  if (!apply) {
    console.log('Validacion completada. Ejecuta nuevamente con --apply para transferir.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await createSchema(client);

    for (const user of users) {
      const data = user.data;
      await client.query(
        `INSERT INTO tigre_rh.users (
          id, nombre, correo, usuario, usuario_normalizado, rol, estado,
          areas, module_access, requiere_cambio_password, fecha_creacion,
          creado_por, source_payload, migrated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb,NOW())
        ON CONFLICT (id) DO UPDATE SET
          nombre = EXCLUDED.nombre,
          correo = EXCLUDED.correo,
          usuario = EXCLUDED.usuario,
          usuario_normalizado = EXCLUDED.usuario_normalizado,
          rol = EXCLUDED.rol,
          estado = EXCLUDED.estado,
          areas = EXCLUDED.areas,
          module_access = EXCLUDED.module_access,
          requiere_cambio_password = EXCLUDED.requiere_cambio_password,
          fecha_creacion = EXCLUDED.fecha_creacion,
          creado_por = EXCLUDED.creado_por,
          source_payload = EXCLUDED.source_payload,
          migrated_at = NOW()`,
        [
          user.id,
          String(data.nombre || ''),
          String(data.correo || ''),
          String(data.usuario || ''),
          user.usuarioNormalizado,
          String(data.rol || ''),
          String(data.estado || ''),
          toJson(Array.isArray(data.areas) ? data.areas : []),
          toJson(Array.isArray(data.module_access) ? data.module_access : []),
          Boolean(data.requiere_cambio_password),
          toDateValue(data.fecha_creacion),
          data.creado_por ? String(data.creado_por) : null,
          toJson(data),
        ],
      );
    }

    for (const credential of credentials.migrated) {
      const data = credential.data;
      await client.query(
        `INSERT INTO tigre_rh.user_credentials (
          uid, usuario_normalizado, password_hash, created_at, updated_at,
          source_payload, migrated_at
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())
        ON CONFLICT (uid) DO UPDATE SET
          usuario_normalizado = EXCLUDED.usuario_normalizado,
          password_hash = EXCLUDED.password_hash,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          source_payload = EXCLUDED.source_payload,
          migrated_at = NOW()`,
        [
          credential.uid,
          credential.usuarioNormalizado,
          credential.passwordHash,
          toDateValue(data.created_at),
          toDateValue(data.updated_at),
          toJson(data),
        ],
      );
    }

    const userCount = await client.query('SELECT COUNT(*)::int AS count FROM tigre_rh.users');
    const credentialCount = await client.query(
      'SELECT COUNT(*)::int AS count FROM tigre_rh.user_credentials',
    );
    if (userCount.rows[0].count < users.length) {
      throw new Error('La cantidad de usuarios en PostgreSQL no coincide con la migracion.');
    }
    if (credentialCount.rows[0].count < credentials.migrated.length) {
      throw new Error('La cantidad de credenciales en PostgreSQL no coincide con la migracion.');
    }

    await client.query('COMMIT');
    console.log(`PostgreSQL users: ${userCount.rows[0].count}`);
    console.log(`PostgreSQL credentials: ${credentialCount.rows[0].count}`);
    console.log('Transferencia de usuarios completada correctamente.');
    if (credentials.skipped.length) {
      console.warn(`Revisar credenciales omitidas: ${credentials.skipped.join(', ')}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

migrate()
  .then(() => closePostgresPool())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await closePostgresPool().catch(() => undefined);
    process.exitCode = 1;
  });
