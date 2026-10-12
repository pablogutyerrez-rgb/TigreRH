import { createHash } from 'node:crypto';
import { dataDb } from '../hybridDb.js';

type RawRow = Record<string, unknown>;
export type CommercialSheet = { name: string; headers: string[]; rows: RawRow[]; formulas: string[]; row_count: number };
export type CommercialImportInput = { campaign: 'Culqi' | 'Entel'; file: { name: string; mime: string; content_base64: string; sha256: string }; sheets: CommercialSheet[]; cutoff_date?: string };
export type CommercialFilters = { campaign?: string; year?: number; month?: number; from?: string; to?: string; supervisor?: string; mesa?: string; sede?: string; category?: string; executive?: string; product?: string; client_classification?: string; criterion?: string };

const AUTHORIZED_SHEETS = ['BASE', 'BASE (AN)', 'MESAS', 'SUPERVISOR', 'TERMINALES', 'cargos'];
const SOURCE_SHEETS = new Set(['BASE', 'BASE (AN)']);
const norm = (value: unknown) => String(value ?? '').trim();
const key = (value: unknown) => norm(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const value = (row: RawRow, aliases: string[]) => Object.entries(row).find(([header]) => aliases.includes(key(header)))?.[1];
const text = (row: RawRow, aliases: string[]) => norm(value(row, aliases));
const numeric = (raw: unknown) => { if (typeof raw === 'number' && Number.isFinite(raw)) return raw; const parsed = Number(norm(raw).replace(/[^0-9,.-]/g, '').replace(/,/g, '')); return Number.isFinite(parsed) ? parsed : null; };
const date = (raw: unknown) => {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'number' && Number.isFinite(raw)) return new Date(Date.UTC(1899, 11, 30) + Math.round(raw * 86400000)).toISOString().slice(0, 10);
  const source = norm(raw); const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(source); if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const latin = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(source); return latin ? `${latin[3]}-${latin[2].padStart(2, '0')}-${latin[1].padStart(2, '0')}` : '';
};
const present = (item: unknown) => item !== null && item !== undefined && norm(item) !== '';
const bool = (raw: unknown): boolean | null => { const item = key(raw); if (!item) return null; if (['si', 'yes', 'true', '1', 'activo', 'activada', 'activado'].includes(item)) return true; if (['no', 'false', '0', 'inactivo', 'pendiente'].includes(item)) return false; return null; };
const metric = (row: RawRow, prefixes: string[], period: string) => numeric(value(row, prefixes.flatMap((prefix) => period === '0' ? [prefix, `${prefix}0`, `${prefix}m0`, `${prefix}mes0`] : [`${prefix}${period}`, `${prefix}m${period}`, `${prefix}mes${period}`])));
const activation = (record: RawRow, criterion = '4') => {
  const explicit = bool(record.activation_source); if (explicit !== null) return explicit;
  if (key(record.product) !== 'culqifull') return null;
  const gpv = Number(record.gpv); const transactions = Number(record.transactions); if (!Number.isFinite(gpv) || !Number.isFinite(transactions)) return null;
  return gpv >= 1000 && transactions >= (criterion === '3' ? 3 : 4);
};
const recordFingerprint = (record: RawRow) => hash({ ...record, source_rows: undefined, raw: undefined, updated_at: undefined, latest_import_id: undefined, fingerprint: undefined });

