import { auth } from '../lib/firebase';
import { getRuntimeEnv } from '../lib/runtimeConfig';
import type { TrainingVariableEvaluation } from '../types';

export type TrainingVariablePayload = Pick<
  TrainingVariableEvaluation,
  | 'formula_version'
  | 'porcentaje_rotacion'
  | 'meses'
  | 'formador_ids'
  | 'campanas'
  | 'anio'
  | 'mes'
  | 'id_formador'
  | 'nombre_formador'
  | 'observacion_general'
  | 'porcentaje_retencion'
  | 'porcentaje_produccion_individual'
  | 'porcentaje_produccion_grupal'
  | 'porcentaje_satisfaccion'
  | 'porcentaje_administrativo'
  | 'observacion_administrativa'
  | 'generation_ids'
  | 'codigos_generacion'
  | 'calculo_automatico'
  | 'calculo_detalle'
>;

export interface TrainingVariableSource {
  id: string;
  codigo: string;
  campana: string;
  fecha_inicio: string;
  fecha_fin: string;
  formadores: Array<{ id: string; nombre: string }>;
}

export interface AutomaticTrainingVariableCalculation {
  generation_ids: string[];
  codigos_generacion: string[];
  porcentaje_retencion: number;
  porcentaje_produccion_individual: number;
  porcentaje_produccion_grupal: number;
  porcentaje_satisfaccion: number;
  porcentaje_rotacion: number;
  detalle: NonNullable<TrainingVariableEvaluation['calculo_detalle']>;
}

const API_BASE_URL =
  getRuntimeEnv('VITE_API_BASE_URL') || (import.meta.env.PROD ? '' : 'http://localhost:8080');

const request = async <T>(path: string, options: RequestInit = {}) => {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Sesión no disponible.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || 'No se pudo procesar la evaluación.');
  return payload as T;
};

export const listTrainingVariableEvaluations = () =>
  request<{ evaluations: TrainingVariableEvaluation[] }>('/api/formacion/variables');

export const listTrainingVariableSources = (anio: number, mes: number, meses?: number[]) => {
  const query = new URLSearchParams({ anio: String(anio), mes: String(mes) });
  if (meses?.length) query.set('meses', meses.join(','));
  return request<{ sources: TrainingVariableSource[] }>(`/api/formacion/variables/fuentes/codigos?${query}`);
};

export const calculateTrainingVariableAutomatically = (
  formadorId: string,
  generationIds: string[],
  anio: number,
  mes: number,
  filters?: { meses?: number[]; formador_ids?: string[]; campanas?: string[] },
) => request<{ calculation: AutomaticTrainingVariableCalculation }>('/api/formacion/variables/calcular/automatico', {
  method: 'POST',
  body: JSON.stringify({ formador_id: formadorId, generation_ids: generationIds, anio, mes, ...filters }),
});

export const createTrainingVariableEvaluation = (payload: TrainingVariablePayload) =>
  request<{ evaluation: TrainingVariableEvaluation }>('/api/formacion/variables', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateTrainingVariableEvaluation = (id: string, payload: TrainingVariablePayload) =>
  request<{ evaluation: TrainingVariableEvaluation }>(`/api/formacion/variables/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const closeTrainingVariableEvaluation = (id: string) =>
  request<{ evaluation: TrainingVariableEvaluation }>(`/api/formacion/variables/${id}/cerrar`, {
    method: 'POST',
  });

export const reopenTrainingVariableEvaluation = (id: string) =>
  request<{ evaluation: TrainingVariableEvaluation }>(`/api/formacion/variables/${id}/reabrir`, {
    method: 'POST',
  });

export const annulTrainingVariableEvaluation = (id: string) =>
  request<{ evaluation: TrainingVariableEvaluation }>(`/api/formacion/variables/${id}/anular`, {
    method: 'POST',
  });

export const deleteTrainingVariableEvaluation = (id: string) =>
  request<{ id: string }>(`/api/formacion/variables/${id}`, {
    method: 'DELETE',
  });
