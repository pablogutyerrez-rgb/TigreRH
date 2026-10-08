import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { BarChart3, Filter, Save, Search, Upload } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { User } from '../types';
import { getRotationDashboard, saveRotationRows, type RotationDashboard } from '../services/rotationService';

interface RotacionProps { currentUser: User; }
const todayYear = new Date().getFullYear();
const emptyData: RotationDashboard = { terminations: [], headcounts: [], total_bajas: 0, total_dotacion: 0, porcentaje_rotacion: null, by_campaign: [], motivos: [], tipos: [], fechas: [] };
const parseWorkbook = async (file: File, type: 'bajas' | 'dotacion') => {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const baseName = workbook.SheetNames.find((name) => name.trim().toUpperCase() === 'BASE');
  if (type === 'bajas' && !baseName) throw new Error('El archivo de bajas debe contener la hoja BASE.');
  const sheet = workbook.Sheets[baseName || workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  if (!rows.length) throw new Error('El archivo no contiene filas para importar.');
  return rows;
};
const percent = (value: number | null) => value == null ? 'Sin datos' : `${value.toFixed(2)}%`;

export default function Rotacion({ currentUser }: RotacionProps) {
  const [data, setData] = useState<RotationDashboard>(emptyData);
  const [availableCampaigns, setAvailableCampaigns] = useState<string[]>([]);
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [search, setSearch] = useState('');
  const [pendingBajas, setPendingBajas] = useState<Record<string, unknown>[]>([]);
  const [pendingDotacion, setPendingDotacion] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const bajasInput = useRef<HTMLInputElement>(null); const dotacionInput = useRef<HTMLInputElement>(null);
  const readOnly = Boolean(currentUser.module_view_only?.includes('formacion:rotacion'));
  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await getRotationDashboard({ campaigns, years, periods, from: from || undefined, to: to || undefined, search: search || undefined });
      setData(result);
      setAvailableCampaigns((current) => Array.from(new Set([...current, ...result.by_campaign.map((item) => item.campana), ...result.terminations.map((item) => item.campana), ...result.headcounts.map((item) => item.campana)])).sort());
      setAvailablePeriods((current) => Array.from(new Set([...current, ...result.headcounts.map((item) => item.periodo), ...result.terminations.map((item) => item.fecha.slice(0, 7))])).sort());
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cargar Rotación.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [campaigns.join('|'), years.join('|'), periods.join('|'), from, to, search]);
  const campaignOptions = useMemo(() => Array.from(new Set([...availableCampaigns, ...campaigns])).sort(), [availableCampaigns, campaigns]);
  const periodOptions = useMemo(() => Array.from(new Set([...availablePeriods, ...periods])).sort(), [availablePeriods, periods]);
  const yearOptions = useMemo(() => Array.from(new Set([todayYear, ...periodOptions.map((item) => Number(item.slice(0, 4)))])), [periodOptions]);
  const stage = async (type: 'bajas' | 'dotacion', file?: File) => {
    if (!file) return;
    setError(''); setMessage('');
    try { const rows = await parseWorkbook(file, type); type === 'bajas' ? setPendingBajas(rows) : setPendingDotacion(rows); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo leer el Excel.'); }
  };
  const save = async () => {
    if (!pendingBajas.length && !pendingDotacion.length) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const results = await Promise.all([
        pendingBajas.length ? saveRotationRows('bajas', pendingBajas) : null,
        pendingDotacion.length ? saveRotationRows('dotacion', pendingDotacion) : null,
      ]);
      const inserted = results.filter(Boolean).reduce((sum, item) => sum + item!.inserted, 0);
      const skipped = results.filter(Boolean).reduce((sum, item) => sum + item!.skipped, 0);
      setPendingBajas([]); setPendingDotacion([]); setMessage(`Guardado completado: ${inserted} filas nuevas${skipped ? `, ${skipped} duplicadas omitidas` : ''}.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar la carga.'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-5 animate-in fade-in duration-300">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
      <div><p className="text-xs font-black uppercase tracking-wider text-violet-600">Medición</p><h2 className="text-xl font-black text-slate-900">Rotación</h2></div>
      {!readOnly && <div className="flex flex-wrap gap-2">
        <input ref={bajasInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void stage('bajas', event.target.files?.[0])} />
        <input ref={dotacionInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void stage('dotacion', event.target.files?.[0])} />
        <button onClick={() => bajasInput.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-700"><Upload className="h-4 w-4" />Cargar rotación</button>
        <button onClick={() => dotacionInput.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-700"><Upload className="h-4 w-4" />Cargar dotación</button>
        <button disabled={saving || (!pendingBajas.length && !pendingDotacion.length)} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />Guardar</button>
      </div>}
    </div>
    {(pendingBajas.length || pendingDotacion.length) && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">Carga pendiente: {pendingBajas.length} bajas y {pendingDotacion.length} filas de dotación. Confirma con «Guardar».</div>}
    {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{message}</div>}
    {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">{error}</div>}
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800"><Filter className="h-4 w-4 text-violet-600" />Filtros</div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <label className="text-[10px] font-black uppercase text-slate-500">Campaña<select multiple value={campaigns} onChange={(e) => setCampaigns(Array.from(e.target.selectedOptions, (option) => option.value))} className="mt-1 h-20 w-full rounded-lg border border-slate-200 px-2 text-xs">{campaignOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="text-[10px] font-black uppercase text-slate-500">Año<select multiple value={years.map(String)} onChange={(e) => setYears(Array.from(e.target.selectedOptions, (option) => Number(option.value)))} className="mt-1 h-20 w-full rounded-lg border border-slate-200 px-2 text-xs">{yearOptions.sort((a,b) => b-a).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="text-[10px] font-black uppercase text-slate-500">Periodo<select multiple value={periods} onChange={(e) => setPeriods(Array.from(e.target.selectedOptions, (option) => option.value))} className="mt-1 h-20 w-full rounded-lg border border-slate-200 px-2 text-xs">{periodOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="text-[10px] font-black uppercase text-slate-500">Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs" /></label>
        <label className="text-[10px] font-black uppercase text-slate-500">Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs" /></label>
        <label className="text-[10px] font-black uppercase text-slate-500">Buscar<div className="relative mt-1"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="DNI, nombre o fecha" className="w-full rounded-lg border border-slate-200 py-2 pl-7 pr-2 text-xs" /></div></label>
      </div></div>
    <div className="grid gap-4 md:grid-cols-3"><Metric title="Dotación" value={String(data.total_dotacion)} /><Metric title="Total de bajas" value={String(data.total_bajas)} /><Metric title="Rotación" value={percent(data.porcentaje_rotacion)} /></div>
    <div className="grid gap-4 xl:grid-cols-2"><Panel title="Dotación y bajas por campaña"><Chart data={data.by_campaign} bars={['dotacion', 'bajas']} /><Rows rows={data.by_campaign.map((item) => [item.campana, String(item.dotacion), String(item.bajas), percent(item.porcentaje)])} headers={['Campaña', 'Dotación', 'Bajas', 'Rotación']} /></Panel><Panel title="Motivos de baja"><Chart data={data.motivos} bars={['value']} labelKey="name" /><Rows rows={data.motivos.map((item) => [item.name, String(item.value)])} headers={['Motivo', 'Bajas']} empty="Sin motivos registrados." /></Panel><Panel title="Tipos de baja"><Rows rows={data.tipos.map((item) => [item.name, String(item.value)])} headers={['Tipo', 'Bajas']} empty="Sin tipos registrados." /></Panel><Panel title="Evolución de bajas"><Trend data={data.fechas} /><Rows rows={data.fechas.map((item) => [item.date, String(item.bajas)])} headers={['Fecha', 'Bajas']} empty="Sin bajas registradas." /></Panel></div>
    {loading && <p className="text-center text-xs font-semibold text-slate-500">Actualizando datos de rotación...</p>}
  </div>;
}
const Metric = ({ title, value }: { title: string; value: string }) => <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">{title}</p><p className="mt-2 text-2xl font-black text-slate-900">{value}</p></div>;
const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><BarChart3 className="h-4 w-4 text-violet-600" />{title}</h3>{children}</section>;
const Chart = ({ data, bars, labelKey = 'campana' }: { data: Array<Record<string, unknown>>; bars: string[]; labelKey?: string }) => data.length ? <div className="mb-4 h-44"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={labelKey} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey={bars[0]} fill="#7c3aed" radius={[3, 3, 0, 0]} />{bars[1] && <Bar dataKey={bars[1]} fill="#10b981" radius={[3, 3, 0, 0]} />}</BarChart></ResponsiveContainer></div> : null;
const Trend = ({ data }: { data: Array<{ date: string; bajas: number }> }) => data.length ? <div className="mb-4 h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="bajas" stroke="#7c3aed" strokeWidth={2} /></LineChart></ResponsiveContainer></div> : null;
const Rows = ({ headers, rows, empty = 'Sin información disponible.' }: { headers: string[]; rows: string[][]; empty?: string }) => rows.length ? <div className="max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead className="text-[10px] uppercase text-slate-500"><tr>{headers.map((header) => <th className="pb-2 pr-2" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-t border-slate-100" key={`${row.join('-')}-${index}`}>{row.map((cell, cellIndex) => <td className="py-2 pr-2 font-medium text-slate-700" key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : <p className="text-xs text-slate-500">{empty}</p>;
