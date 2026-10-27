import { createHash } from 'node:crypto';
import { dataDb as adminDb } from '../hybridDb.js';
import { getScheduledTrainingDays } from './trainingSchedule.js';

type Row = Record<string, unknown> & { id: string };
type StoredRecord = Record<string, unknown> & { id: string };
export type RotationFilters = { campaigns?: string[]; months?: string[]; from?: string; to?: string; search?: string };

const OTHER_CAMPAIGN = 'Otros / Campaña no identificada';
const normalize = (value: unknown) => String(value ?? '').trim();
const key = (value: unknown) => normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const documentKey = (value: unknown) => normalize(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (type: string, values: unknown[]) => createHash('sha256').update(JSON.stringify([type, ...values])).digest('hex').slice(0, 32);
export const rotationDate = (value: unknown): string => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value < 100000 ? rotationDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)) : '';
  const raw = normalize(value);
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw);
  const latin = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(raw);
  const candidate = iso ? `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}` : latin ? `${latin[3]}-${latin[2].padStart(2, '0')}-${latin[1].padStart(2, '0')}` : '';
  const parsed = new Date(`${candidate}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : '';
};
const day = rotationDate;
const datesIn = (value: unknown) => {
  if (value instanceof Date || typeof value === 'number') return [rotationDate(value)].filter(Boolean);
  const matches = normalize(value).match(/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/g) || [];
  return matches.map(rotationDate).filter(Boolean);
};
const firstDate = (value: unknown) => datesIn(value)[0] || rotationDate(value);
const lastDate = (value: unknown) => datesIn(value).at(-1) || rotationDate(value);
const text = (row: Record<string, unknown>, names: string[]) => {
  return normalize(value(row, names));
};
const value = (row: Record<string, unknown>, names: string[]) => {
  const entries = new Map(Object.entries(row).map(([header, entry]) => [key(header), entry]));
  return names.map((name) => entries.get(key(name))).find((entry) => entry != null && normalize(entry) !== '');
};
const isWithin = (value: string, from?: string, to?: string) => (!from || value >= from) && (!to || value <= to);
const isPresent = (value: unknown) => key(value) === 'asistio';
const isApto = (value: unknown) => key(value) === 'apto';
const campaignKey = (value: unknown) => key(value).replace(/empresas/g, '').replace(/^entel(?=ruc)/, '');
const isRotationCampaign = (campaign: unknown) => ['entelruc10', 'entelruc20', 'ruc10', 'ruc20', 'culqi', 'gpon', 'equifax'].includes(campaignKey(campaign));
const isFiveDayRotationCampaign = (campaign: unknown) => ['gpon', 'equifax'].includes(campaignKey(campaign));

export type RotationTermination = {
  id: string; fecha: string; fecha_alta: string; campana: string; campana_origen: string; dni: string; nombre: string;
  proveedor: string; motivo: string; descripcion: string; tipo: 'cese' | 'reingreso' | 'administrativo'; verificado: boolean; validacion?: string;
  raw: Record<string, unknown>; imported_at: string; imported_by: string; updated_at?: string;
  raw_history?: Array<{ raw: Record<string, unknown>; imported_at?: string }>;
};
type RotationHigh = { id: string; documento: string; dni: string; nombre: string; campana: string; fecha_alta: string; participant_id: string; session_id: string; fecha_inicio_laboral?: string; source?: 'formation' | 'snapshot' };
type RotationHeadcount = { id: string; dni: string; nombre: string; campana: string; proveedor: string; estado: string; fecha_alta: string; fecha_corte: string; raw: Record<string, unknown>; imported_at: string; imported_by: string; updated_at?: string };

const classifyNotification = (motivo: string, descripcion: string, tipoSource: string): RotationTermination['tipo'] => {
  const descriptor = key(`${motivo} ${tipoSource}`);
  if (/reingreso|rehire|retorno/.test(descriptor)) return 'reingreso';
  if (/administrativ|actualizacion|modificacion|traslado|correccion|cambiodecampana|cambiodeproveedor|cambioderegimen/.test(descriptor) || /cambiodecampana|cambiodeproveedor|actualizaciondedatos|correcciondedatos|cambioderegimen/.test(key(descripcion))) return 'administrativo';
  return 'cese';
};

export const normalizeTerminations = (rows: Record<string, unknown>[]) => rows.map((raw, index) => {
  const effectiveDate = value(raw, ['fechaefectiva', 'cese', 'fechabaja', 'fechacese', 'fechadecese', 'fechadebaja', 'fechareingreso', 'fechafin', 'fechainicioyfin', 'fechainiciofin', 'periodo', 'fecha']);
  const fecha = lastDate(effectiveDate ?? value(raw, ['fechanotificacion', 'fechadenotificacion']));
  const fecha_alta = firstDate(value(raw, ['alta', 'fechaalta', 'fechadealta', 'fechaingreso', 'fechadeingreso', 'fechaingresolaboral', 'fechainicio', 'fechainicioyfin', 'fechainiciofin', 'periodo']));
  const dni = text(raw, ['dni', 'ce', 'dnice', 'documento', 'numerodocumento', 'numerodedocumento', 'numerodoc', 'nrodocumento', 'ndocumento']);
  const nombre = text(raw, ['nombre', 'nombres', 'nombreyapellido', 'nombreyapellidos', 'nombresyapellidos', 'apellidosynombres', 'colaborador', 'trabajador', 'nombrecompleto']);
  // The final campaign is always resolved from Formación. This is only the service
  // declared in Notificaciones and must not turn the employing company into a campaign.
  const campana_origen = text(raw, ['campana', 'campaña', 'servicio', 'proveedorsocio']);
  const proveedor = text(raw, ['proveedor', 'proveedorsocio', 'proveedorservicio', 'cliente', 'empresa']);
  const motivo = text(raw, ['motivo', 'motivonotificacion', 'motivobaja', 'motivocese', 'motivodecese', 'motivodebaja', 'causal']);
  const descripcion = text(raw, ['descripcion', 'detalle', 'observacion', 'observaciones', 'comentario', 'descripciondelmotivo']);
  const sourceType = text(raw, ['tipo', 'tipobaja', 'tipocese', 'movimiento']);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || (!dni && !nombre)) {
    const missing = [/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? '' : 'FECHA DE CESE válida', !dni && !nombre ? 'DNI/CE o NOMBRE Y APELLIDOS' : ''].filter(Boolean);
    throw new Error(`Fila ${index + 2}: falta ${missing.join(', ')}.`);
  }
  const tipo = classifyNotification(motivo, descripcion, sourceType);
  const state = key(text(raw, ['estado', 'estadocese', 'estadoefectivo', 'confirmado', 'verificado']));
  const recognized = /^(renuncia|despido|ces(e|ado)|baja|terminodecontrato|findecontrato|vencimientodecontrato|abandonode(trabajo|puesto)|mutuodisenso|fallecimiento)/.test(key(motivo)) || /^(cese|baja|despido)$/.test(key(sourceType));
  const validacion = !effectiveDate ? 'Falta fecha efectiva del movimiento' : /pendiente|solicit|anulad|cancelad|rechazad|programad|activo/.test(state) ? 'Notificación no efectiva' :
    !dni ? 'Falta documento para conciliar' :
    fecha_alta && fecha_alta > fecha ? 'Ingreso posterior al movimiento' :
    tipo === 'cese' && !recognized ? 'Motivo de cese no verificado' : '';
  const verificado = !validacion;
  const identity = documentKey(dni) || key(nombre);
  return { id: hash('rotation-notification', [identity, fecha, key(motivo)]), fecha, fecha_alta, campana: campana_origen, campana_origen, dni, nombre, proveedor, motivo, descripcion, tipo, verificado, validacion, raw };
});

const ACTIVE_HEADCOUNT_STATES = ['activo', 'activa', 'laborando', 'altaefectiva', 'altaconfirmada', 'vigente'];
export const normalizeHeadcount = (rows: Record<string, unknown>[]) => rows.map((raw, index) => {
  const dni = text(raw, ['dni', 'ce', 'dnice', 'documento', 'numerodocumento', 'numerodedocumento', 'numerodoc', 'nrodocumento', 'ndocumento']);
  const nombre = text(raw, ['nombre', 'nombres', 'nombreyapellido', 'nombreyapellidos', 'nombresyapellidos', 'apellidosynombres', 'colaborador', 'trabajador', 'nombrecompleto']);
  const campana = text(raw, ['campana', 'campaña', 'servicio']);
  const proveedor = text(raw, ['proveedor', 'proveedorsocio', 'proveedorservicio', 'empresa', 'cliente']);
  const estado = text(raw, ['estado', 'estadoactual', 'situacion', 'situacionlaboral', 'status']) || 'Activo';
  const fecha_alta = firstDate(value(raw, ['fechaingreso', 'fechadeingreso', 'fechaalta', 'fechadealta', 'fecha_inicio', 'fechainicio']));
  const fecha_corte = lastDate(value(raw, ['fechacorte', 'fechadecorte', 'asof', 'fechaactualizacion', 'fechavigencia', 'fecha']));
  const missing = [!dni ? 'DNI/CE' : '', !nombre ? 'NOMBRE Y APELLIDO' : '', !campana ? 'CAMPAÑA' : '', !fecha_alta ? 'FECHA DE INGRESO' : '', !fecha_corte ? 'FECHA DE CORTE' : ''].filter(Boolean);
  if (missing.length) throw new Error(`Fila ${index + 2}: falta ${missing.join(', ')}.`);
  if (fecha_alta > fecha_corte) throw new Error(`Fila ${index + 2}: la fecha de ingreso no puede ser posterior a la fecha de corte.`);
  if (!ACTIVE_HEADCOUNT_STATES.includes(key(estado))) throw new Error(`Fila ${index + 2}: el estado debe indicar una persona activa.`);
  return { id: hash('rotation-headcount', [documentKey(dni), fecha_corte]), dni, nombre, campana, proveedor, estado, fecha_alta, fecha_corte, raw };
});

const read = async <T extends Row>(collection: string) => {
  const snapshot = await adminDb.collection(collection).get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as T);
};

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

// Older imports preserved the original Excel row but did not recognize some of
// its headers. Rebuild the derived fields at read time without mutating history.
export const hydrateRotationTermination = (stored: RotationTermination & Row): RotationTermination => {
  const source = { ...asRecord(stored.raw) };
  const fallback = (header: string, entry: unknown) => { if (normalize(entry)) source[header] = entry; };
  fallback('DNI', stored.dni);
  fallback('Fecha', stored.fecha);
  fallback('Alta', stored.fecha_alta);
  fallback('Motivo', stored.motivo);
  fallback('Tipo', stored.tipo);
  fallback('Nombre', stored.nombre);
  fallback('Proveedor', stored.proveedor);
  fallback('Descripción', stored.descripcion);
  try {
    const [normalized] = normalizeTerminations([source]);
    return {
      ...normalized,
      id: stored.id,
      imported_at: normalize(stored.imported_at),
      imported_by: normalize(stored.imported_by),
      updated_at: normalize(stored.updated_at),
    };
  } catch {
    return stored;
  }
};

export const saveRotationImport = async (rows: Record<string, unknown>[], actor: { uid: string; nombre: string }) => {
  const now = new Date().toISOString();
  const importId = `rotation-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const normalized = normalizeTerminations(rows);
  const unique = new Map<string, typeof normalized[number]>();
  for (const row of normalized) {
    const previous = unique.get(row.id);
    if (previous && fingerprint(previous.raw) !== fingerprint(row.raw)) throw new Error('El archivo contiene versiones distintas de la misma notificación. Sepáralas en cargas de actualización.');
    unique.set(row.id, row);
  }
  let inserted = 0; let updated = 0; let skipped = 0;
  await adminDb.runTransaction(async (transaction) => {
    skipped = normalized.length - unique.size;
    for (const row of [...unique.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const ref = adminDb.collection('rotation_notifications').doc(row.id);
      const existing = await transaction.get(ref);
      const previous = existing.exists ? existing.data() as RotationTermination : undefined;
      const changed = !previous || fingerprint(previous.raw || {}) !== fingerprint(row.raw);
      if (!changed) { skipped += 1; continue; }
      // Immutable revisions preserve every imported version, including concurrent updates.
      for (const revision of [previous, { ...row, imported_at: now, imported_by: actor.uid, import_id: importId }]) {
        if (!revision) continue;
        const versionRef = adminDb.collection('rotation_notification_versions').doc(`${row.id}-${fingerprint(revision.raw)}`);
        if (!(await transaction.get(versionRef)).exists) transaction.set(versionRef, revision);
      }
      transaction.set(ref, {
        ...row, imported_at: previous?.imported_at || now, imported_by: previous?.imported_by || actor.uid,
        updated_at: now, updated_by: actor.uid, import_id: importId,
      });
      if (previous) updated += 1; else inserted += 1;
    }
    transaction.set(adminDb.collection('rotation_imports').doc(importId), {
      id: importId, type: 'notificaciones', row_count: normalized.length, inserted, updated, skipped, imported_at: now,
      imported_by: actor.uid, imported_by_name: actor.nombre,
    });
  });
  const dashboard = await getRotationDashboard();
  const importedIds = new Set([...unique.keys()]);
  const imported = dashboard.detalle.filter((row) => importedIds.has(row.id));
  return {
    import_id: importId, received: normalized.length, inserted, updated, skipped,
    confirmed: imported.filter((row) => row.estado === 'Cese efectivo').length,
    pending: imported.filter((row) => row.estado === 'Pendiente de validación').length,
  };
};

export const saveHeadcountImport = async (rows: Record<string, unknown>[], actor: { uid: string; nombre: string }) => {
  const now = new Date().toISOString();
  const importId = `rotation-headcount-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const normalized = normalizeHeadcount(rows);
  const unique = new Map<string, typeof normalized[number]>();
  for (const row of normalized) {
    const previous = unique.get(row.id);
    if (previous && fingerprint(previous.raw) !== fingerprint(row.raw)) throw new Error('El archivo contiene versiones distintas de la misma persona y fecha de corte.');
    unique.set(row.id, row);
  }
  let inserted = 0; let updated = 0; let skipped = normalized.length - unique.size;
  await adminDb.runTransaction(async (transaction) => {
    for (const row of [...unique.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const ref = adminDb.collection('rotation_headcount_snapshots').doc(row.id);
      const existing = await transaction.get(ref);
      const previous = existing.exists ? existing.data() as RotationHeadcount : undefined;
      if (previous && fingerprint(previous.raw || {}) === fingerprint(row.raw)) { skipped += 1; continue; }
      transaction.set(ref, { ...row, imported_at: previous?.imported_at || now, imported_by: previous?.imported_by || actor.uid, updated_at: now, import_id: importId });
      if (previous) updated += 1; else inserted += 1;
    }
    transaction.set(adminDb.collection('rotation_imports').doc(importId), { id: importId, type: 'dotacion_actual', row_count: normalized.length, inserted, updated, skipped, imported_at: now, imported_by: actor.uid, imported_by_name: actor.nombre });
  });
  return { import_id: importId, received: normalized.length, inserted, updated, skipped };
};

const fingerprint = (raw: Record<string, unknown>) => hash('revision', Object.keys(raw).sort().map((name) => [name, raw[name]]));

const getHighs = (sessions: StoredRecord[], participants: StoredRecord[], attendance: StoredRecord[]): RotationHigh[] => {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const attendanceByParticipant = new Map<string, StoredRecord[]>();
  attendance.forEach((entry) => {
    const participantId = normalize(entry.participant_id);
    if (participantId) {
      const records = attendanceByParticipant.get(participantId) || [];
      records.push(entry); attendanceByParticipant.set(participantId, records);
    }
  });
  return participants.flatMap((participant) => {
    const session = sessionsById.get(normalize(participant.training_session_id));
    if (!session) return [];
    const campana = normalize(session.campana || session['campaña']);
    if (!isRotationCampaign(campana)) return [];
    const finalDay = getScheduledTrainingDays(campana);
    const records = (attendanceByParticipant.get(participant.id) || []).filter((record) => record.training_session_id === session.id && Number(record.dia) === finalDay && !record.isDeleted);
    const finalAttendance = records.sort((a, b) => normalize(b.updated_at || b.fecha_registro).localeCompare(normalize(a.updated_at || a.fecha_registro)))[0];
    if (!finalAttendance || !isPresent(finalAttendance.estado_asistencia) || participant.isDeleted || records.some((record) => normalize(record.updated_at || record.fecha_registro) === normalize(finalAttendance.updated_at || finalAttendance.fecha_registro) && !isPresent(record.estado_asistencia)) || (isFiveDayRotationCampaign(campana) && !isApto(participant.resultado_formacion))) return [];
    const fecha_alta = day(finalAttendance.fecha);
    const dni = normalize(participant.dni || participant.documento || participant.ce);
    const documento = documentKey(dni);
    if (!documento || !fecha_alta) return [];
    return [{ id: hash('rotation-high', [participant.id, session.id, fecha_alta]), documento, dni, nombre: normalize(`${participant.nombres || participant.nombre || ''} ${participant.apellidos || ''}`), campana, fecha_alta, participant_id: participant.id, session_id: session.id }];
  });
};

type Reconciled = RotationTermination & { estado: string; razon: string; permanencia_dias: number | null };
type Episode = RotationHigh & { exit?: Reconciled; ambiguous?: boolean };
const elapsedDays = (start: string, end: string) => Math.floor((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000);
const peruToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const namesMatch = (notificationName: string, formationName: string) => {
  const notified = key(notificationName);
  const formation = key(formationName);
  return !notified || !formation || notified === formation || notified.includes(formation) || formation.includes(notified);
};

const reconcile = (notifications: RotationTermination[], highs: RotationHigh[], cutoff: string) => {
  const episodes: Episode[] = [];
  const active = new Map<string, Episode>();
  const previous = new Map<string, Episode>();
  const rows: Reconciled[] = [];
  const events = [
    ...highs.map((high) => ({ date: high.fecha_alta, high, notification: undefined as RotationTermination | undefined })),
    ...notifications.map((notification) => ({ date: notification.fecha, notification, high: undefined as RotationHigh | undefined })),
  ].sort((a, b) => a.date.localeCompare(b.date) || Number(Boolean(b.high)) - Number(Boolean(a.high)) || (a.high?.id || a.notification!.id).localeCompare(b.high?.id || b.notification!.id));
  for (const event of events) {
    if (event.high) {
      if (event.date > cutoff) continue;
      const high = event.high;
      const current = active.get(high.documento);
      if (current) {
        // Another training is not proof of another employment or of a termination.
        if (high.source !== 'snapshot' && campaignKey(current.campana) !== campaignKey(high.campana)) current.ambiguous = true;
      } else {
        const episode = { ...high, source: high.source || 'formation' };
        episodes.push(episode); active.set(high.documento, episode); previous.set(high.documento, episode);
      }
      continue;
    }
    const source = event.notification!;
    const document = documentKey(source.dni);
    const current = active.get(document);
    const known = current || previous.get(document);
    const contractualStart = day(source.fecha_alta);
    const row: Reconciled = {
      ...source, nombre: source.nombre || known?.nombre || '',
      campana: known && !known.ambiguous ? known.campana : OTHER_CAMPAIGN,
      fecha_alta: contractualStart || known?.fecha_alta || source.fecha_alta,
      estado: 'Pendiente de validación', razon: source.validacion || '', permanencia_dias: null,
    };
    rows.push(row);
    if (event.date > cutoff) { row.razon = 'Fecha posterior al corte'; continue; }
    if (source.tipo === 'administrativo') { row.estado = 'Administrativo'; row.razon ||= 'No descuenta dotación'; continue; }
    if (!source.verificado || !day(source.fecha)) { row.razon ||= 'Notificación no verificada'; continue; }
    if (!known) { row.razon = 'Documento o fecha sin alta de Formación'; continue; }
    if (known.ambiguous) { row.razon = 'Más de una campaña sin cese intermedio: requiere validación'; continue; }
    if (!namesMatch(source.nombre, known.nombre)) {
      row.campana = OTHER_CAMPAIGN; row.razon = 'Nombre no coincide con el alta de Formación'; continue;
    }
    if (isRotationCampaign(source.campana_origen) && campaignKey(source.campana_origen) !== campaignKey(known.campana)) {
      row.campana = OTHER_CAMPAIGN; row.razon = 'Campaña notificada distinta de la última alta: requiere validación'; continue;
    }
    if (source.tipo === 'reingreso') {
      if (current) { row.estado = 'Reingreso ya activo'; row.razon = 'El documento ya tiene dotación activa'; continue; }
      const episode = { ...known, id: `reentry-${source.id}`, fecha_alta: source.fecha, exit: undefined };
      episodes.push(episode); active.set(document, episode); previous.set(document, episode);
      row.fecha_alta = source.fecha; row.estado = 'Reingreso'; row.razon = ''; continue;
    }
    if (!current) { row.razon = 'Cese ya conciliado; no hay un nuevo ingreso'; continue; }
    row.estado = 'Cese efectivo'; row.razon = ''; row.permanencia_dias = elapsedDays(contractualStart || current.fecha_inicio_laboral || current.fecha_alta, source.fecha);
    current.exit = row; active.delete(document);
  }
  return { episodes, rows };
};

const snapshotHighs = (snapshots: RotationHeadcount[], cutoff: string): RotationHigh[] => {
  const latest = new Map<string, RotationHeadcount>();
  for (const snapshot of snapshots) {
    const document = documentKey(snapshot.dni);
    if (!document || snapshot.fecha_corte > cutoff || !isRotationCampaign(snapshot.campana)) continue;
    const previous = latest.get(document);
    if (!previous || previous.fecha_corte < snapshot.fecha_corte || (previous.fecha_corte === snapshot.fecha_corte && normalize(previous.updated_at) < normalize(snapshot.updated_at))) latest.set(document, snapshot);
  }
  return [...latest.values()].map((snapshot) => ({ id: snapshot.id, documento: documentKey(snapshot.dni), dni: snapshot.dni, nombre: snapshot.nombre, campana: snapshot.campana, fecha_alta: snapshot.fecha_corte, fecha_inicio_laboral: snapshot.fecha_alta, participant_id: `snapshot-${snapshot.id}`, session_id: `snapshot-${snapshot.id}`, source: 'snapshot' }));
};

const isVisible = (row: { campana: string; fecha: string; dni?: string; nombre?: string }, filters: RotationFilters) =>
  (!filters.campaigns?.length || filters.campaigns.includes(row.campana)) && (!filters.months?.length || filters.months.includes(row.fecha.slice(0, 7))) &&
  isWithin(row.fecha, filters.from, filters.to) && (!filters.search || key(`${row.dni || ''} ${row.nombre || ''}`).includes(key(filters.search)));

export const buildRotationDashboard = (data: { sessions: StoredRecord[]; participants: StoredRecord[]; attendance: StoredRecord[]; terminations: RotationTermination[]; headcount?: RotationHeadcount[] }, filters: RotationFilters = {}, today = peruToday()) => {
  const formationHighs = getHighs(data.sessions, data.participants, data.attendance);
  const endOfMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  const cutoff = [today, filters.to, filters.months?.length ? endOfMonth([...filters.months].sort().at(-1)!) : undefined].filter((date): date is string => Boolean(date)).sort()[0];
  const highs = [...formationHighs, ...snapshotHighs(data.headcount || [], cutoff)];
  const { episodes, rows } = reconcile(data.terminations, highs, cutoff);
  const hasPeriod = (!filters.from || filters.from <= cutoff) && (!filters.months?.length || filters.months.some((month) => `${month}-01` <= cutoff && (!filters.from || endOfMonth(month) >= filters.from)));
  const identityFilters = { ...filters, months: undefined, from: undefined, to: undefined };
  const visibleHighs = hasPeriod ? episodes.filter((high) => isVisible({ ...high, fecha: high.fecha_alta }, identityFilters) && (!high.exit || isVisible(high.exit, { ...filters, campaigns: undefined, search: undefined }))) : [];
  const visibleCeses = visibleHighs.flatMap((high) => high.exit ? [high.exit] : []);
  const activeHighs = visibleHighs.filter((high) => !high.exit);
  const byCampaign = new Map<string, { campana: string; altas: number; dotacion: number; bajas: number }>();
  const itemFor = (campana: string) => byCampaign.get(campana) || { campana, altas: 0, dotacion: 0, bajas: 0 };
  visibleHighs.forEach((high) => { const item = itemFor(high.campana); item.altas += 1; byCampaign.set(high.campana, item); });
  activeHighs.forEach((high) => { const item = itemFor(high.campana); item.dotacion += 1; byCampaign.set(high.campana, item); });
  visibleCeses.forEach((termination) => { const item = itemFor(termination.campana); item.bajas += 1; byCampaign.set(termination.campana, item); });
  const count = (items: Array<{ name: string }>) => [...items.reduce((map, item) => map.set(item.name || 'Sin especificar', (map.get(item.name || 'Sin especificar') || 0) + 1), new Map<string, number>())].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const permanencia = visibleCeses.map((item) => item.permanencia_dias!);
  const bucket = (daysValue: number) => daysValue <= 7 ? '0-7 días' : daysValue <= 15 ? '8-15 días' : daysValue <= 30 ? '16-30 días' : daysValue <= 60 ? '31-60 días' : daysValue <= 90 ? '61-90 días' : 'Más de 90 días';
  const detail = rows.filter((item) => isVisible(item, filters));
  const other = detail.filter((item) => item.campana === OTHER_CAMPAIGN);
  const rate = (exits: number, population: number) => population ? Math.round(exits / population * 10000) / 100 : null;
  const motiveKeys = [...new Set(visibleCeses.map((item) => item.motivo || 'Sin especificar'))].sort();
  const monthly = new Map<string, Record<string, string | number>>();
  visibleCeses.forEach((item) => {
    const month = item.fecha.slice(0, 7); const row = monthly.get(month) || { date: month, bajas: 0 };
    const motive = item.motivo || 'Sin especificar'; row.bajas = Number(row.bajas) + 1; row[motive] = Number(row[motive] || 0) + 1;
    monthly.set(month, row);
  });
  return {
    terminations: visibleCeses, detalle: detail, pendientes: detail.filter((item) => item.estado === 'Pendiente de validación'), fecha_corte: cutoff,
    altas_historicas: visibleHighs.length, total_bajas: visibleCeses.length, total_dotacion: activeHighs.length,
    porcentaje_rotacion: rate(visibleCeses.length, visibleHighs.length),
    permanencia_promedio: permanencia.length ? Math.round(permanencia.reduce((sum, item) => sum + item, 0) / permanencia.length * 10) / 10 : null,
    funnel: { altas: visibleHighs.length, bajas: visibleCeses.length, dotacion: activeHighs.length },
    by_campaign: [...byCampaign.values()].map((item) => ({ ...item, porcentaje: rate(item.bajas, item.altas) })).sort((a, b) => a.campana.localeCompare(b.campana)),
    motivos: count(visibleCeses.map((item) => ({ name: item.motivo }))), descripciones: count(visibleCeses.filter((item) => /despido/.test(key(item.motivo))).map((item) => ({ name: item.descripcion }))),
    permanencia: [7, 15, 30, 60, 90, 91].map((limit) => ({ name: bucket(limit), value: permanencia.filter((days) => bucket(days) === bucket(limit)).length })),
    fechas: [...monthly.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))), motivo_keys: motiveKeys,
    otros: other,
    filter_options: { campaigns: [...new Set([...highs.map((high) => high.campana), ...rows.map((item) => item.campana)])].sort(), months: [...new Set([today.slice(0, 7), ...highs.map((high) => high.fecha_alta.slice(0, 7)), ...rows.map((item) => item.fecha.slice(0, 7))])].filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)).sort() },
  };
};

export const getRotationDashboard = async (filters: RotationFilters = {}) => {
  const [sessions, participants, attendance, notifications, legacy, headcount] = await Promise.all([read<StoredRecord>('sessions'), read<StoredRecord>('participants'), read<StoredRecord>('attendance'), read<RotationTermination & Row>('rotation_notifications'), read<StoredRecord>('rotation_terminations'), read<RotationHeadcount & Row>('rotation_headcount_snapshots')]);
  // Legacy imports remain read-only; new versions supersede their logical event in the view.
  const combined = new Map<string, RotationTermination>();
  for (const record of legacy) {
    const row = hydrateRotationTermination({
      id: record.id, fecha: day(record.fecha), fecha_alta: day(record.fecha_alta), campana: normalize(record.campana), campana_origen: normalize(record.campana), dni: normalize(record.dni), nombre: normalize(record.nombre), proveedor: normalize(record.proveedor), motivo: normalize(record.motivo), descripcion: normalize(record.descripcion), tipo: record.tipo === 'reingreso' || record.tipo === 'administrativo' ? record.tipo : 'cese', verificado: Boolean(record.verificado), validacion: normalize(record.validacion), raw: asRecord(record.raw), imported_at: normalize(record.imported_at), imported_by: normalize(record.imported_by), updated_at: normalize(record.updated_at),
    });
    combined.set(`${documentKey(row.dni) || key(row.nombre)}:${row.fecha}:${key(row.motivo)}`, row);
  }
  for (const stored of notifications.sort((a, b) => normalize(a.updated_at || a.imported_at).localeCompare(normalize(b.updated_at || b.imported_at)))) {
    const row = hydrateRotationTermination(stored);
    combined.set(`${documentKey(row.dni) || key(row.nombre)}:${row.fecha}:${key(row.motivo)}`, row);
  }
  return buildRotationDashboard({ sessions, participants, attendance, terminations: [...combined.values()], headcount }, filters);
};

export const getRotationRateForEvaluation = async (filters: { campaigns?: string[]; year: number; months: number[] }) => {
  const months = filters.months.map((month) => `${filters.year}-${String(month).padStart(2, '0')}`);
  const dashboard = await getRotationDashboard({ campaigns: filters.campaigns, months });
  if (!dashboard.total_dotacion) return { disponible: false, porcentaje: null, bajas: dashboard.total_bajas, dotacion: 0 };
  return { disponible: true, porcentaje: dashboard.porcentaje_rotacion, bajas: dashboard.total_bajas, dotacion: dashboard.total_dotacion };
};
