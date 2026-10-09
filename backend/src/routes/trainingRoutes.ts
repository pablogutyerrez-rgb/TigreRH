import { Router, type Response } from 'express';
import { z } from 'zod';
import { dataDb as adminDb } from '../hybridDb.js';
import { ensureHybridSchema } from '../hybridDb.js';
import { getPostgresPool } from '../postgres.js';
import { randomUUID } from 'node:crypto';
import {
  type AuthenticatedRequest,
  requireAuth,
  requireRole,
} from '../utils/authMiddleware.js';

const router = Router();
const canManageTraining = [
  requireAuth,
  requireRole(['Administrador', 'Analista', 'Reclutador', 'Coordinador']),
];
const canPatchTraining = [
  requireAuth,
  requireRole(['Administrador', 'Analista', 'Reclutador', 'Coordinador', 'Formador']),
];
const entitySchema = z.object({ id: z.string().min(1) }).passthrough();
type InitialAttendanceRecord = z.infer<typeof entitySchema> & {
  participant_id: string;
  dia: number;
  training_session_id: string;
  fecha: string;
};

const isAssignedTrainer = (data: Record<string, unknown> | undefined, userId: string) =>
  data?.formador_id === userId ||
  (Array.isArray(data?.formador_ids) && data.formador_ids.includes(userId));

const getTrainingCode = (session: Record<string, unknown>) =>
  String(session.generation_code || session.nombre_generacion || '').trim();

const getOjtGroup = (campaign: string) => {
  if (['Entel Empresas RUC 10', 'Entel Empresas RUC 20', 'GPON'].includes(campaign)) return 'Entel';
  if (campaign === 'Culqi') return 'Culqi';
  if (campaign === 'Equifax' || campaign === 'Fija') return 'Equifax';
  if (campaign === 'Tigre Academy') return 'Tigre Academy';
  return null;
};

