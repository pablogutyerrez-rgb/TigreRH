import { auth } from '../lib/firebase';
import { getRuntimeEnv } from '../lib/runtimeConfig';

export type RotationFilters = { campaigns?: string[]; months?: string[]; from?: string; to?: string; search?: string };
export type RotationDetail = { id: string; fecha: string; fecha_alta: string; campana: string; dni: string; nombre: string; proveedor: string; motivo: string; descripcion: string; permanencia_dias: number | null; estado: string; razon: string };
export type RotationDashboard = {
  terminations: RotationDetail[]; detalle: RotationDetail[]; pendientes: RotationDetail[]; fecha_corte: string;
  altas_historicas: number; total_bajas: number; total_dotacion: number; porcentaje_rotacion: number | null; permanencia_promedio: number | null;
  funnel: { altas: number; bajas: number; dotacion: number };
  by_campaign: Array<{ campana: string; altas: number; dotacion: number; bajas: number; porcentaje: number | null }>;
  motivos: Array<{ name: string; value: number }>; descripciones: Array<{ name: string; value: number }>; permanencia: Array<{ name: string; value: number }>;
  fechas: Array<{ date: string; bajas: number; [motivo: string]: string | number }>;
  motivo_keys: string[];
  otros: RotationDetail[];
  filter_options: { campaigns: string[]; months: string[] };
};

const API_BASE_URL = getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');
const request = async <T>(path: string, options: RequestInit = {}) => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesión no disponible.');
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Module-Context': 'formacion:rotacion', ...options.headers } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || 'No se pudo procesar la información de rotación.');
  return payload as T;
};
export const getRotationDashboard = (filters: RotationFilters = {}, signal?: AbortSignal) => {
  const query = new URLSearchParams();
  if (filters.campaigns?.length) query.set('campaigns', filters.campaigns.join(','));
  if (filters.months?.length) query.set('months', filters.months.join(','));
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.search) query.set('search', filters.search);
  return request<RotationDashboard>(`/api/formacion/rotacion${query.size ? `?${query}` : ''}`, { signal });
};
export const saveRotationRows = (rows: Record<string, unknown>[]) => request<{ received: number; inserted: number; updated: number; skipped: number; confirmed: number; pending: number }>('/api/formacion/rotacion/bajas', { method: 'POST', body: JSON.stringify({ rows }) });
