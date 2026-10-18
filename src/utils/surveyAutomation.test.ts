import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildInitialSurvey,
  buildOjtSurvey,
  buildOperationsSurvey,
  isEligibleForOjt,
} from '../../backend/src/services/surveyAutomationService';

test('OJT eligibility begins at the final score of 16', () => {
  assert.equal(isEligibleForOjt({ evaluacion_nota: 15.99 }), false);
  assert.equal(isEligibleForOjt({ evaluacion_nota: 16 }), true);
  assert.equal(isEligibleForOjt({ evaluacion_nota: '20' }), true);
});

test('automatic surveys preserve their intended identity and anonymity', () => {
  const session = { id: 'session-1', campaña: 'Culqi', generation_code: 'CAP-CU-01' };
  const initial = buildInitialSurvey(session, 'admin');
  const ojt = buildOjtSurvey(session, { id: 'ojt-1', nombre: 'OJT Culqi', generation_codes: ['CAP-CU-01'], formador_ojt_ids: ['trainer'] }, 'admin');
  const operations = buildOperationsSurvey(session, 'confirmation-1', 'admin');

  assert.deepEqual({ id: initial.id, token: initial.token, type: initial.survey_type, status: initial.estado },
    { id: 'srv-initial-session-1', token: 'INI-CAP-CU-01', type: 'inicial', status: 'Deshabilitada' });
  assert.deepEqual({ id: ojt.id, token: ojt.token, type: ojt.survey_type, module: ojt.ojt_module_id, session: ojt.training_session_id, group: ojt.codigo_generacion, generations: ojt.grupo_generaciones, campaigns: ojt.grupo_campañas },
    { id: 'srv-ojt-ojt-1', token: 'OJT-OJT-1', type: 'ojt', module: 'ojt-1', session: '', group: 'OJT Culqi', generations: ['CAP-CU-01'], campaigns: ['Culqi'] });
  assert.equal(operations.id, 'srv-ope-confirmation-1');
  assert.equal(operations.survey_type, 'operaciones');
  assert.equal('dni' in operations, false);
  assert.equal('participant_id' in operations, false);
  assert.equal(operations.source_confirmation_id, 'confirmation-1');
});
