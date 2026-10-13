import type { AttendanceRecord, OjtModule, Participant, SurveyResponse, TrainingSession, TrainingSurvey } from '../types';
import { isSurveyEligibleParticipant } from './trainingProgress';

const normalizeDocument = (value: unknown) => String(value ?? '').trim().replace(/^0+(?=\d)/, '');

export const findParticipantSurveyResponse = <T extends Pick<SurveyResponse, 'training_survey_id' | 'participant_id' | 'dni'>>(
  surveyId: string, participant: Pick<Participant, 'id' | 'dni'>, responses: T[],
) => responses.find((response) => response.training_survey_id === surveyId && (
  Boolean(participant.id && response.participant_id === participant.id) ||
  Boolean(normalizeDocument(participant.dni) && normalizeDocument(response.dni) === normalizeDocument(participant.dni))
));

export const getSurveyParticipants = (
  survey: TrainingSurvey, participants: Participant[], attendance: AttendanceRecord[],
  sessions: TrainingSession[], modules: OjtModule[],
) => {
  if (survey.survey_type === 'operaciones') return [];
  if (survey.survey_type === 'ojt') {
    const module = modules.find((item) => item.id === survey.ojt_module_id);
    if (!module) return [];
    const sessionIds = new Set(module.generation_ids || []);
    sessions.filter((session) => session.ojt_module_id === module.id).forEach((session) => sessionIds.add(session.id));
    const participantIds = new Set(module.participant_ids || []);
    return participants.filter((participant) => participantIds.has(participant.id) || sessionIds.has(participant.training_session_id));
  }
  const sessionAttendance = attendance.filter((record) => record.training_session_id === survey.training_session_id);
  return participants.filter((participant) => participant.training_session_id === survey.training_session_id &&
    isSurveyEligibleParticipant(participant, sessionAttendance));
};