const businessDay = (start: string, day: number) => {
  const date = new Date(`${start}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error('Fecha de inicio invalida.');
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
  for (let count = 1; count < day;) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) count += 1;
  }
  return date.toISOString().slice(0, 10);
};

router.post('/:sessionId/assign-ojt', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await ensureHybridSchema();
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    const sessionRow = await client.query(
      `SELECT payload FROM tigre_rh.current_documents WHERE collection_name = 'sessions' AND document_id = $1 AND is_deleted = FALSE FOR UPDATE`,
      [req.params.sessionId],
    );
    const session = sessionRow.rows[0]?.payload as Record<string, any> | undefined;
    if (!session) throw Object.assign(new Error('Capacitacion no encontrada.'), { status: 404 });
    const group = getOjtGroup(String(session.campaña || ''));
    if (!group) throw Object.assign(new Error('Esta campana no tiene grupo OJT asignado.'), { status: 400 });
    const initialIds = Array.isArray(session.formador_capacitacion_inicial_ids)
      ? session.formador_capacitacion_inicial_ids : [session.formador_id];
    if (req.user!.rol !== 'Administrador' &&
      !(['Formador', 'Analista'].includes(req.user!.rol) && initialIds.includes(req.user!.uid))) {
      throw Object.assign(new Error('Solo el formador inicial asignado o Admin puede asignar OJT.'), { status: 403 });
    }
    if (req.user!.module_view_only.includes('formacion:capacitaciones')) {
      throw Object.assign(new Error('Este apartado es de solo vista.'), { status: 403 });
    }
    const ojtTrainerIds = Array.isArray(session.formador_ojt_ids) ? session.formador_ojt_ids : [];
    if (ojtTrainerIds.length === 0) throw Object.assign(new Error('Asigna un Formador OJT antes de continuar.'), { status: 400 });
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('ojt_modules'), hashtext($1))`, [group]);
    const participants = await client.query(
      `SELECT document_id, payload FROM tigre_rh.current_documents WHERE collection_name = 'participants' AND payload->>'training_session_id' = $1 AND is_deleted = FALSE`,
      [req.params.sessionId],
    );
    if (participants.rows.length === 0) throw Object.assign(new Error('No hay participantes en esta capacitacion.'), { status: 400 });
    const dayFive = await client.query(
      `SELECT payload FROM tigre_rh.current_documents WHERE collection_name = 'attendance' AND payload->>'training_session_id' = $1 AND payload->>'dia' = '5' AND is_deleted = FALSE`,
      [req.params.sessionId],
    );
    const registered = new Map<string, string>(dayFive.rows.map((row: { payload: Record<string, unknown> }) =>
      [String(row.payload.participant_id), String(row.payload.estado_asistencia || '')]));
    if (participants.rows.some((row: { document_id: string }) =>
      !registered.has(row.document_id) || ['Seleccionar', 'Pendiente', ''].includes(registered.get(row.document_id) || ''))) {
      throw Object.assign(new Error('Registra la asistencia del dia 5 para todos los participantes.'), { status: 409 });
    }
    const eligibleIds = participants.rows.map((row: { document_id: string }) => row.document_id);
    if (eligibleIds.length === 0) throw Object.assign(new Error('No hay participantes habilitados para OJT.'), { status: 409 });

    const existing = session.ojt_module_id
      ? await client.query(`SELECT payload FROM tigre_rh.current_documents WHERE collection_name = 'ojt_modules' AND document_id = $1 AND is_deleted = FALSE`, [session.ojt_module_id])
      : await client.query(`SELECT payload FROM tigre_rh.current_documents WHERE collection_name = 'ojt_modules' AND payload->>'grupo' = $1 AND payload->>'estado' = 'Abierto' AND is_deleted = FALSE ORDER BY created_at, document_id LIMIT 1 FOR UPDATE`, [group]);
    const previous = existing.rows[0]?.payload as Record<string, any> | undefined;
    if (session.ojt_module_id && !previous) throw Object.assign(new Error('El modulo OJT asignado no existe.'), { status: 409 });
    if (session.ojt_module_id && previous) {
      await client.query('COMMIT');
      res.json({ module: previous, session });
      return;
    }
    if (!session.ojt_module_id && previous?.generation_ids?.includes(session.id)) throw Object.assign(new Error('La generacion ya pertenece a un modulo OJT.'), { status: 409 });
    const timestamp = new Date().toISOString();
    const moduleId = previous?.id || `ojt-${randomUUID()}`;
    const moduleData = {
      ...(previous || {}), id: moduleId, grupo: group, nombre: previous?.nombre || `OJT ${group}`,
      estado: previous?.estado || 'Abierto',
      generation_ids: [...new Set([...(previous?.generation_ids || []), session.id])],
      generation_codes: [...new Set([...(previous?.generation_codes || []), getTrainingCode(session)])],
      participant_ids: [...new Set([...(previous?.participant_ids || []), ...eligibleIds])],
      formador_ojt_ids: [...new Set([...(previous?.formador_ojt_ids || []), ...ojtTrainerIds])],
      formador_ojt_nombres: [...new Set([...(previous?.formador_ojt_nombres || []), ...(session.formador_ojt_nombres || [])])],
      fecha_inicio: previous?.fecha_inicio
        ? [previous.fecha_inicio, businessDay(session.fecha_inicio, 6)].sort()[0]
        : businessDay(session.fecha_inicio, 6),
      fecha_fin: previous?.fecha_fin
        ? [previous.fecha_fin, businessDay(session.fecha_inicio, 10)].sort().reverse()[0]
        : businessDay(session.fecha_inicio, 10),
      hora_capacitacion: previous?.hora_capacitacion || session.hora_capacitacion || '08:00',
      turno: previous?.turno || session.turno,
      modalidad: previous?.modalidad || session.modalidad,
      created_at: previous?.created_at || timestamp, updated_at: timestamp,
    };
    await client.query(
      `INSERT INTO tigre_rh.current_documents (collection_name, document_id, document_path, payload, source_payload, is_deleted)
       VALUES ('ojt_modules', $1, 'ojt_modules/' || $1, $2::jsonb, $2::jsonb, FALSE)
       ON CONFLICT (collection_name, document_id) DO UPDATE SET payload = EXCLUDED.payload, source_payload = EXCLUDED.source_payload, updated_at = NOW(), is_deleted = FALSE`,
      [moduleId, JSON.stringify(moduleData)],
    );
    const assigned = { ...session, ojt_module_id: moduleId, ojt_assigned_at: session.ojt_assigned_at || timestamp };
    await client.query(
      `UPDATE tigre_rh.current_documents SET payload = $2::jsonb, source_payload = $2::jsonb, updated_at = NOW() WHERE collection_name = 'sessions' AND document_id = $1`,
      [session.id, JSON.stringify(assigned)],
    );
    if (session.training_model === 'split_ojt' && !session.ojt_module_id) {
      for (const participantId of eligibleIds) {
        for (let day = 6; day <= 10; day += 1) {
          const id = `ojt-${participantId}-${day}`;
          const record = {
            id, participant_id: participantId, training_session_id: session.id, dia: day,
            fecha: businessDay(session.fecha_inicio, day), estado_asistencia: 'Seleccionar',
            registrado_por: req.user!.uid, fecha_registro: timestamp,
          };
          await client.query(
            `INSERT INTO tigre_rh.current_documents (collection_name, document_id, document_path, payload, source_payload, is_deleted)
             VALUES ('attendance', $1, 'attendance/' || $1, $2::jsonb, $2::jsonb, FALSE)
             ON CONFLICT (collection_name, document_id) DO NOTHING`,
            [id, JSON.stringify(record)],
          );
        }
      }
    }
    await client.query('COMMIT');
    res.json({ module: moduleData, session: assigned });
  } catch (error) {
    await client.query('ROLLBACK');
    const failure = error as Error & { status?: number };
    res.status(failure.status || 500).json({ message: failure.message || 'No se pudo asignar OJT.' });
  } finally {
    client.release();
  }
});

