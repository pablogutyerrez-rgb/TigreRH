import { auth } from '../lib/firebase';
import { getRuntimeEnv } from '../lib/runtimeConfig';
import type {
  AttendanceRecord,
  Participant,
  TrainingSession,
  TrainingSurvey,
  OjtModule,
} from '../types';

const API_BASE_URL =
  getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');

const request = async (path: string, options: RequestInit) => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesion no disponible.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || 'No se pudo guardar la capacitacion.');
  return payload;
};

export const createTrainingBundle = (
  session: TrainingSession,
  survey: TrainingSurvey,
  participants: Participant[],
  attendance: AttendanceRecord[],
) => request('/api/trainings', {
  method: 'POST',
  body: JSON.stringify({ session, survey, participants, attendance }),
});

export const updateTraining = (
  sessionId: string,
  changes: Partial<TrainingSession>,
) => request(`/api/trainings/${sessionId}`, {
  method: 'PATCH',
  body: JSON.stringify(changes),
});

export const deleteTraining = (sessionId: string) =>
  request(`/api/trainings/${sessionId}`, {
    method: 'DELETE',
  });

export const appendTrainingParticipants = (
  sessionId: string,
  participants: Participant[],
  attendance: AttendanceRecord[],
) => request(`/api/trainings/${sessionId}/participants`, {
  method: 'POST',
  body: JSON.stringify({ participants, attendance }),
});

export const assignOjt = (sessionId: string) =>
  request(`/api/trainings/${sessionId}/assign-ojt`, { method: 'POST' }) as Promise<{
    module: OjtModule;
    session: TrainingSession;
  }>;

export const updateOjtModule = (moduleId: string, changes: Partial<Pick<OjtModule, 'nombre' | 'estado' | 'hora_capacitacion' | 'turno' | 'modalidad'>>) =>
  request(`/api/trainings/ojt/${moduleId}`, { method: 'PATCH', body: JSON.stringify(changes) }) as Promise<{ module: OjtModule }>;

export const deleteOjtModule = (moduleId: string) =>
  request(`/api/trainings/ojt/${moduleId}`, { method: 'DELETE' });
