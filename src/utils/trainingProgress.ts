import type { AttendanceRecord, Participant } from '../types';

const PRESENT_ATTENDANCE = new Set(['Asistio', 'Asisti�', 'Asistió', 'Tardanza']);
const DESERTION_ATTENDANCE = new Set(['Desisti�', 'Desistió', 'Baja']);
const DESERTION_FINAL_STATES = new Set(['Desisti�', 'Desistió', 'No asisti�', 'No asistió']);
export const REQUIRED_TRAINING_DAYS = 10;
export const REQUIRED_SURVEY_ATTENDANCE_PERCENT = 80;
export const SURVEY_ELIGIBILITY_DAY = 5;

export const getPresentAttendanceDays = (
  participantId: string,
  attendance: AttendanceRecord[],
) =>
  new Set(
    attendance
      .filter(
        (record) =>
          record.participant_id === participantId &&
          PRESENT_ATTENDANCE.has(record.estado_asistencia),
      )
      .map((record) => record.dia),
  ).size;

export const getTrainingAttendancePercent = (
  participantId: string,
  attendance: AttendanceRecord[],
  requiredTrainingDays = REQUIRED_TRAINING_DAYS,
) =>
  Math.round(
    (getPresentAttendanceDays(participantId, attendance) / requiredTrainingDays) *
      100,
  );

export const hasTrainingDropout = (
  participant: Participant,
  attendance: AttendanceRecord[],
) =>
  DESERTION_FINAL_STATES.has(participant.estado_final) ||
  attendance.some(
    (record) =>
      record.participant_id === participant.id &&
      DESERTION_ATTENDANCE.has(record.estado_asistencia),
  );

export const isSurveyEligibleParticipant = (
  participant: Participant,
  attendance: AttendanceRecord[],
) =>
  attendance.some(
    (record) =>
      record.participant_id === participant.id &&
      record.dia === SURVEY_ELIGIBILITY_DAY,
  );
