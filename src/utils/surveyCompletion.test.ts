import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { dataDb } from '../../backend/src/hybridDb';
import { publicSurveyRoutes } from '../../backend/src/routes/publicSurveyRoutes';
import { findParticipantSurveyResponse, getSurveyParticipants } from './surveyCompletion';
import type { AttendanceRecord, OjtModule, Participant, TrainingSession, TrainingSurvey } from '../types';

const participant = { id: 'p1', training_session_id: 's1', dni: '130365', nombres: 'Test', apellidos: 'Survey', evaluacion_nota: 16 } as Participant;
const session = { id: 's1', ojt_module_id: 'm1', estado: 'Capacitación cerrada' } as TrainingSession;
const module = { id: 'm1', generation_ids: ['s1'], participant_ids: ['p2'] } as OjtModule;
const initial = { id: 'initial', training_session_id: 's1', token: 'INITIAL', estado: 'Habilitada' } as TrainingSurvey;
const ojt = { id: 'ojt', training_session_id: '', ojt_module_id: 'm1', survey_type: 'ojt', token: 'OJT', estado: 'Habilitada' } as TrainingSurvey;
const operations = { id: 'ops', training_session_id: '', survey_type: 'operaciones', token: 'OPS', estado: 'Habilitada', supervisor_nombres: ['Supervisor'] } as TrainingSurvey;
const attendance = [{ id: 'a1', participant_id: 'p1', training_session_id: 's1', dia: 5, estado_asistencia: 'Desistió' }] as AttendanceRecord[];
const ratings = { q1: 4, q2: 4, q3: 4, q4: 4, q5: 4, q6: 4, q7: 4, q8: 4 };
const answers = { ...ratings, dni: '00130365', comentario_positivo: 'Bien', aspecto_mejora: 'Practica' };

test('completion matches survey and participant, normalizes DNI/CE and accepts late responses', () => {
  const responses = [{ training_survey_id: 'initial', dni: '00130365', fecha_respuesta: '2026-10-12' }];
  assert.ok(findParticipantSurveyResponse('initial', participant, responses));
  assert.equal(findParticipantSurveyResponse('ojt', participant, responses), undefined);
  assert.ok(findParticipantSurveyResponse('initial', participant, [{ training_survey_id: 'initial', participant_id: 'p1' }]));
  assert.equal(findParticipantSurveyResponse('initial', { id: 'other', dni: '' }, [{ training_survey_id: 'initial' }]), undefined);
  assert.equal(getSurveyParticipants(initial, [participant], attendance, [session], [module]).length, 1);
});

