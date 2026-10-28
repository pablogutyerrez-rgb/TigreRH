import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRotationDashboard, hydrateRotationTermination, normalizeHeadcount, normalizeTerminations, rotationDate, saveRotationImport, getRotationDashboard, type RotationTermination } from './rotationService.js';
import { dataDb } from '../hybridDb.js';

const notification = (dni: string, fecha: string, motivo = 'Renuncia'): RotationTermination => ({
  id: `${dni}-${fecha}`, fecha, fecha_alta: '', campana: '', campana_origen: '', dni, nombre: '', proveedor: 'Proveedor', motivo,
  descripcion: 'Notificación validada', tipo: 'cese', verificado: true, raw: {}, imported_at: '', imported_by: '',
});
const result = buildRotationDashboard({
  sessions: [
    { id: 'ruc', campana: 'Entel Empresas RUC 10', fecha_fin: '2026-01-15' },
    { id: 'gpon', campana: 'GPON', fecha_fin: '2026-01-08' },
    { id: 'gpon-no-apto', campana: 'GPON', fecha_fin: '2026-01-08' },
    { id: 'reingreso', campana: 'Culqi', fecha_fin: '2026-02-15' },
  ],
  participants: [
    { id: 'p-ruc', training_session_id: 'ruc', dni: '70000001', nombres: 'Ana' },
    { id: 'p-gpon', training_session_id: 'gpon', dni: '70000002', nombres: 'Bruno', resultado_formacion: 'Apto' },
    { id: 'p-no', training_session_id: 'gpon-no-apto', dni: '70000003', resultado_formacion: 'No apto' },
    { id: 'p-reingreso', training_session_id: 'reingreso', dni: '70000001', nombres: 'Ana' },
  ],
  attendance: [
    { id: 'a1', participant_id: 'p-ruc', training_session_id: 'ruc', dia: 10, estado_asistencia: 'Asistió', fecha: '2026-01-15' },
    { id: 'a2', participant_id: 'p-gpon', training_session_id: 'gpon', dia: 5, estado_asistencia: 'Asistió', fecha: '2026-01-08' },
    { id: 'a3', participant_id: 'p-no', training_session_id: 'gpon-no-apto', dia: 5, estado_asistencia: 'Asistió', fecha: '2026-01-08' },
    { id: 'a4', participant_id: 'p-reingreso', training_session_id: 'reingreso', dia: 10, estado_asistencia: 'Asistió', fecha: '2026-02-15' },
  ],
  terminations: [notification('70000001', '2026-01-20'), notification('99999999', '2026-01-20')],
});
assert.equal(result.altas_historicas, 3);
assert.equal(result.total_bajas, 1);
assert.equal(result.total_dotacion, 2);
assert.equal(result.otros.length, 1);
assert.equal(result.by_campaign.find((item) => item.campana === 'GPON')?.altas, 1);
const [first] = normalizeTerminations([{ DNI: '70000001', 'Fecha de cese': '20/01/2026', Motivo: 'Renuncia' }]);
const [same] = normalizeTerminations([{ DNI: '70000001', 'Fecha de cese': '2026-01-20', Motivo: 'Renuncia' }]);
assert.equal(first.id, same.id);
console.log('rotation service tests passed');

const base = () => ({
  sessions: [{ id: 's', campana: 'Culqi' }],
  participants: [{ id: 'p', training_session_id: 's', dni: '00130365', nombres: 'Ana' }],
  attendance: [{ id: 'a', participant_id: 'p', training_session_id: 's', dia: 10, estado_asistencia: 'Asistió', fecha: '2026-01-10' }],
  terminations: [] as RotationTermination[],
});
const imported = (rows: Record<string, unknown>[]): RotationTermination[] => normalizeTerminations(rows).map((row) => ({ ...row, imported_at: '', imported_by: '' }));

test('dates, normalization and stable notification identity', () => {
  assert.equal(rotationDate(45292.8), '2024-01-01');
  assert.equal(rotationDate(new Date('2026-10-20T00:00:00Z')), '2026-10-20');
  for (const date of ['31/02/2026', '2026-13-01', 'invalid', '', -1, Infinity]) assert.equal(rotationDate(date), '');
  assert.throws(() => normalizeTerminations([{ DNI: '1', CESE: '31/02/2026' }]), /válida/);
  const [a] = normalizeTerminations([{ 'DNI/CE': '00130365', CESE: '20/01/2026', MOTIVO: 'Renuncia', DESCRIPCION: 'Voluntaria' }]);
  const [b] = normalizeTerminations([{ 'DNI/CE': '00130365', CESE: '2026-01-20', MOTIVO: 'Despido', DESCRIPCION: 'Actualización del detalle' }]);
  assert.notEqual(a.id, b.id);
  assert.equal(a.dni, '00130365');
  assert.equal(a.verificado, true);
  assert.equal(normalizeTerminations([{ DNI: '1', Fecha: '01/01/2026', CESE: '20/01/2026' }])[0].fecha, '2026-01-20');
});