const makeRecord = (campaign: string, item: { sheet: string; row: RawRow; row_number: number }) => {
  const serial = text(item.row, ['serial', 'numerodeserie', 'numserie', 'nroserie', 'terminal', 'idterminal', 'codigoterminal', 'nroterminal', 'pos']);
  const operation = text(item.row, ['idoperacion', 'idcomercial', 'idlink', 'codigolink', 'idventa']);
  const merchant = text(item.row, ['idcomercio', 'idmerchant', 'merchant', 'codigocomercio', 'comercio', 'cliente']); const saleDate = date(value(item.row, ['fechaventa', 'fecha', 'fechaalta', 'fecharegistro'])); const product = text(item.row, ['producto', 'tipoproducto', 'plan', 'modelo']) || (campaign === 'Culqi' ? 'CulqiFull' : '');
  const identity = serial ? `serial:${key(serial)}` : operation ? `operation:${key(operation)}` : key(product) === 'culqilink' && merchant ? `merchant:${key(merchant)}` : ''; if (!identity || !saleDate) return null;
  const recordKey = hash([campaign, key(product), identity, saleDate]);
  const record: RawRow = {
    id: recordKey, record_key: recordKey, campaign, sale_date: saleDate, year: Number(saleDate.slice(0, 4)), month: Number(saleDate.slice(5, 7)), terminal_id: serial, operation_id: operation, merchant_id: merchant,
    ruc: text(item.row, ['ruc', 'documento', 'numerodocumento']), commerce: text(item.row, ['nombrecomercio', 'razonsocial', 'comercio']), product, client_classification: text(item.row, ['clasificacioncliente', 'clienteclasificacion', 'cliente', 'tipo']),
    supervisor: text(item.row, ['supervisor', 'nombresupervisor', 'jefe', 'jefatura']), executive: text(item.row, ['ejecutivo', 'asesor', 'vendedor', 'nombreasesor', 'nombrecomercial']), mesa: text(item.row, ['mesa', 'mesaventa']), sede: text(item.row, ['sede', 'ciudad', 'oficina']), category: text(item.row, ['categoria', 'segmento']),
    gpv: metric(item.row, ['gpv', 'volumenprocesado', 'monto', 'importe', 'facturacion'], '0'), transactions: metric(item.row, ['transacciones', 'trx', 'cantidadtransacciones', 'numerotransacciones'], '0'),
    gpv_m1: metric(item.row, ['gpv', 'volumenprocesado', 'monto', 'importe'], '1'), gpv_m2: metric(item.row, ['gpv', 'volumenprocesado', 'monto', 'importe'], '2'), gpv_m3: metric(item.row, ['gpv', 'volumenprocesado', 'monto', 'importe'], '3'),
    transactions_m1: metric(item.row, ['transacciones', 'trx', 'cantidadtransacciones'], '1'), transactions_m2: metric(item.row, ['transacciones', 'trx', 'cantidadtransacciones'], '2'), transactions_m3: metric(item.row, ['transacciones', 'trx', 'cantidadtransacciones'], '3'),
    activation_source: text(item.row, ['activacion', 'estadoactivacion', 'activo']), activation_date: date(value(item.row, ['fechaactivacion', 'activadoel'])), source_rows: [{ sheet: item.sheet, row: item.row_number }], raw: item.row,
  };
  record.activation = activation(record);
  record.postventa = record.transactions === null ? 'Pendiente de validación' : Number(record.transactions) === 0 ? 'Sin transacciones' : record.activation === true ? 'Activadas' : record.activation === false ? 'Pendiente de activación' : 'Sin regla verificable';
  return record;
};
const mergeRecord = (base: RawRow, next: RawRow) => {
  const merged: RawRow = { ...base }; Object.entries(next).forEach(([field, entry]) => { if (present(entry) && field !== 'source_rows' && field !== 'raw') merged[field] = entry; });
  merged.source_rows = [...(Array.isArray(base.source_rows) ? base.source_rows : []), ...(Array.isArray(next.source_rows) ? next.source_rows : [])]; merged.raw = { ...((base.raw as RawRow) || {}), ...((next.raw as RawRow) || {}) }; merged.activation = activation(merged); return merged;
};
const enrichRecord = (record: RawRow, terminal?: RawRow, cargo?: RawRow) => {
  const enriched: RawRow = { ...record };
  const fill = (field: string, row: RawRow | undefined, aliases: string[]) => { if (!present(enriched[field]) && row) { const candidate = text(row, aliases); if (candidate) enriched[field] = candidate; } };
  fill('merchant_id', terminal, ['idcomercio', 'merchant', 'codigocomercio', 'comercio']); fill('ruc', terminal, ['ruc', 'documento', 'numerodocumento']); fill('commerce', terminal, ['nombrecomercio', 'razonsocial', 'comercio']);
  fill('supervisor', cargo, ['supervisor', 'nombresupervisor', 'jefe', 'jefatura']); fill('mesa', cargo, ['mesa', 'mesaventa']); fill('sede', cargo, ['sede', 'ciudad', 'oficina']); fill('category', cargo, ['categoria', 'segmento']);
  enriched.activation = activation(enriched); return enriched;
};

