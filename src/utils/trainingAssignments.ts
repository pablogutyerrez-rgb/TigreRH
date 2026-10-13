import type { TrainingSession } from '../types';
import { getScheduledTrainingDays } from '../../backend/src/services/trainingSchedule';
import { isOperationalOjtClosed } from '../../backend/src/services/attendancePolicy';

type TrainerAssignmentSession = Pick<TrainingSession,
  | 'formador_id'
  | 'formador_nombre'
  | 'formador_ids'
  | 'formador_nombres'
  | 'formador_capacitacion_inicial_ids'
  | 'formador_capacitacion_inicial_nombres'
  | 'formador_ojt_ids'
  | 'formador_ojt_nombres'
>;

const unique = (values: Array<string | undefined>) => Array.from(new Set(values.filter(Boolean) as string[]));

const hasSplitAssignment = (session: TrainerAssignmentSession) =>
  Array.isArray(session.formador_capacitacion_inicial_ids) ||
  Array.isArray(session.formador_ojt_ids);

const legacyTrainerIds = (session: TrainerAssignmentSession) => unique([
  ...(Array.isArray(session.formador_ids) ? session.formador_ids : []),
  session.formador_id,
]);

const legacyTrainerNames = (session: TrainerAssignmentSession) => unique([
  ...(Array.isArray(session.formador_nombres) ? session.formador_nombres : []),
  session.formador_nombre,
]);

export const getSessionInitialTrainerIds = (session: TrainerAssignmentSession) =>
  hasSplitAssignment(session)
    ? unique(session.formador_capacitacion_inicial_ids || [])
    : legacyTrainerIds(session);

export const getSessionInitialTrainerNames = (session: TrainerAssignmentSession) =>
  hasSplitAssignment(session)
    ? unique(session.formador_capacitacion_inicial_nombres || [])
    : legacyTrainerNames(session);

export const getSessionOjtTrainerIds = (session: TrainerAssignmentSession) =>
  hasSplitAssignment(session)
    ? unique(session.formador_ojt_ids || [])
    : legacyTrainerIds(session);

export const getSessionOjtTrainerNames = (session: TrainerAssignmentSession) =>
  hasSplitAssignment(session)
    ? unique(session.formador_ojt_nombres || [])
    : legacyTrainerNames(session);

export const getSessionTrainerIds = (session: TrainerAssignmentSession) => unique([
  ...legacyTrainerIds(session),
  ...getSessionInitialTrainerIds(session),
  ...getSessionOjtTrainerIds(session),
]);

export const getSessionTrainerNames = (
  session: TrainerAssignmentSession,
) => unique([
  ...legacyTrainerNames(session),
  ...getSessionInitialTrainerNames(session),
  ...getSessionOjtTrainerNames(session),
]);

export const isSessionAssignedTrainer = (
  session: TrainerAssignmentSession,
  userId?: string,
) => Boolean(userId && getSessionTrainerIds(session).includes(userId));

export const isSessionInitialTrainer = (session: TrainerAssignmentSession, userId?: string) =>
  Boolean(userId && getSessionInitialTrainerIds(session).includes(userId));

export const isSessionOjtTrainer = (session: TrainerAssignmentSession, userId?: string) =>
  Boolean(userId && getSessionOjtTrainerIds(session).includes(userId));

export const canViewOperationalOjt = (session: TrainingSession, user: { id: string; rol: string }, moduleStatus?: string) =>
  user.rol !== 'Formador' || (getScheduledTrainingDays(session.campaña) === 10
    ? isSessionOjtTrainer(session, user.id) && !isOperationalOjtClosed(session, moduleStatus)
    : isSessionAssignedTrainer(session, user.id));
