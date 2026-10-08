import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Calculator,
  CheckCircle,
  Eye,
  FileSpreadsheet,
  FileText,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { TrainingVariableEvaluation, User } from '../types';
import {
  deleteTrainingVariableEvaluation,
  calculateTrainingVariableAutomatically,
  closeTrainingVariableEvaluation,
  createTrainingVariableEvaluation,
  listTrainingVariableEvaluations,
  listTrainingVariableSources,
  reopenTrainingVariableEvaluation,
  type TrainingVariableSource,
  type TrainingVariablePayload,
  updateTrainingVariableEvaluation,
} from '../services/trainingVariableService';
import { calculateTrainingVariablePreview } from '../utils/trainingVariableCalculator';

interface TrainingVariablesProps {
  currentUser: User;
  users: User[];
}

type FormState = TrainingVariablePayload;

const monthNames = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const currentYear = new Date().getFullYear();
const years = Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);

const emptyForm = (trainer?: User, currentUser?: User): FormState => ({
  formula_version: 2,
  porcentaje_rotacion: 0,
  meses: [new Date().getMonth() + 1],
  formador_ids: [],
  campanas: [],
  anio: currentYear,
  mes: new Date().getMonth() + 1,
  id_formador: trainer?.id || '',
  nombre_formador: trainer?.nombre || '',
  observacion_general: '',
  porcentaje_retencion: 0,
  porcentaje_produccion_individual: 0,
  porcentaje_produccion_grupal: 0,
  porcentaje_satisfaccion: 0,
  porcentaje_administrativo: 100,
  observacion_administrativa: currentUser ? '' : '',
  generation_ids: [],
  codigos_generacion: [],
  calculo_automatico: false,
});

const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const percent = (value: number) => `${numberValue(value).toFixed(2)}%`;
const money = (value: number) => `S/ ${numberValue(value).toFixed(2)}`;
const periodLabel = (evaluation: Pick<TrainingVariableEvaluation, 'anio' | 'mes' | 'meses'>) =>
  `${(evaluation.meses?.length ? evaluation.meses : [evaluation.mes]).map((month) => monthNames[month - 1]).join(', ')} ${evaluation.anio}`;

const statusBadge = (status: TrainingVariableEvaluation['estado']) => {
  const classes = {
    BORRADOR: 'bg-slate-100 text-slate-700',
    CERRADO: 'bg-emerald-100 text-emerald-800',
    REABIERTO: 'bg-amber-100 text-amber-800',
    ANULADO: 'bg-rose-100 text-rose-800',
  };
  return `px-2.5 py-1 rounded-full text-[10px] font-black ${classes[status]}`;
};

const scoreBadge = (value: number) => {
  if (value >= 110) return 'bg-indigo-100 text-indigo-800 border-indigo-200';
  if (value >= 100) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (value >= 80) return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-rose-100 text-rose-800 border-rose-200';
};

