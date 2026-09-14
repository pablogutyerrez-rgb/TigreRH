import { randomUUID } from 'node:crypto';
import { getPostgresPool } from './postgres.js';

type Data = Record<string, any>;
type QueryClient = { query: (text: string, values?: unknown[]) => Promise<any> };
type Filter = { field: string; operator: '=='; value: unknown };
type Ordering = { field: string; direction: 'asc' | 'desc' };

export const DELETE_FIELD = Symbol('postgres-delete-field');

let schemaReady: Promise<void> | undefined;
const collectionRevisions = new Map<string, number>();

export const getCollectionRevision = (collectionName: string) =>
  collectionRevisions.get(collectionName) || 0;

const markCollectionChanged = (collectionName: string) => {
  collectionRevisions.set(collectionName, getCollectionRevision(collectionName) + 1);
};

export const ensureHybridSchema = async () => {
  if (!schemaReady) {
    schemaReady = (async () => {
      const pool = getPostgresPool();
      await pool.query('CREATE SCHEMA IF NOT EXISTS tigre_rh');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tigre_rh.current_documents (
          collection_name TEXT NOT NULL,
          document_id TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          source_payload JSONB,
          document_path TEXT,
          source_create_time TIMESTAMPTZ,
          source_update_time TIMESTAMPTZ,
          source_hash TEXT,
          is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (collection_name, document_id)
        )
      `);
      await pool.query(`
        ALTER TABLE tigre_rh.current_documents
          ADD COLUMN IF NOT EXISTS source_payload JSONB,
          ADD COLUMN IF NOT EXISTS document_path TEXT,
          ADD COLUMN IF NOT EXISTS source_create_time TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS source_update_time TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS source_hash TEXT
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS current_documents_collection_updated_idx
        ON tigre_rh.current_documents (collection_name, updated_at DESC)
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS current_documents_path_idx
        ON tigre_rh.current_documents (document_path)
        WHERE document_path IS NOT NULL
      `);
      await pool.query(`
        UPDATE tigre_rh.current_documents
        SET
          document_path = COALESCE(document_path, collection_name || '/' || document_id),
          source_payload = COALESCE(source_payload, payload)
        WHERE document_path IS NULL OR source_payload IS NULL
      `);
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
};

const isDeleteSentinel = (value: unknown) => Boolean(
  value === DELETE_FIELD ||
  (
  value &&
  typeof value === 'object' &&
  (
    String((value as { _methodName?: string })._methodName || '')
      .toLowerCase()
      .includes('delete') ||
    value.constructor?.name === 'DeleteTransform'
  )),
);

const cleanData = (value: Data, current: Data = {}, merge = false) => {
  const result: Data = merge ? { ...current } : {};
  Object.entries(value).forEach(([key, entry]) => {
    if (entry === undefined) return;
    if (isDeleteSentinel(entry)) {
      delete result[key];
      return;
    }
    result[key] = entry;
  });
  return result;
};

const readCurrentRow = async (
  client: QueryClient,
  collectionName: string,
  documentId: string,
  lock = false,
) => {
  await ensureHybridSchema();
  const result = await client.query(
    `SELECT payload, is_deleted
     FROM tigre_rh.current_documents
     WHERE collection_name = $1 AND document_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [collectionName, documentId],
  );
  return result.rows[0] as { payload: Data; is_deleted: boolean } | undefined;
};

const readDocumentData = async (
  collectionName: string,
  documentId: string,
  client: QueryClient = getPostgresPool(),
  lock = false,
) => {
  const current = await readCurrentRow(client, collectionName, documentId, lock);
  return current && !current.is_deleted ? current.payload : undefined;
};

const writeDocumentData = async (
  collectionName: string,
  documentId: string,
  data: Data,
  merge: boolean,
  client?: QueryClient,
): Promise<Data> => {
  await ensureHybridSchema();
  if (merge && !client) {
    const transactionClient = await getPostgresPool().connect();
    try {
      await transactionClient.query('BEGIN');
      const payload: Data = await writeDocumentData(
        collectionName,
        documentId,
        data,
        true,
        transactionClient,
      );
      await transactionClient.query('COMMIT');
      return payload;
    } catch (error) {
      await transactionClient.query('ROLLBACK');
      throw error;
    } finally {
      transactionClient.release();
    }
  }
  const queryClient = client || getPostgresPool();
  const current = merge
    ? await readDocumentData(collectionName, documentId, queryClient, true)
    : undefined;
  const payload = cleanData(data, current, merge);
  await queryClient.query(
    `INSERT INTO tigre_rh.current_documents (
       collection_name, document_id, document_path, payload, source_payload,
       is_deleted, created_at, updated_at
     ) VALUES ($1, $2, $3, $4::jsonb, $4::jsonb, FALSE, NOW(), NOW())
     ON CONFLICT (collection_name, document_id) DO UPDATE SET
       payload = EXCLUDED.payload,
       source_payload = EXCLUDED.source_payload,
       document_path = EXCLUDED.document_path,
       source_hash = NULL,
       is_deleted = FALSE,
       updated_at = NOW()`,
    [collectionName, documentId, `${collectionName}/${documentId}`, JSON.stringify(payload)],
  );
  markCollectionChanged(collectionName);
  return payload;
};

const deleteDocumentData = async (
  collectionName: string,
  documentId: string,
  client: QueryClient = getPostgresPool(),
) => {
  await ensureHybridSchema();
  await client.query(
    `INSERT INTO tigre_rh.current_documents (
       collection_name, document_id, document_path, payload, source_payload,
       source_hash, is_deleted, created_at, updated_at
     ) VALUES ($1, $2, $3, '{}'::jsonb, '{}'::jsonb, NULL, TRUE, NOW(), NOW())
     ON CONFLICT (collection_name, document_id) DO UPDATE SET
       payload = '{}'::jsonb,
       source_payload = '{}'::jsonb,
       source_hash = NULL,
       is_deleted = TRUE,
       updated_at = NOW()`,
    [collectionName, documentId, `${collectionName}/${documentId}`],
  );
  markCollectionChanged(collectionName);
};

const listDocumentData = async (collectionName: string) => {
  await ensureHybridSchema();
  const current = await getPostgresPool().query(
    `SELECT document_id, payload, is_deleted
     FROM tigre_rh.current_documents
     WHERE collection_name = $1`,
    [collectionName],
  );
  const merged = new Map<string, Data>();
  current.rows.forEach((row: { document_id: string; payload: Data; is_deleted: boolean }) => {
    if (row.is_deleted) merged.delete(row.document_id);
    else merged.set(row.document_id, row.payload);
  });
  return merged;
};

class HybridDocumentSnapshot {
  constructor(
    public readonly ref: HybridDocumentReference,
    private readonly value?: Data,
  ) {}

  get id() { return this.ref.id; }
  get exists() { return this.value !== undefined; }
  data(): Data { return this.value || {}; }
}

class HybridQuerySnapshot {
  constructor(public readonly docs: HybridDocumentSnapshot[]) {}
  get empty() { return this.docs.length === 0; }
  get size() { return this.docs.length; }
}

class HybridDocumentReference {
  constructor(
    public readonly collectionName: string,
    public readonly id: string,
  ) {}

  async get() {
    return new HybridDocumentSnapshot(
      this,
      await readDocumentData(this.collectionName, this.id),
    );
  }

  async set(data: Data, options?: { merge?: boolean }) {
    await writeDocumentData(this.collectionName, this.id, data, Boolean(options?.merge));
  }

  async create(data: Data) {
    await ensureHybridSchema();
    const payload = cleanData(data);
    const result = await getPostgresPool().query(
      `INSERT INTO tigre_rh.current_documents (
         collection_name, document_id, document_path, payload, source_payload,
         is_deleted, created_at, updated_at
       ) VALUES ($1, $2, $3, $4::jsonb, $4::jsonb, FALSE, NOW(), NOW())
       ON CONFLICT (collection_name, document_id) DO UPDATE SET
         document_path = EXCLUDED.document_path,
         payload = EXCLUDED.payload,
         source_payload = EXCLUDED.source_payload,
         source_hash = NULL,
         is_deleted = FALSE,
         updated_at = NOW()
       WHERE tigre_rh.current_documents.is_deleted = TRUE
       RETURNING document_id`,
      [this.collectionName, this.id, `${this.collectionName}/${this.id}`, JSON.stringify(payload)],
    );
    if (!result.rowCount) {
      const error = new Error('Document already exists.') as Error & { code?: number };
      error.code = 6;
      throw error;
    }
    markCollectionChanged(this.collectionName);
  }

  async delete() {
    await deleteDocumentData(this.collectionName, this.id);
  }
}

class HybridQuery {
  constructor(
    protected readonly collectionName: string,
    protected readonly filters: Filter[] = [],
    protected readonly ordering?: Ordering,
    protected readonly maximum?: number,
  ) {}

  where(field: string, operator: '==', value: unknown) {
    if (operator !== '==') throw new Error(`Unsupported hybrid query operator: ${operator}`);
    return new HybridQuery(
      this.collectionName,
      [...this.filters, { field, operator, value }],
      this.ordering,
      this.maximum,
    );
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    return new HybridQuery(
      this.collectionName,
      this.filters,
      { field, direction },
      this.maximum,
    );
  }

  limit(maximum: number) {
    return new HybridQuery(
      this.collectionName,
      this.filters,
      this.ordering,
      maximum,
    );
  }

  async get() {
    const documents = await listDocumentData(this.collectionName);
    let entries = Array.from(documents.entries()).filter(([, data]) =>
      this.filters.every((filter) => data[filter.field] === filter.value),
    );
    if (this.ordering) {
      const { field, direction } = this.ordering;
      entries.sort(([, left], [, right]) => {
        const comparison = String(left[field] ?? '').localeCompare(String(right[field] ?? ''));
        return direction === 'desc' ? -comparison : comparison;
      });
    }
    if (this.maximum !== undefined) entries = entries.slice(0, this.maximum);
    return new HybridQuerySnapshot(
      entries.map(([id, data]) =>
        new HybridDocumentSnapshot(new HybridDocumentReference(this.collectionName, id), data)),
    );
  }
}

class HybridCollectionReference extends HybridQuery {
  doc(id: string = randomUUID()) {
    return new HybridDocumentReference(this.collectionName, id);
  }

  async add(data: Data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

type BulkOperation =
  | { kind: 'set'; ref: HybridDocumentReference; data: Data; merge: boolean }
  | { kind: 'delete'; ref: HybridDocumentReference };

const BULK_WRITE_BATCH_SIZE = 1000;

const writeDocumentBatch = async (
  client: QueryClient,
  operations: Array<Extract<BulkOperation, { kind: 'set' }>>,
) => {
  if (operations.length === 0) return;
  await ensureHybridSchema();
  const uniqueRows = new Map<string, {
    collection_name: string;
    document_id: string;
    payload: Data;
  }>();
  operations.forEach(({ ref, data }) => {
    uniqueRows.set(`${ref.collectionName}\u0000${ref.id}`, {
      collection_name: ref.collectionName,
      document_id: ref.id,
      payload: cleanData(data),
    });
  });
  const rows = [...uniqueRows.values()];
  await client.query(
    `WITH input AS (
       SELECT collection_name, document_id, payload
       FROM jsonb_to_recordset($1::jsonb)
         AS item(collection_name TEXT, document_id TEXT, payload JSONB)
     )
     INSERT INTO tigre_rh.current_documents (
       collection_name, document_id, document_path, payload, source_payload,
       is_deleted, created_at, updated_at
     )
     SELECT
       collection_name, document_id, collection_name || '/' || document_id,
       payload, payload, FALSE, NOW(), NOW()
     FROM input
     ON CONFLICT (collection_name, document_id) DO UPDATE SET
       payload = EXCLUDED.payload,
       source_payload = EXCLUDED.source_payload,
       document_path = EXCLUDED.document_path,
       source_hash = NULL,
       is_deleted = FALSE,
       updated_at = NOW()`,
    [JSON.stringify(rows)],
  );
  new Set(operations.map(({ ref }) => ref.collectionName)).forEach(markCollectionChanged);
};

class HybridBulkWriter {
  private readonly operations: BulkOperation[] = [];

  set(ref: HybridDocumentReference, data: Data, options?: { merge?: boolean }) {
    this.operations.push({ kind: 'set', ref, data, merge: Boolean(options?.merge) });
  }

  delete(ref: HybridDocumentReference) {
    this.operations.push({ kind: 'delete', ref });
  }

  async close() {
    const client = await getPostgresPool().connect();
    try {
      await client.query('BEGIN');
      for (let index = 0; index < this.operations.length;) {
        const operation = this.operations[index];
        if (operation.kind === 'set' && !operation.merge) {
          const batch: Array<Extract<BulkOperation, { kind: 'set' }>> = [];
          while (index < this.operations.length && batch.length < BULK_WRITE_BATCH_SIZE) {
            const candidate = this.operations[index];
            if (candidate.kind !== 'set' || candidate.merge) break;
            batch.push(candidate);
            index += 1;
          }
          await writeDocumentBatch(client, batch);
          continue;
        }
        if (operation.kind === 'set') {
          await writeDocumentData(
            operation.ref.collectionName,
            operation.ref.id,
            operation.data,
            true,
            client,
          );
        } else {
          await deleteDocumentData(operation.ref.collectionName, operation.ref.id, client);
        }
        index += 1;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

class HybridTransaction {
  private readonly operations: Array<() => Promise<void>> = [];

  constructor(private readonly client: QueryClient) {}

  async get(ref: HybridDocumentReference) {
    await this.client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [ref.collectionName, ref.id],
    );
    return new HybridDocumentSnapshot(
      ref,
      await readDocumentData(ref.collectionName, ref.id, this.client, true),
    );
  }

  set(ref: HybridDocumentReference, data: Data, options?: { merge?: boolean }) {
    this.operations.push(async () => {
      await writeDocumentData(
        ref.collectionName,
        ref.id,
        data,
        Boolean(options?.merge),
        this.client,
      );
    });
    return this;
  }

  delete(ref: HybridDocumentReference) {
    this.operations.push(async () => {
      await deleteDocumentData(ref.collectionName, ref.id, this.client);
    });
    return this;
  }

  async flush() {
    for (const operation of this.operations) await operation();
  }
}

class HybridDatabase {
  collection(name: string) {
    return new HybridCollectionReference(name);
  }

  bulkWriter() {
    return new HybridBulkWriter();
  }

  async runTransaction<T>(callback: (transaction: HybridTransaction) => Promise<T>) {
    const client = await getPostgresPool().connect();
    try {
      await client.query('BEGIN');
      const transaction = new HybridTransaction(client);
      const result = await callback(transaction);
      await transaction.flush();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export const dataDb = new HybridDatabase();
