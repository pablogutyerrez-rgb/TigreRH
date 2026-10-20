import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { dataDb } from '../../backend/src/hybridDb';
import { updateParticipantDocument } from '../../backend/src/services/participantDocumentService';
import { getScheduledTrainingDays, hasCampaignOjt, isBusinessDate, isInitialAttendanceComplete } from '../../backend/src/services/trainingSchedule';
import { getBusinessDayDate } from './trainingDays';

test('campaign schedules use five or ten business days across weekends and years', () => {
  for (const campaign of ['Entel Empresas RUC 10', 'Entel Empresas RUC 20', 'Culqi']) {
    assert.equal(getScheduledTrainingDays(campaign), 10);
    assert.equal(hasCampaignOjt(campaign), true);
    assert.equal(getBusinessDayDate('2026-10-12', getScheduledTrainingDays(campaign)), '2026-10-23');
  }
  for (const campaign of ['GPON', 'Equifax', 'Fija']) {
    assert.equal(getScheduledTrainingDays(campaign), 5);
    assert.equal(hasCampaignOjt(campaign), false);
    assert.equal(getBusinessDayDate('2026-10-12', getScheduledTrainingDays(campaign)), '2026-10-16');
  }
  assert.equal(getBusinessDayDate('2026-12-28', 10), '2027-01-08');
  for (let day = 1; day <= 10; day++) assert.equal(isBusinessDate(getBusinessDayDate('2026-10-16', day)), true);
  for (const date of ['2026-10-17', '2026-10-18', '2026-02-30', '', 'invalid']) assert.equal(isBusinessDate(date), false);
});

test('OJT becomes available after initial attendance, preserving dropout exemptions and session isolation', () => {
  const participants = [{ id: 'p' }];
  const records = [1, 2, 3, 4, 5].map((dia) => ({ participant_id: 'p', training_session_id: 's', dia, estado_asistencia: 'Asistió' }));
  assert.equal(isInitialAttendanceComplete('s', participants, records), true);
  assert.equal(isInitialAttendanceComplete('s', participants, records.slice(1)), false);
  assert.equal(isInitialAttendanceComplete('s', participants, [{ ...records[4] }]), false);
  assert.equal(isInitialAttendanceComplete('other', participants, records), false);
  assert.equal(isInitialAttendanceComplete('s', [], records), false);
  assert.equal(isInitialAttendanceComplete('s', participants, records.map((r) => ({ ...r, estado_asistencia: 'Pendiente' }))), false);
  assert.equal(isInitialAttendanceComplete('s', participants, [{ ...records[0], estado_asistencia: 'Desistió' }]), true);
});