export default function TrainingVariables({ currentUser, users }: TrainingVariablesProps) {
  const [evaluations, setEvaluations] = useState<TrainingVariableEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterYear, setFilterYear] = useState('todos');
  const [filterMonth, setFilterMonth] = useState('todos');
  const [filterTrainer, setFilterTrainer] = useState('todos');
  const [filterCoordinator, setFilterCoordinator] = useState('todos');
  const [filterStatus, setFilterStatus] = useState('todos');
  const [page, setPage] = useState(1);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'detail' | null>(null);
  const [editing, setEditing] = useState<TrainingVariableEvaluation | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(undefined, currentUser));
  const [sourceOptions, setSourceOptions] = useState<TrainingVariableSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [calculating, setCalculating] = useState(false);

  const isAdmin = currentUser.rol === 'Administrador';
  const isCoordinator = currentUser.rol === 'Coordinador';
  const isTrainer = currentUser.rol === 'Formador';
  const canManage = isAdmin || isCoordinator;
  const isReadOnly = modalMode === 'detail' || isTrainer || editing?.estado === 'CERRADO' || editing?.estado === 'ANULADO';

  const trainers = useMemo(
    () => users.filter((user) => user.rol === 'Formador' && user.estado === 'Activo').sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [users],
  );

  const coordinators = useMemo(
    () => Array.from(new Set(evaluations.map((evaluation) => evaluation.nombre_coordinador).filter(Boolean))).sort(),
    [evaluations],
  );

  const currentFormula = form.formula_version === 2;
  const previewResult = useMemo(() => {
    try { return { value: calculateTrainingVariablePreview(form), error: '' }; }
    catch (error) { return { value: calculateTrainingVariablePreview({ ...form, porcentaje_rotacion: 0, porcentaje_retencion: 0, porcentaje_produccion_grupal: 0, porcentaje_satisfaccion: 0 }), error: error instanceof Error ? error.message : 'Datos inválidos' }; }
  }, [form]);
  const preview = previewResult.value;
  const filteredSources = sourceOptions.filter((source) =>
    (!form.campanas?.length || form.campanas.includes(source.campana)) &&
    (!form.formador_ids?.length || source.formadores.some((trainer) => form.formador_ids!.includes(trainer.id))));
  const sourceTrainers = [...new Map<string, { id: string; nombre: string }>(sourceOptions.filter((source) => !form.campanas?.length || form.campanas.includes(source.campana))
    .flatMap((source) => source.formadores).map((trainer) => [trainer.id, trainer])).values()];
  const updateSelection = (changes: Partial<FormState>) => setForm((previous) => ({
    ...previous, ...changes, generation_ids: [], codigos_generacion: [], calculo_automatico: false, calculo_detalle: undefined,
  }));
  const selectedSource = useMemo(
    () => sourceOptions.find((source) => source.id === form.generation_ids?.[0]),
    [sourceOptions, form.generation_ids],
  );
  const associatedTrainers = selectedSource?.formadores || [];

  const loadEvaluations = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listTrainingVariableEvaluations();
      setEvaluations(response.evaluations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las evaluaciones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEvaluations();
  }, []);

  useEffect(() => {
    if (!modalMode) {
      setSourceOptions([]);
      setSourceError('');
      return;
    }

    let active = true;
    setLoadingSources(true);
    setSourceError('');
    void listTrainingVariableSources(form.anio, form.mes, form.meses)
      .then((response) => {
        if (active) setSourceOptions(response.sources);
      })
      .catch((err) => {
        if (active) {
          setSourceOptions([]);
          setSourceError(err instanceof Error ? err.message : 'No se pudieron cargar los códigos de generación.');
        }
      })
      .finally(() => {
        if (active) setLoadingSources(false);
      });

    return () => {
      active = false;
    };
  }, [form.anio, form.mes, form.meses, modalMode]);

  const filteredEvaluations = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return evaluations.filter((evaluation) => {
      if (filterYear !== 'todos' && evaluation.anio !== Number(filterYear)) return false;
      if (filterMonth !== 'todos' && !(evaluation.meses?.length ? evaluation.meses : [evaluation.mes]).includes(Number(filterMonth))) return false;
      if (filterTrainer !== 'todos' && !(evaluation.formador_ids?.length ? evaluation.formador_ids : [evaluation.id_formador]).includes(filterTrainer)) return false;
      if (filterCoordinator !== 'todos' && evaluation.nombre_coordinador !== filterCoordinator) return false;
      if (filterStatus !== 'todos' && evaluation.estado !== filterStatus) return false;
      if (!normalizedSearch) return true;
      return (
        evaluation.nombre_formador.toLowerCase().includes(normalizedSearch) ||
        evaluation.nombre_coordinador.toLowerCase().includes(normalizedSearch) ||
        periodLabel(evaluation).toLowerCase().includes(normalizedSearch)
      );
    });
  }, [evaluations, filterCoordinator, filterMonth, filterStatus, filterTrainer, filterYear, searchTerm]);

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filteredEvaluations.length / pageSize));
  const pageItems = filteredEvaluations.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [filterCoordinator, filterMonth, filterStatus, filterTrainer, filterYear, searchTerm]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(undefined, currentUser));
    setModalMode('create');
  };

  const openEdit = (evaluation: TrainingVariableEvaluation) => {
    setEditing(evaluation);
    setForm({
      formula_version: evaluation.formula_version,
      porcentaje_rotacion: evaluation.porcentaje_rotacion,
      meses: evaluation.meses,
      formador_ids: evaluation.formador_ids,
      campanas: evaluation.campanas,
      anio: evaluation.anio,
      mes: evaluation.mes,
      id_formador: evaluation.id_formador,
      nombre_formador: evaluation.nombre_formador,
      observacion_general: evaluation.observacion_general || '',
      porcentaje_retencion: evaluation.porcentaje_retencion,
      porcentaje_produccion_individual: evaluation.porcentaje_produccion_individual,
      porcentaje_produccion_grupal: evaluation.porcentaje_produccion_grupal,
      porcentaje_satisfaccion: evaluation.porcentaje_satisfaccion,
      porcentaje_administrativo: evaluation.porcentaje_administrativo,
      observacion_administrativa: evaluation.observacion_administrativa || '',
      generation_ids: evaluation.generation_ids || [],
      codigos_generacion: evaluation.codigos_generacion || [],
      calculo_automatico: Boolean(evaluation.calculo_automatico),
      calculo_detalle: evaluation.calculo_detalle,
    });
    setModalMode('edit');
  };

  const openDetail = (evaluation: TrainingVariableEvaluation) => {
    openEdit(evaluation);
    setModalMode('detail');
  };

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateTrainer = (trainerId: string) => {
    const trainer = associatedTrainers.find((item) => item.id === trainerId);
    setForm((prev) => ({
      ...prev,
      id_formador: trainer?.id || '',
      nombre_formador: trainer?.nombre || '',
      calculo_automatico: false,
      calculo_detalle: undefined,
    }));
  };

  const updatePeriod = (key: 'anio' | 'mes', value: number) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      formador_ids: [],
      campanas: [],
      id_formador: '',
      nombre_formador: '',
      generation_ids: [],
      codigos_generacion: [],
      calculo_automatico: false,
      calculo_detalle: undefined,
    }));
  };

  const selectSource = (sourceId: string) => {
    const source = sourceOptions.find((item) => item.id === sourceId);
    const currentTrainer = source?.formadores.find((trainer) => trainer.id === form.id_formador);
    const trainer = currentTrainer || source?.formadores[0];
    setForm((prev) => ({
      ...prev,
      id_formador: trainer?.id || '',
      nombre_formador: trainer?.nombre || '',
      generation_ids: source ? [source.id] : [],
      codigos_generacion: source ? [source.codigo] : [],
      calculo_automatico: false,
      calculo_detalle: undefined,
    }));
  };

  const handleAutomaticCalculation = async () => {
    if (currentFormula && !form.meses?.length) { alert('Selecciona al menos un mes.'); return; }
    if (!form.id_formador) {
      alert('Selecciona un formador.');
      return;
    }
    if (!form.generation_ids?.length) {
      alert('Selecciona una capacitación.');
      return;
    }

    setCalculating(true);
    try {
      const response = await calculateTrainingVariableAutomatically(
        form.id_formador,
        form.generation_ids,
        form.anio,
        form.mes,
        { meses: form.meses, formador_ids: form.formador_ids, campanas: form.campanas },
      );
      const calculation = response.calculation;
      setForm((prev) => ({
        ...prev,
        generation_ids: calculation.generation_ids,
        codigos_generacion: calculation.codigos_generacion,
        porcentaje_retencion: calculation.porcentaje_retencion,
        porcentaje_produccion_individual: calculation.porcentaje_produccion_individual,
        porcentaje_produccion_grupal: calculation.porcentaje_produccion_grupal,
        porcentaje_satisfaccion: calculation.porcentaje_satisfaccion,
        porcentaje_rotacion: calculation.porcentaje_rotacion,
        calculo_automatico: true,
        calculo_detalle: calculation.detalle,
      }));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo realizar el cálculo automático.');
    } finally {
      setCalculating(false);
    }
  };

  const exportToExcel = () => {
    const rows = filteredEvaluations.map((evaluation) => ({
      Periodo: periodLabel(evaluation),
      Formador: evaluation.nombre_formador,
      Coordinador: evaluation.nombre_coordinador,
      'Códigos de generación': (evaluation.codigos_generacion || []).join(', '),
      'Tipo de cálculo': evaluation.calculo_automatico ? 'Automático' : 'Manual',
      'Participantes Día 1': evaluation.calculo_detalle?.participantes_dia_1 ?? '',
      'Participantes Día final': evaluation.calculo_detalle?.participantes_dia_final ?? '',
      'Retención obtenida (%)': evaluation.porcentaje_retencion,
      'Altas a operación': evaluation.calculo_detalle?.altas_operacion ?? '',
      'Ventas reales OJT': evaluation.calculo_detalle?.ventas_reales ?? '',
      'Producción individual (%)': evaluation.porcentaje_produccion_individual,
      'Producción grupal (%)': evaluation.porcentaje_produccion_grupal,
      'Respuestas de encuesta': evaluation.calculo_detalle?.respuestas_encuesta ?? '',
      'Satisfacción (%)': evaluation.porcentaje_satisfaccion,
      'Administrativo / Rotación (%)': evaluation.formula_version === 2 ? evaluation.porcentaje_rotacion : evaluation.porcentaje_administrativo,
      'Cumplimiento total (%)': evaluation.cumplimiento_total,
      'Comisión total': evaluation.comision_total,
      Estado: evaluation.estado,
      'Fecha de cierre': evaluation.fecha_cierre ? new Date(evaluation.fecha_cierre).toLocaleDateString('es-PE') : '',
      'Observación general': evaluation.observacion_general || '',
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Medición de Variables');
    XLSX.writeFile(workbook, `medicion-variables-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const validateForm = () => {
    if (currentFormula && !form.meses?.length) return 'Selecciona al menos un mes.';
    if (!form.generation_ids?.length) return 'Selecciona una capacitación.';
    if (!form.id_formador) return 'Selecciona un formador.';
    if (currentFormula && previewResult.error) return previewResult.error;
    if (currentFormula && form.calculo_automatico && form.calculo_detalle?.productividad_disponible === false) return 'No hay altas a operación para calcular Productividad OJT.';
    if (currentFormula && form.calculo_automatico && form.calculo_detalle?.rotacion_disponible === false) return 'No hay dotación cargada para calcular rotación.';
    if (form.porcentaje_retencion < 0 || form.porcentaje_retencion > 100) return 'La retención debe estar entre 0% y 100%.';
    if (form.porcentaje_produccion_individual < 0 || form.porcentaje_produccion_individual > 100) return 'La producción individual debe estar entre 0% y 100%.';
    if (form.porcentaje_produccion_grupal < 0) return 'La producción grupal debe ser igual o mayor a 0%.';
    if (form.porcentaje_satisfaccion < 0 || form.porcentaje_satisfaccion > 100) return 'La satisfacción debe estar entre 0% y 100%.';
    if (form.porcentaje_administrativo < 0 || form.porcentaje_administrativo > 100) return 'El cumplimiento administrativo debe estar entre 0% y 100%.';
    if (!currentFormula && form.porcentaje_administrativo < 100 && !form.observacion_administrativa?.trim()) {
      return 'El sustento administrativo es obligatorio cuando la calificación es menor a 100%.';
    }
    const duplicate = evaluations.some((evaluation) =>
      evaluation.id !== editing?.id &&
      (evaluation.formador_ids || [evaluation.id_formador]).some((id) => (form.formador_ids || [form.id_formador]).includes(id)) &&
      evaluation.generation_ids?.some((id) => form.generation_ids!.includes(id)) &&
      evaluation.estado !== 'ANULADO',
    );
    if (duplicate) return 'Ya existe una evaluación activa para ese formador y capacitación.';
    return '';
  };

  const handleSave = async () => {
    const validation = validateForm();
    if (validation) {
      alert(validation);
      return;
    }
    setSaving(true);
    try {
      const response = editing
        ? await updateTrainingVariableEvaluation(editing.id, form)
        : await createTrainingVariableEvaluation(form);
      setEvaluations((prev) => {
        const exists = prev.some((item) => item.id === response.evaluation.id);
        return exists
          ? prev.map((item) => item.id === response.evaluation.id ? response.evaluation : item)
          : [response.evaluation, ...prev];
      });
      setModalMode(null);
      setEditing(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo guardar la evaluación.');
    } finally {
      setSaving(false);
    }
  };

  const replaceEvaluation = (next: TrainingVariableEvaluation) => {
    setEvaluations((prev) => prev.map((item) => item.id === next.id ? next : item));
  };

  const handleClose = async (evaluation: TrainingVariableEvaluation) => {
    if (!confirm('Una vez cerrada la evaluación, el coordinador no podrá modificarla. ¿Deseas continuar?')) return;
    setSaving(true);
    try {
      const response = await closeTrainingVariableEvaluation(evaluation.id);
      replaceEvaluation(response.evaluation);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo cerrar la evaluación.');
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async (evaluation: TrainingVariableEvaluation) => {
    setSaving(true);
    try {
      const response = await reopenTrainingVariableEvaluation(evaluation.id);
      replaceEvaluation(response.evaluation);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo reabrir la evaluación.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (evaluation: TrainingVariableEvaluation) => {
    if (!confirm('Esta evaluación se eliminará permanentemente. ¿Deseas continuar?')) return;
    setSaving(true);
    try {
      await deleteTrainingVariableEvaluation(evaluation.id);
      setEvaluations((prev) => prev.filter((item) => item.id !== evaluation.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar la evaluación.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:bg-slate-50 disabled:text-slate-500';
  const labelClass = 'text-xs font-black uppercase tracking-wide text-slate-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-fuchsia-600">Formación</p>
          <h2 className="text-3xl font-black text-slate-950 flex items-center gap-3">
            <Calculator className="w-8 h-8 text-fuchsia-600" />
            Módulo de Medición de Variables
          </h2>
          <p className="text-slate-500 mt-1">
            Cálculo manual o automático de KPI por capacitación y formador asociado.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={exportToExcel}
              disabled={!filteredEvaluations.length}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <FileSpreadsheet className="w-5 h-5" />
              Descargar Excel
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-indigo-200 hover:opacity-95"
            >
              <Plus className="w-5 h-5" />
              Nueva evaluación
            </button>
          </div>
        )}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <div className="xl:col-span-2 relative">
            <Search className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar formador, coordinador o periodo..."
              className={`${inputClass} pl-10`}
            />
          </div>
          <select value={filterYear} onChange={(event) => setFilterYear(event.target.value)} className={inputClass}>
            <option value="todos">Todos los años</option>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <select value={filterMonth} onChange={(event) => setFilterMonth(event.target.value)} className={inputClass}>
            <option value="todos">Todos los meses</option>
            {monthNames.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
          </select>
          <select value={filterTrainer} onChange={(event) => setFilterTrainer(event.target.value)} className={inputClass}>
            <option value="todos">Todos los formadores</option>
            {trainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.nombre}</option>)}
          </select>
          <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} className={inputClass}>
            <option value="todos">Todos los estados</option>
            {['BORRADOR', 'CERRADO', 'REABIERTO', 'ANULADO'].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={filterCoordinator} onChange={(event) => setFilterCoordinator(event.target.value)} className={inputClass}>
            <option value="todos">Todos los coordinadores</option>
            {coordinators.map((coordinator) => <option key={coordinator} value={coordinator}>{coordinator}</option>)}
          </select>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {['Periodo', 'Formador', 'Coordinador', 'Retención', 'Prod. individual', 'Prod. grupal', 'Satisfacción', 'Administrativo', 'Total', 'Comisión', 'Estado', 'Cierre', 'Acciones'].map((header) => (
                  <th key={header} className="px-4 py-3 text-left font-black">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-500">Cargando evaluaciones...</td></tr>
              ) : error ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-rose-600">{error}</td></tr>
              ) : pageItems.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-500">No hay evaluaciones con los filtros seleccionados.</td></tr>
              ) : pageItems.map((evaluation) => (
                <tr key={evaluation.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-bold text-slate-900">{periodLabel(evaluation)}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <span className="block">{evaluation.nombre_formador}</span>
                    {evaluation.codigos_generacion?.length ? (
                      <span className="mt-1 block max-w-52 truncate text-[10px] font-bold text-indigo-600" title={evaluation.codigos_generacion.join(', ')}>
                        {evaluation.codigos_generacion.join(', ')}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{evaluation.nombre_coordinador}</td>
                  <td className="px-4 py-3">{percent(evaluation.porcentaje_retencion)}</td>
                  <td className="px-4 py-3">{percent(evaluation.porcentaje_produccion_individual)}</td>
                  <td className="px-4 py-3">{percent(evaluation.porcentaje_produccion_grupal)}</td>
                  <td className="px-4 py-3">{percent(evaluation.porcentaje_satisfaccion)}</td>
                  <td className="px-4 py-3">{percent(evaluation.formula_version === 2 ? evaluation.porcentaje_rotacion ?? 0 : evaluation.porcentaje_administrativo)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${scoreBadge(evaluation.cumplimiento_total)}`}>
                      {percent(evaluation.cumplimiento_total)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-black text-slate-900">{money(evaluation.comision_total)}</td>
                  <td className="px-4 py-3"><span className={statusBadge(evaluation.estado)}>{evaluation.estado}</span></td>
                  <td className="px-4 py-3 text-slate-500">{evaluation.fecha_cierre ? new Date(evaluation.fecha_cierre).toLocaleDateString('es-PE') : '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openDetail(evaluation)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Ver detalle"><Eye className="w-4 h-4" /></button>
                      {canManage && evaluation.estado !== 'CERRADO' && evaluation.estado !== 'ANULADO' && (
                        <button onClick={() => openEdit(evaluation)} className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50" title="Editar"><Pencil className="w-4 h-4" /></button>
                      )}
                      {canManage && evaluation.estado !== 'CERRADO' && evaluation.estado !== 'ANULADO' && (
                        <button onClick={() => handleClose(evaluation)} disabled={saving} className="p-2 rounded-lg text-emerald-700 hover:bg-emerald-50" title="Cerrar"><CheckCircle className="w-4 h-4" /></button>
                      )}
                      {isAdmin && evaluation.estado === 'CERRADO' && (
                        <button onClick={() => handleReopen(evaluation)} disabled={saving} className="p-2 rounded-lg text-amber-700 hover:bg-amber-50" title="Reabrir"><RotateCcw className="w-4 h-4" /></button>
                      )}
                      {isAdmin && (
                        <button onClick={() => handleDelete(evaluation)} disabled={saving} className="p-2 rounded-lg text-rose-700 hover:bg-rose-50" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>Mostrando {pageItems.length} de {filteredEvaluations.length} evaluaciones</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Anterior</button>
            <span className="font-bold text-slate-700">{page} / {totalPages}</span>
            <button onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
          </div>
        </div>
      </section>

      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-5">
              <div>
                <h3 className="text-2xl font-black text-slate-950 flex items-center gap-2">
                  {isReadOnly ? <FileText className="w-6 h-6 text-indigo-600" /> : <Calculator className="w-6 h-6 text-fuchsia-600" />}
                  {modalMode === 'create' ? 'Nueva evaluación por capacitación' : modalMode === 'detail' ? 'Detalle de evaluación' : 'Editar evaluación'}
                </h3>
                <p className="text-sm text-slate-500">Calcula los KPI operativos de una capacitación y asígnalos a uno de sus formadores.</p>
              </div>
              <button onClick={() => setModalMode(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 p-6">
              <div className="space-y-5">
                <section className="rounded-2xl border border-slate-200 p-4">
                  <h4 className="font-black text-slate-900 mb-4">Datos generales</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1">
                      <span className={labelClass}>Año</span>
                      <select disabled={isReadOnly} value={form.anio} onChange={(event) => updatePeriod('anio', Number(event.target.value))} className={inputClass}>
                        {years.map((year) => <option key={year} value={year}>{year}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className={labelClass}>Mes</span>
                      {currentFormula ? <VariableMultiSelect disabled={isReadOnly} options={monthNames.map((label, index) => ({ id: String(index + 1), label }))} selected={(form.meses || []).map(String)} onChange={(ids) => updateSelection({ meses: ids.map(Number), mes: Number(ids[0]) || form.mes })} className={inputClass} /> : (<select disabled={isReadOnly} value={form.mes} onChange={(event) => updatePeriod('mes', Number(event.target.value))} className={inputClass}>
                        {monthNames.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
                      </select>)}

                    </label>
                    <label className="md:col-span-2 space-y-1">
                      <span className={labelClass}>Observación general</span>
                      <textarea disabled={isReadOnly} value={form.observacion_general || ''} onChange={(event) => updateForm('observacion_general', event.target.value)} rows={3} className={inputClass} />
                    </label>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h4 className="font-black text-slate-900">Capacitación y formador</h4>
                      <p className="mt-1 text-xs text-slate-500">Selecciona las capacitaciones y los formadores asociados.</p>
                    </div>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => void handleAutomaticCalculation()}
                        disabled={calculating || !form.generation_ids?.length || !form.id_formador || currentFormula && !form.meses?.length}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"
                      >
                        <Sparkles className="h-4 w-4" />
                        {calculating ? 'Calculando...' : 'Calcular automáticamente'}
                      </button>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    {currentFormula && <label className="space-y-1"><span className={labelClass}>Campaña</span><VariableMultiSelect disabled={isReadOnly} options={[...new Set<string>(sourceOptions.map((source) => source.campana))].map((name) => ({ id: name, label: name }))} selected={form.campanas || []} className={inputClass} onChange={(ids) => updateSelection({ campanas: ids, formador_ids: [], id_formador: '', nombre_formador: '' })} /></label>}
                    <label className="space-y-1">
                      <span className={labelClass}>Capacitación</span>
                      {currentFormula ? <VariableMultiSelect disabled={isReadOnly || loadingSources} options={filteredSources.map((source) => ({ id: source.id, label: source.codigo + ' · ' + source.campana }))} selected={form.generation_ids || []} className={inputClass} onChange={(ids) => setForm((previous) => ({ ...previous, generation_ids: ids, codigos_generacion: filteredSources.filter((source) => ids.includes(source.id)).map((source) => source.codigo), calculo_automatico: false, calculo_detalle: undefined }))} /> : (<select
                        disabled={isReadOnly || loadingSources}
                        value={form.generation_ids?.[0] || ''}
                        onChange={(event) => selectSource(event.target.value)}
                        className={inputClass}
                      >
                        <option value="">{loadingSources ? 'Cargando capacitaciones...' : 'Seleccionar capacitación'}</option>
                        {sourceOptions.map((source) => (
                          <option key={source.id} value={source.id}>{source.codigo} · {source.campana}</option>
                        ))}
                      </select>)}
                    </label>
                    <label className="space-y-1">
                      <span className={labelClass}>Formador asociado</span>
                      {currentFormula ? <VariableMultiSelect disabled={isReadOnly} options={sourceTrainers.map((trainer) => ({ id: trainer.id, label: trainer.nombre }))} selected={form.formador_ids || []} className={inputClass} onChange={(ids) => updateSelection({ formador_ids: ids, id_formador: ids[0] || '', nombre_formador: sourceTrainers.filter((trainer) => ids.includes(trainer.id)).map((trainer) => trainer.nombre).join(', ') })} /> : (<select
                        disabled={isReadOnly || !selectedSource}
                        value={form.id_formador}
                        onChange={(event) => updateTrainer(event.target.value)}
                        className={inputClass}
                      >
                        <option value="">Seleccionar formador</option>
                        {associatedTrainers.map((trainer) => (
                          <option key={trainer.id} value={trainer.id}>{trainer.nombre}</option>
                        ))}
                      </select>)}
                    </label>
                  </div>

                  {!loadingSources && sourceOptions.length === 0 ? (
                    <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center text-sm text-slate-500">No hay capacitaciones con formadores asociados en este periodo.</p>
                  ) : null}

                  {sourceError ? (
                    <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{sourceError}</p>
                  ) : null}

                  {form.codigos_generacion?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {form.codigos_generacion.map((code) => (
                        <span key={code} className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700">{code}</span>
                      ))}
                    </div>
                  ) : null}

                  {form.calculo_automatico && form.calculo_detalle && (
                    <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs md:grid-cols-5">
                      <ReadMetric label="Día 1" value={String(form.calculo_detalle.participantes_dia_1)} />
                      <ReadMetric label="Día final" value={String(form.calculo_detalle.participantes_dia_final)} />
                      <ReadMetric label="Altas a operación" value={String(form.calculo_detalle.altas_operacion ?? 0)} />
                      <ReadMetric label="Ventas reales OJT" value={String(form.calculo_detalle.ventas_reales ?? 0)} />
                      <ReadMetric label="Encuestas" value={String(form.calculo_detalle.respuestas_encuesta)} />
                    </div>
                  )}
                </section>

                <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <KpiCard
                    title={currentFormula ? "Retención total (D1–D10)" : "Retención a operación"}
                    weight="Peso 30%"
                    meta={currentFormula ? "Meta 50%" : "Meta 70%"}
                    guide={{
                      measures: 'Mide la capacidad del formador para lograr que los participantes culminen la capacitación y pasen a operación.',
                      input: currentFormula ? 'Altas efectivas a operación divididas entre participantes iniciales del Día 1. Meta 50%.' : 'Ingresa el porcentaje mensual de retención obtenido. La meta de referencia es 70%; si el valor supera 70%, genera sobrecumplimiento.',
                    }}
                  >
                    <PercentInput label="Retención obtenida" value={form.porcentaje_retencion} disabled={isReadOnly} onChange={(value) => updateForm('porcentaje_retencion', value)} />
                    <ReadMetric label="Cumplimiento" value={percent(preview.cumplimiento_retencion)} />
                    <ReadMetric label="Aporte" value={`${preview.aporte_retencion.toFixed(2)} puntos`} />
                  </KpiCard>
                  <KpiCard
                    title={currentFormula ? "Productividad OJT" : "Producción durante OJT"}
                    weight="Peso 50%"
                    meta="Meta grupal 100%"
                    guide={{
                      measures: 'Mide el desempeño productivo durante OJT según el resultado mensual definido por el coordinador.',
                      input: currentFormula ? 'Ventas reales OJT divididas entre altas a operación de las capacitaciones seleccionadas. Meta 100%.' : 'Ingresa dos porcentajes: el individual solo sirve como referencia; el grupal se compara con la meta de 100% y calcula el aporte ponderado del KPI.',
                    }}
                  >
                    {!currentFormula && <PercentInput label="Cumplimiento individual" value={form.porcentaje_produccion_individual} disabled={isReadOnly} onChange={(value) => updateForm('porcentaje_produccion_individual', value)} />}
                    <PercentInput label={currentFormula ? "Productividad OJT" : "Cumplimiento grupal"} value={form.porcentaje_produccion_grupal} disabled={isReadOnly} onChange={(value) => updateForm('porcentaje_produccion_grupal', value)} />
                    <ReadMetric label="Aporte grupal" value={`${preview.aporte_produccion.toFixed(2)} puntos`} />
                  </KpiCard>
                  <KpiCard
                    title="Satisfacción de capacitación"
                    weight="Peso 10%"
                    meta="Meta 90%"
                    guide={{
                      measures: 'Mide la percepción de calidad de la capacitación recibida por los participantes.',
                      input: currentFormula ? 'Promedio de las encuestas correspondientes. Meta 90%.' : 'Ingresa el porcentaje promedio mensual de satisfacción. La meta mínima es 90%; valores superiores representan sobrecumplimiento.',
                    }}
                  >
                    <PercentInput label="Satisfacción obtenida" value={form.porcentaje_satisfaccion} disabled={isReadOnly} onChange={(value) => updateForm('porcentaje_satisfaccion', value)} />
                    <ReadMetric label="Cumplimiento" value={percent(preview.cumplimiento_satisfaccion)} />
                    <ReadMetric label="Aporte" value={`${preview.aporte_satisfaccion.toFixed(2)} puntos`} />
                  </KpiCard>
                  <KpiCard
                    title={currentFormula ? "Rotación" : "Cumplimiento administrativo"}
                    weight="Peso 10%"
                    meta={currentFormula ? "Meta 10% · Ingreso manual" : "Calificación manual"}
                    guide={{
                      measures: currentFormula ? 'Rotación calculada con bajas y dotación cargadas.' : 'Mide el cumplimiento de responsabilidades operativas y administrativas del formador durante el mes.',
                      input: currentFormula ? '10% obtiene 10 puntos; por debajo disminuye proporcionalmente. Por encima requiere definición.' : 'Ingresa una calificación manual de 0% a 100%. Si es menor a 100%, debes registrar el sustento u observación.',
                    }}
                  >
                    {currentFormula ? <ReadMetric label="Rotación calculada" value={form.calculo_automatico && form.calculo_detalle?.rotacion_disponible === false ? 'Sin datos' : percent(form.porcentaje_rotacion ?? 0)} /> : <PercentInput label="Cumplimiento administrativo" value={form.porcentaje_administrativo} disabled={isReadOnly} onChange={(value) => updateForm('porcentaje_administrativo', value)} />}
                    <label className="space-y-1 block">
                      <span className={labelClass}>Sustento {!currentFormula && form.porcentaje_administrativo < 100 ? '*' : ''}</span>
                      <textarea disabled={isReadOnly} value={form.observacion_administrativa || ''} onChange={(event) => updateForm('observacion_administrativa', event.target.value)} rows={3} className={inputClass} />
                    </label>
                    <ReadMetric label="Aporte" value={`${preview.aporte_administrativo.toFixed(2)} puntos`} />
                  </KpiCard>
                </section>
              </div>

              <aside className="space-y-4">
                {previewResult.error && <p role="alert" className="text-sm text-rose-700">{previewResult.error}</p>}
                <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <h4 className="text-lg font-black text-slate-950 mb-4">Resumen de comisión</h4>
                  <div className="space-y-3">
                    <ReadMetric label="Aporte retención" value={`${preview.aporte_retencion.toFixed(2)} pts`} />
                    <ReadMetric label="Aporte producción" value={`${preview.aporte_produccion.toFixed(2)} pts`} />
                    <ReadMetric label="Aporte satisfacción" value={`${preview.aporte_satisfaccion.toFixed(2)} pts`} />
                    <ReadMetric label={currentFormula ? "Aporte rotación" : "Aporte administrativo"} value={`${preview.aporte_administrativo.toFixed(2)} pts`} />
                  </div>
                  <div className={`mt-5 rounded-2xl border p-4 ${scoreBadge(preview.cumplimiento_total)}`}>
                    <p className="text-xs font-black uppercase tracking-wide">Cumplimiento total</p>
                    <p className="text-3xl font-black mt-1">{percent(preview.cumplimiento_total)}</p>
                  </div>
                  {preview.cumplimiento_total < (currentFormula ? 90 : 85) && (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">
                      El cumplimiento global es menor a {currentFormula ? 90 : 85}%. La comisión aplicable es S/ 0.00.
                    </div>
                  )}
                  <div className="mt-4 space-y-2 text-sm">
                    <ReadMetric label="Comisión base" value={money(preview.comision_base)} />
                    <ReadMetric label="Bloques de sobrecumplimiento" value={String(preview.bloques_sobrecumplimiento)} />
                    <ReadMetric label="Bono adicional" value={money(preview.bono_sobrecumplimiento)} />
                    <div className="flex justify-between rounded-xl bg-white p-3 font-black text-slate-950">
                      <span>Comisión total</span>
                      <span>{money(preview.comision_total)}</span>
                    </div>
                  </div>
                </section>

                {isReadOnly && (
                  <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                    <Lock className="w-5 h-5 text-slate-400 mt-0.5" />
                    <p>Esta vista es solo lectura o la evaluación no permite edición por su estado actual.</p>
                  </div>
                )}
                {!isReadOnly && !currentFormula && form.porcentaje_administrativo < 100 && !form.observacion_administrativa?.trim() && (
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    <AlertTriangle className="w-5 h-5 mt-0.5" />
                    <p>Agrega un sustento administrativo para poder guardar.</p>
                  </div>
                )}
              </aside>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-100 bg-white px-6 py-4">
              <button onClick={() => setModalMode(null)} className="rounded-xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700">Cancelar</button>
              {!isReadOnly && (
                <button
                  onClick={handleSave}
                  disabled={saving || Boolean(previewResult.error)}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Guardando...' : 'Guardar borrador'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type KpiGuideInfo = {
  measures: string;
  input: string;
};

function KpiCard({
  title,
  weight,
  meta,
  guide,
  children,
}: {
  title: string;
  weight: string;
  meta: string;
  guide?: KpiGuideInfo;
  children: React.ReactNode;
}) {
  return (
    <section className="relative rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-black text-slate-950">{title}</h4>
            {guide && <KpiGuide guide={guide} />}
          </div>
          <p className="text-xs text-slate-500 mt-1">{meta}</p>
        </div>
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black text-indigo-700">{weight}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function KpiGuide({ guide }: { guide: KpiGuideInfo }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="Ver guía del indicador"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-black text-slate-500 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-100"
      >
        ?
      </button>
      <span className="pointer-events-none absolute left-0 top-8 z-30 hidden w-72 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-xl group-hover:block group-focus-within:block">
        <span className="block">
          <span className="font-black text-slate-800">Qué se mide: </span>
          {guide.measures}
        </span>
        <span className="mt-2 block">
          <span className="font-black text-slate-800">Qué registrar: </span>
          {guide.input}
        </span>
      </span>
    </span>
  );
}

function PercentInput({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
      <div className="relative">
        <input
          type="number"
          min={0}
          step="0.01"
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-10 text-sm font-semibold text-slate-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:bg-slate-50 disabled:text-slate-500"
        />
        <span className="absolute right-3 top-2 text-sm font-bold text-slate-400">%</span>
      </div>
    </label>
  );
}

function ReadMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-black text-slate-900">{value}</span>
    </div>
  );
}

function VariableMultiSelect({ options, selected, onChange, disabled, className }: {
  options: { id: string; label: string }[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean; className: string;
}) {
  if (disabled) return <div className={className}>{options.filter((option) => selected.includes(option.id)).map((option) => option.label).join(', ') || 'Sin selección'}</div>;
  return <details className="relative">
    <summary className={className}>{selected.length ? `${selected.length} seleccionados` : 'Seleccionar'}</summary>
    <div className="absolute left-0 z-50 mt-1 max-h-60 min-w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
      {options.map((option) => <label key={option.id} className="flex items-center gap-2 px-2 py-2 text-xs text-slate-700">
        <input type="checkbox" checked={selected.includes(option.id)} onChange={() => onChange(selected.includes(option.id) ? selected.filter((id) => id !== option.id) : [...selected, option.id])} />
        {option.label}
      </label>)}
    </div>
  </details>;
}
