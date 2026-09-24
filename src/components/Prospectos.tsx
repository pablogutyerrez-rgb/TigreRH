import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Filter,
  FileSpreadsheet,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShoppingBag,
  Trash2,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Prospect, ProspectStatus, TrainingSession, User } from '../types';
import { BPO_CAMPAIGNS, normalizeCampaignName } from '../constants/campaigns';
import {
  createProspect,
  deleteProspect,
  listProspects,
  updateProspect,
} from '../services/firebase/prospectService';
import { isSessionAssignedTrainer } from '../utils/trainingAssignments';
import CampaignMultiSelect from './CampaignMultiSelect';

interface ProspectosProps {
  currentUser: User;
  users: User[];
  sessions: TrainingSession[];
}

const PROSPECT_STATUSES: ProspectStatus[] = [
  'Nuevo',
  'Contactado',
  'En seguimiento',
  'Interesado',
  'Venta / Alta',
  'No interesado',
];

type ProspectForm = Omit<Prospect, 'id' | 'creado_por' | 'creado_por_rol' | 'created_at' | 'updated_at'>;

const peruDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const emptyForm = (currentUser: User): ProspectForm => ({
  campana: BPO_CAMPAIGNS[0],
  fecha_registro: peruDate(),
  formador_id: currentUser.rol === 'Formador' ? currentUser.id : '',
  formador_nombre: currentUser.rol === 'Formador' ? currentUser.nombre : '',
  training_session_id: '',
  training_session_code: '',
  ejecutivo_nombre: '',
  ejecutivo_dni: '',
  ejecutivo_inconcert: '',
  prospecto_nombre: '',
  ruc: '',
  dni: '',
  telefono: '',
  correo: '',
  producto_interes: '',
  lineas_adicionales: '',
  cantidad_productos: 1,
  estado: 'Nuevo',
  observaciones: '',
});

const statusStyle: Record<ProspectStatus, string> = {
  Nuevo: 'bg-slate-100 text-slate-700',
  Contactado: 'bg-blue-50 text-blue-700',
  'En seguimiento': 'bg-amber-50 text-amber-700',
  Interesado: 'bg-violet-50 text-violet-700',
  'Venta / Alta': 'bg-emerald-50 text-emerald-700',
  'No interesado': 'bg-rose-50 text-rose-700',
};

