import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isInitialAttendanceComplete } from '../../backend/src/services/trainingSchedule';

test('attendance displays stored pending marks instead of a false withdrawal', async () => {
  const result = await build({
    entryPoints: ['src/components/AttendanceControl.tsx'], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'no-network', setup(builder) {
      builder.onResolve({ filter: /services\/operationService$/ }, () => ({ path: 'operations', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents:
        'export const getParticipantCvUrlRemote = () => {}; export const uploadParticipantCvRemote = () => {};', loader: 'js' }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const participant = { id: 'p', training_session_id: 's', nombres: 'Test', apellidos: 'Participant', dni: '12345678' };
  const statuses = ['Asistió', 'Tardanza', 'Faltó', 'Descanso médico', 'Feriado', 'Desistió', 'Baja', 'Pendiente', 'Seleccionar', ''];
  for (const status of statuses) {
    const attendance = [1, 2, 3, 4, 5].map(dia => ({ id: `a${dia}`, participant_id: 'p', training_session_id: 's', dia, estado_asistencia: status }));
    for (const rol of ['Administrador', 'Formador', 'Analista', 'Reclutador', 'Coordinador']) {
      const html = renderToStaticMarkup(React.createElement(module.exports.default, {
        session: { id: 's', campaña: 'Culqi', fecha_inicio: '2026-10-05', fecha_fin: '2026-10-16', training_days: 10, formador_id: 'u', formador_capacitacion_inicial_ids: ['u'] },
        participants: [participant], attendance, confirmations: [], reopens: [],
        currentUser: { id: 'u', rol, module_view_only: [] }, simulatedTime: { hour: 10, minute: 0, isSimulated: true },
        onSaveAttendance: async () => {}, onBulkAttendance: async () => {}, onRequestReopen: async () => {}, onGoBack: () => {},
      }));
      const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)![1];
      const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)];
      const expected = ['Pendiente', 'Seleccionar', ''].includes(status) ? 'Pendiente' : status === 'Tardanza' ? 'Tarde' : status === 'Descanso médico' ? 'DM' : status;
      const firstDayIndex = cells.findIndex(cell => cell[1].includes('Test Participant')) + 1;
      assert.ok(cells[firstDayIndex + 4][1].includes(`>${expected}</span>`), `${rol}: D5 must display ${expected}`);
      if (rol === 'Administrador' && ['Pendiente', 'Seleccionar', ''].includes(status)) {
        assert.match(cells[firstDayIndex][1], /<option value="" disabled="" selected="">-- Marcar --<\/option>/);
      }
    }
    assert.equal(isInitialAttendanceComplete('s', [participant], attendance), !['Pendiente', 'Seleccionar', ''].includes(status), status);
  }
});

test('D5 and earlier pending marks block OJT unless a real earlier withdrawal applies', () => {
  const p = { id: 'p', estado_final: 'Completó capacitación' };
  const records = [1, 2, 3, 4, 5].map(dia => ({ participant_id: 'p', training_session_id: 's', dia, estado_asistencia: dia === 4 ? 'Feriado' : dia === 5 ? 'Pendiente' : 'Asistió' }));
  assert.equal(isInitialAttendanceComplete('s', [p], records), false);
  assert.equal(isInitialAttendanceComplete('s', [p], records.concat({ ...records[4], training_session_id: 'other', estado_asistencia: 'Asistió' })), false);
  for (const status of ['Asistió', 'Tardanza', 'Faltó', 'Descanso médico', 'Feriado', 'Baja', 'Desistió']) {
    assert.equal(isInitialAttendanceComplete('s', [p], records.map(r => r.dia === 5 ? { ...r, estado_asistencia: status } : r)), true);
  }
  for (const status of ['Baja', 'Desistió']) {
    assert.equal(isInitialAttendanceComplete('s', [p], records.map(r => r.dia === 3 ? { ...r, estado_asistencia: status } : r)), true);
  }
});
