import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAttendanceMinutesOpen, peruAttendanceMinutes, isOperationalOjtClosed, isToolsDropout } from '../../backend/src/services/attendancePolicy';
import { isAttendanceWindowOpen } from './time';
import { canViewOperationalOjt } from './trainingAssignments';
import { calculateTrainingVariableFromData } from '../../backend/src/services/trainingVariableSourceService';
import type { TrainingSession } from '../types';

test('Peru attendance window, inclusive limits, administrator and reopen override', () => {
  for (const [utc, allowed] of [['12:59', false], ['13:00', true], ['23:59', true], ['00:00', true], ['00:01', false]] as const) {
    const minutes = peruAttendanceMinutes(new Date(`2026-10-14T${utc}:00Z`));
    assert.equal(isAttendanceMinutesOpen(minutes), allowed, utc);
    for (const role of ['Formador', 'Analista']) {
      assert.equal(isAttendanceWindowOpen(role, false, minutes), allowed);
      assert.equal(isAttendanceWindowOpen(role, true, minutes), true);
    }
    assert.equal(isAttendanceWindowOpen('Administrador', false, minutes), true);
  }
});

test('OJT operational tray restricts assignments and closure without mutating historical sessions', () => {
  for (const campaña of ['Entel Empresas RUC 10', 'Entel Empresas RUC 20', 'Culqi']) {
    const session = { id: 's', campaña, estado: 'En curso', formador_capacitacion_inicial_ids: ['initial'], formador_ojt_ids: ['ojt'] } as TrainingSession;
    const original = structuredClone(session);
    assert.equal(canViewOperationalOjt(session, { id: 'initial', rol: 'Formador' }, 'Abierto'), false);
    assert.equal(canViewOperationalOjt(session, { id: 'ojt', rol: 'Formador' }, 'Abierto'), true);
    assert.equal(canViewOperationalOjt(session, { id: 'other', rol: 'Formador' }, 'Abierto'), false);
    assert.equal(canViewOperationalOjt(session, { id: 'ojt', rol: 'Formador' }, 'Cerrado'), false);
    for (const estado of ['Capacitación cerrada', 'Campaña cerrada']) {
      const closed = { ...session, estado } as TrainingSession;
      assert.equal(canViewOperationalOjt(closed, { id: 'ojt', rol: 'Formador' }, 'Abierto'), false);
      assert.equal(canViewOperationalOjt(closed, { id: 'admin', rol: 'Administrador' }, 'Cerrado'), true);
    }
    assert.deepEqual(session, original);
  }
  for (const campaña of ['GPON', 'Equifax']) assert.equal(isOperationalOjtClosed({ campaña, estado: 'Capacitación cerrada' }, 'Cerrado'), false);
});

test('Herramientas excludes Baja and Desistio without reclassifying other reasons or changing historical retention', async () => {
  const sessions = [{ id: 's', campana: 'Culqi', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-14', formador_id: 'f', estado: 'Capacitación cerrada' }];
  const participants = ['p', 'q'].map((id) => ({ id, training_session_id: 's' }));
  const base = {
    sessions, participants, confirmations: [], prospects: [], surveys: [], responses: [],
    attendance: [
      ...[1, 5, 6, 10].map((dia) => ({ id: `p-${dia}`, training_session_id: 's', participant_id: 'p', dia, estado_asistencia: 'Asistió' })),
      { id: 'q-1', training_session_id: 's', participant_id: 'q', dia: 1, estado_asistencia: 'Asistió' },
    ],
  };
  for (const estado_asistencia of ['Baja', 'Desistió']) {
    const dropout = { id: 'q-2', training_session_id: 's', participant_id: 'q', dia: 2, estado_asistencia, motivo_desercion: 'Herramientas', observacion: 'Sin equipo disponible' };
    assert.equal(isToolsDropout(dropout), true);
    const data = { ...base, attendance: [...base.attendance, dropout] };
    const before = structuredClone(data);
    const result = await calculateTrainingVariableFromData('f', ['s'], 2026, 10, data);
    assert.equal(result.porcentaje_retencion, 100);
    assert.deepEqual(data, before);
    for (const motivo_desercion of ['No cumple con el perfil', 'Otro motivo']) {
      assert.equal(isToolsDropout({ ...dropout, motivo_desercion }), false);
      const included = await calculateTrainingVariableFromData('f', ['s'], 2026, 10,
        { ...base, attendance: [...base.attendance, { ...dropout, motivo_desercion }] });
      assert.equal(included.porcentaje_retencion, 75);
    }
    const legacy = await calculateTrainingVariableFromData('f', ['s'], 2026, 10,
      { ...base, attendance: [...base.attendance, { ...dropout, motivo_desercion: 'Problemas personales' }] });
    assert.equal(legacy.porcentaje_retencion, estado_asistencia === 'Desistió' ? 100 : 75);
  }
  assert.equal(isToolsDropout({ estado_asistencia: 'Asistió', motivo_desercion: 'Herramientas' }), false);
});
