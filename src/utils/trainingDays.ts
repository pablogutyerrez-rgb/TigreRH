import type { TrainingSession } from '../types';

export const LEGACY_TRAINING_DAYS_COUNT = 5;
export const CURRENT_TRAINING_DAYS_COUNT = 10;

export const getTrainingDaysCount = (session?: Pick<TrainingSession, 'training_days'> | null) => {
  const value = Number(session?.training_days);
  return value === LEGACY_TRAINING_DAYS_COUNT ? LEGACY_TRAINING_DAYS_COUNT : CURRENT_TRAINING_DAYS_COUNT;
};

export const getTrainingDays = (session?: Pick<TrainingSession, 'training_days'> | null) =>
  Array.from({ length: getTrainingDaysCount(session) }, (_, index) => index + 1);

export const getBusinessDayDate = (start: string, day: number) => {
  const date = new Date(`${start}T12:00:00`);
  if (Number.isNaN(date.getTime())) return start;
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  let remaining = day - 1;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
};

export const getSessionDayDate = (session: Pick<TrainingSession, 'fecha_inicio' | 'training_days' | 'training_model'>, day: number) =>
  session.training_model === 'split_ojt'
    ? getBusinessDayDate(session.fecha_inicio, day)
    : new Date(new Date(`${session.fecha_inicio}T12:00:00`).getTime() + (day - 1) * 86400000).toISOString().slice(0, 10);
