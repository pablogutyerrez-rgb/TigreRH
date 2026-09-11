import 'dotenv/config';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firestoreMigrationAdmin.js';
import { closePostgresPool, getPostgresPool } from '../postgres.js';

type SourceSession = {
  id: string;
  data: DocumentData;
};

type TrainerAssignment = {
  type: 'initial' | 'ojt';
  position: number;
  userId: string | null;
  trainerName: string;
};

const apply = process.argv.includes('--apply');

const toSourceSession = (doc: QueryDocumentSnapshot): SourceSession => ({
  id: doc.id,
  data: doc.data(),
});

const textValue = (...values: unknown[]) => {
  const value = values.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value.trim() : '';
};

const stringArray = (...values: unknown[]) => {
  const value = values.find(Array.isArray);
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
};

const unique = (values: string[]) => Array.from(new Set(values));

const toJson = (value: unknown) => JSON.stringify(value ?? {});

const toTimestamp = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === 'function') return candidate.toDate().toISOString();
  }
  return null;
};

const toDate = (value: unknown) => {
  const raw = textValue(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : match[1];
};

const toTime = (value: unknown) => {
  const raw = textValue(value);
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)/);
  return match ? `${match[1]}:${match[2]}` : null;
};

const trainerAssignments = (data: DocumentData): TrainerAssignment[] => {
  const allIds = stringArray(data.formador_ids);
  const allNames = stringArray(data.formador_nombres);
  let initialIds = stringArray(
    data.formador_capacitacion_inicial_ids,
    data.formador_inicial_ids,
  );
  let initialNames = stringArray(
    data.formador_capacitacion_inicial_nombres,
    data.formador_inicial_nombres,
  );
  const ojtIds = stringArray(data.formador_ojt_ids);
  const ojtNames = stringArray(data.formador_ojt_nombres);

  if (initialIds.length === 0) initialIds = allIds;
  if (initialNames.length === 0) initialNames = allNames;
  if (initialIds.length === 0 && data.formador_id) {
    initialIds = [String(data.formador_id).trim()];
  }
  if (initialNames.length === 0 && data.formador_nombre) {
    initialNames = [String(data.formador_nombre).trim()];
  }

  const build = (
    type: TrainerAssignment['type'],
    ids: string[],
    names: string[],
  ) => Array.from({ length: Math.max(ids.length, names.length) }, (_, position) => ({
    type,
    position,
    userId: ids[position] || null,
    trainerName: names[position] || '',
  }));

  return [...build('initial', initialIds, initialNames), ...build('ojt', ojtIds, ojtNames)];
};

const createSchema = async (client: any) => {
  await client.query('CREATE SCHEMA IF NOT EXISTS tigre_rh');
  await client.query(`
    CREATE TABLE IF NOT EXISTS tigre_rh.sessions (
      id TEXT PRIMARY KEY,
      nombre_generacion TEXT NOT NULL DEFAULT '',
      generation_code TEXT NOT NULL DEFAULT '',
      generation_code_base TEXT NOT NULL DEFAULT '',
      campana TEXT NOT NULL DEFAULT '',
      tipo_capacitacion TEXT NOT NULL DEFAULT '',
      fecha_inicio DATE,
      fecha_fin DATE,
      hora_capacitacion TIME,
      formador_id TEXT,
      formador_nombre TEXT NOT NULL DEFAULT '',
      formador_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      formador_nombres JSONB NOT NULL DEFAULT '[]'::jsonb,
      formador_inicial_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      formador_inicial_nombres JSONB NOT NULL DEFAULT '[]'::jsonb,
      formador_ojt_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      formador_ojt_nombres JSONB NOT NULL DEFAULT '[]'::jsonb,
      reclutador_id TEXT,
      reclutador_nombre TEXT NOT NULL DEFAULT '',
      modalidad TEXT NOT NULL DEFAULT '',
      turno TEXT NOT NULL DEFAULT '',
      observaciones TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT '',
      training_days SMALLINT,
      selection_requisition_id TEXT,
      selection_requisition_code TEXT,
      fecha_creacion TIMESTAMPTZ,
      fecha_cierre TIMESTAMPTZ,
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS tigre_rh.session_trainers (
      session_id TEXT NOT NULL REFERENCES tigre_rh.sessions(id) ON DELETE CASCADE,
      assignment_type TEXT NOT NULL CHECK (assignment_type IN ('initial', 'ojt')),
      position INTEGER NOT NULL,
      user_id TEXT,
      trainer_name TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (session_id, assignment_type, position)
    )
  `);
  await client.query(
    'CREATE INDEX IF NOT EXISTS sessions_campaign_dates_idx ON tigre_rh.sessions (campana, fecha_inicio, fecha_fin)',
  );
  await client.query(
    'CREATE INDEX IF NOT EXISTS sessions_generation_code_idx ON tigre_rh.sessions (generation_code)',
  );
  await client.query(
    'CREATE INDEX IF NOT EXISTS sessions_status_idx ON tigre_rh.sessions (estado)',
  );
  await client.query(
    'CREATE INDEX IF NOT EXISTS session_trainers_user_idx ON tigre_rh.session_trainers (user_id, assignment_type)',
  );
};

