import { randomUUID } from 'node:crypto';
import { dataDb as adminDb } from '../hybridDb.js';
import { hasCampaignOjt } from './trainingSchedule.js';

type RecordData = Record<string, any>;

export const OJT_MINIMUM_FINAL_SCORE = 16;

export const isEligibleForOjt = (participant: RecordData) =>
  Number(participant.evaluacion_nota) >= OJT_MINIMUM_FINAL_SCORE;

const cleanToken = (value: unknown) => String(value || '').trim().replace(/\s+/g, '-').toUpperCase();

const operationSupervisors = (campaign: string) => {
  const normalized = campaign.trim().toLowerCase();
  if (normalized === 'culqi') return ['Augusto Tello', 'Jerson Atoche', 'Romey Huiman', 'Johnny Weill', 'Christian Delgado', 'Rosel Guevara'];
  if (normalized === 'equifax') return ['Juan Rondon', 'Hugo Navarro'];
  if (normalized.includes('ruc 20')) return ['Matias Canicela', 'Katya Laiche'];
  if (normalized.includes('ruc 10')) return ['Janeth Coronado'];
  if (normalized.includes('entel')) return ['Rosel Guevara', 'Estefano Zambrano'];
  return [];
};

const createIfMissing = async (collection: string, id: string, value: RecordData) => {
  try {
    await adminDb.collection(collection).doc(id).create(value);
    return value;
  } catch (error) {
    if ((error as { code?: number }).code !== 6) throw error;
    const existing = await adminDb.collection(collection).doc(id).get();
    return existing.data();
  }
};

export const buildInitialSurvey = (session: RecordData, createdById = '') => {
  const id = `srv-initial-${session.id}`;
  const code = String(session.generation_code || session.nombre_generacion || session.id);
  return {
    id,
    training_session_id: session.id,
    codigo_generacion: code,
    campaña: String(session.campaña || ''),
    formador_id: String(session.formador_id || ''),
    formador_nombre: String(session.formador_nombre || ''),
    estado: 'Deshabilitada',
    token: cleanToken(`INI-${code}`),
    survey_type: 'inicial',
    automatico: true,
    created_by_id: createdById,
    created_at: new Date().toISOString(),
  };
};

export const ensureInitialSurvey = async (session: RecordData, createdById = '') =>
  createIfMissing('surveys', `srv-initial-${session.id}`, buildInitialSurvey(session, createdById));

export const buildOjtSurvey = (session: RecordData, module: RecordData, createdById = '') => {
  const id = `srv-ojt-${module.id}`;
  const code = String(session.generation_code || session.nombre_generacion || module.nombre || module.id);
  return {
    id,
    training_session_id: String(session.id),
    ojt_module_id: String(module.id),
    grupo_ojt: String(module.nombre || ''),
    codigo_generacion: code,
    campaña: String(session.campaña || ''),
    formador_id: String((module.formador_ojt_ids || [])[0] || ''),
    formador_nombre: Array.isArray(module.formador_ojt_nombres) ? module.formador_ojt_nombres.join(', ') : '',
    estado: 'Deshabilitada',
    token: cleanToken(`OJT-${module.id}`),
    survey_type: 'ojt',
    automatico: true,
    created_by_id: createdById,
    created_at: new Date().toISOString(),
  };
};

export const ensureOjtSurvey = async (session: RecordData, module: RecordData, createdById = '') => {
  if (!hasCampaignOjt(session.campaña) || !module?.id) return null;
  const survey = buildOjtSurvey(session, module, createdById);
  return createIfMissing('surveys', survey.id, survey);
};

export const buildOperationsSurvey = (
  session: RecordData,
  confirmationId: string,
  createdById = '',
) => {
  const id = `srv-ope-${confirmationId}`;
  return {
    id,
    training_session_id: String(session.id),
    source_confirmation_id: confirmationId,
    codigo_generacion: String(session.generation_code || session.nombre_generacion || session.id),
    campaña: String(session.campaña || ''),
    formador_id: '',
    formador_nombre: '',
    supervisor_nombres: operationSupervisors(String(session.campaña || '')),
    estado: 'Deshabilitada',
    token: `OPE-${randomUUID()}`.toUpperCase(),
    survey_type: 'operaciones',
    automatico: true,
    created_by_id: createdById,
    created_at: new Date().toISOString(),
  };
};

export const ensureOperationsSurvey = async (
  session: RecordData,
  confirmationId: string,
  createdById = '',
) => {
  const survey = buildOperationsSurvey(session, confirmationId, createdById);
  return createIfMissing('surveys', survey.id, survey);
};
