import { auth } from '../lib/firebase';
import { getRuntimeEnv } from '../lib/runtimeConfig';
import type {
  SelectionApplicant,
  SelectionAuditLog,
  SelectionRequisition,
} from '../types';

const API_BASE_URL =
  getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');

let moduleContext = 'seleccion:postulantes';
let moduleReadOnly = false;
export const setSelectionModuleContext = (view: string, readOnly: boolean) => {
  moduleContext = `seleccion:${view}`;
  moduleReadOnly = readOnly;
};

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const context = moduleContext;
  if (options.method && options.method !== 'GET' && moduleReadOnly) throw new Error('Este apartado es de solo vista.');
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesion no disponible.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Module-Context': context,
      ...options.headers,
    },
  });
  const rawBody = await response.text();
  let payload: any = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || 'No se pudo completar la operacion.');
  }
  return payload as T;
};

export interface SelectionBootstrapData {
  requisitions: SelectionRequisition[];
  applicants: SelectionApplicant[];
  audit: SelectionAuditLog[];
}

export const getSelectionBootstrap = () =>
  request<SelectionBootstrapData>('/api/selection/bootstrap');

export const createSelectionRequisition = (
  requisition: Partial<SelectionRequisition>,
) =>
  request<{ requisition: SelectionRequisition }>('/api/selection/requisitions', {
    method: 'POST',
    body: JSON.stringify(requisition),
  });

export const updateSelectionRequisition = (
  id: string,
  changes: Partial<SelectionRequisition>,
) =>
  request<{ ok: true; changes: Partial<SelectionRequisition> }>(`/api/selection/requisitions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });

export const deleteSelectionRequisition = (id: string, reason: string) =>
  request<{ ok: true; changes: Partial<SelectionRequisition> }>(`/api/selection/requisitions/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });

export const createSelectionApplicant = (
  requisitionId: string,
  applicant: Partial<SelectionApplicant>,
) =>
  request<{ applicant: SelectionApplicant }>(`/api/selection/requisitions/${requisitionId}/applicants`, {
    method: 'POST',
    body: JSON.stringify(applicant),
  });

export const importSelectionApplicants = (
  requisitionId: string,
  applicants: Partial<SelectionApplicant>[],
) =>
  request<{ created: SelectionApplicant[]; skipped: Array<{ row: number; reason: string; dni?: string }> }>(
    `/api/selection/requisitions/${requisitionId}/applicants/bulk`,
    {
      method: 'POST',
      body: JSON.stringify({ applicants }),
    },
  );

export const updateSelectionApplicant = (
  id: string,
  changes: Partial<SelectionApplicant>,
) =>
  request<{ ok: true; changes: Partial<SelectionApplicant> }>(`/api/selection/applicants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });

export const deleteSelectionApplicant = (id: string, reason: string) =>
  request<{ ok: true; changes: Partial<SelectionApplicant> }>(`/api/selection/applicants/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });

export const assignSelectionToTraining = (
  requisitionId: string,
  applicantIds: string[],
  training: Record<string, unknown>,
) =>
  request<{ session: unknown; survey: unknown; assigned: number }>(
    `/api/selection/requisitions/${requisitionId}/assign-training`,
    {
      method: 'POST',
      body: JSON.stringify({ applicantIds, training }),
    },
  );
