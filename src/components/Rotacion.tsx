import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, Filter, Save, Search, Upload } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { User } from '../types';
import { getRotationDashboard, saveRotationRows, type RotationDashboard } from '../services/rotationService';
import { parseRotationWorkbook } from '../utils/rotationWorkbook';
import CampaignMultiSelect from './CampaignMultiSelect';

interface RotacionProps { currentUser: User; }
const emptyData: RotationDashboard = { terminations: [], detalle: [], pendientes: [], fecha_corte: '', altas_historicas: 0, total_bajas: 0, total_dotacion: 0, porcentaje_rotacion: null, permanencia_promedio: null, funnel: { altas: 0, bajas: 0, dotacion: 0 }, by_campaign: [], motivos: [], descripciones: [], permanencia: [], fechas: [], otros: [], filter_options: { campaigns: [], months: [] } };
const percent = (value: number | null) => value == null ? 'Sin datos' : `${value.toFixed(2)}%`;
const monthLabel = (month: string) => new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));

export default function Rotacion({ currentUser }: RotacionProps) {
  const [data, setData] = useState<RotationDashboard>(emptyData);
  const [campaigns, setCampaigns] = useState<string[]>([]); const [months, setMonths] = useState<string[]>([]);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Record<string, unknown>[]>([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const input = useRef<HTMLInputElement>(null);
  const [refresh, setRefresh] = useState(0);
  const readOnly = Boolean(currentUser.module_view_only?.includes('formacion:rotacion'));
  useEffect(() => {
    if (from && to && from > to) { setError('Desde no puede ser posterior a Hasta.'); setLoading(false); return; }
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError('');
      try {
        const result = await getRotationDashboard({ campaigns, months, from: from || undefined, to: to || undefined, search: search || undefined }, controller.signal);
        if (!controller.signal.aborted) setData(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo cargar Rotación.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    const timer = window.setTimeout(() => void load(), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [campaigns, months, from, to, search, refresh]);
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') setRefresh((value) => value + 1); };
    const interval = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update); };
  }, []);
  const stage = async (file?: File) => {
    if (!file) return;
    setPending([]);
    try { setError(''); setMessage(''); setPending(parseRotationWorkbook(await file.arrayBuffer())); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo leer el Excel.'); }
  };
  const save = async () => {
    if (!pending.length) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await saveRotationRows(pending); setPending([]);
      setMessage(`Importación completada: ${result.inserted} nuevas${result.updated ? `, ${result.updated} actualizadas` : ''}${result.skipped ? `, ${result.skipped} sin cambios` : ''}.`);
      if (input.current) input.current.value = '';
      setRefresh((value) => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar la importación.'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-5 animate-in fade-in duration-300">
    <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs font-black uppercase tracking-wider text-violet-600">Medición</p><h2 className="text-xl font-black text-slate-900">Rotación</h2></div>
      {!readOnly && <div className="flex flex-wrap gap-2"><input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void stage(event.target.files?.[0])} /><button onClick={() => input.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-700"><Upload className="h-4 w-4" />Cargar rotación</button><button disabled={saving || !pending.length} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />Guardar</button></div>}
    </div>
    {pending.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">Carga pendiente: {pending.length} notificaciones. Confirma con «Guardar».</div>}
    {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{message}</div>}{error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">{error}</div>}
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800"><Filter className="h-4 w-4 text-violet-600" />Filtros</div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <div className="text-[10px] font-black uppercase text-slate-500">Campaña<CampaignMultiSelect selected={campaigns} options={data.filter_options.campaigns} onChange={setCampaigns} allLabel="Todas las campañas" summaryClassName="mt-1 rounded-lg border border-slate-200 px-2 py-2 text-xs normal-case" /></div>
      <label className="text-[10px] font-black uppercase text-slate-500">Mes<select value={months[0] || ''} onChange={(event) => setMonths(event.target.value ? [event.target.value] : [])} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs"><option value="">Todos los meses</option>{data.filter_options.months.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>
      <label className="text-[10px] font-black uppercase text-slate-500">Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs" /></label><label className="text-[10px] font-black uppercase text-slate-500">Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs" /></label>
      <label className="text-[10px] font-black uppercase text-slate-500">Buscar<div className="relative mt-1"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="DNI o nombre" className="w-full rounded-lg border border-slate-200 py-2 pl-7 pr-2 text-xs" /></div></label>
    </div></div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric title="Dotación activa" value={String(data.total_dotacion)} /><Metric title="Ceses efectivos" value={String(data.total_bajas)} /><Metric title="Rotación" value={percent(data.porcentaje_rotacion)} /><Metric title="Permanencia promedio" value={data.permanencia_promedio == null ? 'Sin datos' : `${data.permanencia_promedio} días`} /></div>
    <Panel title="Embudo de rotación"><div className="mb-3 text-xs text-slate-500">Corte: {data.fecha_corte || '—'} · Base: dotación inicial + altas y reingresos del período</div><div className="space-y-3">{[['Altas históricas / base del período', data.funnel.altas], ['Ceses conciliados', data.funnel.bajas], ['Dotación activa', data.funnel.dotacion]].map(([label, quantity], index) => { const amount = Number(quantity); const share = data.funnel.altas ? amount / data.funnel.altas * 100 : 0; return <div key={label}><div className="mb-1 flex justify-between gap-2 text-xs font-semibold"><span>{label}</span><span>{amount} ({percent(share)})</span></div><div className="h-3 w-full rounded bg-slate-100"><div className={`h-3 rounded ${['bg-violet-600', 'bg-rose-500', 'bg-emerald-500'][index]}`} style={{ width: `${Math.min(100, share)}%` }} /></div></div>; })}</div></Panel>
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Ceses por campaña"><Chart data={data.by_campaign} bars={['bajas']} /><Rows headers={['Campaña', 'Base', 'Activos', 'Ceses', 'Rotación']} rows={data.by_campaign.map((item) => [item.campana, String(item.altas), String(item.dotacion), String(item.bajas), percent(item.porcentaje)])} /></Panel>
      <Panel title="Ceses mensuales"><Trend data={data.fechas} /><Rows headers={['Mes', 'Ceses']} rows={data.fechas.map((item) => [monthLabel(item.date), String(item.bajas)])} /></Panel>
      <Panel title="Motivos de cese"><Chart data={data.motivos} bars={['value']} labelKey="name" /><Rows headers={['Motivo', 'Ceses']} rows={data.motivos.map((item) => [item.name, String(item.value)])} /></Panel>
      <Panel title="Permanencia"><Chart data={data.permanencia} bars={['value']} labelKey="name" /><Rows headers={['Rango', 'Ceses']} rows={data.permanencia.map((item) => [item.name, String(item.value)])} /></Panel>
      <Panel title="Descripciones de despido"><Chart data={data.descripciones} bars={['value']} labelKey="name" /><Rows headers={['Descripción', 'Ceses']} rows={data.descripciones.map((item) => [item.name, String(item.value)])} /></Panel>
      <Panel title="Otros / Campaña no identificada"><Rows headers={['Colaborador', 'Documento', 'Proveedor', 'Fecha', 'Motivo', 'Descripción', 'Validación']} rows={data.otros.map((item) => [item.nombre, item.dni, item.proveedor, item.fecha, item.motivo, item.descripcion, item.razon])} /></Panel>
    </div>
    {data.pendientes.length > 0 && <Panel title="Pendientes de validación"><Rows headers={['Colaborador', 'Documento', 'Campaña', 'Fecha', 'Observación']} rows={data.pendientes.map((item) => [item.nombre, item.dni, item.campana, item.fecha, item.razon])} /></Panel>}
    <Panel title="Detalle de movimientos"><Rows headers={['Colaborador', 'Documento', 'Campaña', 'Proveedor', 'Alta', 'Movimiento', 'Motivo', 'Descripción', 'Permanencia', 'Estado', 'Validación']} rows={data.detalle.map((item) => [item.nombre, item.dni, item.campana, item.proveedor, item.fecha_alta, item.fecha, item.motivo, item.descripcion, item.permanencia_dias == null ? 'No aplica' : `${item.permanencia_dias} días`, item.estado, item.razon])} /></Panel>
    {loading && <p className="text-center text-xs font-semibold text-slate-500">Actualizando datos de rotación...</p>}
  </div>;
}
const Metric = ({ title, value }: { title: string; value: string }) => <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">{title}</p><p className="mt-2 text-2xl font-black text-slate-900">{value}</p></div>;
const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="min-w-0 border-t border-slate-200 py-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><BarChart3 className="h-4 w-4 text-violet-600" />{title}</h3>{children}</section>;
const Chart = ({ data, bars, labelKey = 'campana' }: { data: Array<Record<string, unknown>>; bars: string[]; labelKey?: string }) => data.length ? <div className="mb-4 h-44"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={labelKey} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey={bars[0]} fill="#7c3aed" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div> : null;
const Trend = ({ data }: { data: Array<{ date: string; bajas: number }> }) => data.length ? <div className="mb-4 h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="bajas" stroke="#7c3aed" strokeWidth={2} /></LineChart></ResponsiveContainer></div> : null;
const Rows = ({ headers, rows }: { headers: string[]; rows: string[][] }) => rows.length ? <div className="max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead className="text-[10px] uppercase text-slate-500"><tr>{headers.map((header) => <th className="pb-2 pr-2" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-t border-slate-100" key={`${row.join('-')}-${index}`}>{row.map((cell, cellIndex) => <td className="py-2 pr-2 font-medium text-slate-700" key={cellIndex}>{cell || 'Sin especificar'}</td>)}</tr>)}</tbody></table></div> : <p className="text-xs text-slate-500">Sin información disponible.</p>;