export const inspectCommercialImport = (input: CommercialImportInput) => {
  const sheets = input.sheets.filter((sheet) => AUTHORIZED_SHEETS.includes(sheet.name)); const sourceSheets = sheets.filter((sheet) => SOURCE_SHEETS.has(sheet.name));
  if (input.campaign === 'Culqi' && sourceSheets.length === 0) throw new Error('El archivo debe incluir BASE o BASE (AN) para consolidar operaciones comerciales.');
  const observed: Array<{ sheet: string; row: number; reason: string }> = []; const recordsByKey = new Map<string, RawRow>(); let repeatedRows = 0;
  sourceSheets.forEach((sheet) => sheet.rows.forEach((row, index) => {
    if (!Object.values(row).some((cell) => present(cell))) return; const record = makeRecord(input.campaign, { sheet: sheet.name, row, row_number: index + 2 });
    if (!record) { observed.push({ sheet: sheet.name, row: index + 2, reason: 'Falta una fecha de venta o identificador comercial estable (serial o id de operación).' }); return; }
    const current = recordsByKey.get(String(record.record_key)); if (current) { repeatedRows += 1; recordsByKey.set(String(record.record_key), mergeRecord(current, record)); } else recordsByKey.set(String(record.record_key), record);
  }));
  const terminalIndex = new Map<string, RawRow>();
  (sheets.find((sheet) => sheet.name === 'TERMINALES')?.rows || []).forEach((row) => { const id = key(text(row, ['serial', 'numerodeserie', 'numserie', 'nroserie', 'terminal', 'idterminal', 'codigoterminal'])); if (id) terminalIndex.set(id, row); });
  const cargoIndex = new Map<string, RawRow>();
  (sheets.find((sheet) => sheet.name === 'cargos')?.rows || []).forEach((row) => { const id = key(text(row, ['ejecutivo', 'asesor', 'vendedor', 'nombreasesor', 'nombrecomercial'])); if (id) cargoIndex.set(id, row); });
  recordsByKey.forEach((record, recordKey) => recordsByKey.set(recordKey, enrichRecord(record, terminalIndex.get(key(record.terminal_id)), cargoIndex.get(key(record.executive)))));
  const formulas = sheets.flatMap((sheet) => sheet.formulas.map((formula) => ({ sheet: sheet.name, formula })));
  const missing = AUTHORIZED_SHEETS.filter((name) => !sheets.some((sheet) => sheet.name === name));
  const errors = sourceSheets.reduce((total, sheet) => total + sheet.rows.filter((row) =>
    Object.values(row).some((cell) => /^#(N\/A|REF!|VALUE!|DIV\/0!)/i.test(norm(cell))),
  ).length, 0);
  return { records: [...recordsByKey.values()], observed, duplicates: repeatedRows, inspection: { sheets: sheets.map((sheet) => ({ name: sheet.name, headers: sheet.headers, rows: sheet.row_count, formulas: sheet.formulas.length })), ignored_sheets: input.sheets.filter((sheet) => !AUTHORIZED_SHEETS.includes(sheet.name)).map((sheet) => sheet.name), expected_sheets_missing: missing, formulas, external_formula_references: formulas.filter(({ formula }) => /\[[^\]]+\]/.test(formula)), errors } };
};

