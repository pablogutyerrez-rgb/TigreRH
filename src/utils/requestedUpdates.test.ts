import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateTrainingVariableEvaluation as backend } from '../../backend/src/services/trainingVariableCalculator';
import { calculateTrainingVariablePreview as preview } from './trainingVariableCalculator';
import { calculateTrainingVariableFromData } from '../../backend/src/services/trainingVariableSourceService';
import { normalizeTerminations } from '../../backend/src/services/rotationService';
import { inspectCommercialImport } from '../../backend/src/services/commercialService';
import { calculatePhaseMetrics } from '../../backend/src/services/trainingPhaseMetrics';
import { prospectComparison, campaignKey, filterProspectRecords } from './prospectMetrics';
import { buildTrainingWorkbook, TRAINING_EXPORT_HEADERS } from './trainingExport';
import * as XLSX from 'xlsx';
import type { TrainingSession, Participant, AttendanceRecord, Prospect } from '../types';

const input = { formula_version: 2, porcentaje_retencion: 50, porcentaje_produccion_individual: 100,
  porcentaje_produccion_grupal: 100, porcentaje_satisfaccion: 90, porcentaje_administrativo: 100, porcentaje_rotacion: 10 };
const currentCalculation = (overrides: Partial<typeof input> = {}) => {
  const result = backend({ ...input, ...overrides });
  assert.ok('comision_aplicable' in result && 'descuento_rotacion' in result);
  return result;
};
test('nueva formula, candado, limites y paridad con servidor', () => {
  assert.equal(currentCalculation().comision_total, 300);
  assert.equal(currentCalculation().comision_aplicable, 300);
  assert.equal(currentCalculation().descuento_rotacion, 0);
  assert.equal(backend({ ...input, porcentaje_produccion_grupal: 80 }).cumplimiento_total, 90);
  assert.equal(backend({ ...input, porcentaje_produccion_grupal: 80 }).comision_total, 270);
  assert.equal(backend({ ...input, porcentaje_produccion_grupal: 79.98 }).comision_total, 0);
  assert.equal(backend({ ...input, porcentaje_rotacion: 5 }).aporte_administrativo, 10);
  assert.equal(backend({ ...input, porcentaje_retencion: 100, porcentaje_satisfaccion: 100 }).comision_total, 300);
  assert.equal(backend({ ...input, porcentaje_rotacion: 10.1 }).comision_total, 240);
  for (const [rotation, discount, commission] of [[0, 0, 300], [10, 0, 300], [10.01, 60, 240], [20, 60, 240]] as const) {
    const result = currentCalculation({ porcentaje_rotacion: rotation });
    assert.equal(result.comision_aplicable, 300);
    assert.equal(result.descuento_rotacion, discount);
    assert.equal(result.comision_total, commission);
    assert.ok(result.comision_total >= 0 && result.comision_total <= 300);
  }
  const blocked = currentCalculation({ porcentaje_produccion_grupal: 79.98, porcentaje_rotacion: 20 });
  assert.equal(blocked.comision_aplicable, 0);
  assert.equal(blocked.descuento_rotacion, 0);
  assert.equal(blocked.comision_total, 0);
  assert.equal(backend(input).aporte_retencion + backend(input).aporte_produccion + backend(input).aporte_satisfaccion + backend(input).aporte_administrativo, 100);
  for (const rotation of [0, 1.25, 5, 10, 10.1]) assert.deepEqual(backend({ ...input, porcentaje_rotacion: rotation }), preview({ ...input, porcentaje_rotacion: rotation }));
});
const data = {
  sessions: [
    { id: 'a', generation_code: 'A', campana: 'Culqi', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-30', formador_ids: ['f', 'g'] },
    { id: 'b', generation_code: 'B', campana: 'Entel Empresas RUC 10', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-30', formador_id: 'g' },
  ],
  participants: [{ id: 'p', training_session_id: 'a' }, { id: 'q', training_session_id: 'a', estado_final: 'Alta confirmada' }, { id: 'r', training_session_id: 'b' }],
  attendance: [
    { id: '0', training_session_id: 'a', participant_id: 'p', dia: 1, estado_asistencia: 'Asistió' },
    { id: '0a', training_session_id: 'a', participant_id: 'q', dia: 1, estado_asistencia: 'Tardanza' },
    { id: '1', training_session_id: 'a', participant_id: 'p', dia: 2, estado_asistencia: 'Asistió' },
    { id: '2', training_session_id: 'a', participant_id: 'q', dia: 2, estado_asistencia: 'Tardanza' },
    { id: '2a', training_session_id: 'a', participant_id: 'p', dia: 5, estado_asistencia: 'Asistió' },
    { id: '2b', training_session_id: 'a', participant_id: 'q', dia: 5, estado_asistencia: 'Tardanza' },
    { id: '2c', training_session_id: 'a', participant_id: 'p', dia: 6, estado_asistencia: 'Asistió' },
    { id: '2d', training_session_id: 'a', participant_id: 'q', dia: 6, estado_asistencia: 'Tardanza' },
    { id: '3', training_session_id: 'a', participant_id: 'p', dia: 10, estado_asistencia: 'Asistió' },
    { id: '3a', training_session_id: 'b', participant_id: 'r', dia: 1, estado_asistencia: 'Asistió' },
    { id: '4', training_session_id: 'b', participant_id: 'r', dia: 2, estado_asistencia: 'Asistió' },
    { id: '4a', training_session_id: 'b', participant_id: 'r', dia: 5, estado_asistencia: 'Asistió' },
    { id: '4b', training_session_id: 'b', participant_id: 'r', dia: 6, estado_asistencia: 'Asistió' },
    { id: '5', training_session_id: 'b', participant_id: 'r', dia: 10, estado_asistencia: 'Asistió' },
  ],
  confirmations: [{ id: 'ca', training_session_id: 'a', participant_id: 'p', estado_alta: 'Alta confirmada' }, { id: 'cb', training_session_id: 'b', participant_id: 'r', estado_alta: 'Alta confirmada' }],
  prospects: [{ id: 'pa', training_session_id: 'a', estado: 'Venta / Alta', cantidad_productos: 1 }, { id: 'pb', training_session_id: 'b', estado: 'Venta / Alta', cantidad_productos: 2 }],
  surveys: [{ id: 'sa', training_session_id: 'a' }, { id: 'sb', training_session_id: 'b' }],
  responses: [{ id: 'ra', training_survey_id: 'sa', final_score_20: 18 }, { id: 'rb', training_survey_id: 'sb', final_score_20: 20 }],
};
test('multiseleccion usa Prospectos y metas reales por campaña', async () => {
  const sourceData = { ...data, rotation: { disponible: true, porcentaje: 5, bajas: 1, dotacion: 20 } };
  const result = await calculateTrainingVariableFromData('f', ['a', 'b', 'a'], 2026, 9, sourceData, { meses: [9, 10], formador_ids: ['f', 'g'] });
  assert.deepEqual(result.generation_ids, ['a', 'b']);
  assert.equal(result.porcentaje_retencion, 83.33);
  assert.equal(result.porcentaje_produccion_grupal, 100);
  assert.equal(result.porcentaje_satisfaccion, 95);
  assert.equal(result.detalle.altas_operacion, 2);
  assert.equal(result.detalle.ventas_reales, 3);
  assert.equal(result.porcentaje_rotacion, 5);
  await assert.rejects(() => calculateTrainingVariableFromData('f', ['b'], 2026, 9, sourceData), /formador/);
  await assert.rejects(() => calculateTrainingVariableFromData('g', ['b'], 2026, 9, sourceData), /periodo/);
  await assert.rejects(() => calculateTrainingVariableFromData('g', ['b'], 2026, 10, sourceData, { campanas: ['Culqi'] }), /campañas/);
});
test('diez altas D10 RUC10 y veinte ventas de Prospectos alcanzan productividad máxima', async () => {
  const participants = Array.from({ length: 10 }, (_, index) => ({ id: `ruc-${index}`, training_session_id: 'ruc' }));
  const sourceData = {
    sessions: [{ id: 'ruc', generation_code: 'RUC', campana: 'Entel Empresas RUC 10', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-30', formador_id: 'f' }],
    participants,
    attendance: participants.flatMap((participant, index) => [1, 2, 5, 6, 10].map((dia) => ({ id: `a-${index}-${dia}`, training_session_id: 'ruc', participant_id: participant.id, dia, estado_asistencia: 'Asistió' }))),
    confirmations: participants.map((participant, index) => ({ id: `c-${index}`, training_session_id: 'ruc', participant_id: participant.id, estado_alta: 'Alta confirmada' })),
    prospects: participants.map((participant, index) => ({ id: `p-${index}`, training_session_id: 'ruc', estado: 'Venta / Alta', cantidad_productos: 2 })),
    surveys: [], responses: [], rotation: { disponible: true, porcentaje: 0, bajas: 0, dotacion: 1 },
  };
  const result = await calculateTrainingVariableFromData('f', ['ruc'], 2026, 9, sourceData);
  assert.equal(result.detalle.altas_operacion, 10);
  assert.equal(result.detalle.ventas_reales, 20);
  assert.equal(result.porcentaje_produccion_grupal, 100);
});
test('feriado conserva la retención y Altas exige Asistió en D10', () => {
  const metrics = calculatePhaseMetrics(new Set(['a', 'b']), [
    { participant_id: 'a', dia: 1, estado_asistencia: 'Asistió' },
    { participant_id: 'b', dia: 1, estado_asistencia: 'Asistió' },
    { participant_id: 'a', dia: 5, estado_asistencia: 'Feriado' },
    { participant_id: 'b', dia: 5, estado_asistencia: 'Asistió' },
    { participant_id: 'a', dia: 6, estado_asistencia: 'Feriado' },
    { participant_id: 'b', dia: 6, estado_asistencia: 'Asistió' },
    { participant_id: 'a', dia: 10, estado_asistencia: 'Feriado' },
    { participant_id: 'b', dia: 10, estado_asistencia: 'Asistió' },
  ], []);
  assert.equal(metrics.retencionCapacitacion, 100);
  assert.equal(metrics.retencionOjt, 100);
  assert.deepEqual([...metrics.altasD10Ids], ['b']);
});
test('importa bajas desde BASE con fechas seriales y DNI numérico', () => {
  const rows = normalizeTerminations([{
    CIUDAD: 'Lima', POSICIÓN: 'Asesor', ALTA: 45292, DNI: 130365, 'NOMBRE Y APELLIDOS': 'Marcos Capusari',
    'CAMPAÑA': 'Culqi', CESE: 45292, MOTIVO: 'Renuncia', PERMANENCIA: 10,
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fecha, '2024-01-01');
  assert.equal(rows[0].fecha_alta, '2024-01-01');
  assert.equal(rows[0].dni, '130365');
  assert.equal(rows[0].nombre, 'Marcos Capusari');
  assert.throws(() => normalizeTerminations([{ DNI: '1', CESE: 45292 }]), /Fila 2: falta CAMPAÑA/);
});
test('inspeccion comercial reconstruye Culqi y conserva pendientes reales', () => {
  const result = inspectCommercialImport({ campaign: 'Culqi', file: { name: 'culqi.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content_base64: 'AA==', sha256: 'a'.repeat(64) }, sheets: [{ name: 'BASE', headers: ['Terminal', 'Comercio', 'Fecha venta', 'GPV', 'Transacciones', 'Supervisor'], formulas: ['SUM(D:D)'], row_count: 2, rows: [{ Terminal: 'T-1', Comercio: 'C-1', 'Fecha venta': '2026-09-20', GPV: 1200, Transacciones: 4, Supervisor: 'Ana' }, { Terminal: 'T-2', Comercio: 'C-1', 'Fecha venta': '2026-09-20', GPV: 0, Transacciones: 0, Supervisor: 'Ana' }] }] });
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].activation, true);
  assert.equal(result.records[1].postventa, 'Sin transacciones');
  assert.equal(result.inspection.formulas.length, 1);
});
test('comparacion cuenta ventas sin limite de fechas y deduplica ejecutivos', () => {
  const prospects = Array.from({ length: 12 }, (_, i) => ({ id: String(i), campana: 'Culqi', training_session_id: 'a',
    fecha_registro: '2026-10-' + String(i + 1).padStart(2, '0'), ejecutivo_dni: '123', estado: 'Venta / Alta' })) as Prospect[];
  const rows = prospectComparison(prospects, [], [], []);
  assert.equal(rows.length, 12);
  assert.equal(rows.reduce((sum, row) => sum + row['Ventas realizadas'], 0), 12);
  assert.equal(campaignKey('Fija'), campaignKey('Equifax'));
  assert.equal(campaignKey('Entel RUC 10'), campaignKey('Entel Empresas RUC 10'));
});
test('Excel sin paginacion, orden y compatibilidad historica', () => {
  const sessions = [{ id: 'b', campaña: 'Equifax', generation_code: 'B' }, { id: 'a', campaña: 'Culqi', generation_code: 'A' }] as TrainingSession[];
  const people = Array.from({ length: 105 }, (_, i) => ({ id: String(i), training_session_id: i === 0 ? 'b' : 'a', nombres: 'Ana', apellidos: 'Perez',
    asistencia_dia_10: 'Desistió', motivo_desercion: 'Salud', resultado_formacion: 'No apto', evaluacion_nota: 0 })) as Participant[];
  const workbook = buildTrainingWorkbook(sessions, [], people, [], []);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Postulantes, { header: 1 });
  assert.equal(rows.length, 106);
  assert.deepEqual(rows[0], TRAINING_EXPORT_HEADERS);
  assert.equal(rows[1][0], 'Culqi');
  assert.equal(rows[105][0], 'Equifax');
  assert.equal(rows[1][12], 'Desistió');
  assert.equal(rows[1][13], 'Sí');
  assert.equal(rows[1][14], 'Salud');
  assert.equal(rows[1][16], 0);
});
test('campaña, fecha, formador y generación combinados para listado y Excel', () => {
  const records = [
    { id: 'a', campana: 'Fija', fecha_registro: '2026-10-07T12:00:00Z', formador_id: 'f', training_session_code: 'A', ejecutivo_nombre: 'Ana' },
    { id: 'b', campana: 'Culqi', fecha_registro: '2026-10-07', formador_id: 'f', training_session_code: 'A', ejecutivo_nombre: 'Ana' },
    { id: 'c', campana: 'Equifax', fecha_registro: '2026-10-08', formador_id: 'f', training_session_code: 'A', ejecutivo_nombre: 'Ana' },
  ] as Prospect[];
  const filtered = filterProspectRecords(records, { campaigns: ['Equifax'], from: '2026-10-07', to: '2026-10-07', trainer: 'f', generation: 'A', search: 'Ana' }, (p) => p.training_session_code || '');
  assert.deepEqual(filtered.map((p) => p.id), ['a']);
});
test('comparacion distingue D5, OJT y etapa desconocida sin estimarla', () => {
  const sessions = [{ id: 'a', campaña: 'Culqi', generation_code: 'A' }] as TrainingSession[];
  const participants = [{ id: 'p', training_session_id: 'a', dni: '1', resultado_formacion: 'Apto' },
    { id: 'q', training_session_id: 'a', dni: '2' }] as Participant[];
  const attendance = [{ participant_id: 'p', training_session_id: 'a', dia: 5, fecha: '2026-10-07', estado_asistencia: 'Asistió' },
    { participant_id: 'q', training_session_id: 'a', dia: 6, fecha: '2026-10-07', estado_asistencia: 'Tardanza' }] as AttendanceRecord[];
  const rows = prospectComparison([], sessions, participants, attendance, '2026-10-07', '2026-10-07');
  assert.equal(rows[0]['Postulantes aptos D5'], 1);
  assert.equal(rows[0]['Ejecutivos OJT'], 1);
  assert.equal(rows[0]['Postulantes/Ejecutivos'], 2);
  assert.equal(rows[0]['Ventas realizadas'], 0);
  assert.equal(prospectComparison([], sessions, participants, attendance, '2026-10-08').length, 0);
});