test('all five campaigns, missing dates, conflicting attendance, and session isolation', () => {
  for (const campaign of ['Entel Empresas RUC 10', 'Entel Empresas RUC 20', 'Culqi', 'GPON', 'Equifax']) {
    const data = base(); data.sessions[0].campana = campaign;
    const five = ['GPON', 'Equifax'].includes(campaign);
    data.attendance[0].dia = five ? 5 : 10;
    Object.assign(data.participants[0], { resultado_formacion: 'Apto' });
    assert.equal(buildRotationDashboard(data).total_dotacion, 1, campaign);
    if (five) {
      Object.assign(data.participants[0], { resultado_formacion: 'No apto' });
      assert.equal(buildRotationDashboard(data).total_dotacion, 0);
    }
  }
  const data = base(); data.attendance[0].training_session_id = 'other';
  assert.equal(buildRotationDashboard(data).total_dotacion, 0);
  data.attendance[0].training_session_id = 's'; data.attendance[0].fecha = '';
  assert.equal(buildRotationDashboard(data).total_dotacion, 0);
  data.attendance[0].fecha = '2026-01-10'; data.attendance.push({ ...data.attendance[0], id: 'conflict', estado_asistencia: 'Faltó' });
  assert.equal(buildRotationDashboard(data).total_dotacion, 0);
});

test('unverified, administrative events and unmatched documents never deduct staff', () => {
  for (const fields of [{ MOTIVO: 'Por verificar' }, { MOTIVO: 'Renuncia', ESTADO: 'Pendiente' }, { MOTIVO: 'Cambio de proveedor' }, { DNI: 'unknown', MOTIVO: 'Renuncia' }]) {
    const data = base(); data.terminations = imported([{ DNI: '00130365', CESE: '20/01/2026', ...fields }]);
    const dashboard = buildRotationDashboard(data);
    assert.equal(dashboard.total_bajas, 0); assert.equal(dashboard.total_dotacion, 1);
    assert.equal(dashboard.detalle.length, 1);
  }
  const data = base(); data.terminations = imported([{ DNI: '00130365', CESE: '20/01/2026', MOTIVO: 'Despido', DESCRIPCION: '15' }]);
  assert.equal(buildRotationDashboard(data).total_bajas, 1);
  const [administrative] = normalizeTerminations([{ DNI: '00130365', 'FECHA INICIO - FIN': '01/10/2025 - 31/07/2026', 'MOTIVO NOTIFICACIÓN': 'Cambio de Régimen' }]);
  assert.equal(administrative.tipo, 'administrativo');
  assert.equal(administrative.verificado, true);
});

test('Notificaciones contractual dates drive permanence while Formación resolves the campaign', () => {
  const data = base();
  data.participants[0].nombres = 'Ana Torres';
  data.terminations = imported([{
    DNI: '00130365', 'NOMBRE Y APELLIDO': 'ANA TORRES', 'FECHA INICIO - FIN': '01/01/2026 - 20/01/2026',
    'MOTIVO NOTIFICACIÓN': 'Renuncia', 'PROVEEDOR SOCIO': 'CULQI', EMPRESA: 'AUTOMATIZATE CORPORATIVO E.I.R.L.',
  }]);
  const dashboard = buildRotationDashboard(data);
  assert.equal(dashboard.total_bajas, 1);
  assert.equal(dashboard.detalle[0].campana, 'Culqi');
  assert.equal(dashboard.detalle[0].fecha_alta, '2026-01-01');
  assert.equal(dashboard.detalle[0].permanencia_dias, 19);
});

test('a DNI match with a conflicting name remains pending in Otros', () => {
  const data = base();
  data.participants[0].nombres = 'Ana Torres';
  data.terminations = imported([{ DNI: '00130365', 'NOMBRE Y APELLIDO': 'Nombre Distinto', 'FECHA INICIO - FIN': '01/01/2026 - 20/01/2026', MOTIVO: 'Renuncia' }]);
  const dashboard = buildRotationDashboard(data);
  assert.equal(dashboard.total_bajas, 0);
  assert.equal(dashboard.otros.length, 1);
  assert.equal(dashboard.detalle[0].razon, 'Nombre no coincide con el alta de Formación');
  assert.equal(dashboard.detalle[0].permanencia_dias, 19);
});

