import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { getPostgresPool, closePostgresPool } from '../../backend/src/postgres';
import { isInitialAttendanceComplete, isBusinessDate } from '../../backend/src/services/trainingSchedule';

test('initial attendance uses the existing withdrawal exemption without inventing attendance', () => {
  assert.equal(isInitialAttendanceComplete('s', [{ id: 'p', estado_final: 'Desistió' }], []), true);
  for (const estado_final of ['En formación', 'Pendiente de alta', 'Completó capacitación']) {
    assert.equal(isInitialAttendanceComplete('s', [{ id: 'p', estado_final }], []), false);
  }
});

test('Culqi assignment enables legacy and split attendance transactionally without duplicates', async (t) => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
  const pool = getPostgresPool();
  type Doc = Record<string, any>;
  let session: Doc;
  let participants: Doc[];
  let attendance: Doc[];
  let module: Doc | undefined;
  let inserts = 0;
  let snapshot: any;
  const reset = (split = false) => {
    session = { id: 's', campaña: 'Culqi', generation_code: 'CU', fecha_inicio: '2026-10-05', estado: 'En curso',
      training_days: split ? 5 : 10, ...(split ? { training_model: 'split_ojt' } : {}),
      formador_capacitacion_inicial_ids: ['initial'], formador_ojt_ids: ['ojt'], formador_ojt_nombres: ['OJT'] };
    participants = [{ id: 'p', training_session_id: 's' }, { id: 'withdrawn', training_session_id: 's', estado_final: 'Desistió' }];
    attendance = [1, 2, 3, 4, 5].map((dia) => ({ id: `initial-${dia}`, participant_id: 'p', training_session_id: 's', dia, estado_asistencia: 'Asistió' }));
    module = undefined; inserts = 0;
  };
  const rows = (docs: Doc[]) => ({ rows: docs.map((payload) => ({ document_id: payload.id, payload })) });
  const client = { release() {}, query: async (sql: string, params: any[] = []): Promise<any> => {
    if (sql === 'BEGIN') { snapshot = structuredClone({ session, attendance, module }); return rows([]); }
    if (sql === 'ROLLBACK') { ({ session, attendance, module } = snapshot); return rows([]); }
    if (sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return rows([]);
    if (sql.startsWith('SELECT') && sql.includes("collection_name = 'sessions'")) return rows([session]);
    if (sql.startsWith('SELECT') && sql.includes("collection_name = 'participants'")) return rows(participants);
    if (sql.startsWith('SELECT') && sql.includes("collection_name = 'attendance'")) return rows(attendance);
    if (sql.startsWith('SELECT') && sql.includes("collection_name = 'ojt_modules'")) return rows(module ? [module] : []);
    if (sql.includes('jsonb_array_elements')) {
      inserts++;
      const records: Doc[] = JSON.parse(params[0]);
      const missing = records.filter((record) => !attendance.some((old) => old.id === record.id));
      attendance.push(...missing);
      return rows(missing);
    }
    if (sql.includes("VALUES ('ojt_modules'")) { module = JSON.parse(params[1]); return rows([]); }
    if (sql.startsWith('UPDATE') && sql.includes("collection_name = 'sessions'")) { session = JSON.parse(params[1]); return rows([]); }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  t.mock.method(pool, 'query', async () => rows([]));
  t.mock.method(pool, 'connect', async () => client);
  const require = createRequire(new URL('../../backend/package.json', import.meta.url));
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const app = initializeApp({ projectId: 'culqi-isolated-test' });
  try {
    const { trainingRoutes } = await import('../../backend/src/routes/trainingRoutes');
    const handler = (trainingRoutes as any).stack.find((layer: any) => layer.route?.path === '/:sessionId/assign-ojt').route.stack.at(-1).handle;
    const invoke = async (rol = 'Administrador', uid = 'admin', readonly = false) => {
      let status = 200; let body: any;
      const res = { status: (code: number) => { status = code; return res; }, json: (data: any) => { body = data; return res; } };
      await handler({ params: { sessionId: 's' }, user: { rol, uid, module_view_only: readonly ? ['formacion:capacitaciones'] : [] } }, res);
      return { status, body };
    };
    await t.test('legacy Culqi reuses marked D6, inserts only missing weekdays and retries safely', async () => {
      reset();
      attendance.push({ id: 'historical-six', participant_id: 'p', training_session_id: 's', dia: 6, fecha: '2026-10-12', estado_asistencia: 'Tardanza', observacion: 'Keep' });
      const historical = structuredClone(attendance);
      const result = await invoke('Formador', 'initial');
      assert.equal(result.status, 200);
      assert.equal(result.body.attendance.length, 10);
      assert.equal(inserts, 1);
      assert.equal(session.training_model, undefined);
      for (const original of historical) assert.deepEqual(attendance.find((record) => record.id === original.id), original);
      assert.equal(attendance.filter((record) => record.participant_id === 'p' && record.dia === 6).length, 1);
      assert.ok(result.body.attendance.every((record: Doc) => isBusinessDate(record.fecha)));
      const id = module!.id;
      assert.equal((await invoke()).status, 200);
      assert.equal(attendance.length, 15);
      assert.equal(module!.id, id);
      assert.equal(inserts, 1);
    });
    await t.test('new split Culqi enables D6-D10 after completing D1-D5', async () => {
      reset(true);
      attendance[4].estado_asistencia = 'Pendiente';
      assert.equal((await invoke()).status, 409);
      assert.equal(module, undefined);
      attendance[4].estado_asistencia = 'Feriado';
      assert.equal((await invoke()).status, 200);
      assert.equal(attendance.length, 15);
      assert.equal(session.training_model, 'split_ojt');
    });
    await t.test('permissions, missing trainer, closed training and excluded campaigns remain blocked', async () => {
      reset();
      for (const [rol, uid, readonly] of [['Formador', 'ojt', false], ['Formador', 'unassigned', false], ['Reclutador', 'recruiter', false], ['Administrador', 'admin', true]] as const) {
        assert.equal((await invoke(rol, uid, readonly)).status, 403);
      }
      session.formador_ojt_ids = [];
      assert.equal((await invoke()).status, 400);
      reset(); session.estado = 'Capacitación cerrada';
      assert.equal((await invoke()).status, 409);
      for (const campaña of ['GPON', 'Equifax']) { reset(); session.campaña = campaña; assert.equal((await invoke()).status, 400); }
    });
    await t.test('an assigned module can recover missing records without replacing historical attendance', async () => {
      reset(); await invoke();
      const id = module!.id;
      attendance = attendance.filter((record) => !(record.participant_id === 'p' && record.dia === 10));
      assert.equal((await invoke()).status, 200);
      assert.equal(module!.id, id);
      assert.equal(attendance.length, 15);
      module!.estado = 'Cerrado';
      assert.equal((await invoke()).status, 409);
    });
  } finally { await deleteApp(app); await closePostgresPool(); }
});