router.patch('/ojt/:moduleId', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = z.object({
    nombre: z.string().trim().min(1).optional(),
    estado: z.enum(['Abierto', 'Cerrado']).optional(),
    hora_capacitacion: z.string().optional(),
    turno: z.string().optional(),
    modalidad: z.string().optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Datos del modulo OJT invalidos.' });
    return;
  }
  const ref = adminDb.collection('ojt_modules').doc(req.params.moduleId);
  const current = await ref.get();
  if (!current.exists) {
    res.status(404).json({ message: 'Modulo OJT no encontrado.' });
    return;
  }
  const module = { id: current.id, ...current.data(), ...parsed.data, updated_at: new Date().toISOString() };
  await ref.set(module);
  res.json({ module });
});

router.delete('/ojt/:moduleId', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  const ref = adminDb.collection('ojt_modules').doc(req.params.moduleId);
  const current = await ref.get();
  if (!current.exists) {
    res.status(404).json({ message: 'Modulo OJT no encontrado.' });
    return;
  }
  const writer = adminDb.bulkWriter();
  for (const sessionId of current.data().generation_ids || []) {
    const sessionRef = adminDb.collection('sessions').doc(String(sessionId));
    const session = await sessionRef.get();
    if (session.data()?.ojt_module_id === current.id) {
      writer.set(sessionRef, { ojt_module_id: null }, { merge: true });
    }
  }
  writer.delete(ref);
  await writer.close();
  res.json({ ok: true });
});

const hasDuplicateTrainingCode = async (code: string, sessionId: string) => {
  if (!code) return false;
  const [byGenerationCode, byName] = await Promise.all([
    adminDb.collection('sessions').where('generation_code', '==', code).limit(1).get(),
    adminDb.collection('sessions').where('nombre_generacion', '==', code).limit(1).get(),
  ]);
  return [...byGenerationCode.docs, ...byName.docs].some((doc) => doc.id !== sessionId);
};

const assertTrainingAccess = async (
  req: AuthenticatedRequest,
  sessionId: string,
) => {
  if (req.user!.rol !== 'Formador') return true;
  const session = await adminDb.collection('sessions').doc(sessionId).get();
  if (!session.exists) return false;
  return isAssignedTrainer(session.data(), req.user!.uid);
};

