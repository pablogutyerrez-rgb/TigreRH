import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertCircle, BarChart3, Clock3, Download, Filter, Funnel as FunnelIcon, RefreshCw, Save, Search, Upload, UserMinus, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { User } from '../types';
import { getRotationDashboard, saveHeadcountRows, saveRotationRows, type RotationDashboard } from '../services/rotationService';
import { parseRotationWorkbook } from '../utils/rotationWorkbook';
import { parseHeadcountWorkbook } from '../utils/rotationHeadcountWorkbook';
import CampaignMultiSelect from './CampaignMultiSelect';

interface RotacionProps { currentUser: User; }
const emptyData: RotationDashboard = { terminations: [], detalle: [], pendientes: [], fecha_corte: '', altas_historicas: 0, total_bajas: 0, total_dotacion: 0, porcentaje_rotacion: null, permanencia_promedio: null, funnel: { altas: 0, bajas: 0, dotacion: 0 }, by_campaign: [], motivos: [], descripciones: [], permanencia: [], fechas: [], motivo_keys: [], otros: [], filter_options: { campaigns: [], months: [] } };
const palette = ['#7c3aed', '#f97316', '#ef4444', '#0ea5e9', '#14b8a6', '#eab308'];
const percent = (value: number | null) => value == null ? 'Sin datos' : `${value.toFixed(2)}%`;
const monthLabel = (month: string) => new Intl.DateTimeFormat('es-PE', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
const cell = (value: string | number | null | undefined) => String(value ?? '').trim() || 'Sin especificar';
const exitDate = (item: RotationDashboard['detalle'][number]) => item.fecha || (item.estado === 'Cese pendiente de fecha' ? 'Pendiente' : item.estado === 'Alta no procedió' ? 'No aplica' : '');
const peruDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function Rotacion({ currentUser }: RotacionProps) {
  const [data, setData] = useState<RotationDashboard>(emptyData);
  const [campaigns, setCampaigns] = useState<string[]>([]); const [months, setMonths] = useState<string[]>([]);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Record<string, unknown>[]>([]); const [pendingHeadcount, setPendingHeadcount] = useState<Record<string, unknown>[]>([]); const [headcountCutoff, setHeadcountCutoff] = useState(peruDate); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const input = useRef<HTMLInputElement>(null); const headcountInput = useRef<HTMLInputElement>(null);
  const [refresh, setRefresh] = useState(0); const readOnly = Boolean(currentUser.module_view_only?.includes('formacion:rotacion'));
  useEffect(() => {
    if (from && to && from > to) { setError('Desde no puede ser posterior a Hasta.'); setLoading(false); return; }
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError('');
      try {
        const result = await getRotationDashboard({ campaigns, months, from: from || undefined, to: to || undefined, search: search || undefined }, controller.signal);
        if (!controller.signal.aborted) setData(result);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo cargar Rotación.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    const timer = window.setTimeout(() => void load(), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [campaigns, months, from, to, search, refresh]);
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') setRefresh((value) => value + 1); };
    const interval = window.setInterval(update, 60000); window.addEventListener('focus', update);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update); };
  }, []);
  const stage = async (file?: File) => {
    if (!file) return;
    try { setError(''); setMessage(''); const rows = parseRotationWorkbook(await file.arrayBuffer()); setPending(rows); setMessage(`Archivo validado: ${rows.length} registros listos para importar.`); }
    catch (reason) { setPending([]); setError(reason instanceof Error ? reason.message : 'No se pudo leer el Excel.'); }
  };
  const save = async () => {
    if (!pending.length) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await saveRotationRows(pending); setPending([]);
      setMessage(`Importación procesada: ${result.received}; nuevas: ${result.inserted}; actualizadas: ${result.updated}; sin cambios: ${result.skipped}; ceses confirmados: ${result.confirmed}; pendientes: ${result.pending}.`);
      if (input.current) input.current.value = ''; setRefresh((value) => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar la importación.'); }
    finally { setSaving(false); }
  };
  const stageHeadcount = async (file?: File) => {
    if (!file) return;
    try { setError(''); setMessage(''); const rows = parseHeadcountWorkbook(await file.arrayBuffer(), headcountCutoff); setPendingHeadcount(rows); setMessage(`Dotación validada al ${headcountCutoff}: ${rows.length} personas activas listas para importar.`); }
    catch (reason) { setPendingHeadcount([]); setError(reason instanceof Error ? reason.message : 'No se pudo leer el Excel de dotación.'); }
  };
  const saveHeadcount = async () => {
    if (!pendingHeadcount.length) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await saveHeadcountRows(pendingHeadcount); setPendingHeadcount([]);
      setMessage(`Dotación procesada: ${result.received}; nuevas: ${result.inserted}; actualizadas: ${result.updated}; sin cambios: ${result.skipped}.`);
      if (headcountInput.current) headcountInput.current.value = ''; setRefresh((value) => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar la dotación.'); }
    finally { setSaving(false); }
  };
  const clear = () => { setCampaigns([]); setMonths([]); setFrom(''); setTo(''); setSearch(''); setError(''); };
  const exportDetail = () => {
    const rows = data.detalle.map((item) => ({ Nombre: cell(item.nombre), Documento: cell(item.dni), Campaña: cell(item.campana), Proveedor: cell(item.proveedor), Alta: cell(item.fecha_alta), 'Fecha de cese': cell(exitDate(item)), Motivo: cell(item.motivo), 'Descripción / observación': cell(item.descripcion), 'Permanencia (días)': item.permanencia_dias ?? '', Estado: cell(item.estado), Validación: cell(item.razon) }));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Rotación'); XLSX.writeFile(workbook, 'rotacion-filtrada.xlsx');
  };
  const funnel = useMemo(() => [{ name: 'Altas', value: data.funnel.altas, fill: '#7c3aed' }, { name: 'Ceses', value: data.funnel.bajas, fill: '#fb7185' }, ...(data.funnel.pendientes ? [{ name: 'Ceses sin fecha', value: data.funnel.pendientes, fill: '#f59e0b' }] : []), { name: 'Activos', value: data.funnel.dotacion, fill: '#10b981' }], [data.funnel]);
  return <div className="space-y-4 animate-in fade-in duration-300">
    <div className="flex items-end justify-between border-b border-slate-200 pb-3"><div><p className="text-[11px] font-black uppercase tracking-wider text-violet-600">Medición</p><h2 className="text-xl font-black text-slate-900">Rotación</h2></div><p className="hidden text-xs text-slate-500 sm:block">Corte: {data.fecha_corte || 'Sin datos'}</p></div>
    {message && <Notice tone="success">{message}</Notice>}{error && <Notice tone="error">{error}</Notice>}
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800"><Filter className="h-4 w-4 text-violet-600" />Filtros</div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
      <div className="text-[10px] font-black uppercase text-slate-500">Campaña<CampaignMultiSelect selected={campaigns} options={data.filter_options.campaigns} onChange={setCampaigns} allLabel="Todas las campañas" summaryClassName="mt-1 rounded-lg border border-slate-200 px-2 py-2 text-xs normal-case" /></div>
      <label className="text-[10px] font-black uppercase text-slate-500">Mes<select value={months[0] || ''} onChange={(event) => setMonths(event.target.value ? [event.target.value] : [])} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs"><option value="">Todos los meses</option>{data.filter_options.months.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>
      <label className="text-[10px] font-black uppercase text-slate-500">Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs" /></label>
      <label className="text-[10px] font-black uppercase text-slate-500">Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs" /></label>
      <label className="text-[10px] font-black uppercase text-slate-500">Buscar<div className="relative mt-1"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="DNI o nombre" className="w-full rounded-lg border border-slate-200 py-2 pl-7 pr-2 text-xs" /></div></label>
      <div className="flex flex-wrap items-end gap-2 xl:col-span-2"><button onClick={clear} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><RefreshCw className="h-3.5 w-3.5" />Limpiar</button>{!readOnly && <><input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void stage(event.target.files?.[0])} /><input ref={headcountInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void stageHeadcount(event.target.files?.[0])} /><button onClick={() => input.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white"><Upload className="h-3.5 w-3.5" />Cargar rotación</button><label className="text-[10px] font-black uppercase text-slate-500">Corte<input type="date" value={headcountCutoff} onChange={(event) => setHeadcountCutoff(event.target.value)} className="mt-1 block h-9 rounded-lg border border-violet-200 bg-violet-50 px-2 text-xs font-bold text-violet-700" /></label><button onClick={() => headcountInput.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-700"><Users className="h-3.5 w-3.5" />Cargar dotación</button>{pending.length > 0 && <button disabled={saving} onClick={() => void save()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-700 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving ? 'Guardando...' : `Guardar rotación (${pending.length})`}</button>}{pendingHeadcount.length > 0 && <button disabled={saving} onClick={() => void saveHeadcount()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving ? 'Guardando...' : `Guardar dotación (${pendingHeadcount.length})`}</button>}</>}</div>
    </div></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Dotación activa" value={String(data.total_dotacion)} icon={<Users className="h-5 w-5" />} tone="violet" /><Metric title="Ceses" value={String(data.total_bajas)} icon={<UserMinus className="h-5 w-5" />} tone="coral" /><Metric title="Rotación" value={percent(data.porcentaje_rotacion)} icon={<BarChart3 className="h-5 w-5" />} tone="green" /><Metric title="Permanencia promedio" value={data.permanencia_promedio == null ? 'Sin datos' : `${data.permanencia_promedio} días`} icon={<Clock3 className="h-5 w-5" />} tone="amber" /></div>
    <Panel title="Embudo de rotación" icon={<FunnelIcon className="h-4 w-4 text-violet-600" />}><div className="grid items-center gap-4 md:grid-cols-[1.4fr_1fr]"><RotationFunnel data={funnel} /><div className="space-y-3">{funnel.map((item) => <div key={item.name} className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs"><span className="flex items-center gap-2 font-semibold text-slate-600"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.fill }} />{item.name}</span><strong className="text-slate-900">{item.value} <span className="font-medium text-slate-400">{data.funnel.altas ? `(${(item.value / data.funnel.altas * 100).toFixed(1)}%)` : '(0.0%)'}</span></strong></div>)}</div></div></Panel>
    <div className="grid gap-4 xl:grid-cols-2"><Panel title="Ceses mensuales"><MonthlyChart data={data.fechas} keys={data.motivo_keys} /></Panel><Panel title="Ceses por campaña"><CampaignChart data={data.by_campaign} /></Panel></div>
    <div className="grid gap-4 xl:grid-cols-2"><Panel title="Motivos de cese"><Donut data={data.motivos} /></Panel><Panel title="Permanencia al cese"><VerticalBars data={data.permanencia} /></Panel></div>
    <div className="grid gap-4 xl:grid-cols-2"><Panel title="Descripciones de despido"><DescriptionChart data={data.descripciones} /></Panel><Panel title="Otros / Campaña no identificada"><div className="mb-3 flex items-center gap-3 rounded-lg bg-amber-50 p-3"><AlertCircle className="h-5 w-5 text-amber-600" /><div><p className="text-lg font-black text-amber-900">{data.otros.length}</p><p className="text-xs text-amber-800">Registros pendientes de conciliación</p></div></div><Table headers={['Documento', 'Fecha', 'Motivo', 'Validación']} rows={data.otros.slice(0, 8).map((item) => [item.dni, item.fecha, item.motivo, item.razon])} /></Panel></div>
    <Panel title="Detalle de movimientos" action={<button onClick={exportDetail} disabled={!data.detalle.length} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-700 disabled:opacity-50"><Download className="h-3.5 w-3.5" />Exportar</button>}><Table full headers={['Nombre', 'Documento', 'Campaña', 'Proveedor', 'Alta', 'Cese', 'Motivo', 'Descripción / observación', 'Permanencia', 'Estado', 'Validación']} rows={data.detalle.map((item) => [item.nombre, item.dni, item.campana, item.proveedor, item.fecha_alta, exitDate(item), item.motivo, item.descripcion, item.permanencia_dias == null ? (item.estado === 'Cese pendiente de fecha' ? 'Pendiente' : 'No aplica') : `${item.permanencia_dias} días`, item.estado, item.razon])} /></Panel>
    {loading && <p className="text-center text-xs font-semibold text-slate-500">Actualizando datos de rotación...</p>}
  </div>;
}
const Notice = ({ tone, children }: { tone: 'success' | 'error'; children: React.ReactNode }) => <div className={`rounded-lg border px-4 py-3 text-xs font-semibold ${tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{children}</div>;
const Metric = ({ title, value, icon, tone }: { title: string; value: string; icon: React.ReactNode; tone: 'violet' | 'coral' | 'green' | 'amber' }) => { const themes = { violet: 'border-violet-100 bg-violet-50 text-violet-700', coral: 'border-rose-100 bg-rose-50 text-rose-600', green: 'border-emerald-100 bg-emerald-50 text-emerald-700', amber: 'border-amber-100 bg-amber-50 text-amber-700' }; return <div className={`rounded-xl border p-4 shadow-sm ${themes[tone]}`}><div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-wide">{title}</p><span>{icon}</span></div><p className="mt-3 text-3xl font-black text-slate-900">{value}</p></div>; };
const RotationFunnel = ({ data }: { data: Array<{ name: string; value: number; fill: string }> }) => <div className="flex h-56 flex-col items-center justify-center gap-2 py-1" aria-label="Embudo de rotación">{data.map((item, index) => <div key={item.name} title={`${item.name}: ${item.value}`} className={`${data.length > 3 ? 'h-10' : 'h-14'} shrink-0 transition-none`} style={{ width: `${100 - index * 16}%`, backgroundColor: item.fill, clipPath: 'polygon(7% 0, 93% 0, 85% 100%, 15% 100%)' }} />)}</div>;
const Panel = ({ title, children, icon = <BarChart3 className="h-4 w-4 text-violet-600" />, action }: { title: string; children: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode }) => <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-black text-slate-900">{icon}{title}</h3>{action}</div>{children}</section>;
const Empty = () => <p className="py-8 text-center text-xs text-slate-400">Sin información verificable para este filtro.</p>;
const MonthlyChart = ({ data, keys }: { data: RotationDashboard['fechas']; keys: string[] }) => data.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ left: -18, right: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={monthLabel} tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip labelFormatter={monthLabel} /><Legend wrapperStyle={{ fontSize: 10 }} />{keys.map((name, index) => <Bar key={name} dataKey={name} stackId="ceses" fill={palette[index % palette.length]} radius={index === keys.length - 1 ? [3, 3, 0, 0] : undefined} />)}</BarChart></ResponsiveContainer></div> : <Empty />;
const CampaignChart = ({ data }: { data: RotationDashboard['by_campaign'] }) => data.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ left: 16, right: 8 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="campana" width={120} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="bajas" name="Ceses" fill="#fb7185" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <Empty />;
const Donut = ({ data }: { data: Array<{ name: string; value: number }> }) => data.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>{data.map((entry, index) => <Cell key={entry.name} fill={palette[index % palette.length]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 10 }} /></PieChart></ResponsiveContainer></div> : <Empty />;
const VerticalBars = ({ data }: { data: Array<{ name: string; value: number }> }) => <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ left: -18, right: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="value" name="Ceses" fill="#f59e0b" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>;
const DescriptionChart = ({ data }: { data: Array<{ name: string; value: number }> }) => { const ranked = data.slice(0, 7).map((item) => ({ ...item, name: item.name.length > 38 ? `${item.name.slice(0, 37)}...` : item.name })); return ranked.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={ranked} layout="vertical" margin={{ left: 16, right: 8 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={135} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="value" name="Ceses" fill="#7c3aed" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <Empty />; };
const Table = ({ headers, rows, full = false }: { headers: string[]; rows: string[][]; full?: boolean }) => rows.length ? <div className={`${full ? 'max-h-[32rem]' : 'max-h-56'} overflow-auto rounded-lg border border-slate-100`}><table className="min-w-full text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{headers.map((header) => <th className="whitespace-nowrap px-3 py-2" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-t border-slate-100 align-top" key={`${row.join('-')}-${index}`}>{row.map((value, cellIndex) => <td className="max-w-xs px-3 py-2 text-slate-700" key={cellIndex}>{cell(value)}</td>)}</tr>)}</tbody></table></div> : <Empty />;
