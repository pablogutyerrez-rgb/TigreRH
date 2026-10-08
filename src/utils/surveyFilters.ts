import type { TrainingSession, TrainingSurvey } from '../types';
import { getSessionTrainerIds } from './trainingAssignments';

export const overlapsDateRange = (start: string, end: string, from: string, to: string) =>
  !(from && to && from > to) &&
  (!from || (end || start).slice(0, 10) >= from) &&
  (!to || start.slice(0, 10) <= to);

export interface SurveyFilters {
  campaign: string;
  generation: string;
  trainer: string;
  type: string;
  from: string;
  to: string;
}

const normalize = (value?: string) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export const filterSurveys = (surveys: TrainingSurvey[], sessions: TrainingSession[], filters: SurveyFilters) => {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return surveys.filter((survey) => {
    const session = byId.get(survey.training_session_id);
    const campaign = session?.campaña || survey.campaña;
    const generation = session?.generation_code || session?.nombre_generacion || survey.codigo_generacion;
    const trainers = session ? getSessionTrainerIds(session) : [survey.formador_id];
    return survey.estado !== 'Eliminada' &&
      (!filters.campaign || normalize(campaign) === normalize(filters.campaign)) &&
      (!filters.generation || normalize(generation) === normalize(filters.generation)) &&
      (!filters.trainer || trainers.includes(filters.trainer)) &&
      (!filters.type || normalize(session?.tipo_capacitacion || survey.training_type) === normalize(filters.type)) &&
      overlapsDateRange(session?.fecha_inicio || survey.start_date || '', session?.fecha_fin || survey.end_date || '', filters.from, filters.to);
  });
};