router.post('/', canManageTraining, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = z.object({
    session: entitySchema,
    survey: entitySchema,
    participants: z.array(entitySchema).max(2000),
    attendance: z.array(entitySchema).max(10000),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Datos de capacitacion invalidos.' });
    return;
  }

  const { survey, participants, attendance } = parsed.data;
  const start = String(parsed.data.session.fecha_inicio || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || [0, 6].includes(new Date(`${start}T12:00:00`).getDay())) {
    res.status(400).json({ message: 'La capacitacion debe iniciar de lunes a viernes.' });
    return;
  }
  const session = { ...parsed.data.session, training_days: 5, training_model: 'split_ojt', fecha_fin: businessDay(start, 5) };
  const participantIds = new Set(participants.map((participant) => String(participant.id)));
  const initialAttendance: InitialAttendanceRecord[] = attendance
    .filter((record) => {
      const day = Number(record.dia);
      return Number.isInteger(day) && day >= 1 && day <= 5 && participantIds.has(String(record.participant_id));
    })
    .map((record) => ({
      ...record,
      participant_id: String(record.participant_id),
      dia: Number(record.dia),
      training_session_id: session.id,
      fecha: businessDay(start, Number(record.dia)),
    }));
  const attendanceKeys = new Set(initialAttendance.map((record) => `${record.participant_id}/${record.dia}`));
  if (participants.some((participant) => participant.training_session_id !== session.id) ||
    initialAttendance.length !== participants.length * 5 ||
    attendanceKeys.size !== initialAttendance.length) {
    res.status(400).json({ message: 'La asistencia inicial debe contener solo los cinco dias habiles de esta capacitacion.' });
    return;
  }
  const trainingCode = getTrainingCode(session);
  if (await hasDuplicateTrainingCode(trainingCode, session.id)) {
    res.status(409).json({ message: `Ya existe una capacitacion con el codigo ${trainingCode}.` });
    return;
  }

  const writer = adminDb.bulkWriter();
  writer.set(adminDb.collection('sessions').doc(session.id), session);
  writer.set(adminDb.collection('surveys').doc(survey.id), survey);
  participants.forEach((participant) =>
    writer.set(adminDb.collection('participants').doc(participant.id), participant),
  );
  initialAttendance.forEach((record) =>
    writer.set(adminDb.collection('attendance').doc(record.id), record),
  );
  await writer.close();
  res.status(201).json({ ok: true });
});

router.patch('/:sessionId', canPatchTraining, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await assertTrainingAccess(req, req.params.sessionId))) {
    res.status(403).json({ message: 'Solo puedes editar tus propias capacitaciones.' });
    return;
  }
  const changes = z.record(z.string(), z.unknown()).safeParse(req.body);
  if (!changes.success) {
    res.status(400).json({ message: 'Cambios de capacitacion invalidos.' });
    return;
  }
  delete changes.data.id;
  if (changes.data.estado && req.user!.rol !== 'Administrador') {
    const current = await adminDb.collection('sessions').doc(req.params.sessionId).get();
    const oldStatus = String(current.data()?.estado || '');
    const nextStatus = String(changes.data.estado);
    if (oldStatus !== nextStatus &&
      (['Capacitación cerrada', 'Campaña cerrada'].includes(oldStatus) ||
        ['Capacitación cerrada', 'Campaña cerrada'].includes(nextStatus))) {
      res.status(403).json({ message: 'Solo el administrador puede cerrar o reabrir capacitaciones.' });
      return;
    }
  }
  if (req.user!.rol === 'Formador') {
    const keys = Object.keys(changes.data);
    const statusOnly = keys.length === 1 && keys[0] === 'estado';
    const allowedStatus = ['Capacitación cerrada', 'En curso'].includes(String(changes.data.estado || ''));
    if (!statusOnly || !allowedStatus) {
      res.status(403).json({ message: 'El Formador solo puede actualizar el estado de su capacitación asignada.' });
      return;
    }
  }

  const requestedCode = String(changes.data.generation_code || changes.data.nombre_generacion || '').trim();
  if (requestedCode && await hasDuplicateTrainingCode(requestedCode, req.params.sessionId)) {
    res.status(409).json({ message: `Ya existe una capacitacion con el codigo ${requestedCode}.` });
    return;
  }

  if (requestedCode) {
    changes.data.generation_code = requestedCode;
    changes.data.nombre_generacion = requestedCode;
  }

  const shouldSyncRelatedRecords = req.user!.rol === 'Administrador' && Boolean(
    requestedCode || changes.data.campaña || changes.data.formador_id || changes.data.formador_nombre,
  );
  if (!shouldSyncRelatedRecords) {
    await adminDb.collection('sessions').doc(req.params.sessionId).set(changes.data, { merge: true });
    res.json({ ok: true });
    return;
  }

  const surveysSnapshot = await adminDb.collection('surveys')
    .where('training_session_id', '==', req.params.sessionId)
    .get();
  const responseSnapshots = await Promise.all(surveysSnapshot.docs.map((survey) =>
    adminDb.collection('responses').where('training_survey_id', '==', survey.id).get(),
  ));
  const relatedChanges: Record<string, unknown> = {
    ...(requestedCode ? { codigo_generacion: requestedCode } : {}),
    ...(changes.data.campaña ? { campaña: changes.data.campaña } : {}),
    ...(changes.data.formador_id ? { formador_id: changes.data.formador_id } : {}),
    ...(changes.data.formador_nombre ? { formador_nombre: changes.data.formador_nombre } : {}),
  };
  const writer = adminDb.bulkWriter();
  writer.set(adminDb.collection('sessions').doc(req.params.sessionId), changes.data, { merge: true });
  surveysSnapshot.docs.forEach((survey) => writer.set(survey.ref, relatedChanges, { merge: true }));
  responseSnapshots.forEach((snapshot) =>
    snapshot.docs.forEach((response) => writer.set(response.ref, relatedChanges, { merge: true })),
  );
  await writer.close();
  res.json({ ok: true });
});