test('rehydrates older notifications from their original Excel row without changing the record id', () => {
  const restored = hydrateRotationTermination({
    id: 'historic-row', dni: '77103807', fecha: '2026-06-03', fecha_alta: '2026-05-18', campana: '', campana_origen: '',
    nombre: '', proveedor: 'STRATEGIC PAY GROUP E.I.R.L.', motivo: '', descripcion: '', tipo: 'cese', verificado: false,
    validacion: 'Motivo de cese no verificado', imported_at: '2026-10-27T00:00:00.000Z', imported_by: 'admin',
    raw: { 'NOMBRE Y APELLIDO': 'MARIO ANDRE PANIZO CORONEL', DNI: '77103807', 'FECHA INICIO - FIN': '18/05/2026 - 03/06/2026', 'MOTIVO NOTIFICACIÓN': 'Renuncia', 'PROVEEDOR SOCIO': 'CULQI' },
  });
  assert.equal(restored.id, 'historic-row');
  assert.equal(restored.nombre, 'MARIO ANDRE PANIZO CORONEL');
  assert.equal(restored.motivo, 'Renuncia');
  assert.equal(restored.verificado, true);
});

test('active headcount snapshots supplement current staffing without duplicating Formación highs', () => {
  const [snapshot] = normalizeHeadcount([{ DNI: '00999999', 'NOMBRE Y APELLIDO': 'Bruno Activo', CAMPAÑA: 'Culqi', ESTADO: 'Activo', 'FECHA DE INGRESO': '01/02/2026', 'FECHA DE CORTE': '20/02/2026' }]);
  const data = base();
  const dashboard = buildRotationDashboard({ ...data, headcount: [{ ...snapshot, imported_at: '', imported_by: '' }] }, {}, '2026-02-20');
  assert.equal(dashboard.total_dotacion, 2);
  assert.equal(dashboard.altas_historicas, 2);
  assert.throws(() => normalizeHeadcount([{ DNI: '00999999', 'NOMBRE Y APELLIDO': 'Bruno Activo', CAMPAÑA: 'Culqi', ESTADO: 'Cesado', 'FECHA DE INGRESO': '01/02/2026', 'FECHA DE CORTE': '20/02/2026' }]));
});

test('historical active roster preserves operational fields and does not duplicate a Formación high', () => {
  const [snapshot] = normalizeHeadcount([{ DNI: '00130365', 'NOMBRE COMPLETO': 'Ana', CAMPAÑA: 'Culqi', ESTADO: 'Activo', Ciudad: 'Lima', TURNO: 'Full time', 'Perfil/Puesto': 'Ejecutivo', Supervisor: 'Supervisora', 'FECHA INICIO': '01/01/2026', 'FECHA DE CORTE': '20/02/2026' }]);
  const dashboard = buildRotationDashboard({ ...base(), headcount: [{ ...snapshot, imported_at: '', imported_by: '' }] }, {}, '2026-02-20');
  assert.equal(snapshot.supervisor, 'Supervisora');
  assert.equal(dashboard.total_dotacion, 1);
  assert.equal(dashboard.altas_historicas, 1);
});

test('coherent period stock, combined filters, zero staff and as-of dates', () => {
  const data = base(); data.terminations = imported([{ DNI: '00130365', CESE: '10/02/2026', MOTIVO: 'Renuncia' }]);
  const before = buildRotationDashboard(data, { months: ['2026-01'] });
  assert.equal(before.total_dotacion, 1); assert.equal(before.total_bajas, 0);
  const after = buildRotationDashboard(data, { months: ['2026-02'], campaigns: ['Culqi'], search: 'ana', from: '2026-02-01', to: '2026-02-28' });
  assert.equal(after.total_dotacion, 0); assert.equal(after.total_bajas, 1); assert.equal(after.altas_historicas, 1); assert.equal(after.porcentaje_rotacion, 100);
  assert.equal(after.funnel.altas, after.funnel.bajas + after.funnel.dotacion);
  assert.equal(after.permanencia_promedio, 31);
  data.participants[0].nombres = 'Ángela';
  assert.equal(buildRotationDashboard(data, { search: 'angela' }).total_bajas, 1);
  assert.equal(buildRotationDashboard(data, { search: 'unrelated' }).total_bajas, 0);
  assert.equal(buildRotationDashboard(data, { campaigns: ['GPON'] }).total_dotacion, 0);
  assert.equal(buildRotationDashboard(data, { months: ['2025-02'] }).total_dotacion, 0);
  assert.equal(buildRotationDashboard(data, { from: '2026-03-01' }).altas_historicas, 0);
  assert.equal(buildRotationDashboard(base(), { from: '2027-01-01' }, '2026-10-27').total_dotacion, 0);
});

