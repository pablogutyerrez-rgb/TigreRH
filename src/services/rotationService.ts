import { auth } from '../lib/firebase';
import { getRuntimeEnv } from '../lib/runtimeConfig';

export type RotationFilters = { campaigns?: string[]; years?: number[]; periods?: string[]; from?: string; to?: string; search?: string };
export type RotationDashboard = {
  terminations: Array<{ id: string; fecha: string; campana: string; dni: string; nombre: string; motivo: string; tipo: string }>;
  headcounts: Array<{ id: string; periodo: string; campana: string; dotacion: number }>;
  total_bajas: number; total_dotacion: number; porcentaje_rotacion: number | null;
  by_campaign: Array<{ campana: string; dotacion: number; bajas: number; porcentaje: number | null }>;
  motivos: Array<{ name: string; value: number }>;
  tipos: Array<{ name: string; value: number }>;
  fechas: Array<{ date: string; bajas: number }>;
};

const API_BASE_URL = getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');

const request = async <T>(path: string, options: RequestInit = {}) => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesión no disponible.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Module-Context': 'formacion:rotacion', ...options.headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || 'No se pudo procesar la información de rotación.');
  return payload as T;
};

export const getRotationDashboard = (filters: RotationFilters = {}) => {
  const query = new URLSearchParams();
  if (filters.campaigns?.length) query.set('campaigns', filters.campaigns.join(','));
  if (filters.years?.length) query.set('years', filters.years.join(','));
  if (filters.periods?.length) query.set('periods', filters.periods.join(','));
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.search) query.set('search', filters.search);
  return request<RotationDashboard>(`/api/formacion/rotacion${query.size ? `?${query}` : ''}`);
};

export const saveRotationRows = (type: 'bajas' | 'dotacion', rows: Record<string, unknown>[]) =>
  request<{ received: number; inserted: number; skipped: number }>(`/api/formacion/rotacion/${type}`, {
    method: 'POST', body: JSON.stringify({ rows }),
  });
