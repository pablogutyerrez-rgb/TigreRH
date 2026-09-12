import { auth } from '../lib/firebase';
import { getRuntimeEnv } from '../lib/runtimeConfig';
import type { AttendanceRecord, AttendanceReopenRequest, OperationConfirmation, Participant } from '../types';

const API_BASE_URL =
  getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');

const save = async <T = void>(path: string, body: unknown): Promise<T> => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesion no disponible.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'No se pudo guardar el registro.');
  return data as T;
};

const post = async <T>(path: string, body: unknown, forceTokenRefresh = false): Promise<T> => {
  const token = await auth?.currentUser?.getIdToken(forceTokenRefresh);
  if (!token) throw new Error('Sesion no disponible.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'No se pudo procesar la solicitud.');
  return data as T;
};

const get = async <T>(path: string): Promise<T> => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesion no disponible.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'No se pudo obtener la informacion.');
  return data as T;
};

const remove = async (path: string) => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesion no disponible.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'No se pudo eliminar el registro.');
};

export const persistAttendance = (record: AttendanceRecord) =>
  save(`/api/operations/attendance/${record.id}`, record);

export const persistAttendanceBatch = (records: AttendanceRecord[]) =>
  save<{ ok: true; saved: number }>('/api/operations/attendance/bulk', { records });

export const persistConfirmation = (confirmation: OperationConfirmation) =>
  save(`/api/operations/confirmations/${confirmation.id}`, confirmation);

export const persistParticipant = (participant: Participant) =>
  save(`/api/operations/participants/${participant.id}`, participant);

export const uploadParticipantCvRemote = async (
  participantId: string,
  trainingSessionId: string,
  file: File,
) => {
  const token = await auth?.currentUser?.getIdToken(true);
  if (!token) throw new Error('Sesion no disponible.');
  const query = new URLSearchParams({
    training_session_id: trainingSessionId,
    file_name: file.name,
  });
  const response = await fetch(`${API_BASE_URL}/api/operations/participants/${participantId}/cv?${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'X-Training-Session-Id': trainingSessionId,
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  });
  const responseText = await response.text();
  const data = responseText
    ? (() => {
        try {
          return JSON.parse(responseText) as { participant?: Participant; message?: string };
        } catch {
          return null;
        }
      })()
    : null;
  if (!response.ok) {
    throw new Error(data?.message || `No se pudo guardar el CV (HTTP ${response.status}).`);
  }
  if (!data?.participant) throw new Error('El servidor no devolvio los datos del CV guardado.');
  return data.participant;
};

export const getParticipantCvUrlRemote = async (participantId: string) => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesion no disponible.');
  const response = await fetch(`${API_BASE_URL}/api/operations/participants/${participantId}/cv-content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || 'No se pudo obtener el CV.');
  }
  return URL.createObjectURL(await response.blob());
};

export const deleteParticipantRemote = (participantId: string) =>
  remove(`/api/operations/participants/${participantId}`);

export const persistReopenRequest = (request: AttendanceReopenRequest) =>
  save<{ ok: true; request: AttendanceReopenRequest }>(`/api/operations/reopens/${request.id}`, request);

export const getReopenRequestsRemote = async () => {
  const result = await get<{ requests: AttendanceReopenRequest[] }>('/api/operations/reopens');
  return result.requests;
};
