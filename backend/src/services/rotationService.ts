import { createHash } from 'node:crypto';
import { dataDb as adminDb } from '../hybridDb.js';

type Row = Record<string, unknown> & { id: string };
export type RotationFilters = { campaigns?: string[]; years?: number[]; periods?: string[]; from?: string; to?: string; search?: string };

const normalize = (value: unknown) => String(value ?? '').trim();
const key = (value: unknown) => normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const day = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
    return date.toISOString().slice(0, 10);
  }
  const raw = normalize(value);
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const latin = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(raw);
  if (latin) return `${latin[3]}-${latin[2].padStart(2, '0')}-${latin[1].padStart(2, '0')}`;
  return raw.slice(0, 10);
};
const hash = (type: string, values: unknown[]) => createHash('sha256').update(JSON.stringify([type, ...values])).digest('hex').slice(0, 32);
const monthKey = (value: unknown) => {
  const raw = normalize(value);
  const match = /^(\d{4})[-/](\d{1,2})/.exec(raw);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}` : raw;
};
const text = (row: Record<string, unknown>, names: string[]) => {
  const entries = Object.entries(row);
  const found = entries.find(([header]) => names.includes(key(header)));
  return normalize(found?.[1]);
};
const value = (row: Record<string, unknown>, names: string[]) => {
  const found = Object.entries(row).find(([header]) => names.includes(key(header)));
  return found?.[1];
};
const number = (value: unknown) => {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : NaN;
};
const isWithin = (value: string, from?: string, to?: string) =>
  (!from || value >= from) && (!to || value <= to);

export type RotationTermination = {
  id: string; fecha: string; fecha_alta: string; campana: string; dni: string; nombre: string; motivo: string; tipo: string;
  raw: Record<string, unknown>; imported_at: string; imported_by: string;
};
export type RotationHeadcount = {
  id: string; periodo: string; campana: string; dotacion: number;
  raw: Record<string, unknown>; imported_at: string; imported_by: string;
};

export const normalizeTerminations = (rows: Record<string, unknown>[]) => rows.map((raw, index) => {
  const fecha = day(value(raw, ['fecha', 'cese', 'fechabaja', 'fechacese', 'fechadebaja']));
  const fecha_alta = day(value(raw, ['alta', 'fechaalta', 'fechaingreso', 'fechaingresolaboral']));
  const campana = text(raw, ['campana', 'campaña']);
  const dni = text(raw, ['dni', 'documento', 'numerodocumento', 'numerodedocumento']);
  const nombre = text(raw, ['nombre', 'nombres', 'nombreyapellidos', 'colaborador', 'trabajador', 'nombrecompleto']);
  const motivo = text(raw, ['motivo', 'motivobaja', 'motivocese', 'causal']);
  const tipo = text(raw, ['tipo', 'tipobaja', 'tipocese']);
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !campana || (!dni && !nombre)) {
    const missing = [!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? 'CESE/fecha válida' : '', !campana ? 'CAMPAÑA' : '', !dni && !nombre ? 'DNI o NOMBRE Y APELLIDOS' : ''].filter(Boolean);
    throw new Error(`Fila ${index + 2}: falta ${missing.join(', ')}.`);
  }
  return { id: hash('termination', [fecha, campana, dni || nombre, motivo, tipo]), fecha, fecha_alta: /^\d{4}-\d{2}-\d{2}$/.test(fecha_alta) ? fecha_alta : '', campana, dni, nombre, motivo, tipo, raw };
});

export const normalizeHeadcounts = (rows: Record<string, unknown>[]) => rows.map((raw) => {
  const periodo = monthKey(text(raw, ['periodo', 'mes', 'fecha', 'date']));
  const campana = text(raw, ['campana', 'campaña']);
  const dotacion = number(text(raw, ['dotacion', 'dotación', 'headcount', 'cantidad', 'colaboradores', 'cantidadcolaboradores']));
  if (!/^\d{4}-\d{2}$/.test(periodo) || !campana || !Number.isInteger(dotacion) || dotacion < 0) {
    throw new Error('Cada dotación requiere periodo AAAA-MM, campaña y cantidad entera mayor o igual a cero.');
  }
  return { id: hash('headcount', [periodo, campana]), periodo, campana, dotacion, raw };
});

const read = async <T extends Row>(collection: string) => {
  const snapshot = await adminDb.collection(collection).get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as T);
};

export const saveRotationImport = async (
  type: 'bajas' | 'dotacion', rows: Record<string, unknown>[], actor: { uid: string; nombre: string },
) => {
  const now = new Date().toISOString();
  const importId = `rotation-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const normalized = type === 'bajas' ? normalizeTerminations(rows) : normalizeHeadcounts(rows);
  const collection = type === 'bajas' ? 'rotation_terminations' : 'rotation_headcount';
  let inserted = 0; let skipped = 0;
  await adminDb.runTransaction(async (transaction) => {
    for (const row of normalized) {
      const ref = adminDb.collection(collection).doc(row.id);
      const existing = await transaction.get(ref);
      if (existing.exists) { skipped += 1; continue; }
      transaction.set(ref, { ...row, imported_at: now, imported_by: actor.uid, import_id: importId });
      inserted += 1;
    }
    transaction.set(adminDb.collection('rotation_imports').doc(importId), {
      id: importId, type, row_count: normalized.length, inserted, skipped, imported_at: now,
      imported_by: actor.uid, imported_by_name: actor.nombre,
    });
  });
  return { import_id: importId, received: normalized.length, inserted, skipped };
};

