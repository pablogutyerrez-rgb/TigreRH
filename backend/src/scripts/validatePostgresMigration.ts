import 'dotenv/config';
import { closePostgresPool, getPostgresPool } from '../postgres.js';

type RelationCheck = {
  name: string;
  sourceCollection: string;
  sourceField: string;
  targetCollection: string;
};

const relationChecks: RelationCheck[] = [
  { name: 'participants -> sessions', sourceCollection: 'participants', sourceField: 'training_session_id', targetCollection: 'sessions' },
  { name: 'attendance -> participants', sourceCollection: 'attendance', sourceField: 'participant_id', targetCollection: 'participants' },
  { name: 'attendance -> sessions', sourceCollection: 'attendance', sourceField: 'training_session_id', targetCollection: 'sessions' },
  { name: 'confirmations -> participants', sourceCollection: 'confirmations', sourceField: 'participant_id', targetCollection: 'participants' },
  { name: 'confirmations -> sessions', sourceCollection: 'confirmations', sourceField: 'training_session_id', targetCollection: 'sessions' },
  { name: 'reopens -> participants', sourceCollection: 'reopens', sourceField: 'participant_id', targetCollection: 'participants' },
  { name: 'reopens -> sessions', sourceCollection: 'reopens', sourceField: 'training_session_id', targetCollection: 'sessions' },
  { name: 'surveys -> sessions', sourceCollection: 'surveys', sourceField: 'training_session_id', targetCollection: 'sessions' },
  { name: 'responses -> surveys', sourceCollection: 'responses', sourceField: 'training_survey_id', targetCollection: 'surveys' },
  { name: 'responses -> participants', sourceCollection: 'responses', sourceField: 'participant_id', targetCollection: 'participants' },
  { name: 'selection_applicants -> selection_requisitions', sourceCollection: 'selection_applicants', sourceField: 'requisition_id', targetCollection: 'selection_requisitions' },
  { name: 'cv_records -> participants', sourceCollection: 'cv_records', sourceField: 'participant_id', targetCollection: 'participants' },
];

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

const validate = async () => {
  const pool = getPostgresPool();
  const connection = await pool.query(
    'SELECT current_database() AS database, current_user AS username, NOW() AS checked_at',
  );
  console.table(connection.rows);

  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'tigre_rh' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tableCounts: Array<{ table: string; count: number }> = [];
  for (const { table_name: tableName } of tables.rows as Array<{ table_name: string }>) {
    const count = await pool.query(
      `SELECT COUNT(*)::int AS count FROM tigre_rh.${quoteIdentifier(tableName)}`,
    );
    tableCounts.push({ table: tableName, count: Number(count.rows[0].count) });
  }
  console.log('Tablas PostgreSQL:');
  console.table(tableCounts);

  const collectionCounts = await pool.query(`
    SELECT collection_name, COUNT(*)::int AS count
    FROM tigre_rh.current_documents
    WHERE is_deleted = FALSE
    GROUP BY collection_name
    ORDER BY collection_name
  `);
  console.log('Documentos activos por coleccion:');
  console.table(collectionCounts.rows);

  const migrationState = await pool.query(`
    SELECT collection_name, status, read_count, inserted_count, updated_count,
      skipped_count, error_count, last_error
    FROM tigre_rh.firestore_migration_state
    ORDER BY collection_name
  `);
  console.log('Estado de migracion:');
  console.table(migrationState.rows);

  const failedStates = migrationState.rows.filter(
    (row: { status: string; error_count: number }) => row.status !== 'complete' || Number(row.error_count) > 0,
  );
  if (failedStates.length) {
    throw new Error(`Hay ${failedStates.length} colecciones incompletas o con errores.`);
  }

  const countsByCollection = new Map<string, number>(
    collectionCounts.rows.map((row: { collection_name: string; count: number }) => [
      row.collection_name,
      Number(row.count),
    ]),
  );
  for (const state of migrationState.rows as Array<Record<string, unknown>>) {
    const expected = Math.max(Number(state.read_count || 0), Number(state.skipped_count || 0));
    const actual = countsByCollection.get(String(state.collection_name)) || 0;
    if (actual < expected) {
      throw new Error(`Conteo menor al migrado en ${state.collection_name}: ${actual} < ${expected}.`);
    }
  }

  const relationResults: Array<{ relation: string; orphans: number }> = [];
  for (const check of relationChecks) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM tigre_rh.current_documents source
       LEFT JOIN tigre_rh.current_documents target
         ON target.collection_name = $3
        AND target.document_id = source.payload ->> $2
        AND target.is_deleted = FALSE
       WHERE source.collection_name = $1
         AND source.is_deleted = FALSE
         AND NULLIF(source.payload ->> $2, '') IS NOT NULL
         AND target.document_id IS NULL`,
      [check.sourceCollection, check.sourceField, check.targetCollection],
    );
    relationResults.push({ relation: check.name, orphans: Number(result.rows[0].count) });
  }
  console.log('Relaciones documentales:');
  console.table(relationResults);

  const normalizedRelations = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM tigre_rh.user_credentials c LEFT JOIN tigre_rh.users u ON u.id = c.uid WHERE u.id IS NULL) AS credential_orphans,
      (SELECT COUNT(*)::int FROM tigre_rh.participants p LEFT JOIN tigre_rh.sessions s ON s.id = p.training_session_id WHERE s.id IS NULL) AS participant_orphans,
      (SELECT COUNT(*)::int FROM tigre_rh.attendance a LEFT JOIN tigre_rh.participants p ON p.id = a.participant_id LEFT JOIN tigre_rh.sessions s ON s.id = a.training_session_id WHERE p.id IS NULL OR s.id IS NULL) AS attendance_orphans,
      (SELECT COUNT(*)::int FROM tigre_rh.session_trainers st LEFT JOIN tigre_rh.sessions s ON s.id = st.session_id WHERE s.id IS NULL) AS trainer_session_orphans
  `);
  console.log('Relaciones normalizadas:');
  console.table(normalizedRelations.rows);
  if (Object.values(normalizedRelations.rows[0]).some((value) => Number(value) > 0)) {
    throw new Error('Se detectaron relaciones huerfanas en las tablas normalizadas.');
  }

  console.log('Validacion PostgreSQL completada correctamente sin releer Firestore.');
};

validate()
  .then(() => closePostgresPool())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await closePostgresPool().catch(() => undefined);
    process.exitCode = 1;
  });
