import { auth } from '../lib/firebase';
import { getRuntimeEnv } from '../lib/runtimeConfig';
import type {
  AttendanceRecord,
  AttendanceReopenRequest,
  AuditLog,
  OperationConfirmation,
  Participant,
  SurveyResponse,
  TrainingSession,
  TrainingSurvey,
  User,
  OjtModule,
} from '../types';

export interface BootstrapData {
  users: User[];
  sessions: TrainingSession[];
  ojt_modules: OjtModule[];
  participants: Participant[];
  attendance: AttendanceRecord[];
  confirmations: OperationConfirmation[];
  reopens: AttendanceReopenRequest[];
  logs: AuditLog[];
  surveys: TrainingSurvey[];
  responses: SurveyResponse[];
}

const API_BASE_URL =
  getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');

export const getBootstrapData = async () => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) {
    throw new Error('Sesion no disponible. Vuelve a iniciar sesion.');
  }

  const response = await fetch(`${API_BASE_URL}/api/bootstrap`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => null)) as
    | (BootstrapData & { message?: string })
    | null;

  if (!response.ok || !payload) {
    throw new Error(payload?.message || 'No se pudieron cargar los datos.');
  }

  return payload;
};
