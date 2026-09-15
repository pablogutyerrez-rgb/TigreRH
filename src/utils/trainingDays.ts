import type { TrainingSession } from '../types';

export const LEGACY_TRAINING_DAYS_COUNT = 5;
export const CURRENT_TRAINING_DAYS_COUNT = 10;

export const getTrainingDaysCount = (session?: Pick<TrainingSession, 'training_days'> | null) => {
  const value = Number(session?.training_days);
  return value === LEGACY_TRAINING_DAYS_COUNT ? LEGACY_TRAINING_DAYS_COUNT : CURRENT_TRAINING_DAYS_COUNT;
};

export const getTrainingDays = (session?: Pick<TrainingSession, 'training_days'> | null) =>
  Array.from({ length: getTrainingDaysCount(session) }, (_, index) => index + 1);
