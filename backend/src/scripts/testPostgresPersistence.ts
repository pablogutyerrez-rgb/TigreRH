import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { closePostgresPool, getPostgresPool } from '../postgres.js';

const run = async () => {
  const client = await getPostgresPool().connect();
  const id = `postgres-crud-test-${randomUUID()}`;
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tigre_rh.current_documents (
         collection_name, document_id, document_path, payload, source_payload,
         is_deleted, created_at, updated_at
       ) VALUES ('__persistence_test__', $1, '__persistence_test__/' || $1,
         '{"phase":"created","nested":{"ok":true},"items":[1,null,"three"]}'::jsonb,
         '{"phase":"created","nested":{"ok":true},"items":[1,null,"three"]}'::jsonb,
         FALSE, NOW(), NOW())`,
      [id],
    );
    const created = await client.query(
      `SELECT payload FROM tigre_rh.current_documents
       WHERE collection_name = '__persistence_test__' AND document_id = $1`,
      [id],
    );
    if (created.rows[0]?.payload?.nested?.ok !== true) throw new Error('Fallo la lectura posterior al alta.');

    await client.query(
      `UPDATE tigre_rh.current_documents
       SET payload = jsonb_set(payload, '{phase}', '"updated"'::jsonb), updated_at = NOW()
       WHERE collection_name = '__persistence_test__' AND document_id = $1`,
      [id],
    );
    const updated = await client.query(
      `SELECT payload ->> 'phase' AS phase FROM tigre_rh.current_documents
       WHERE collection_name = '__persistence_test__' AND document_id = $1`,
      [id],
    );
    if (updated.rows[0]?.phase !== 'updated') throw new Error('Fallo la edicion.');

    await client.query(
      `DELETE FROM tigre_rh.current_documents
       WHERE collection_name = '__persistence_test__' AND document_id = $1`,
      [id],
    );
    const deleted = await client.query(
      `SELECT COUNT(*)::int AS count FROM tigre_rh.current_documents
       WHERE collection_name = '__persistence_test__' AND document_id = $1`,
      [id],
    );
    if (Number(deleted.rows[0].count) !== 0) throw new Error('Fallo la eliminacion.');
    await client.query('ROLLBACK');
    console.log('CRUD PostgreSQL correcto; la transaccion de prueba fue revertida.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

run()
  .then(() => closePostgresPool())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await closePostgresPool().catch(() => undefined);
    process.exitCode = 1;
  });
