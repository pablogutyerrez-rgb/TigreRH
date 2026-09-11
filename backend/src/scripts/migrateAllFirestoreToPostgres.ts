import 'dotenv/config';
import { FieldPath, type CollectionReference } from 'firebase-admin/firestore';
import { adminDb } from '../firestoreMigrationAdmin.js';
import { ensureHybridSchema } from '../hybridDb.js';
import { closePostgresPool, getPostgresPool } from '../postgres.js';
import {
  encodeFirestoreRuntimeValue,
  encodeFirestoreSourceValue,
  hashFirestoreSourceValue,
} from '../utils/firestoreValueCodec.js';

const DEFAULT_PAGE_SIZE = 250;
const SEEDED_COLLECTIONS = new Set([
  'users',
  'user_credentials',
  'sessions',
  'participants',
  'attendance',
]);
const SEEDED_TABLES = new Map([
  ['users', 'users'],
  ['user_credentials', 'user_credentials'],
  ['sessions', 'sessions'],
  ['participants', 'participants'],
  ['attendance', 'attendance'],
]);

type MigrationCounters = {
  read: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
};

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const pageSizeArg = process.argv.find((value) => value.startsWith('--page-size='));
const requestedPageSize = Number(pageSizeArg?.split('=')[1] || DEFAULT_PAGE_SIZE);
const pageSize = Number.isFinite(requestedPageSize)
  ? Math.min(500, Math.max(10, Math.trunc(requestedPageSize)))
  : DEFAULT_PAGE_SIZE;

const ensureMigrationSchema = async () => {
  await ensureHybridSchema();
  await getPostgresPool().query(`
    CREATE TABLE IF NOT EXISTS tigre_rh.firestore_migration_state (
      collection_name TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      last_document_id TEXT,
      read_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      last_error TEXT
    )
  `);
  await getPostgresPool().query(`
    CREATE INDEX IF NOT EXISTS current_documents_relation_session_idx
    ON tigre_rh.current_documents (collection_name, (payload->>'training_session_id'))
  `);
  await getPostgresPool().query(`
    CREATE INDEX IF NOT EXISTS current_documents_relation_participant_idx
    ON tigre_rh.current_documents (collection_name, (payload->>'participant_id'))
  `);
  await getPostgresPool().query(`
    CREATE INDEX IF NOT EXISTS current_documents_relation_survey_idx
    ON tigre_rh.current_documents (collection_name, (payload->>'training_survey_id'))
  `);
  await getPostgresPool().query(`
    CREATE INDEX IF NOT EXISTS current_documents_relation_requisition_idx
    ON tigre_rh.current_documents (collection_name, (payload->>'requisition_id'))
  `);
};

const markSeededCollectionsComplete = async () => {
  for (const collectionName of SEEDED_COLLECTIONS) {
    const tableName = SEEDED_TABLES.get(collectionName)!;
    const table = await getPostgresPool().query(
      'SELECT to_regclass($1) AS name',
      [`tigre_rh.${tableName}`],
    );
    if (!table.rows[0].name) continue;
    const sourceCount = await getPostgresPool().query(
      `SELECT COUNT(*)::int AS count FROM tigre_rh.${tableName}`,
    );
    const currentCount = await getPostgresPool().query(
      `SELECT COUNT(*)::int AS count
       FROM tigre_rh.current_documents
       WHERE collection_name = $1 AND is_deleted = FALSE`,
      [collectionName],
    );
    const source = Number(sourceCount.rows[0].count);
    const current = Number(currentCount.rows[0].count);
    if (source === 0 || current < source) continue;
    await getPostgresPool().query(
      `INSERT INTO tigre_rh.firestore_migration_state (
         collection_name, status, read_count, inserted_count, skipped_count,
         started_at, updated_at, completed_at
       ) VALUES ($1, 'complete', 0, 0, $2, NOW(), NOW(), NOW())
       ON CONFLICT (collection_name) DO NOTHING`,
      [collectionName, current],
    );
    console.log(`${collectionName}: transferencia normalizada previa verificada (${current}).`);
  }
};