test('OJT completion uses its group and operations has no participant tracking', () => {
  const participants = [participant, { id: 'p2', training_session_id: 'other' }, { id: 'p3', training_session_id: 'outside' }] as Participant[];
  assert.deepEqual(getSurveyParticipants(ojt, participants, [], [session], [module]).map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(getSurveyParticipants(operations, participants, attendance, [session], [module]), []);
  assert.deepEqual(getSurveyParticipants(ojt, participants, [], [session], []), []);
});

// Exercise the actual public route handlers with an isolated document store.
test('public survey routes: availability, duplicates and anonymous operations', async (t) => {
  type Data = Record<string, any>;
  let store: Record<string, Map<string, Data>>;
  const reset = (status: string) => {
    store = {
      surveys: new Map([initial, ojt, operations].map((survey) => [survey.id, { ...survey }])),
      sessions: new Map([['s1', { ...session, estado: status }]]),
      ojt_modules: new Map([['m1', { ...module, estado: status }]]),
      participants: new Map([['p1', { ...participant }]]),
      attendance: new Map(attendance.map((record) => [record.id, { ...record }])),
      responses: new Map(), survey_public_nonces: new Map(),
    };
  };
  const collection = (name: string) => {
    const rows = store[name] ||= new Map();
    const snapshot = (id: string) => ({ id, exists: rows.has(id), data: () => rows.get(id) || {} });
    const query = (filters: Array<[string, unknown]> = [], maximum = Infinity): any => ({
      where: (field: string, _operator: string, value: unknown) => query([...filters, [field, value]], maximum),
      limit: (value: number) => query(filters, value),
      get: async () => ({ docs: [...rows.keys()].filter((id) => filters.every(([field, value]) => rows.get(id)?.[field] === value)).slice(0, maximum).map(snapshot) }),
      doc: (id: string) => ({
        get: async () => snapshot(id),
        create: async (data: Data) => {
          if (rows.has(id)) throw Object.assign(new Error('Duplicate'), { code: 6 });
          rows.set(id, { ...data });
        },
        set: async (data: Data) => { rows.set(id, { ...rows.get(id), ...data }); },
      }),
    });
    return query();
  };
  t.mock.method(dataDb, 'collection', collection);
  const invoke = async (path: string, token: string, body: Data = {}, dni = '00130365') => {
    const route = (publicSurveyRoutes as any).stack.find((layer: any) => layer.route?.path === path).route;
    let status = 200;
    let result: any;
    const res = { status: (value: number) => { status = value; return res; }, set: () => res, json: (value: any) => { result = value; return res; } };
    await route.stack[0].handle({ params: { token }, query: { dni }, body }, res);
    return { status, body: result };
  };

  await t.test('enabled links accept answers regardless of training status', async () => {
    for (const status of ['Pendiente de inicio', 'Abierto', 'En curso', 'Finalizada', 'Capacitación cerrada', 'Campaña cerrada', 'Cerrado']) {
      reset(status);
      for (const token of ['INITIAL', 'OJT', 'OPS']) {
        const metadata = await invoke('/:token/metadata', token);
        assert.equal(metadata.status, 200, `${status}: ${token}`);
        if (token !== 'OPS') assert.equal((await invoke('/:token', token)).status, 200);
        const body = token === 'OPS' ? { ...ratings, submission_nonce: metadata.body.submission_nonce, supervisor_nombre: 'Supervisor' } : answers;
        assert.equal((await invoke('/:token/responses', token, body)).status, 201, `${status}: ${token}`);
      }
    }
  });
  await t.test('manual disabling blocks all public routes', async () => {
    for (const status of ['Borrador', 'Deshabilitada', 'Cerrada', 'Eliminada']) {
      reset('En curso');
      for (const survey of store.surveys.values()) {
        survey.estado = status;
        for (const path of ['/:token/metadata', '/:token', '/:token/responses']) {
          assert.equal((await invoke(path, survey.token, answers)).status, 410);
        }
      }
    }
  });
  await t.test('one response per document and survey, including concurrent submissions', async () => {
    reset('Capacitación cerrada');
    const results = await Promise.all([invoke('/:token/responses', 'INITIAL', answers), invoke('/:token/responses', 'INITIAL', answers)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal((await invoke('/:token', 'INITIAL')).status, 409);
    assert.equal((await invoke('/:token/responses', 'OJT', answers)).status, 201);
    assert.equal((await invoke('/:token/responses', 'OJT', answers)).status, 409);
    assert.equal(store.responses.size, 2);
    assert.ok(findParticipantSurveyResponse('initial', participant, [...store.responses.values()] as any));
    assert.ok(findParticipantSurveyResponse('ojt', participant, [...store.responses.values()] as any));
    store.responses.set('historical', { training_survey_id: 'initial', dni: 130365 });
    assert.equal((await invoke('/:token/responses', 'INITIAL', answers)).status, 409);
  });
  await t.test('operations stays anonymous and permits separate submissions without participant blocking', async () => {
    reset('Capacitación cerrada');
    for (let index = 0; index < 2; index += 1) {
      const metadata = await invoke('/:token/metadata', 'OPS');
      const payload = { ...ratings, submission_nonce: metadata.body.submission_nonce, supervisor_nombre: 'Supervisor', dni: '00130365', participant_id: 'p1' };
      const result = await invoke('/:token/responses', 'OPS', payload);
      assert.equal(result.status, 201);
      for (const key of ['dni', 'participant_id', 'nombre_ejecutivo']) assert.equal(key in result.body.response, false);
      assert.equal((await invoke('/:token/responses', 'OPS', payload)).status, 409);
    }
    assert.equal(store.responses.size, 2);
  });
  await t.test('survey synchronization reads late answers and preserves the existing user scope', async () => {
    const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
    const { initializeApp, deleteApp } = backendRequire('firebase-admin/app');
    const app = initializeApp({ projectId: 'survey-isolated-test' });
    try {
      const { bootstrapRoutes } = await import('../../backend/src/routes/bootstrapRoutes');
      const handler = (bootstrapRoutes as any).stack.find((layer: any) => layer.route?.path === '/').route.stack.at(-1).handle;
      const bootstrap = async (role: string, id: string, scope?: string) => {
        let data: any;
        let status = 200;
        const res = { set: () => res, status: (value: number) => { status = value; return res; }, json: (value: any) => { data = value; return res; } };
        await handler({ user: { rol: role, uid: id, module_access: [] }, query: { scope } }, res);
        assert.equal(status, 200);
        return data;
      };
      reset('Capacitación cerrada');
      store.sessions.get('s1')!.formador_id = 'trainer';
      await bootstrap('Administrador', 'admin'); // Warm the ordinary bootstrap cache before the late answer.
      assert.equal((await invoke('/:token/responses', 'INITIAL', answers)).status, 201);
      assert.equal((await invoke('/:token/responses', 'OJT', answers)).status, 201);
      for (const role of ['Administrador', 'Analista', 'Coordinador', 'Reclutador', 'Sistemas', 'Formador']) {
        const data = await bootstrap(role, 'trainer', 'surveys');
        assert.deepEqual(Object.keys(data).sort(), ['responses', 'surveys']);
        assert.equal(data.responses.length, 2, role);
        assert.ok(findParticipantSurveyResponse('initial', participant, data.responses));
        assert.ok(findParticipantSurveyResponse('ojt', participant, data.responses));
      }
      const outside = await bootstrap('Formador', 'unassigned', 'surveys');
      assert.deepEqual(outside.surveys, []);
      assert.deepEqual(outside.responses, []);
      store.surveys.get('initial')!.link_assigned_user_ids = ['unassigned'];
      const assigned = await bootstrap('Formador', 'unassigned', 'surveys');
      assert.deepEqual(assigned.surveys.map((survey: any) => survey.id), ['initial']);
      assert.deepEqual(assigned.responses.map((response: any) => response.training_survey_id), ['initial']);
    } finally {
      await deleteApp(app);
    }
  });
});