const matches = (row: { campana: string }, filters: RotationFilters) =>
  (!filters.campaigns?.length || filters.campaigns.includes(row.campana));

export const getRotationDashboard = async (filters: RotationFilters = {}) => {
  const [terminations, headcounts] = await Promise.all([
    read<RotationTermination & Row>('rotation_terminations'),
    read<RotationHeadcount & Row>('rotation_headcount'),
  ]);
  const visibleTerminations = terminations.filter((row) => {
    const year = Number(row.fecha.slice(0, 4)); const period = row.fecha.slice(0, 7);
    const searchable = [row.dni, row.nombre, row.fecha].join(' ').toLowerCase();
    return matches(row, filters) && (!filters.years?.length || filters.years.includes(year)) &&
      (!filters.periods?.length || filters.periods.includes(period)) &&
      isWithin(row.fecha, filters.from, filters.to) &&
      (!filters.search || searchable.includes(filters.search.toLowerCase()));
  });
  const visibleHeadcounts = headcounts.filter((row) => {
    const year = Number(row.periodo.slice(0, 4));
    return matches(row, filters) && (!filters.years?.length || filters.years.includes(year)) &&
      (!filters.periods?.length || filters.periods.includes(row.periodo)) &&
      isWithin(`${row.periodo}-01`, filters.from, filters.to);
  });
  const uniqueTerminations = [...new Map(visibleTerminations.map((row) => [row.dni ? `${row.campana}/${row.fecha}/${row.dni}` : row.id, row])).values()];
  const headcountByCampaignPeriod = new Map<string, RotationHeadcount>();
  visibleHeadcounts.forEach((row) => headcountByCampaignPeriod.set(`${row.campana}/${row.periodo}`, row));
  const totalHeadcount = [...headcountByCampaignPeriod.values()].reduce((sum, row) => sum + row.dotacion, 0);
  const byCampaign = new Map<string, { campana: string; dotacion: number; bajas: number }>();
  [...headcountByCampaignPeriod.values()].forEach((row) => {
    const item = byCampaign.get(row.campana) || { campana: row.campana, dotacion: 0, bajas: 0 };
    item.dotacion += row.dotacion; byCampaign.set(row.campana, item);
  });
  uniqueTerminations.forEach((row) => {
    const item = byCampaign.get(row.campana) || { campana: row.campana, dotacion: 0, bajas: 0 };
    item.bajas += 1; byCampaign.set(row.campana, item);
  });
  const motives = new Map<string, number>(); const dates = new Map<string, number>(); const types = new Map<string, number>();
  uniqueTerminations.forEach((row) => {
    if (row.motivo) motives.set(row.motivo, (motives.get(row.motivo) || 0) + 1);
    if (row.tipo) types.set(row.tipo, (types.get(row.tipo) || 0) + 1);
    dates.set(row.fecha, (dates.get(row.fecha) || 0) + 1);
  });
  return {
    terminations: uniqueTerminations, headcounts: [...headcountByCampaignPeriod.values()],
    total_bajas: uniqueTerminations.length, total_dotacion: totalHeadcount,
    porcentaje_rotacion: totalHeadcount ? Math.round(uniqueTerminations.length / totalHeadcount * 10000) / 100 : null,
    by_campaign: [...byCampaign.values()].map((row) => ({ ...row, porcentaje: row.dotacion ? Math.round(row.bajas / row.dotacion * 10000) / 100 : null })).sort((a, b) => a.campana.localeCompare(b.campana)),
    motivos: [...motives].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    tipos: [...types].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    fechas: [...dates].map(([date, bajas]) => ({ date, bajas })).sort((a, b) => a.date.localeCompare(b.date)),
  };
};

export const getRotationRateForEvaluation = async (filters: { campaigns?: string[]; year: number; months: number[] }) => {
  const periods = filters.months.map((month) => `${filters.year}-${String(month).padStart(2, '0')}`);
  const dashboard = await getRotationDashboard({ campaigns: filters.campaigns, years: [filters.year], periods });
  if (!dashboard.total_dotacion) return { disponible: false, porcentaje: null, bajas: dashboard.total_bajas, dotacion: 0 };
  return { disponible: true, porcentaje: dashboard.porcentaje_rotacion, bajas: dashboard.total_bajas, dotacion: dashboard.total_dotacion };
};