const migrate = async () => {
  const snapshot = await adminDb.collection('sessions').get();
  const sessions = snapshot.docs.map(toSourceSession);
  const assignmentCount = sessions.reduce(
    (total, session) => total + trainerAssignments(session.data).length,
    0,
  );

  console.log(`Firestore sessions: ${sessions.length}`);
  console.log(`Asignaciones de formadores transferibles: ${assignmentCount}`);

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

    for (const session of sessions) {
      const data = session.data;
      const initialIds = stringArray(
        data.formador_capacitacion_inicial_ids,
        data.formador_inicial_ids,
      );
      const initialNames = stringArray(
        data.formador_capacitacion_inicial_nombres,
        data.formador_inicial_nombres,
      );
      const ojtIds = stringArray(data.formador_ojt_ids);
      const ojtNames = stringArray(data.formador_ojt_nombres);
      const allIds = unique([
        ...stringArray(data.formador_ids),
        ...initialIds,
        ...ojtIds,
        textValue(data.formador_id),
      ].filter(Boolean));
      const allNames = unique([
        ...stringArray(data.formador_nombres),
        ...initialNames,
        ...ojtNames,
        textValue(data.formador_nombre),
      ].filter(Boolean));

      await client.query(
        `INSERT INTO tigre_rh.sessions (
          id, nombre_generacion, generation_code, generation_code_base,
          campana, tipo_capacitacion, fecha_inicio, fecha_fin,
          hora_capacitacion, formador_id, formador_nombre, formador_ids,
          formador_nombres, formador_inicial_ids, formador_inicial_nombres,
          formador_ojt_ids, formador_ojt_nombres, reclutador_id,
          reclutador_nombre, modalidad, turno, observaciones, estado,
          training_days, selection_requisition_id, selection_requisition_code,
          fecha_creacion, fecha_cierre, source_payload, migrated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,
          $14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21,
          $22,$23,$24,$25,$26,$27,$28,$29::jsonb,NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          nombre_generacion = EXCLUDED.nombre_generacion,
          generation_code = EXCLUDED.generation_code,
          generation_code_base = EXCLUDED.generation_code_base,
          campana = EXCLUDED.campana,
          tipo_capacitacion = EXCLUDED.tipo_capacitacion,
          fecha_inicio = EXCLUDED.fecha_inicio,
          fecha_fin = EXCLUDED.fecha_fin,
          hora_capacitacion = EXCLUDED.hora_capacitacion,
          formador_id = EXCLUDED.formador_id,
          formador_nombre = EXCLUDED.formador_nombre,
          formador_ids = EXCLUDED.formador_ids,
          formador_nombres = EXCLUDED.formador_nombres,
          formador_inicial_ids = EXCLUDED.formador_inicial_ids,
          formador_inicial_nombres = EXCLUDED.formador_inicial_nombres,
          formador_ojt_ids = EXCLUDED.formador_ojt_ids,
          formador_ojt_nombres = EXCLUDED.formador_ojt_nombres,
          reclutador_id = EXCLUDED.reclutador_id,
          reclutador_nombre = EXCLUDED.reclutador_nombre,
          modalidad = EXCLUDED.modalidad,
          turno = EXCLUDED.turno,
          observaciones = EXCLUDED.observaciones,
          estado = EXCLUDED.estado,
          training_days = EXCLUDED.training_days,
          selection_requisition_id = EXCLUDED.selection_requisition_id,
          selection_requisition_code = EXCLUDED.selection_requisition_code,
          fecha_creacion = EXCLUDED.fecha_creacion,
          fecha_cierre = EXCLUDED.fecha_cierre,
          source_payload = EXCLUDED.source_payload,
          migrated_at = NOW()`,
        [
          session.id,
          textValue(data.nombre_generacion, data.generation_code),
          textValue(data.generation_code, data.nombre_generacion),
          textValue(data.generation_code_base),
          textValue(data.campaña, data.campana),
          textValue(data.tipo_capacitacion, data.tipo_capacitación),
          toDate(data.fecha_inicio),
          toDate(data.fecha_fin),
          toTime(data.hora_capacitacion || data.hora_capacitación),
          textValue(data.formador_id) || null,
          textValue(data.formador_nombre),
          toJson(allIds),
          toJson(allNames),
          toJson(initialIds),
          toJson(initialNames),
          toJson(ojtIds),
          toJson(ojtNames),
          textValue(data.reclutador_id) || null,
          textValue(data.reclutador_nombre),
          textValue(data.modalidad),
          textValue(data.turno),
          textValue(data.observaciones),
          textValue(data.estado),
          Number.isInteger(data.training_days) ? data.training_days : null,
          textValue(data.selection_requisition_id) || null,
          textValue(data.selection_requisition_code) || null,
          toTimestamp(data.fecha_creacion),
          toTimestamp(data.fecha_cierre),
          toJson(data),
        ],
      );

      await client.query(
        'DELETE FROM tigre_rh.session_trainers WHERE session_id = $1',
        [session.id],
      );
      for (const assignment of trainerAssignments(data)) {
        await client.query(
          `INSERT INTO tigre_rh.session_trainers (
            session_id, assignment_type, position, user_id, trainer_name
          ) VALUES ($1,$2,$3,$4,$5)`,
          [
            session.id,
            assignment.type,
            assignment.position,
            assignment.userId,
            assignment.trainerName,
          ],
        );
      }
    }

    const ids = sessions.map((session) => session.id);
    const migratedSessions = ids.length === 0
      ? { rows: [{ count: 0 }] }
      : await client.query(
        'SELECT COUNT(*)::int AS count FROM tigre_rh.sessions WHERE id = ANY($1::text[])',
        [ids],
      );
    const migratedAssignments = ids.length === 0
      ? { rows: [{ count: 0 }] }
      : await client.query(
        'SELECT COUNT(*)::int AS count FROM tigre_rh.session_trainers WHERE session_id = ANY($1::text[])',
        [ids],
      );

    if (migratedSessions.rows[0].count !== sessions.length) {
      throw new Error('La cantidad de capacitaciones en PostgreSQL no coincide con Firestore.');
    }
    if (migratedAssignments.rows[0].count !== assignmentCount) {
      throw new Error('La cantidad de asignaciones de formadores no coincide con Firestore.');
    }

    await client.query('COMMIT');
    console.log(`PostgreSQL sessions: ${migratedSessions.rows[0].count}`);
    console.log(`PostgreSQL session trainers: ${migratedAssignments.rows[0].count}`);
    console.log('Transferencia de capacitaciones completada correctamente.');
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
