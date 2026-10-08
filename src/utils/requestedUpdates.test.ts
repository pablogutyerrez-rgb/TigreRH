import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateTrainingVariableEvaluation as backend } from '../../backend/src/services/trainingVariableCalculator';
import { calculateTrainingVariablePreview as preview } from './trainingVariableCalculator';
import { calculateTrainingVariableFromData } from '../../backend/src/services/trainingVariableSourceService';
import { prospectComparison, campaignKey, filterProspectRecords } from './prospectMetrics';
import { buildTrainingWorkbook, TRAINING_EXPORT_HEADERS } from './trainingExport';
import * as XLSX from 'xlsx';
import type { TrainingSession, Participant, AttendanceRecord, Prospect } from '../types';

const input = { formula_version: 2, porcentaje_retencion: 50, porcentaje_produccion_individual: 100,
  porcentaje_produccion_grupal: 100, porcentaje_satisfaccion: 90, porcentaje_administrativo: 100, porcentaje_rotacion: 10 };
test('nueva formula, candado, limites y paridad con servidor', () => {
  assert.equal(backend(input).comision_total, 300);
  assert.equal(backend({ ...input, porcentaje_produccion_grupal: 80 }).cumplimiento_total, 90);
  assert.equal(backend({ ...input, porcentaje_produccion_grupal: 80 }).comision_total, 270);
  assert.equal(backend({ ...input, porcentaje_produccion_grupal: 79.98 }).comision_total, 0);
  assert.equal(backend({ ...input, porcentaje_rotacion: 5 }).aporte_administrativo, 5);
  assert.equal(backend({ ...input, porcentaje_retencion: 100, porcentaje_satisfaccion: 100 }).comision_total, 300);
  assert.equal(backend({ ...input, porcentaje_rotacion: 10.1 }).aporte_administrativo, 10);
  for (const rotation of [0, 1.25, 5, 10, 10.1]) assert.deepEqual(backend({ ...input, porcentaje_rotacion: rotation }), preview({ ...input, porcentaje_rotacion: rotation }));
});
const data = {
  sessions: [
    { id: 'a', generation_code: 'A', campana: 'Culqi', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-30', formador_ids: ['f', 'g'] },
    { id: 'b', generation_code: 'B', campana: 'Equifax', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-30', formador_id: 'g' },
  ],
  participants: [{ id: 'p', training_session_id: 'a', ventas_ojt: 1 }, { id: 'q', training_session_id: 'a' }, { id: 'r', training_session_id: 'b', ventas_ojt: 0 }],
  attendance: [
    { id: '1', training_session_id: 'a', participant_id: 'p', dia: 2, estado_asistencia: 'Asistió' },
    { id: '2', training_session_id: 'a', participant_id: 'q', dia: 2, estado_asistencia: 'Tardanza' },
    { id: '3', training_session_id: 'a', participant_id: 'p', dia: 10, estado_asistencia: 'Asistió' },
    { id: '4', training_session_id: 'b', participant_id: 'r', dia: 2, estado_asistencia: 'Asistió' },
    { id: '5', training_session_id: 'b', participant_id: 'r', dia: 10, estado_asistencia: 'Asistió' },
  ],
  confirmations: [{ id: 'ca', training_session_id: 'a', participant_id: 'p', estado_alta: 'Alta confirmada' }, { id: 'cb', training_session_id: 'b', participant_id: 'r', estado_alta: 'Alta confirmada' }],
  surveys: [{ id: 'sa', training_session_id: 'a' }, { id: 'sb', training_session_id: 'b' }],
  responses: [{ id: 'ra', training_survey_id: 'sa', final_score_20: 18 }, { id: 'rb', training_survey_id: 'sb', final_score_20: 20 }],
};
test('multiseleccion usa datos OJT reales y no duplica', async () => {
  const sourceData = { ...data, rotation: { disponible: true, porcentaje: 5, bajas: 1, dotacion: 20 } };
  const result = await calculateTrainingVariableFromData('f', ['a', 'b', 'a'], 2026, 9, sourceData, { meses: [9, 10], formador_ids: ['f', 'g'] });
  assert.deepEqual(result.generation_ids, ['a', 'b']);
  assert.equal(result.porcentaje_retencion, 75);
  assert.equal(result.porcentaje_produccion_grupal, 50);
  assert.equal(result.porcentaje_satisfaccion, 95);
  assert.equal(result.detalle.altas_operacion, 2);
  assert.equal(result.detalle.ventas_reales, 1);
  assert.equal(result.porcentaje_rotacion, 5);
  await assert.rejects(() => calculateTrainingVariableFromData('f', ['b'], 2026, 9, sourceData), /formador/);
  await assert.rejects(() => calculateTrainingVariableFromData('g', ['b'], 2026, 9, sourceData), /periodo/);
  await assert.rejects(() => calculateTrainingVariableFromData('g', ['b'], 2026, 10, sourceData, { campanas: ['Culqi'] }), /campañas/);
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