test('document correction and affected routes use existing records atomically', async (t) => {
  type Data = Record<string, any>;
  let store: Record<string, Map<string, Data>>;
  let sequence = 0;
  let rejectCommit = false;
  const reset = () => {
    rejectCommit = false;
    store = {
      sessions: new Map([['s', { id: 's', campaña: 'Culqi', training_session_id: 's', reclutador_id: 'recruiter' }]]),
      participants: new Map([['p', { id: 'p', training_session_id: 's', dni: '12345678', selection_applicant_id: 'a', resultado_formacion: 'Apto', evaluacion_nota: 18 }]]),
      selection_applicants: new Map([['a', { id: 'a', participant_id: 'p', dni: '12345678', historial: ['keep'] }]]),
      surveys: new Map([['si', { id: 'si', training_session_id: 's' }], ['so', { id: 'so', survey_type: 'ojt', ojt_module_id: 'm' }], ['ops', { id: 'ops', survey_type: 'operaciones' }]]),
      ojt_modules: new Map([['m', { id: 'm', generation_ids: ['s', 's2'], participant_ids: ['p'] }]]),
      responses: new Map([
        ['ri', { id: 'ri', training_survey_id: 'si', participant_id: 'p', dni: '12345678', q1: 4, fecha_respuesta: '2026-10-01' }],
        ['ro', { id: 'ro', training_survey_id: 'so', dni: '12345678', q1: 5 }],
        ['rx', { id: 'rx', training_survey_id: 'other', dni: '12345678', q1: 3 }],
        ['ops', { id: 'ops', training_survey_id: 'ops', survey_type: 'operaciones', q1: 5 }],
      ]),
      attendance: new Map([['att', { id: 'att', participant_id: 'p', training_session_id: 's', dia: 5, estado_asistencia: 'Asistió' }]]),
      logs: new Map([['old', { id: 'old', valor_anterior: 'keep' }]]),
    };
  };
  const collection = (name: string) => {
    const rows = store[name] ||= new Map();
    const doc = (id = `generated-${++sequence}`): any => ({ id, name,
      get: async () => ({ id, ref: doc(id), exists: rows.has(id), data: () => rows.get(id) || {} }),
      create: async (data: Data) => {
        if (rows.has(id)) throw Object.assign(new Error('Duplicate'), { code: 6 });
        rows.set(id, { ...data });
      },
      set: async (data: Data, options?: { merge?: boolean }) => { rows.set(id, { ...(options?.merge ? rows.get(id) : {}), ...data }); },
    });
    const query = (filters: Array<[string, unknown]> = []): any => ({
      doc,
      where: (field: string, _op: string, value: unknown) => query([...filters, [field, value]]),
      limit: (_count: number) => query(filters),
      get: async () => {
        const docs = await Promise.all([...rows.keys()].filter((id) => filters.every(([field, value]) => rows.get(id)?.[field] === value)).map((id) => doc(id).get()));
        return { docs, empty: !docs.length };
      },
    });
    return query();
  };
  const writer = () => {
    const pending: Array<() => Promise<void>> = [];
    return { get: (ref: any) => ref.get(), set: (ref: any, data: Data, options?: any) => { pending.push(() => ref.set(data, options)); },
      close: async () => { if (rejectCommit) throw new Error('Simulated write failure'); for (const write of pending) await write(); } };
  };
  t.mock.method(dataDb, 'collection', collection);
  t.mock.method(dataDb, 'bulkWriter', writer);
  t.mock.method(dataDb, 'runTransaction', async (callback: any) => { const tx = writer(); const result = await callback(tx); await tx.close(); return result; });
  const actor = { uid: 'admin', nombre: 'Admin', rol: 'Administrador' };
  const change = { training_session_id: 's', dni: '00130365', nombres: 'Corrected' };

  await t.test('DNI/CE correction preserves ids, answers, attendance, history and assignments', async () => {
    reset();
    const originalAttendance = structuredClone([...store.attendance.values()]);
    const originalModules = structuredClone([...store.ojt_modules.values()]);
    await updateParticipantDocument('p', change, actor);
    assert.equal(store.participants.size, 1);
    assert.equal(store.participants.get('p')!.dni, '00130365');
    assert.equal(store.participants.get('p')!.evaluacion_nota, 18);
    assert.equal(store.selection_applicants.get('a')!.dni, '00130365');
    for (const id of ['ri', 'ro']) { assert.equal(store.responses.get(id)!.dni, '00130365'); assert.equal(store.responses.get(id)!.participant_id, 'p'); }
    assert.equal(store.responses.get('ri')!.q1, 4);
    assert.equal(store.responses.get('ri')!.fecha_respuesta, '2026-10-01');
    assert.equal(store.responses.get('rx')!.dni, '12345678');
    assert.equal('dni' in store.responses.get('ops')!, false);
    assert.deepEqual([...store.attendance.values()], originalAttendance);
    assert.deepEqual([...store.ojt_modules.values()], originalModules);
    assert.equal(store.logs.get('old')!.valor_anterior, 'keep');
    assert.equal([...store.logs.values()].at(-1)!.valor_anterior, '12345678');
  });
  await t.test('invalid, duplicate and failed changes never partially update linked data', async () => {
    reset();
    for (const dni of ['abc', '123', '', '1234567890123456']) await assert.rejects(updateParticipantDocument('p', { ...change, dni }, actor));
    store.participants.set('other', { id: 'other', dni: '130365', training_session_id: 's2' });
    await assert.rejects(updateParticipantDocument('p', change, actor), /ya esta registrado/);
    store.participants.delete('other');
    store.selection_applicants.set('other', { dni: '00130365' });
    await assert.rejects(updateParticipantDocument('p', change, actor), /ya esta registrado/);
    store.selection_applicants.delete('other');
    rejectCommit = true;
    await assert.rejects(updateParticipantDocument('p', change, actor), /Simulated/);
    assert.equal(store.participants.get('p')!.dni, '12345678');
    assert.equal(store.responses.get('ri')!.dni, '12345678');
    assert.equal(store.selection_applicants.get('a')!.dni, '12345678');
  });

  const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
  const { initializeApp, deleteApp } = backendRequire('firebase-admin/app');
  const app = initializeApp({ projectId: 'attendance-isolated-test' });
  try {
    const { operationRoutes } = await import('../../backend/src/routes/operationRoutes');
    const { trainingRoutes } = await import('../../backend/src/routes/trainingRoutes');
    const { bootstrapRoutes } = await import('../../backend/src/routes/bootstrapRoutes');
    const { publicSurveyRoutes } = await import('../../backend/src/routes/publicSurveyRoutes');
    const invoke = async (router: any, path: string, method: string, body: Data, role: string, userId = 'admin', viewOnly: string[] = []) => {
      const handler = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
      let code = 200; let payload: any;
      const res = { status: (value: number) => { code = value; return res; }, json: (value: any) => { payload = value; return res; } };
      await handler({ body, params: { id: body.id || 'p', sessionId: 's' }, user: { ...actor, uid: userId, rol: role, module_view_only: viewOnly } }, res);
      return { code, payload };
    };
    await t.test('authorized document edits and read-only or unassigned restrictions', async () => {
      for (const role of ['Administrador', 'Reclutador', 'Coordinador']) {
        reset();
        assert.equal((await invoke(operationRoutes, '/participants/:id', 'put', change, role, role === 'Reclutador' ? 'recruiter' : 'admin')).code, 200);
      }
      for (const [role, user, viewOnly] of [['Formador', 'trainer', []], ['Analista', 'analyst', []], ['Reclutador', 'other', []], ['Coordinador', 'c', ['formacion:asistencia']]] as const) {
        reset();
        assert.equal((await invoke(operationRoutes, '/participants/:id', 'put', change, role, user, [...viewOnly])).code, 403);
        assert.equal(store.participants.get('p')!.dni, '12345678');
      }
    });
    await t.test('creation persists full campaign schedule with only five initial attendance rows', async () => {
      for (const campaña of ['Entel Empresas RUC 10', 'Entel Empresas RUC 20', 'Culqi', 'GPON', 'Equifax']) {
        reset();
        const body = {
          session: { id: 'new', campaña, generation_code: 'NEW', fecha_inicio: '2026-10-12' },
          survey: { id: 'new-survey' }, participants: [{ id: 'np', training_session_id: 'new' }],
          attendance: [1, 2, 3, 4, 5].map((dia) => ({ id: `new-${dia}`, participant_id: 'np', training_session_id: 'new', dia, estado_asistencia: 'Seleccionar' })),
        };
        assert.equal((await invoke(trainingRoutes, '/', 'post', body, 'Reclutador', 'recruiter')).code, 201);
        assert.equal(store.sessions.get('new')!.fecha_fin, getBusinessDayDate('2026-10-12', getScheduledTrainingDays(campaña)));
        assert.equal([...store.attendance.values()].filter((record) => record.training_session_id === 'new').length, 5);
        assert.ok([...store.attendance.values()].filter((record) => record.training_session_id === 'new').every((record) => isBusinessDate(record.fecha)));
        body.session.fecha_inicio = '2026-10-17';
        assert.equal((await invoke(trainingRoutes, '/', 'post', body, 'Administrador')).code, 400);
      }
    });
    await t.test('Herramientas preserves dropout comments and evidence, and five-day campaigns do not require OJT', async () => {
      for (const estado_asistencia of ['Baja', 'Desistió']) {
        reset();
        const record = { training_session_id: 's', participant_id: 'p', dia: 3, estado_asistencia,
          motivo_desercion: 'Herramientas', observacion: 'Equipo no disponible', evidencia_imagen: 'existing-evidence' };
        assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', record, 'Administrador')).code, 200);
        assert.equal(store.attendance.get('p')!.motivo_desercion, 'Herramientas');
        assert.equal(store.attendance.get('p')!.observacion, record.observacion);
        assert.equal(store.attendance.get('p')!.evidencia_imagen, record.evidencia_imagen);
      }
      for (const campaña of ['GPON', 'Equifax', 'Culqi', 'Entel Empresas RUC 10', 'Entel Empresas RUC 20']) {
        reset();
        Object.assign(store.sessions.get('s')!, { campaña, training_model: 'split_ojt' });
        const result = await invoke(operationRoutes, '/confirmations/:id', 'put',
          { training_session_id: 's', participant_id: 'p', estado_alta: 'Alta confirmada' }, 'Administrador');
        assert.equal(result.code, hasCampaignOjt(campaña) ? 409 : 200);
      }
    });
    await t.test('training synchronization respects existing scope and sees corrected DNI without stale cache', async () => {
      reset();
      store.sessions.get('s')!.formador_id = 'trainer';
      const handler = (bootstrapRoutes as any).stack.find((layer: any) => layer.route?.path === '/').route.stack.at(-1).handle;
      const read = async (rol: string, uid: string) => {
        let result: any;
        const res = { set: () => res, status: () => res, json: (data: any) => { result = data; return res; } };
        await handler({ user: { rol, uid, module_access: [] }, query: { scope: 'training' } }, res);
        return result;
      };
      assert.equal((await read('Administrador', 'admin')).participants[0].dni, '12345678');
      await updateParticipantDocument('p', change, actor);
      for (const [rol, uid] of [['Administrador', 'admin'], ['Reclutador', 'recruiter'], ['Formador', 'trainer']]) {
        const data = await read(rol, uid);
        assert.equal(data.participants[0].dni, change.dni);
        assert.equal(data.attendance.length, 1);
        assert.equal(data.ojt_modules.length, 1);
      }
      const outside = await read('Formador', 'unassigned');
      for (const field of ['participants', 'sessions', 'attendance', 'ojt_modules', 'confirmations']) assert.deepEqual(outside[field], []);
    });
    await t.test('survey validation recognizes corrected DNI and still blocks the existing response', async () => {
      reset();
      Object.assign(store.surveys.get('si')!, { token: 'INITIAL', estado: 'Habilitada' });
      await updateParticipantDocument('p', change, actor);
      const handler = (publicSurveyRoutes as any).stack.find((layer: any) => layer.route?.path === '/:token').route.stack.at(-1).handle;
      const lookup = async (dni: string) => {
        let code = 200;
        const res = { status: (value: number) => { code = value; return res; }, set: () => res, json: () => res };
        await handler({ params: { token: 'INITIAL' }, query: { dni } }, res);
        return code;
      };
      assert.equal(await lookup(change.dni), 409);
      assert.equal(await lookup('12345678'), 404);
      store.responses.delete('ri');
      assert.equal(await lookup(change.dni), 200);
    });
    await t.test('attendance endpoints enforce Peru hours, phase, reopen expiry and OJT closure', async (t) => {
      t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-13T12:59:00Z') });
      const prepare = () => {
        reset();
        Object.assign(store.sessions.get('s')!, {
          campaña: 'Culqi', training_model: 'split_ojt', ojt_module_id: 'm', estado: 'En curso',
          formador_capacitacion_inicial_ids: ['initial'], formador_ojt_ids: ['ojt'],
        });
        store.ojt_modules.get('m')!.estado = 'Abierto';
      };
      const record = (dia: number) => ({ id: `a-${dia}`, participant_id: 'p', training_session_id: 's', dia, estado_asistencia: 'Asistió' });
      for (const [utc, expected] of [['2026-10-13T12:59:00Z', 403], ['2026-10-13T13:00:00Z', 200],
        ['2026-10-14T00:00:00Z', 200], ['2026-10-14T00:01:00Z', 403]] as const) {
        t.mock.timers.setTime(new Date(utc).getTime());
        for (const [day, user] of [[1, 'initial'], [6, 'ojt']] as const) {
          prepare();
          for (const role of ['Formador', 'Analista']) {
            assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', record(day), role, user)).code, expected);
            assert.equal((await invoke(operationRoutes, '/attendance/bulk', 'put', { records: [record(day)] }, role, user)).code, expected);
          }
          assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', record(day), 'Administrador')).code, 200);
        }
      }
      prepare();
      store.reopens = new Map([['r', { training_session_id: 's', dia_capacitacion: 6, estado: 'aprobada', habilitado_hasta: new Date(Date.now() + 60000).toISOString() }]]);
      assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', record(6), 'Formador', 'ojt')).code, 200);
      assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', record(7), 'Formador', 'ojt')).code, 403);
      assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', record(6), 'Formador', 'initial')).code, 403);
      store.reopens.get('r')!.habilitado_hasta = new Date(Date.now() - 1).toISOString();
      assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', record(6), 'Formador', 'ojt')).code, 403);
      store.reopens.get('r')!.habilitado_hasta = new Date(Date.now() + 60000).toISOString();
      store.reopens.get('r')!.estado = 'pendiente';
      assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', record(6), 'Formador', 'ojt')).code, 403);
      store.reopens.get('r')!.estado = 'aprobada';
      const dropout = (day: number) => ({ ...record(day), estado_asistencia: 'Baja', motivo_desercion: 'Herramientas', observacion: 'Falla de equipo' });
      assert.equal((await invoke(operationRoutes, '/attendance/bulk', 'put', { records: [dropout(6), dropout(7), dropout(8)] }, 'Formador', 'ojt')).code, 200);
      assert.equal((await invoke(operationRoutes, '/attendance/bulk', 'put', { records: [{ ...dropout(9), observacion: 'Otra baja' }] }, 'Formador', 'ojt')).code, 403);
      assert.equal((await invoke(operationRoutes, '/attendance/bulk', 'put', { records: [
        record(6), { ...record(7), estado_asistencia: 'Seleccionar' }, { ...record(8), estado_asistencia: 'Seleccionar' },
      ] }, 'Formador', 'ojt')).code, 200);
      t.mock.timers.setTime(new Date('2026-10-14T16:00:00Z').getTime());
      for (const closedModule of [false, true]) {
        prepare();
        if (closedModule) store.ojt_modules.get('m')!.estado = 'Cerrado';
        else store.sessions.get('s')!.estado = 'Capacitación cerrada';
        const before = structuredClone([...store.attendance.values()]);
        assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', record(6), 'Formador', 'ojt')).code, 403);
        assert.equal((await invoke(operationRoutes, '/attendance/bulk', 'put', { records: [record(6)] }, 'Formador', 'ojt')).code, 403);
        assert.deepEqual([...store.attendance.values()], before);
        assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', record(6), 'Administrador')).code, 200);
      }
      prepare();
      assert.equal((await invoke(trainingRoutes, '/:sessionId', 'patch', { estado: 'Capacitación cerrada' }, 'Formador', 'ojt')).code, 403);
      t.mock.timers.reset();
    });
    await t.test('correcting initial attendance adds a newly eligible participant to the assigned OJT group', async () => {
      reset();
      Object.assign(store.sessions.get('s')!, {
        campaña: 'Culqi',
        fecha_inicio: '2026-10-12',
        training_model: 'split_ojt',
        ojt_module_id: 'm',
      });
      store.ojt_modules.set('m', {
        id: 'm',
        nombre: 'OJT Culqi',
        generation_ids: ['s'],
        participant_ids: [],
        formador_ojt_ids: ['ojt'],
        formador_ojt_nombres: ['OJT'],
      });
      store.participants.get('p')!.evaluacion_nota = 16;
      store.participants.get('p')!.resultado_formacion = 'Apto';
      store.attendance = new Map([1, 2, 3, 4, 5].map((dia) => [`initial-${dia}`, {
        id: `initial-${dia}`,
        participant_id: 'p',
        training_session_id: 's',
        dia,
        estado_asistencia: dia === 5 ? 'Faltó' : 'Asistió',
      }]));

      const correction = {
        id: 'initial-5',
        participant_id: 'p',
        training_session_id: 's',
        dia: 5,
        estado_asistencia: 'Asistió',
      };
      assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', correction, 'Administrador')).code, 200);
      assert.deepEqual(store.ojt_modules.get('m')!.participant_ids, ['p']);
      const ojtRecords = [...store.attendance.values()].filter((record) => record.participant_id === 'p' && record.dia >= 6);
      assert.deepEqual(ojtRecords.map((record) => record.dia).sort((left, right) => left - right), [6, 7, 8, 9, 10]);
      assert.ok(ojtRecords.every((record) => record.estado_asistencia === 'Seleccionar'));

      assert.equal((await invoke(operationRoutes, '/attendance/:id', 'put', correction, 'Administrador')).code, 200);
      assert.deepEqual(store.ojt_modules.get('m')!.participant_ids, ['p']);
      assert.equal([...store.attendance.values()].filter((record) => record.participant_id === 'p' && record.dia >= 6).length, 5);
    });
  } finally { await deleteApp(app); }
});