const list = async <T extends RawRow>(collection: string) => (await dataDb.collection(collection).get()).docs.map((document) => ({ id: document.id, ...document.data() }) as unknown as T);
const changedFields = (before: RawRow, after: RawRow) => Object.keys(after).filter((field) => !['raw', 'source_rows', 'updated_at', 'latest_import_id', 'fingerprint'].includes(field) && JSON.stringify(before[field]) !== JSON.stringify(after[field]));
const mergeForPersistence = (before: RawRow, incoming: RawRow) => {
  const merged: RawRow = { ...before };
  Object.entries(incoming).forEach(([field, entry]) => {
    if (field === 'source_rows' || field === 'raw' || present(entry) || !present(before[field])) merged[field] = entry;
  });
  return merged;
};

export const saveCommercialImport = async (input: CommercialImportInput, actor: { uid: string; nombre: string }) => {
  const analysis = inspectCommercialImport(input); const importId = `commercial-import-${Date.now()}-${input.file.sha256.slice(0, 8)}`; const now = new Date().toISOString(); let inserted = 0; let updated = 0; let unchanged = 0;
  await dataDb.runTransaction(async (transaction) => {
    const duplicateFile = await transaction.get(dataDb.collection('commercial_imports').doc(input.file.sha256)); if (duplicateFile.exists) throw new Error('Este archivo ya fue importado.');
    for (const record of analysis.records) {
      const ref = dataDb.collection('commercial_records').doc(String(record.record_key)); const existing = await transaction.get(ref); const before = existing.exists ? existing.data() as RawRow : undefined; const persisted = before ? mergeForPersistence(before, record) : record; const fingerprint = recordFingerprint(persisted);
      if (!before) { inserted += 1; transaction.set(ref, { ...persisted, fingerprint, created_at: now, updated_at: now, latest_import_id: importId }); }
      else if (before.fingerprint !== fingerprint) { updated += 1; const fields = changedFields(before, persisted); transaction.set(ref, { ...persisted, fingerprint, updated_at: now, latest_import_id: importId }, { merge: true }); transaction.set(dataDb.collection('commercial_changes').doc(`${importId}-${record.record_key}`), { id: `${importId}-${record.record_key}`, import_id: importId, record_key: record.record_key, changed_fields: fields, before: Object.fromEntries(fields.map((field) => [field, before[field]])), after: Object.fromEntries(fields.map((field) => [field, persisted[field]])), created_at: now }); }
      else unchanged += 1;
      transaction.set(dataDb.collection('commercial_import_records').doc(`${importId}-${record.record_key}`), { ...record, import_id: importId, saved_at: now });
    }
    transaction.set(dataDb.collection('commercial_files').doc(input.file.sha256), { id: input.file.sha256, name: input.file.name, mime: input.file.mime, imported_at: now, imported_by: actor.uid });
    transaction.set(dataDb.collection('commercial_imports').doc(input.file.sha256), { id: input.file.sha256, import_id: importId, campaign: input.campaign, cutoff_date: input.cutoff_date || '', imported_at: now, imported_by: actor.uid, imported_by_name: actor.nombre, analysis: { ...analysis, records: undefined }, inserted, updated, unchanged });
    analysis.observed.forEach((observation, index) => transaction.set(dataDb.collection('commercial_observations').doc(`${importId}-${index}`), { ...observation, import_id: importId, created_at: now }));
  });
  const periods = [...new Set(analysis.records.map((record) => String(record.sale_date).slice(0, 7)).filter(Boolean))].sort(); return { import_id: importId, ...analysis, inserted, updated, unchanged, observed: analysis.observed.length, rejected: 0, persisted: inserted + updated, periods };
};

