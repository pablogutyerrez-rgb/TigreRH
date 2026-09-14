import type { AttendanceRecord, Participant, SurveyResponse, TrainingSurvey } from '../types';
import { getRuntimeEnv } from '../lib/runtimeConfig';

const API_BASE_URL =
  getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = (await response.json().catch(() => null)) as
    | (T & { message?: string })
    | null;
  if (!response.ok) {
    throw new Error(data?.message || 'No se pudo procesar la encuesta.');
  }
  return data as T;
};

export const getPublicSurveyContext = async (token: string, dni: string) => {
  const response = await fetch(
    `${API_BASE_URL}/api/public-surveys/${encodeURIComponent(token)}?dni=${encodeURIComponent(dni)}`,
  );
  return parseResponse<{
    survey: TrainingSurvey;
    participant: Participant;
    attendance: AttendanceRecord[];
  }>(response);
};

export const getPublicSurveyMetadata = async (token: string) => {
  const response = await fetch(
    `${API_BASE_URL}/api/public-surveys/${encodeURIComponent(token)}/metadata`,
    { cache: 'no-store' },
  );
  return parseResponse<{ survey: TrainingSurvey }>(response);
};

export const submitPublicSurveyResponse = async (
  token: string,
  payload: {
    dni: string;
    q1: number;
    q2: number;
    q3: number;
    q4: number;
    q5: number;
    q6: number;
    q7: number;
    q8: number;
    comentario_positivo: string;
    aspecto_mejora: string;
  },
) => {
  const response = await fetch(
    `${API_BASE_URL}/api/public-surveys/${encodeURIComponent(token)}/responses`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  return parseResponse<{ ok: true; response: SurveyResponse }>(response);
};
