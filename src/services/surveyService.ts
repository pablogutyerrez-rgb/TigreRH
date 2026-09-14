import { auth } from '../lib/firebase';
import { getRuntimeEnv } from '../lib/runtimeConfig';
import type { SurveyStatus, TrainingSurvey } from '../types';

const API_BASE_URL =
  getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');

const getAuthToken = async () => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesion no disponible.');
  return token;
};

export const createSurveyRemote = async (survey: TrainingSurvey) => {
  const token = await getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(survey),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'No se pudo crear la encuesta.');
  return data.survey as TrainingSurvey;
};

export const updateSurveyStatusRemote = async (
  surveyId: string,
  status: SurveyStatus,
  changes: Partial<TrainingSurvey>,
) => {
  const token = await getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status, changes }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'No se pudo actualizar la encuesta.');
};

export const updateSurveyLinkAssignmentsRemote = async (surveyId: string, userIds: string[]) => {
  const token = await getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/surveys/${surveyId}/link-assignments`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userIds }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'No se pudieron actualizar las asignaciones.');
};