const formatDate = (value: string) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`))
    .replace('.', '');
};

const normalizedKey = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\bempresas\b/gi, '')
  .replace(/[^a-zA-Z0-9]/g, '')
  .toLowerCase();

const isSaleStatus = (status?: string) => ['venta', 'alta', 'ventaalta'].includes(normalizedKey(status || ''));

const getSessionCode = (session: TrainingSession) =>
  session.nombre_generacion || session.generation_code || session.id;

const isActiveProspectSession = (session: TrainingSession) =>
  session.estado === 'Activa' || session.estado === 'En curso';

const resolveProspectSession = (prospect: Prospect, sessions: TrainingSession[]) => {
  const explicit = sessions.find((session) =>
    session.id === prospect.training_session_id ||
    getSessionCode(session) === prospect.training_session_code,
  );
  if (explicit) return explicit;

  const campaignKey = normalizedKey(prospect.campana);
  const trainerKey = normalizedKey(prospect.formador_nombre || '');
  const candidates = sessions.filter((session) => {
    const sameCampaign = normalizedKey(session.campaña) === campaignKey;
    const sameTrainer = session.formador_id === prospect.formador_id ||
      (!!trainerKey && normalizedKey(session.formador_nombre || '') === trainerKey);
    return sameCampaign && sameTrainer;
  });
  if (candidates.length === 0) return undefined;

  const prospectTime = new Date(`${prospect.fecha_registro}T12:00:00`).getTime();
  return candidates
    .map((session) => {
      const start = new Date(`${session.fecha_inicio}T12:00:00`).getTime();
      const end = new Date(`${session.fecha_fin}T12:00:00`).getTime();
      const containsDate = prospectTime >= start && prospectTime <= end;
      return { session, distance: containsDate ? 0 : Math.min(Math.abs(prospectTime - start), Math.abs(prospectTime - end)) };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.session;
};

export default function Prospectos({ currentUser, users, sessions }: ProspectosProps) {
  const isAdmin = currentUser.rol === 'Administrador';
  const canExport = ['Administrador', 'Coordinador', 'Analista'].includes(currentUser.rol);
  const trainers = useMemo(
    () => users.filter((user) => user.rol === 'Formador' && user.estado === 'Activo'),
    [users],
  );
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [campaignFilters, setCampaignFilters] = useState<string[]>([]);
  const [trainerFilter, setTrainerFilter] = useState('todos');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('todas');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Prospect | null>(null);
  const [form, setForm] = useState<ProspectForm>(() => emptyForm(currentUser));
  const [saving, setSaving] = useState(false);
  const deletedProspectIds = useRef(new Set<string>());

  const activeSessionsForCurrentTrainer = useMemo(
    () => sessions.filter((session) =>
      isActiveProspectSession(session) && isSessionAssignedTrainer(session, currentUser.id)),
    [sessions, currentUser.id],
  );

  const formCampaignOptions = useMemo(() => {
    if (currentUser.rol !== 'Formador') return [...BPO_CAMPAIGNS];
    const campaigns = activeSessionsForCurrentTrainer.map((session) => normalizeCampaignName(session.campaña));
    if (editing?.campana) campaigns.push(normalizeCampaignName(editing.campana));
    return Array.from(new Set<string>(campaigns))
      .sort((a, b) => a.localeCompare(b, 'es'));
  }, [activeSessionsForCurrentTrainer, currentUser.rol, editing]);

  const loadProspects = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const records = await listProspects();
      setProspects(records
        .filter((record) => !deletedProspectIds.current.has(record.id))
        .map((record) => ({ ...record, campana: normalizeCampaignName(record.campana) })));
      setError('');
    } catch (loadError) {
      setError(`No se pudieron cargar los prospectos: ${loadError instanceof Error ? loadError.message : 'Error desconocido'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProspects(true);
    const interval = window.setInterval(() => void loadProspects(), 30000);
    return () => window.clearInterval(interval);
  }, []);

  const campaignOptions = useMemo(
    () => Array.from(new Set([...BPO_CAMPAIGNS, ...prospects.map((prospect) => normalizeCampaignName(prospect.campana))])).sort((a, b) => a.localeCompare(b, 'es')),
    [prospects],
  );
  const trainerOptions = useMemo(() => {
    const options = new Map<string, string>();
    prospects.forEach((prospect) => {
      if (prospect.formador_id) options.set(prospect.formador_id, prospect.formador_nombre || 'Formador sin nombre');
    });
    trainers.forEach((trainer) => options.set(trainer.id, trainer.nombre));
    return Array.from(options.entries()).sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [prospects, trainers]);
  const sessionOptions = useMemo(() => sessions
    .filter((session) => {
      if (campaignFilters.length > 0 && !campaignFilters.some((campaign) => normalizedKey(session.campaña) === normalizedKey(campaign))) return false;
      if (trainerFilter !== 'todos' && !isSessionAssignedTrainer(session, trainerFilter)) return false;
      return true;
    })
    .sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio)), [sessions, campaignFilters, trainerFilter]);

  const sessionCodeOptions = useMemo(() => {
    const prospectCodes = prospects
      .filter((prospect) => campaignFilters.length === 0 || campaignFilters.some((campaign) => normalizedKey(prospect.campana) === normalizedKey(campaign)))
      .filter((prospect) => trainerFilter === 'todos' || prospect.formador_id === trainerFilter)
      .map((prospect) => prospect.training_session_code)
      .filter((code): code is string => Boolean(code));
    return Array.from(new Set([...sessionOptions.map(getSessionCode), ...prospectCodes])).sort();
  }, [sessionOptions, prospects, campaignFilters, trainerFilter]);

  const filteredProspects = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return prospects.filter((prospect) => {
      if (campaignFilters.length > 0 && !campaignFilters.some((campaign) => normalizedKey(prospect.campana) === normalizedKey(campaign))) return false;
      if (trainerFilter !== 'todos' && prospect.formador_id !== trainerFilter) return false;
      if (startDateFilter && prospect.fecha_registro < startDateFilter) return false;
      if (endDateFilter && prospect.fecha_registro > endDateFilter) return false;
      if (sessionFilter !== 'todas') {
        const resolvedSession = resolveProspectSession(prospect, sessions);
        const resolvedCode = prospect.training_session_code || (resolvedSession ? getSessionCode(resolvedSession) : '');
        if (resolvedCode !== sessionFilter) return false;
      }
      if (!term) return true;
      return [
        prospect.ejecutivo_nombre,
        prospect.ejecutivo_dni,
        prospect.ejecutivo_inconcert,
        prospect.prospecto_nombre,
        prospect.ruc,
        prospect.dni,
        prospect.telefono,
      ].some((value) => String(value || '').toLocaleLowerCase('es').includes(term));
    });
  }, [prospects, search, campaignFilters, trainerFilter, startDateFilter, endDateFilter, sessionFilter, sessions]);

  const lastFiveDays = useMemo(
    () => Array.from(new Set(filteredProspects.map((prospect) => prospect.fecha_registro).filter(Boolean)))
      .sort()
      .slice(-5),
    [filteredProspects],
  );

  const ojtProspects = useMemo(
    () => filteredProspects.filter((prospect) => lastFiveDays.includes(prospect.fecha_registro)),
    [filteredProspects, lastFiveDays],
  );
  const sales = ojtProspects.filter((prospect) => isSaleStatus(prospect.estado)).length;
  const conversion = ojtProspects.length > 0 ? Math.round((sales / ojtProspects.length) * 100) : 0;
  const dailyData = lastFiveDays.map((date, index) => {
    const dayProspects = ojtProspects.filter((prospect) => prospect.fecha_registro === date);
    return {
      name: `Día ${index + 1}`,
      fecha: formatDate(date),
      Prospectos: dayProspects.length,
      Ventas: dayProspects.filter((prospect) => isSaleStatus(prospect.estado)).length,
    };
  });
  const { executiveData, campaignData } = useMemo(() => {
    const executives = new Map<string, { ejecutivo: string; campana: string; prospectos: number; ventas: number }>();
    const campaigns = new Map<string, { prospects: number; sales: number }>();

    filteredProspects.forEach((prospect) => {
      const isSale = isSaleStatus(prospect.estado);
      const executiveKey = `${prospect.ejecutivo_inconcert || prospect.ejecutivo_dni}-${prospect.campana}`;
      const executive = executives.get(executiveKey) || {
        ejecutivo: prospect.ejecutivo_nombre,
        campana: prospect.campana,
        prospectos: 0,
        ventas: 0,
      };
      executive.prospectos += 1;
      if (isSale) executive.ventas += 1;
      executives.set(executiveKey, executive);

      const campaign = campaigns.get(prospect.campana) || { prospects: 0, sales: 0 };
      campaign.prospects += 1;
      if (isSale) campaign.sales += 1;
      campaigns.set(prospect.campana, campaign);
    });

    const visibleCampaigns = campaignOptions
      .filter((campaign) => campaignFilters.length === 0 || campaignFilters.some((selected) => normalizedKey(campaign) === normalizedKey(selected)));
    return {
      executiveData: Array.from(executives.values())
        .map((row) => ({ ...row, conversion: row.prospectos ? Math.round((row.ventas / row.prospectos) * 100) : 0 }))
        .sort((a, b) => b.prospectos - a.prospectos),
      campaignData: visibleCampaigns.map((campaign) => {
        const totals = campaigns.get(campaign) || { prospects: 0, sales: 0 };
        return {
          campaign,
          ...totals,
          conversion: totals.prospects > 0 ? Math.round((totals.sales / totals.prospects) * 100) : 0,
        };
      }),
    };
  }, [filteredProspects, campaignOptions, campaignFilters]);

  const openCreate = () => {
    setEditing(null);
    const nextForm = emptyForm(currentUser);
    if (currentUser.rol === 'Formador') {
      nextForm.campana = Array.from(new Set<string>(activeSessionsForCurrentTrainer.map((session) => normalizeCampaignName(session.campaña))))
        .sort((a, b) => a.localeCompare(b, 'es'))[0] || '';
    }
    setForm(nextForm);
    setShowModal(true);
  };

  const openEdit = (prospect: Prospect) => {
    const { id: _id, creado_por: _createdBy, creado_por_rol: _createdRole, created_at: _createdAt, updated_at: _updatedAt, ...editable } = prospect;
    const canonicalCampaign = normalizeCampaignName(editable.campana);
    setEditing({ ...prospect, campana: canonicalCampaign });
    setForm({ ...editable, campana: canonicalCampaign });
    setShowModal(true);
  };

  const handleTrainerChange = (trainerId: string) => {
    const trainer = trainers.find((item) => item.id === trainerId);
    setForm((previous) => ({
      ...previous,
      formador_id: trainerId,
      formador_nombre: trainer?.nombre || '',
      training_session_id: previous.training_session_id && sessions.some((session) => session.id === previous.training_session_id && session.formador_id === trainerId)
        ? previous.training_session_id
        : '',
      training_session_code: previous.training_session_id && sessions.some((session) => session.id === previous.training_session_id && session.formador_id === trainerId)
        ? previous.training_session_code
        : '',
    }));
  };

  const handleSessionChange = (sessionId: string) => {
    const selectedSession = sessions.find((session) => session.id === sessionId);
    setForm((previous) => ({
      ...previous,
      training_session_id: sessionId,
      training_session_code: selectedSession ? getSessionCode(selectedSession) : '',
    }));
  };

  const formSessionOptions = useMemo(() => sessions
    .filter((session) => normalizedKey(session.campaña) === normalizedKey(form.campana))
    .filter((session) => currentUser.rol !== 'Formador' || editing || isActiveProspectSession(session))
    .filter((session) => !form.formador_id || (
      currentUser.rol === 'Formador'
        ? isSessionAssignedTrainer(session, form.formador_id)
        : session.formador_id === form.formador_id
    ))
    .sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio)), [sessions, form.campana, form.formador_id, currentUser.rol, editing]);

  const clearFilters = () => {
    setCampaignFilters([]);
    setTrainerFilter('todos');
    setStartDateFilter('');
    setEndDateFilter('');
    setSessionFilter('todas');
    setSearch('');
  };

  const handleExport = () => {
    if (!canExport) return;
    const rows = filteredProspects.map((prospect) => {
      const session = resolveProspectSession(prospect, sessions);
      return {
        'Fecha de registro': prospect.fecha_registro,
        Campaña: prospect.campana,
        'Código de generación': prospect.training_session_code || (session ? getSessionCode(session) : ''),
        'Formador responsable': prospect.formador_nombre,
        'Ejecutivo': prospect.ejecutivo_nombre,
        'DNI ejecutivo': prospect.ejecutivo_dni,
        'Usuario InConcert': prospect.ejecutivo_inconcert || '',
        'Prospecto / Razón social': prospect.prospecto_nombre,
        RUC: prospect.ruc || '',
        DNI: prospect.dni || '',
        Teléfono: prospect.telefono,
        Correo: prospect.correo || '',
        'Producto de interés': prospect.producto_interes,
        'Líneas adicionales': prospect.lineas_adicionales || '',
        'Cantidad de productos': prospect.cantidad_productos,
        Estado: prospect.estado,
        Observaciones: prospect.observaciones || '',
      };
    });
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Prospectos');
    XLSX.writeFile(workbook, `prospectos-${peruDate()}.xlsx`);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.formador_id || !form.ejecutivo_nombre.trim() || !form.ejecutivo_dni.trim() || !form.prospecto_nombre.trim() || !form.telefono.trim() || !form.producto_interes.trim()) {
      setError('Completa los campos obligatorios antes de guardar.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await updateProspect(editing.id, form);
      } else {
        await createProspect(form);
      }
      await loadProspects();
      setShowModal(false);
    } catch (saveError) {
      setError(`No se pudo guardar el prospecto: ${saveError instanceof Error ? saveError.message : 'Error desconocido'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (prospect: Prospect) => {
    if (!isAdmin || !window.confirm(`¿Eliminar el prospecto de ${prospect.prospecto_nombre}?`)) return;
    try {
      await deleteProspect(prospect.id);
      deletedProspectIds.current.add(prospect.id);
      setProspects((current) => current.filter((record) => record.id !== prospect.id));
      await loadProspects();
    } catch (deleteError) {
      setError(`No se pudo eliminar el prospecto: ${deleteError instanceof Error ? deleteError.message : 'Error desconocido'}`);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-fuchsia-600">Formación</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900 sm:text-3xl">Prospectos</h1>
          <p className="mt-1 text-sm text-slate-500">Registro comercial y medición de resultados durante OJT.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <button type="button" onClick={handleExport} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-emerald-700 shadow-sm hover:bg-emerald-50">
              <FileSpreadsheet className="h-4 w-4" /> Descargar Excel
            </button>
          )}
          <button type="button" onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:brightness-105">
            <Plus className="h-4 w-4" /> Registrar prospecto
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}

      <section className="glass-card rounded-2xl p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black text-slate-900"><Filter className="h-4 w-4 text-indigo-600" /> Filtros de prospectos</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">Actualizan el listado, las tarjetas y los gráficos OJT.</p>
          </div>
          <button type="button" onClick={clearFilters} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
            <RotateCcw className="h-3.5 w-3.5" /> Limpiar filtros
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <label className="space-y-1">
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500"><Search className="h-3.5 w-3.5" /> Buscar</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ejecutivo o prospecto" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-indigo-400" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase text-slate-500">Campaña</span>
            <CampaignMultiSelect options={campaignOptions} selected={campaignFilters} onChange={(campaigns) => { setCampaignFilters(campaigns); setSessionFilter('todas'); }} allLabel="Todas las campañas" summaryClassName="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase text-slate-500">Formador</span>
            <select value={trainerFilter} onChange={(event) => { setTrainerFilter(event.target.value); setSessionFilter('todas'); }} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400"><option value="todos">Todos los formadores</option>{trainerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          </label>
          <label className="space-y-1">
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500"><CalendarDays className="h-3.5 w-3.5" /> Fecha de inicio</span>
            <input type="date" value={startDateFilter} max={endDateFilter || undefined} onChange={(event) => setStartDateFilter(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400" />
          </label>
          <label className="space-y-1">
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500"><CalendarDays className="h-3.5 w-3.5" /> Fecha de fin</span>
            <input type="date" value={endDateFilter} min={startDateFilter || undefined} onChange={(event) => setEndDateFilter(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase text-slate-500">Código de generación</span>
            <select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400"><option value="todas">Todos los códigos</option>{sessionCodeOptions.map((code) => <option key={code} value={code}>{code}</option>)}</select>
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">Medición de Prospectos OJT</h2>
          <p className="text-xs text-slate-500">Resultados de los últimos 5 días con actividad según los filtros aplicados.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Prospectos generados', ojtProspects.length, Users],
            ['Venta / Alta', sales, ShoppingBag],
            ['Conversión', `${conversion}%`, TrendingUp],
            ['Ejecutivos medidos', new Set(ojtProspects.map((item) => item.ejecutivo_inconcert || item.ejecutivo_dni)).size, BriefcaseBusiness],
          ].map(([label, value, Icon]) => {
            const KpiIcon = Icon as typeof Users;
            return <div key={String(label)} className="glass-card rounded-2xl p-5"><div className="flex items-start justify-between"><div><p className="text-[10px] font-black uppercase text-slate-400">{String(label)}</p><p className="mt-2 text-3xl font-black text-slate-900">{String(value)}</p></div><div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><KpiIcon className="h-5 w-5" /></div></div></div>;
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="glass-card rounded-2xl p-5">
            <h3 className="flex items-center gap-2 text-sm font-black text-slate-800"><BarChart3 className="h-4 w-4 text-indigo-600" /> Prospectos por día</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" fontSize={11} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} fontSize={11} stroke="#94a3b8" />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Prospectos" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Ventas" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="glass-card overflow-hidden rounded-2xl">
            <div className="border-b border-slate-100 px-5 py-4"><h3 className="text-sm font-black text-slate-800">Resultado por campaña</h3></div>
            <div className="grid grid-cols-1 border-b border-slate-100 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              {campaignData.map((row) => <div key={row.campaign} className="border-b border-slate-50 px-4 py-3 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0 xl:border-b xl:border-r-0 xl:last:border-b-0 2xl:border-b-0 2xl:border-r"><p className="truncate text-[10px] font-black uppercase text-slate-500">{row.campaign}</p><div className="mt-1 flex items-end justify-between gap-2"><p className="text-xl font-black text-slate-900">{row.prospects}</p><p className="text-xs font-bold text-emerald-700">{row.sales} ventas · {row.conversion}%</p></div></div>)}
            </div>
            <div className="border-b border-slate-100 px-5 py-3"><h3 className="text-sm font-black text-slate-800">Comparativo por ejecutivo</h3></div>
            <div className="max-h-56 overflow-auto">
              {executiveData.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">Sin registros para los filtros aplicados.</p> : executiveData.map((row) => (
                <div key={`${row.ejecutivo}-${row.campana}`} className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-50 px-5 py-3 last:border-0">
                  <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800">{row.ejecutivo}</p><p className="truncate text-[10px] text-slate-400">{row.campana} · {row.prospectos} prospectos · {row.ventas} ventas</p></div>
                  <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">{row.conversion}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="glass-card overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h2 className="text-base font-black text-slate-900">Prospectos registrados</h2>
          <span className="text-xs font-semibold text-slate-400">{filteredProspects.length} registros</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Fecha</th><th className="p-3">Campaña</th><th className="p-3">Ejecutivo</th><th className="p-3">Prospecto</th><th className="p-3">Producto</th><th className="p-3">Estado</th><th className="p-3 text-right">Acciones</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="p-10 text-center text-slate-400">Cargando prospectos...</td></tr> : filteredProspects.length === 0 ? <tr><td colSpan={7} className="p-10 text-center text-slate-400">No se encontraron prospectos.</td></tr> : filteredProspects.map((prospect) => (
                <tr key={prospect.id} className="border-t border-slate-100 hover:bg-slate-50/60"><td className="whitespace-nowrap p-3 text-slate-500">{formatDate(prospect.fecha_registro)}</td><td className="whitespace-nowrap p-3"><p className="font-semibold text-slate-700">{prospect.campana}</p><p className="text-[10px] font-medium text-indigo-500">{resolveProspectSession(prospect, sessions) ? getSessionCode(resolveProspectSession(prospect, sessions)!) : 'Sin capacitación asociada'}</p></td><td className="p-3"><p className="font-bold text-slate-800">{prospect.ejecutivo_nombre}</p><p className="text-[10px] text-slate-400">{prospect.ejecutivo_inconcert || prospect.ejecutivo_dni}</p></td><td className="p-3"><p className="font-bold text-slate-800">{prospect.prospecto_nombre}</p><p className="text-[10px] text-slate-400">{prospect.ruc || prospect.dni || prospect.telefono}</p></td><td className="p-3 text-slate-600">{prospect.producto_interes}</td><td className="p-3"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-black ${statusStyle[prospect.estado] || 'bg-slate-100 text-slate-700'}`}>{prospect.estado}</span></td><td className="p-3"><div className="flex justify-end gap-1"><button type="button" title="Editar prospecto" onClick={() => openEdit(prospect)} className="rounded-lg p-2 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600"><Pencil className="h-4 w-4" /></button>{isAdmin && <button type="button" title="Eliminar prospecto" onClick={() => handleDelete(prospect)} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}</div></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <form onSubmit={handleSave} className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-lg font-black text-slate-900">{editing ? 'Editar prospecto' : 'Registrar prospecto'}</h2><p className="text-xs text-slate-500">Completa la información comercial del registro.</p></div><button type="button" title="Cerrar" onClick={() => setShowModal(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
            <div className="space-y-6 overflow-y-auto p-5">
              <FormSection title="1. Datos generales"><Field label="Campaña *"><select required value={form.campana} onChange={(event) => setForm({ ...form, campana: event.target.value, training_session_id: '', training_session_code: '' })} className="field-input">{currentUser.rol === 'Formador' && <option value="">Seleccionar campaña</option>}{formCampaignOptions.map((campaign) => <option key={campaign}>{campaign}</option>)}</select></Field><Field label="Fecha de registro *"><input type="date" required value={form.fecha_registro} onChange={(event) => setForm({ ...form, fecha_registro: event.target.value })} className="field-input" /></Field><Field label="Formador responsable *"><select required disabled={!isAdmin} value={form.formador_id} onChange={(event) => handleTrainerChange(event.target.value)} className="field-input disabled:bg-slate-50"><option value="">Seleccionar formador</option>{trainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.nombre}</option>)}</select></Field><Field label="Código de capacitación asociada"><select value={form.training_session_id || ''} onChange={(event) => handleSessionChange(event.target.value)} className="field-input"><option value="">Sin capacitación asociada</option>{formSessionOptions.map((session) => <option key={session.id} value={session.id}>{getSessionCode(session)}</option>)}</select></Field></FormSection>
              <FormSection title="2. Datos del ejecutivo"><Field label="Nombre completo *"><input required value={form.ejecutivo_nombre} onChange={(event) => setForm({ ...form, ejecutivo_nombre: event.target.value })} className="field-input" /></Field><Field label="DNI *"><input required inputMode="numeric" value={form.ejecutivo_dni} onChange={(event) => setForm({ ...form, ejecutivo_dni: event.target.value })} className="field-input" /></Field><Field label="Usuario de InConcert"><input value={form.ejecutivo_inconcert} onChange={(event) => setForm({ ...form, ejecutivo_inconcert: event.target.value })} className="field-input" /></Field></FormSection>
              <FormSection title="3. Datos del prospecto"><Field label="Nombre / Razón Social *"><input required value={form.prospecto_nombre} onChange={(event) => setForm({ ...form, prospecto_nombre: event.target.value })} className="field-input" /></Field><Field label="RUC"><input inputMode="numeric" value={form.ruc || ''} onChange={(event) => setForm({ ...form, ruc: event.target.value })} className="field-input" /></Field><Field label="DNI"><input inputMode="numeric" value={form.dni || ''} onChange={(event) => setForm({ ...form, dni: event.target.value })} className="field-input" /></Field><Field label="Teléfono de contacto *"><input required value={form.telefono} onChange={(event) => setForm({ ...form, telefono: event.target.value })} className="field-input" /></Field><Field label="Correo electrónico"><input type="email" value={form.correo || ''} onChange={(event) => setForm({ ...form, correo: event.target.value })} className="field-input" /></Field><Field label="Producto de interés *"><input required value={form.producto_interes} onChange={(event) => setForm({ ...form, producto_interes: event.target.value })} className="field-input" /></Field><Field label="Líneas adicionales"><input value={form.lineas_adicionales || ''} onChange={(event) => setForm({ ...form, lineas_adicionales: event.target.value })} className="field-input" /></Field><Field label="Cantidad de productos"><input type="number" min="1" value={form.cantidad_productos} onChange={(event) => setForm({ ...form, cantidad_productos: Math.max(1, Number(event.target.value) || 1) })} className="field-input" /></Field><Field label="Estado del prospecto *"><select value={form.estado} onChange={(event) => setForm({ ...form, estado: event.target.value as ProspectStatus })} className="field-input">{PROSPECT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field><div className="sm:col-span-2 xl:col-span-3"><Field label="Observaciones"><textarea rows={3} value={form.observaciones || ''} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} className="field-input resize-none" /></Field></div></FormSection>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4"><button type="button" onClick={() => setShowModal(false)} className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200">Cancelar</button><button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar prospecto'}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-3 text-sm font-black text-slate-800">{title}</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">{label}</span>{children}</label>;
}