test('reentries and repeated trainings count one active document; repeated ceses count once', () => {
  const data = base();
  data.participants.push({ ...data.participants[0], id: 'p2' });
  data.attendance.push({ ...data.attendance[0], id: 'a2', participant_id: 'p2', fecha: '2026-01-15' });
  assert.equal(buildRotationDashboard(data).altas_historicas, 1);
  data.terminations = imported([
    { DNI: '00130365', CESE: '20/01/2026', MOTIVO: 'Renuncia' },
    { DNI: '00130365', CESE: '22/01/2026', MOTIVO: 'Renuncia' },
    { DNI: '00130365', Fecha: '01/02/2026', Tipo: 'Reingreso' },
  ]);
  const dashboard = buildRotationDashboard(data);
  assert.equal(dashboard.total_bajas, 1); assert.equal(dashboard.total_dotacion, 1); assert.equal(dashboard.funnel.altas, 2);
  assert.equal(dashboard.pendientes.length, 1);
  assert.equal(dashboard.detalle.at(-1)?.estado, 'Reingreso');
});

test('campaign ambiguity and old employment dates require validation', () => {
  const data = base(); data.sessions.push({ id: 'other', campana: 'Entel Empresas RUC 10' });
  data.participants.push({ ...data.participants[0], id: 'p2', training_session_id: 'other' });
  data.attendance.push({ ...data.attendance[0], id: 'a2', participant_id: 'p2', training_session_id: 'other', fecha: '2026-01-15' });
  data.terminations = imported([{ DNI: '00130365', CESE: '20/01/2026', MOTIVO: 'Renuncia' }]);
  assert.equal(buildRotationDashboard(data).total_bajas, 0);
  assert.equal(buildRotationDashboard(data).otros.length, 1);
  const single = base(); single.terminations = imported([{ DNI: '00130365', ALTA: '01/01/2026', CESE: '20/01/2026', MOTIVO: 'Renuncia' }]);
  assert.equal(buildRotationDashboard(single).total_bajas, 1);
});

test('imports are atomic, idempotent and keep every revision; legacy records stay visible', async (t) => {
  type Data = Record<string, any>;
  const store = new Map<string, Data>();
  const collection = (name: string): any => ({
    doc: (id: string) => ({ id, name }),
    get: async () => ({ docs: [...store].filter(([path]) => path.startsWith(`${name}/`)).map(([path, entry]) => ({ id: path.slice(name.length + 1), data: () => entry })) }),
  });
  t.mock.method(dataDb, 'collection', collection);
  t.mock.method(dataDb, 'runTransaction', async (callback: any) => {
    const pending = new Map<string, Data>();
    await callback({
      get: async (ref: any) => ({ exists: store.has(`${ref.name}/${ref.id}`), data: () => store.get(`${ref.name}/${ref.id}`) }),
      set: (ref: any, row: Data) => { pending.set(`${ref.name}/${ref.id}`, structuredClone(row)); },
    });
    for (const [path, row] of pending) store.set(path, row);
  });
  const actor = { uid: 'admin', nombre: 'Admin' };
  const row = { DNI: '00130365', CESE: '20/01/2026', MOTIVO: 'Renuncia', DESCRIPCION: 'Voluntaria' };
  const firstImport = await saveRotationImport([row, row], actor);
  assert.equal(firstImport.inserted, 1); assert.equal(firstImport.pending, 1);
  assert.equal((await saveRotationImport([row], actor)).skipped, 1);
  assert.equal((await saveRotationImport([{ ...row, DESCRIPCION: '15' }], actor)).pending, 1);
  for (let index = 0; index < 12; index++) assert.equal((await saveRotationImport([{ ...row, DESCRIPCION: `Version ${index}` }], actor)).updated, 1);
  assert.equal([...store.keys()].filter((path) => path.startsWith('rotation_notification_versions/')).length, 14);
  const originalRevision = structuredClone([...store].find(([path, value]) => path.startsWith('rotation_notification_versions/') && value.descripcion === 'Voluntaria'));
  await saveRotationImport([row], actor);
  assert.deepEqual([...store].find(([path]) => path === originalRevision![0]), originalRevision);
  assert.equal((await saveRotationImport([row, { ...row, MOTIVO: 'Despido' }], actor)).inserted, 1);
  const data = base();
  for (const name of ['sessions', 'participants', 'attendance'] as const) for (const entry of data[name]) store.set(`${name}/${entry.id}`, entry);
  store.set('rotation_terminations/old', { ...row, id: 'old', raw: row, dni: row.DNI, fecha: '2026-01-20', motivo: row.MOTIVO, nombre: 'Ana' });
  const legacy = structuredClone(store.get('rotation_terminations/old'));
  assert.equal((await getRotationDashboard()).total_bajas, 1);
  assert.deepEqual(store.get('rotation_terminations/old'), legacy);
  assert.ok([...store.keys()].every((path) => path.startsWith('rotation_') || /^(sessions|participants|attendance)\//.test(path)));
});