const getState = async (collectionName: string) => {
  const result = await getPostgresPool().query(
    `SELECT * FROM tigre_rh.firestore_migration_state WHERE collection_name = $1`,
    [collectionName],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
};

const migratePage = async (
  collectionName: string,
  documents: Array<{
    id: string;
    path: string;
    payload: unknown;
    sourcePayload: unknown;
    sourceHash: string;
    createTime: string | null;
    updateTime: string | null;
  }>,
  counters: MigrationCounters,
) => {
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    const ids = documents.map((document) => document.id);
    const existing = ids.length
      ? await client.query(
        `SELECT document_id, source_hash FROM tigre_rh.current_documents
         WHERE collection_name = $1 AND document_id = ANY($2::text[])`,
        [collectionName, ids],
      )
      : { rows: [] };
    const existingHashes = new Map(
      existing.rows.map((row: { document_id: string; source_hash: string | null }) => [
        row.document_id,
        row.source_hash,
      ]),
    );
    const changedDocuments = documents.filter(
      (document) => existingHashes.get(document.id) !== document.sourceHash,
    );
    const inserted = changedDocuments.filter(
      (document) => !existingHashes.has(document.id),
    ).length;
    const updated = changedDocuments.length - inserted;
    const skipped = documents.length - changedDocuments.length;

    if (changedDocuments.length) await client.query(
      `INSERT INTO tigre_rh.current_documents (
         collection_name, document_id, document_path, payload, source_payload,
         source_create_time, source_update_time, source_hash, is_deleted,
         created_at, updated_at
       )
       SELECT $1, row.document_id, row.document_path, row.payload,
         row.source_payload, row.source_create_time, row.source_update_time,
         row.source_hash, FALSE, NOW(), NOW()
       FROM jsonb_to_recordset($2::jsonb) AS row(
         document_id TEXT,
         document_path TEXT,
         payload JSONB,
         source_payload JSONB,
         source_create_time TIMESTAMPTZ,
         source_update_time TIMESTAMPTZ,
         source_hash TEXT
       )
       ON CONFLICT (collection_name, document_id) DO UPDATE SET
         document_path = EXCLUDED.document_path,
         payload = EXCLUDED.payload,
         source_payload = EXCLUDED.source_payload,
         source_create_time = EXCLUDED.source_create_time,
         source_update_time = EXCLUDED.source_update_time,
         source_hash = EXCLUDED.source_hash,
         is_deleted = FALSE,
         updated_at = NOW()`,
      [
        collectionName,
        JSON.stringify(changedDocuments.map((document) => ({
          document_id: document.id,
          document_path: document.path,
          payload: document.payload,
          source_payload: document.sourcePayload,
          source_create_time: document.createTime,
          source_update_time: document.updateTime,
          source_hash: document.sourceHash,
        }))),
      ],
    );

    counters.read += documents.length;
    counters.inserted += inserted;
    counters.updated += updated;
    counters.skipped += skipped;
    const lastDocumentId = documents.at(-1)?.id || null;
    await client.query(
      `INSERT INTO tigre_rh.firestore_migration_state (
         collection_name, status, last_document_id, read_count, inserted_count,
         updated_count, skipped_count, error_count, started_at, updated_at,
         completed_at, last_error
       ) VALUES ($1, 'running', $2, $3, $4, $5, $6, $7, NOW(), NOW(), NULL, NULL)
       ON CONFLICT (collection_name) DO UPDATE SET
         status = 'running',
         last_document_id = EXCLUDED.last_document_id,
         read_count = EXCLUDED.read_count,
         inserted_count = EXCLUDED.inserted_count,
         updated_count = EXCLUDED.updated_count,
         skipped_count = EXCLUDED.skipped_count,
         error_count = EXCLUDED.error_count,
         started_at = COALESCE(tigre_rh.firestore_migration_state.started_at, NOW()),
         updated_at = NOW(),
         completed_at = NULL,
         last_error = NULL`,
      [
        collectionName,
        lastDocumentId,
        counters.read,
        counters.inserted,
        counters.updated,
        counters.skipped,
        counters.errors,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const migrateCollection = async (collection: CollectionReference) => {
  const collectionName = collection.path;
  const state = await getState(collectionName);
  const counters: MigrationCounters = {
    read: Number(state?.read_count || 0),
    inserted: Number(state?.inserted_count || 0),
    updated: Number(state?.updated_count || 0),
    skipped: Number(state?.skipped_count || 0),
    errors: Number(state?.error_count || 0),
  };

  if (state?.status === 'complete') {
    console.log(`${collectionName}: ya completada; omitidos ${state.skipped_count || state.read_count || 0}`);
    return counters;
  }

  await getPostgresPool().query(
    `INSERT INTO tigre_rh.firestore_migration_state (
       collection_name, status, started_at, updated_at
     ) VALUES ($1, 'running', NOW(), NOW())
     ON CONFLICT (collection_name) DO UPDATE SET
       status = 'running',
       started_at = COALESCE(tigre_rh.firestore_migration_state.started_at, NOW()),
       updated_at = NOW(),
       completed_at = NULL,
       last_error = NULL`,
    [collectionName],
  );

  let lastDocumentId = typeof state?.last_document_id === 'string'
    ? state.last_document_id
    : undefined;

  while (true) {
    let query = collection.orderBy(FieldPath.documentId()).limit(pageSize);
    if (lastDocumentId) query = query.startAfter(lastDocumentId);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    const documents = snapshot.docs.map((document) => {
      const sourcePayload = encodeFirestoreSourceValue(document.data());
      return {
        id: document.id,
        path: document.ref.path,
        payload: encodeFirestoreRuntimeValue(document.data()),
        sourcePayload,
        sourceHash: hashFirestoreSourceValue(sourcePayload),
        createTime: document.createTime?.toDate().toISOString() || null,
        updateTime: document.updateTime?.toDate().toISOString() || null,
      };
    });
    await migratePage(collectionName, documents, counters);
    lastDocumentId = documents.at(-1)?.id;
    console.log(
      `${collectionName}: leidos ${counters.read}, insertados ${counters.inserted}, actualizados ${counters.updated}`,
    );
    if (snapshot.size < pageSize) break;
  }

  const postgresCount = await getPostgresPool().query(
    `SELECT COUNT(*)::int AS count FROM tigre_rh.current_documents
     WHERE collection_name = $1 AND is_deleted = FALSE`,
    [collectionName],
  );
  if (Number(postgresCount.rows[0].count) < counters.read) {
    throw new Error(`Conteo PostgreSQL invalido para ${collectionName}.`);
  }
  await getPostgresPool().query(
    `UPDATE tigre_rh.firestore_migration_state SET
       status = 'complete', updated_at = NOW(), completed_at = NOW(), last_error = NULL
     WHERE collection_name = $1`,
    [collectionName],
  );
  console.log(
    `${collectionName}: completada; leidos=${counters.read}, insertados=${counters.inserted}, actualizados=${counters.updated}, omitidos=${counters.skipped}, errores=${counters.errors}`,
  );
  return counters;
};

const recordFailure = async (collectionName: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  await getPostgresPool().query(
    `INSERT INTO tigre_rh.firestore_migration_state (
       collection_name, status, error_count, started_at, updated_at, last_error
     ) VALUES ($1, 'failed', 1, NOW(), NOW(), $2)
     ON CONFLICT (collection_name) DO UPDATE SET
       status = 'failed',
       error_count = tigre_rh.firestore_migration_state.error_count + 1,
       updated_at = NOW(),
       last_error = EXCLUDED.last_error`,
    [collectionName, message.slice(0, 4000)],
  );
};

const migrate = async () => {
  await ensureMigrationSchema();
  await markSeededCollectionsComplete();

  const collections = (await adminDb.listCollections())
    .sort((left, right) => left.id.localeCompare(right.id));
  console.log(`Colecciones raiz detectadas: ${collections.map((item) => item.id).join(', ')}`);

  const pending = collections;
  console.log(`Colecciones por revisar/migrar: ${pending.map((item) => item.id).join(', ') || 'ninguna'}`);
  if (!apply) {
    console.log('Inventario completado sin leer documentos. Usa --apply para migrar.');
    return;
  }

  for (const collection of pending) {
    try {
      await migrateCollection(collection);
    } catch (error) {
      await recordFailure(collection.path, error);
      throw error;
    }
  }
  console.log('Migracion completa de Firestore finalizada correctamente.');
};

migrate()
  .then(() => closePostgresPool())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await closePostgresPool().catch(() => undefined);
    process.exitCode = 1;
  });