const group = (records: RawRow[], field: string, criterion: string, name = (record: RawRow) => norm(record[field]) || 'Sin dato') => [...records.reduce((map, record) => {
  const label = name(record); const item = map.get(label) || { name: label, ventas: 0, activadas: 0, pendientes: 0, gpv: 0, transacciones: 0, comercios: new Set<string>() }; const active = activation(record, criterion);
  item.ventas += 1; if (active === true) item.activadas += 1; if (active === false) item.pendientes += 1; if (record.gpv !== null) item.gpv += Number(record.gpv || 0); if (record.transactions !== null) item.transacciones += Number(record.transactions || 0); if (record.merchant_id) item.comercios.add(String(record.merchant_id)); map.set(label, item); return map;
}, new Map<string, any>()).values()].map((item) => ({ ...item, comercios: item.comercios.size, activacion: item.ventas ? Math.round(item.activadas / item.ventas * 10000) / 100 : null })).sort((left, right) => right.ventas - left.ventas);

export const getCommercialDashboard = async (filters: CommercialFilters = {}) => {
  const all = await list<any>('commercial_records'); const criterion = filters.criterion || '4'; const records = all.filter((record) => {
    const saleDate = norm(record.sale_date); const match = (field: string, expected?: string) => !expected || norm(record[field]) === expected;
    return match('campaign', filters.campaign) && (!filters.year || saleDate.startsWith(`${filters.year}-`)) && (!filters.month || saleDate.slice(5, 7) === String(filters.month).padStart(2, '0')) && (!filters.from || saleDate >= filters.from) && (!filters.to || saleDate <= filters.to) && match('supervisor', filters.supervisor) && match('mesa', filters.mesa) && match('sede', filters.sede) && match('category', filters.category) && match('executive', filters.executive) && match('product', filters.product) && match('client_classification', filters.client_classification);
  });
  const culqi = records.filter((record) => record.campaign === 'Culqi'); const terminals = new Set(culqi.map((record) => record.terminal_id || record.operation_id).filter(Boolean)); const merchants = new Set(culqi.map((record) => record.merchant_id || record.ruc).filter(Boolean)); const activations = culqi.map((record) => activation(record, criterion)); const active = activations.filter((item) => item === true).length; const measurable = activations.filter((item) => item !== null).length;
  const options = (field: string) => [...new Set(all.filter((record) => !filters.campaign || record.campaign === filters.campaign).map((record) => norm(record[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  return { records: culqi, kpis: { terminales_vendidas: terminals.size, comercios_unicos: merchants.size, terminales_activadas: active, terminales_pendientes: measurable - active, porcentaje_activacion: measurable ? Math.round(active / measurable * 10000) / 100 : null, gpv: culqi.reduce((sum, record) => sum + (record.gpv === null ? 0 : Number(record.gpv || 0)), 0), transacciones: culqi.reduce((sum, record) => sum + (record.transactions === null ? 0 : Number(record.transactions || 0)), 0) }, by_mesa: group(culqi, 'mesa', criterion), by_supervisor: group(culqi, 'supervisor', criterion), by_ejecutivo: group(culqi, 'executive', criterion), by_month: group(culqi, 'sale_date', criterion, (record) => norm(record.sale_date).slice(0, 7)).sort((left, right) => left.name.localeCompare(right.name)), by_week: group(culqi, 'sale_date', criterion, (record) => { const value = new Date(`${record.sale_date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7)); return value.toISOString().slice(0, 10); }).sort((left, right) => left.name.localeCompare(right.name)), postventa: group(culqi, 'postventa', criterion, (record) => activation(record, criterion) === true ? 'Activadas' : activation(record, criterion) === false ? 'Pendientes de activación' : 'Sin regla verificable'), alerts: { sin_supervisor: culqi.filter((record) => !norm(record.supervisor)).length, sin_serial: culqi.filter((record) => !norm(record.terminal_id)).length, sin_fecha_activacion: culqi.filter((record) => !norm(record.activation_date)).length }, options: { years: options('year'), months: options('month'), supervisors: options('supervisor'), mesas: options('mesa'), sedes: options('sede'), categories: options('category'), executives: options('executive'), products: options('product'), client_classifications: options('client_classification') }, entel_pending: !all.some((record) => record.campaign === 'Entel') };
};
