import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Capacitaciones from '../components/Capacitaciones';
import type { TrainingSession, TrainingSurvey, Participant, AttendanceRecord, OperationConfirmation, OjtModule } from '../types';
import { overlapsDateRange, filterSurveys, type SurveyFilters } from './surveyFilters';
import { buildTrainingWorkbook } from './trainingExport';
import type { User } from '../types';

test('todos los perfiles autorizados conservan descarga en Solo vista', () => {
  for (const rol of ['Administrador', 'Analista', 'Reclutador', 'Formador', 'Coordinador', 'Sistemas'] as User['rol'][]) {
    const markup = renderToStaticMarkup(createElement(Capacitaciones, {
      sessions: [], participants: [], trainers: [], recruiters: [],
      currentUser: { id: 'viewer', rol, module_view_only: ['formacion:capacitaciones'] } as User,
      onAddSession: async () => {}, onDeleteSession: () => {}, onViewAttendance: () => {},
    }));
    assert.ok(markup.includes('Descargar información'));
    assert.ok(!markup.includes('Crear Capacitación'));
    assert.ok(markup.includes('aria-label="Desde"'));
    assert.ok(markup.includes('aria-label="Hasta"'));
  }
});

const sessions = [
  { id: 'a', campaña: 'Culqi', nombre_generacion: 'CAP-A', generation_code: 'CAP-A', tipo_capacitacion: 'Inicial', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-07', formador_id: 'f1', formador_ojt_ids: ['f2'], training_days: 5, training_model: 'split_ojt' },
  { id: 'b', campaña: 'Equifax', nombre_generacion: 'CAP-B', tipo_capacitacion: 'OJT', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-10', formador_id: 'f3', training_days: 10 },
] as TrainingSession[];
const surveys = [
  { id: 'sa', training_session_id: 'a', estado: 'Habilitada' },
  { id: 'sb', training_session_id: 'b', estado: 'Cerrada' },
  { id: 'deleted', training_session_id: 'a', estado: 'Eliminada' },
  { id: 'legacy', training_session_id: 'legacy-session', estado: 'Habilitada', campaña: 'Historico', codigo_generacion: 'CAP-H', formador_id: 'f4', training_type: 'Especial', start_date: '2026-08-01', end_date: '2026-08-05' },
] as TrainingSurvey[];
const empty: SurveyFilters = { campaign: '', generation: '', trainer: '', type: '', from: '', to: '' };

test('rango inclusivo, limites abiertos y rango invertido', () => {
  assert.equal(overlapsDateRange('2026-10-01', '2026-10-07', '2026-10-07', '2026-10-07'), true);
  assert.equal(overlapsDateRange('2026-10-01', '2026-10-07', '2026-10-08', ''), false);
  assert.equal(overlapsDateRange('2026-10-01', '2026-10-07', '', '2026-10-01'), true);
  assert.equal(overlapsDateRange('2026-10-01', '2026-10-07', '2026-10-08', '2026-10-01'), false);
});

test('los seis filtros de encuestas funcionan solos y combinados', () => {
  for (const filter of [{ campaign: 'Culqi' }, { generation: 'CAP-A' }, { trainer: 'f2' }, { type: 'Inicial' }, { from: '2026-10-01' }, { to: '2026-08-05' }]) {
    const result = filterSurveys(surveys, sessions, { ...empty, ...filter });
    assert.deepEqual(result.map((item) => item.id), 'to' in filter ? ['legacy'] : ['sa']);
  }
  assert.deepEqual(filterSurveys(surveys, sessions, { campaign: ' culqi ', generation: 'cap-a', trainer: 'f2', type: 'Inicial', from: '2026-10-01', to: '2026-10-07' }).map((item) => item.id), ['sa']);
  assert.deepEqual(filterSurveys(surveys, sessions, { ...empty, campaign: 'Culqi', trainer: 'f3' }), []);
  assert.deepEqual(filterSurveys(surveys, sessions, { ...empty, type: 'Especial', trainer: 'f4' }).map((item) => item.id), ['legacy']);
});

test('Excel preserva nombres, documento, diez dias y datos extensos, sin otros registros', () => {
  const people = [
    { id: 'pa', training_session_id: 'a', nombres: 'Ana', apellidos: 'Perez', dni: '00123456', observacion: 'x'.repeat(33000) },
    { id: 'pb', training_session_id: 'b', nombres: 'Luis', apellidos: 'Rios', dni: '98765432' },
  ] as Participant[];
  const attendance = Array.from({ length: 10 }, (_, index) => ({
    id: `att-${index}`, participant_id: 'pa', training_session_id: 'a', dia: index + 1,
    estado_asistencia: 'Asistió', fecha: '2026-10-01', fecha_registro: '2026-10-01T10:00:00Z',
  })) as AttendanceRecord[];
  const confirmations = [{ id: 'ha', participant_id: 'pa', training_session_id: 'a', estado_alta: 'Alta confirmada', fecha_registro: '2026-10-20' }] as OperationConfirmation[];
  const modules = [{ id: 'ojt', generation_ids: ['a', 'b'], generation_codes: ['CAP-A', 'CAP-B'], participant_ids: ['pa', 'pb'] }] as OjtModule[];
  const workbook = buildTrainingWorkbook([sessions[0]], modules, people, attendance, confirmations);
  const reopened = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(reopened.Sheets.Postulantes);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Nombres, 'Ana');
  assert.equal(rows[0].Documento, '00123456');
  assert.equal(rows[0]['Día 10'], 'Asistió');
  assert.equal(rows[0].Alta, 'Alta confirmada');
  assert.equal(XLSX.utils.sheet_to_json(reopened.Sheets.Asistencia).length, 10);
  const ojt = XLSX.utils.sheet_to_json<Record<string, string>>(reopened.Sheets.OJT)[0];
  assert.deepEqual(JSON.parse(ojt.generation_ids), ['a']);
  const chunks = XLSX.utils.sheet_to_json<{ Contenido: string }>(reopened.Sheets['Datos extensos']);
  assert.equal(chunks.map((row) => row.Contenido).join('').length, 33000);
  const historic = buildTrainingWorkbook([sessions[1]], [], people, [], []);
  assert.equal(XLSX.utils.sheet_to_json(historic.Sheets.Postulantes).length, 1);
});
