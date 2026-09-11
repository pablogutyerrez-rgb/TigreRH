import 'dotenv/config';
import { ensureHybridSchema } from '../hybridDb.js';
import { closePostgresPool, getPostgresPool } from '../postgres.js';

const TABLES = [
  ['users', 'users', 'id'],
  ['user_credentials', 'user_credentials', 'uid'],
  ['sessions', 'sessions', 'id'],
  ['participants', 'participants', 'id'],
  ['attendance', 'attendance', 'id'],
] as const;

const activate = async () => {
  await ensureHybridSchema();
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    for (const [collectionName, tableName, idColumn] of TABLES) {
      await client.query(
        `INSERT INTO tigre_rh.current_documents (
           collection_name, document_id, document_path, payload, source_payload,
           is_deleted, created_at, updated_at
         )
         SELECT $1, ${idColumn}, $1 || '/' || ${idColumn},
           source_payload || jsonb_build_object('id', ${idColumn}),
           source_payload || jsonb_build_object('id', ${idColumn}),
           FALSE, NOW(), NOW()
         FROM tigre_rh.${tableName}
         ON CONFLICT (collection_name, document_id) DO UPDATE SET
           document_path = COALESCE(tigre_rh.current_documents.document_path, EXCLUDED.document_path),
           source_payload = COALESCE(tigre_rh.current_documents.source_payload, EXCLUDED.source_payload),
           is_deleted = FALSE,
           updated_at = NOW()`,
        [collectionName],
      );
    }

    const counts = await client.query(`
      SELECT collection_name, COUNT(*)::int AS count
      FROM tigre_rh.current_documents
      WHERE collection_name = ANY($1::text[]) AND is_deleted = FALSE
      GROUP BY collection_name
      ORDER BY collection_name
    `, [TABLES.map(([collectionName]) => collectionName)]);

    for (const [collectionName, tableName] of TABLES) {
      const source = await client.query(
        `SELECT COUNT(*)::int AS count FROM tigre_rh.${tableName}`,
      );
      const current = counts.rows.find(
        (row: { collection_name: string }) => row.collection_name === collectionName,
      );
      if (Number(current?.count || 0) < Number(source.rows[0].count)) {
        throw new Error(`No se completo la activacion de ${collectionName}.`);
      }
      console.log(`${collectionName}: ${current.count}`);
    }

    await client.query('COMMIT');
    console.log('Corte PostgreSQL preparado correctamente.');
    console.log('PostgreSQL queda como fuente unica del runtime; no se requiere una lista de fallback.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

activate()
  .then(() => closePostgresPool())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await closePostgresPool().catch(() => undefined);
    process.exitCode = 1;
  });
