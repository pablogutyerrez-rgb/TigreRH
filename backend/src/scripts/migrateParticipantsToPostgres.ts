import 'dotenv/config';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { closePostgresPool, getPostgresPool } from '../postgres.js';

type SourceDocument = {
  id: string;
  data: DocumentData;
};

const apply = process.argv.includes('--apply');

const toSourceDocument = (doc: QueryDocumentSnapshot): SourceDocument => ({
  id: doc.id,
  data: doc.data(),
});

const textValue = (value: unknown) => String(value ?? '').trim();
const nullableText = (value: unknown) => textValue(value) || null;
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
  const match = textValue(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const createSchema = async (client: any) => {
  await client.query('CREATE SCHEMA IF NOT EXISTS tigre_rh');
  await client.query(`
    CREATE TABLE IF NOT EXISTS tigre_rh.participants (
      id TEXT PRIMARY KEY,
      training_session_id TEXT NOT NULL REFERENCES tigre_rh.sessions(id) ON DELETE CASCADE,
      dni TEXT NOT NULL DEFAULT '',
      nombres TEXT NOT NULL DEFAULT '',
      apellidos TEXT NOT NULL DEFAULT '',
      celular TEXT NOT NULL DEFAULT '',
      correo TEXT NOT NULL DEFAULT '',
      puesto TEXT NOT NULL DEFAULT '',
      fuente_reclutamiento TEXT NOT NULL DEFAULT '',
      observacion TEXT NOT NULL DEFAULT '',
      estado_final TEXT NOT NULL DEFAULT '',
      estado_alta TEXT NOT NULL DEFAULT '',
      resultado_formacion TEXT NOT NULL DEFAULT '',
      evaluacion_nota NUMERIC,
      comentario_aptitud TEXT NOT NULL DEFAULT '',
      motivo_no_apto TEXT NOT NULL DEFAULT '',
      motivo_desercion TEXT NOT NULL DEFAULT '',
      observacion_general TEXT NOT NULL DEFAULT '',
      observacion_evaluacion TEXT NOT NULL DEFAULT '',
      reclutador_origen TEXT NOT NULL DEFAULT '',
      coordinador TEXT NOT NULL DEFAULT '',
      ciudad TEXT NOT NULL DEFAULT '',
      formador_asignado TEXT NOT NULL DEFAULT '',
      fecha_capacitacion DATE,
      selection_applicant_id TEXT,
      selection_requisition_id TEXT,
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS tigre_rh.attendance (
      id TEXT PRIMARY KEY,
      participant_id TEXT NOT NULL REFERENCES tigre_rh.participants(id) ON DELETE CASCADE,
      training_session_id TEXT NOT NULL REFERENCES tigre_rh.sessions(id) ON DELETE CASCADE,
      dia SMALLINT,
      fecha DATE,
      estado_asistencia TEXT NOT NULL DEFAULT '',
      minutos_tardanza INTEGER,
      motivo_desercion TEXT NOT NULL DEFAULT '',
      observacion TEXT NOT NULL DEFAULT '',
      evidencia_nombre TEXT NOT NULL DEFAULT '',
      evidencia_imagen TEXT NOT NULL DEFAULT '',
      registrado_por TEXT,
      fecha_registro TIMESTAMPTZ,
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(
    'CREATE INDEX IF NOT EXISTS participants_session_idx ON tigre_rh.participants (training_session_id)',
  );
  await client.query(
    'CREATE INDEX IF NOT EXISTS participants_dni_idx ON tigre_rh.participants (dni)',
  );
  await client.query(
    'CREATE INDEX IF NOT EXISTS participants_status_idx ON tigre_rh.participants (estado_final, estado_alta)',
  );
  await client.query(
    'CREATE INDEX IF NOT EXISTS attendance_session_day_idx ON tigre_rh.attendance (training_session_id, dia)',
  );
  await client.query(
    'CREATE INDEX IF NOT EXISTS attendance_participant_day_idx ON tigre_rh.attendance (participant_id, dia)',
  );
};

const assertSourceRelations = (
  participants: SourceDocument[],
  attendance: SourceDocument[],
) => {
  const participantIds = new Set(participants.map((participant) => participant.id));
  const participantSession = new Map(
    participants.map((participant) => [
      participant.id,
      textValue(participant.data.training_session_id),
    ]),
  );
  const invalidParticipants = participants.filter(
    (participant) => !textValue(participant.data.training_session_id),
  );
  const invalidAttendance = attendance.filter((record) => {
    const participantId = textValue(record.data.participant_id);
    const sessionId = textValue(record.data.training_session_id);
    return !participantIds.has(participantId) ||
      !sessionId ||
      participantSession.get(participantId) !== sessionId;
  });

  if (invalidParticipants.length) {
    throw new Error(
      `Participantes sin capacitacion: ${invalidParticipants.slice(0, 10).map((item) => item.id).join(', ')}`,
    );
  }
  if (invalidAttendance.length) {
    throw new Error(
      `Asistencias con relacion invalida: ${invalidAttendance.slice(0, 10).map((item) => item.id).join(', ')}`,
    );
  }
};

const migrate = async () => {
  const [participantSnapshot, attendanceSnapshot] = await Promise.all([
    adminDb.collection('participants').get(),
    adminDb.collection('attendance').get(),
  ]);
  const participants = participantSnapshot.docs.map(toSourceDocument);
  const attendance = attendanceSnapshot.docs.map(toSourceDocument);
  assertSourceRelations(participants, attendance);

  console.log(`Firestore participants: ${participants.length}`);
  console.log(`Firestore attendance: ${attendance.length}`);

  const pool = getPostgresPool();
  const connectivity = await pool.query(
    'SELECT current_database() AS database, current_user AS username',
  );
  console.log(`PostgreSQL: ${connectivity.rows[0].database} (${connectivity.rows[0].username})`);

  const sessionIds = Array.from(new Set(
    participants.map((participant) => textValue(participant.data.training_session_id)),
  ));
  const availableSessions = sessionIds.length === 0
    ? { rows: [] }
    : await pool.query(
      'SELECT id FROM tigre_rh.sessions WHERE id = ANY($1::text[])',
      [sessionIds],
    );
  const availableSessionIds = new Set(availableSessions.rows.map((row: any) => String(row.id)));
  const missingSessions = sessionIds.filter((id) => !availableSessionIds.has(id));
  if (missingSessions.length) {
    throw new Error(
      `Faltan capacitaciones en PostgreSQL: ${missingSessions.slice(0, 10).join(', ')}`,
    );
  }

  if (!apply) {
    console.log('Validacion completada. Ejecuta nuevamente con --apply para transferir.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await createSchema(client);

    for (const participant of participants) {
      const data = participant.data;
      await client.query(
        `INSERT INTO tigre_rh.participants (
          id, training_session_id, dni, nombres, apellidos, celular, correo,
          puesto, fuente_reclutamiento, observacion, estado_final, estado_alta,
          resultado_formacion, evaluacion_nota, comentario_aptitud,
          motivo_no_apto, motivo_desercion, observacion_general,
          observacion_evaluacion, reclutador_origen, coordinador, ciudad,
          formador_asignado, fecha_capacitacion, selection_applicant_id,
          selection_requisition_id, source_payload, migrated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
          $18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          training_session_id = EXCLUDED.training_session_id,
          dni = EXCLUDED.dni,
          nombres = EXCLUDED.nombres,
          apellidos = EXCLUDED.apellidos,
          celular = EXCLUDED.celular,
          correo = EXCLUDED.correo,
          puesto = EXCLUDED.puesto,
          fuente_reclutamiento = EXCLUDED.fuente_reclutamiento,
          observacion = EXCLUDED.observacion,
          estado_final = EXCLUDED.estado_final,
          estado_alta = EXCLUDED.estado_alta,
          resultado_formacion = EXCLUDED.resultado_formacion,
          evaluacion_nota = EXCLUDED.evaluacion_nota,
          comentario_aptitud = EXCLUDED.comentario_aptitud,
          motivo_no_apto = EXCLUDED.motivo_no_apto,
          motivo_desercion = EXCLUDED.motivo_desercion,
          observacion_general = EXCLUDED.observacion_general,
          observacion_evaluacion = EXCLUDED.observacion_evaluacion,
          reclutador_origen = EXCLUDED.reclutador_origen,
          coordinador = EXCLUDED.coordinador,
          ciudad = EXCLUDED.ciudad,
          formador_asignado = EXCLUDED.formador_asignado,
          fecha_capacitacion = EXCLUDED.fecha_capacitacion,
          selection_applicant_id = EXCLUDED.selection_applicant_id,
          selection_requisition_id = EXCLUDED.selection_requisition_id,
          source_payload = EXCLUDED.source_payload,
          migrated_at = NOW()`,
        [
          participant.id,
          textValue(data.training_session_id),
          textValue(data.dni),
          textValue(data.nombres),
          textValue(data.apellidos),
          textValue(data.celular),
          textValue(data.correo),
          textValue(data.puesto),
          textValue(data.fuente_reclutamiento),
          textValue(data.observacion),
          textValue(data.estado_final),
          textValue(data.estado_alta),
          textValue(data.resultado_formacion),
          toNumber(data.evaluacion_nota),
          textValue(data.comentario_aptitud),
          textValue(data.motivo_no_apt || data.motivo_no_apto),
          textValue(data.motivo_desercion),
          textValue(data.observacion_general),
          textValue(data.observacion_evaluacion),
          textValue(data.reclutador_origen),
          textValue(data.coordinador),
          textValue(data.ciudad),
          textValue(data.formador_asignado),
          toDate(data.fecha_capacitacion),
          nullableText(data.selection_applicant_id),
          nullableText(data.selection_requisition_id),
          toJson(data),
        ],
      );
    }

    for (const record of attendance) {
      const data = record.data;
      await client.query(
        `INSERT INTO tigre_rh.attendance (
          id, participant_id, training_session_id, dia, fecha,
          estado_asistencia, minutos_tardanza, motivo_desercion, observacion,
          evidencia_nombre, evidencia_imagen, registrado_por, fecha_registro,
          source_payload, migrated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW())
        ON CONFLICT (id) DO UPDATE SET
          participant_id = EXCLUDED.participant_id,
          training_session_id = EXCLUDED.training_session_id,
          dia = EXCLUDED.dia,
          fecha = EXCLUDED.fecha,
          estado_asistencia = EXCLUDED.estado_asistencia,
          minutos_tardanza = EXCLUDED.minutos_tardanza,
          motivo_desercion = EXCLUDED.motivo_desercion,
          observacion = EXCLUDED.observacion,
          evidencia_nombre = EXCLUDED.evidencia_nombre,
          evidencia_imagen = EXCLUDED.evidencia_imagen,
          registrado_por = EXCLUDED.registrado_por,
          fecha_registro = EXCLUDED.fecha_registro,
          source_payload = EXCLUDED.source_payload,
          migrated_at = NOW()`,
        [
          record.id,
          textValue(data.participant_id),
          textValue(data.training_session_id),
          toNumber(data.dia),
          toDate(data.fecha),
          textValue(data.estado_asistencia),
          toNumber(data.minutos_tardanza),
          textValue(data.motivo_desercion),
          textValue(data.observacion),
          textValue(data.evidencia_nombre),
          textValue(data.evidencia_imagen),
          nullableText(data.registrado_por),
          toTimestamp(data.fecha_registro),
          toJson(data),
        ],
      );
    }

    const participantIds = participants.map((participant) => participant.id);
    const attendanceIds = attendance.map((record) => record.id);
    const migratedParticipants = participantIds.length === 0
      ? { rows: [{ count: 0 }] }
      : await client.query(
        'SELECT COUNT(*)::int AS count FROM tigre_rh.participants WHERE id = ANY($1::text[])',
        [participantIds],
      );
    const migratedAttendance = attendanceIds.length === 0
      ? { rows: [{ count: 0 }] }
      : await client.query(
        'SELECT COUNT(*)::int AS count FROM tigre_rh.attendance WHERE id = ANY($1::text[])',
        [attendanceIds],
      );

    if (migratedParticipants.rows[0].count !== participants.length) {
      throw new Error('La cantidad de participantes en PostgreSQL no coincide con Firestore.');
    }
    if (migratedAttendance.rows[0].count !== attendance.length) {
      throw new Error('La cantidad de asistencias en PostgreSQL no coincide con Firestore.');
    }

    await client.query('COMMIT');
    console.log(`PostgreSQL participants: ${migratedParticipants.rows[0].count}`);
    console.log(`PostgreSQL attendance: ${migratedAttendance.rows[0].count}`);
    console.log('Transferencia de participantes y asistencias completada correctamente.');
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
