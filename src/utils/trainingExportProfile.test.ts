import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildTrainingWorkbook, TRAINING_EXPORT_HEADERS } from './trainingExport';
import type { TrainingSession, Participant, AttendanceRecord } from '../types';

test('training export preserves recruiter profiles, filters, historical rows and existing columns', () => {
  const sessions = [{ id: 's', campaña: 'Culqi', generation_code: 'CAP-A' }] as TrainingSession[];
  const profiles = ['Ejecutivo call center', 'Consultivo', 'Corporativo', 'Comercial', '', undefined];
  const people = Array.from({ length: 105 }, (_, i) => ({
    id: `p${i}`, training_session_id: 's', nombres: `Person ${i}`, apellidos: 'Test',
    puesto: profiles[i % profiles.length], evaluacion_nota: 0,
  })) as Participant[];
  const excluded = { ...people[0], id: 'excluded', training_session_id: 'other', puesto: 'Excluded' };
  const attendance = [{ id: 'a', participant_id: 'p0', training_session_id: 's', dia: 10,
    estado_asistencia: 'Asistió', fecha_registro: '2026-10-15T10:00:00Z' }] as AttendanceRecord[];
  const before = JSON.stringify({ people, attendance });
  const workbook = buildTrainingWorkbook(sessions, [], [...people, people[0], excluded], attendance, []);
  const reopened = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  assert.deepEqual(reopened.SheetNames, ['Postulantes']);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(reopened.Sheets.Postulantes, { defval: '' });
  const headers = XLSX.utils.sheet_to_json<unknown[]>(reopened.Sheets.Postulantes, { header: 1 })[0];
  assert.deepEqual(headers, TRAINING_EXPORT_HEADERS);
  assert.equal(headers.length, 18);
  assert.equal(headers[12], 'D10');
  assert.equal(headers[16], 'Nota del examen');
  assert.equal(headers[17], 'Perfil del ejecutivo');
  assert.equal(rows.length, 105);
  for (let i = 0; i < people.length; i++) {
    assert.equal(rows[i]['Perfil del ejecutivo'], people[i].puesto ?? '');
    assert.equal(rows[i]['Nombre del postulante'], `Person ${i} Test`);
  }
  assert.equal(rows[0].D10, 'Asistió');
  assert.equal(rows[0]['Nota del examen'], 0);
  assert.equal(JSON.stringify({ people, attendance }), before);
});