router.delete('/:sessionId', requireAuth, requireRole(['Administrador']), async (req: AuthenticatedRequest, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!(await assertTrainingAccess(req, sessionId))) {
    res.status(403).json({ message: 'Solo puedes eliminar tus propias capacitaciones.' });
    return;
  }

  const [
    participantsSnapshot,
    attendanceSnapshot,
    confirmationsSnapshot,
    surveysSnapshot,
  ] = await Promise.all([
    adminDb.collection('participants').where('training_session_id', '==', sessionId).get(),
    adminDb.collection('attendance').where('training_session_id', '==', sessionId).get(),
    adminDb.collection('confirmations').where('training_session_id', '==', sessionId).get(),
    adminDb.collection('surveys').where('training_session_id', '==', sessionId).get(),
  ]);

  const surveyIds = surveysSnapshot.docs.map((doc) => doc.id);
  const responseSnapshots = await Promise.all(
    surveyIds.map((surveyId) =>
      adminDb.collection('responses').where('training_survey_id', '==', surveyId).get(),
    ),
  );

  const writer = adminDb.bulkWriter();
  writer.delete(adminDb.collection('sessions').doc(sessionId));
  participantsSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
  attendanceSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
  confirmationsSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
  surveysSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
  responseSnapshots.forEach((snapshot) =>
    snapshot.docs.forEach((doc) => writer.delete(doc.ref)),
  );
  await writer.close();

  res.json({ ok: true });
});

router.post(
  '/:sessionId/participants',
  canManageTraining,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!(await assertTrainingAccess(req, req.params.sessionId))) {
      res.status(403).json({ message: 'Solo puedes cargar personas en tus propias capacitaciones.' });
      return;
    }
    const parsed = z.object({
      participants: z.array(entitySchema).min(1).max(2000),
      attendance: z.array(entitySchema).max(10000),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Datos de participantes invalidos.' });
      return;
    }
    const writer = adminDb.bulkWriter();
    parsed.data.participants.forEach((participant) =>
      writer.set(adminDb.collection('participants').doc(participant.id), participant),
    );
    parsed.data.attendance.forEach((record) =>
      writer.set(adminDb.collection('attendance').doc(record.id), record),
    );
    await writer.close();
    res.status(201).json({ ok: true, added: parsed.data.participants.length });
  },
);

export { router as trainingRoutes };
