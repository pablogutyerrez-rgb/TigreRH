import { createHash } from 'node:crypto';
import { dataDb } from '../hybridDb.js';

type RawRow = Record<string, unknown>;
export type CommercialSheet = { name: string; headers: string[]; rows: RawRow[]; formulas: string[]; row_count: number };
export type CommercialImportInput = { campaign: 'Culqi' | 'Entel'; file: { name: string; mime: string; content_base64: string; sha256: string }; sheets: CommercialSheet[]; cutoff_date?: string };
export type CommercialFilters = { campaign?: string; year?: number; month?: number; from?: string; to?: string; supervisor?: string; executive?: string };

const norm = (value: unknown) => String(value ?? '').trim();
const key = (value: unknown) => norm(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const value = (row: RawRow, aliases: string[]) => Object.entries(row).find(([header]) => aliases.includes(key(header)))?.[1];
const text = (row: RawRow, aliases: string[]) => norm(value(row, aliases));
const numeric = (raw: unknown) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const parsed = Number(norm(raw).replace(/[^0-9,.-]/g, '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const date = (raw: unknown) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return new Date(Date.UTC(1899, 11, 30) + Math.round(raw * 86400000)).toISOString().slice(0, 10);
  const source = norm(raw); const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(source);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const latin = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(source);
  return latin ? `${latin[3]}-${latin[2].padStart(2, '0')}-${latin[1].padStart(2, '0')}` : '';
};

const terminalAliases = ['terminal', 'idterminal', 'codigoterminal', 'serial', 'nroterminal', 'numeroterminal', 'pos'];
const merchantAliases = ['comercio', 'merchant', 'ruc', 'idcomercio', 'codigocomercio', 'cliente'];
const dateAliases = ['fechaventa', 'fecha', 'fechaalta', 'fecharegistro', 'fechaactivacion'];
const gpvAliases = ['gpv', 'volumenprocesado', 'monto', 'importe', 'facturacion'];
const transactionAliases = ['transacciones', 'trx', 'cantidadtransacciones', 'numerotransacciones'];

export const inspectCommercialImport = (input: CommercialImportInput) => {
  const rows = input.sheets.flatMap((sheet) => sheet.rows.map((row, index) => ({ sheet: sheet.name, row, row_number: index + 2 })));
  const observed: Array<{ sheet: string; row: number; reason: string }> = [];
  const records = rows.flatMap((item) => {
    const terminal = text(item.row, terminalAliases); const merchant = text(item.row, merchantAliases); const saleDate = date(value(item.row, dateAliases));
    if (!terminal && !merchant) { if (Object.values(item.row).some((cell) => norm(cell))) observed.push({ sheet: item.sheet, row: item.row_number, reason: 'Sin identificador de comercio ni terminal.' }); return []; }
    if (!saleDate) { observed.push({ sheet: item.sheet, row: item.row_number, reason: 'Fecha comercial no verificable.' }); return []; }
    const gpv = numeric(value(item.row, gpvAliases)); const transactions = numeric(value(item.row, transactionAliases));
    const supervisor = text(item.row, ['supervisor', 'nombresupervisor', 'jefe']);
    const executive = text(item.row, ['ejecutivo', 'asesor', 'vendedor', 'nombreasesor', 'nombrecomercial']);
    const product = text(item.row, ['producto', 'tipoproducto', 'plan']);
    const terminalKey = terminal || merchant;
    const septemberRule = input.campaign === 'Culqi' && saleDate.startsWith('2026-09');
    const activation = septemberRule && gpv !== null && transactions !== null
      ? gpv >= 1000 && transactions >= 4
      : null;
    const postventa = gpv === null || transactions === null ? 'Pendiente de validación'
      : transactions === 0 ? 'Sin transacciones'
      : septemberRule && gpv < 1000 ? 'Con transacciones, pero GPV insuficiente'
      : septemberRule && transactions < 4 ? 'Con GPV suficiente, pero transacciones insuficientes'
      : activation ? 'Activadas' : 'Sin información suficiente';
    return [{ id: hash([input.campaign, saleDate, terminalKey, merchant]), campaign: input.campaign, sale_date: saleDate, terminal_id: terminal, merchant_id: merchant, supervisor, executive, product, gpv, transactions, activation, postventa, source_sheet: item.sheet, source_row: item.row_number, raw: item.row }];
  });
  const distinct = new Map(records.map((record) => [record.id, record]));
  const formulas = input.sheets.flatMap((sheet) => sheet.formulas.map((formula) => ({ sheet: sheet.name, formula })));
  const known = new Set(['BASE', 'BASE (1)', 'BASE (AN)', 'MESAS', 'SUPERVISOR', 'TERMINALES', 'VALIDAR', 'cargos']);
  const expectedSheets = input.campaign === 'Culqi' ? [...known].filter((name) => !input.sheets.some((sheet) => sheet.name === name)) : [];
  return {
    records: [...distinct.values()], observed, duplicates: records.length - distinct.size,
    inspection: { sheets: input.sheets.map((sheet) => ({ name: sheet.name, headers: sheet.headers, rows: sheet.row_count, formulas: sheet.formulas.length })), formulas, expected_sheets_missing: expectedSheets, external_formula_references: formulas.filter(({ formula }) => /\[[^\]]+\]/.test(formula)), errors: rows.filter(({ row }) => Object.values(row).some((cell) => /^#(N\/A|REF!|VALUE!|DIV\/0!)/i.test(norm(cell)))).length },
  };
};

const list = async <T extends RawRow>(collection: string) => (await dataDb.collection(collection).get()).docs.map((document) => ({ id: document.id, ...document.data() }) as unknown as T);

export const saveCommercialImport = async (input: CommercialImportInput, actor: { uid: string; nombre: string }) => {
  const analysis = inspectCommercialImport(input); const importId = `commercial-import-${Date.now()}-${input.file.sha256.slice(0, 8)}`; const now = new Date().toISOString();
  let inserted = 0; let updated = 0;
  await dataDb.runTransaction(async (transaction) => {
    const duplicateFile = await transaction.get(dataDb.collection('commercial_imports').doc(input.file.sha256));
    if (duplicateFile.exists) throw new Error('Este archivo ya fue importado.');
    for (const record of analysis.records) {
      const ref = dataDb.collection('commercial_records').doc(record.id); const existing = await transaction.get(ref);
      existing.exists ? updated += 1 : inserted += 1;
      transaction.set(ref, { ...record, updated_at: now, latest_import_id: importId }, { merge: true });
      transaction.set(dataDb.collection('commercial_import_records').doc(`${importId}-${record.id}`), { ...record, import_id: importId, saved_at: now });
    }
    transaction.set(dataDb.collection('commercial_files').doc(input.file.sha256), { ...input.file, id: input.file.sha256, imported_at: now, imported_by: actor.uid });
    transaction.set(dataDb.collection('commercial_imports').doc(input.file.sha256), { id: input.file.sha256, import_id: importId, campaign: input.campaign, cutoff_date: input.cutoff_date || '', imported_at: now, imported_by: actor.uid, imported_by_name: actor.nombre, analysis: { ...analysis, records: undefined }, inserted, updated });
    analysis.observed.forEach((observation, index) => transaction.set(dataDb.collection('commercial_observations').doc(`${importId}-${index}`), { ...observation, import_id: importId, created_at: now }));
  });
  return { import_id: importId, ...analysis, inserted, updated };
};

export const getCommercialDashboard = async (filters: CommercialFilters = {}) => {
  const all = await list<any>('commercial_records');
  const records = all.filter((record) => {
    const saleDate = norm(record.sale_date); const match = (field: string, expected?: string) => !expected || norm(record[field]) === expected;
    return match('campaign', filters.campaign) && (!filters.year || saleDate.startsWith(`${filters.year}-`)) && (!filters.month || saleDate.slice(5, 7) === String(filters.month).padStart(2, '0')) && (!filters.from || saleDate >= filters.from) && (!filters.to || saleDate <= filters.to) && match('supervisor', filters.supervisor) && match('executive', filters.executive);
  });
  const culqi = records.filter((record) => record.campaign === 'Culqi');
  const terminals = new Set(culqi.map((record) => record.terminal_id).filter(Boolean)); const merchants = new Set(culqi.map((record) => record.merchant_id).filter(Boolean));
  const activated = culqi.filter((record) => record.activation === true); const validActivation = culqi.filter((record) => record.activation !== null);
  const group = (source: any[], field: string, keyFor = (record: any) => norm(record[field]) || 'Sin dato') => [...source.reduce((map, record) => { const name = keyFor(record); const item = map.get(name) || { name, ventas: 0, gpv: 0, transacciones: 0 }; item.ventas += 1; item.gpv += Number(record.gpv || 0); item.transacciones += Number(record.transactions || 0); map.set(name, item); return map; }, new Map<string, any>()).values()].sort((a, b) => b.ventas - a.ventas);
  const monday = (record: any) => { const source = new Date(`${record.sale_date}T00:00:00Z`); source.setUTCDate(source.getUTCDate() - ((source.getUTCDay() + 6) % 7)); return source.toISOString().slice(0, 10); };
  return { records, kpis: { terminales_vendidas: terminals.size, comercios_unicos: merchants.size, terminales_activadas: activated.length, terminales_pendientes: validActivation.length - activated.length, porcentaje_activacion: validActivation.length ? Math.round(activated.length / validActivation.length * 10000) / 100 : null, gpv: culqi.reduce((sum, record) => sum + Number(record.gpv || 0), 0), transacciones: culqi.reduce((sum, record) => sum + Number(record.transactions || 0), 0) }, by_supervisor: group(culqi, 'supervisor'), by_ejecutivo: group(culqi, 'executive'), by_month: group(culqi, 'sale_date', (record) => norm(record.sale_date).slice(0, 7)), by_week: group(culqi, 'sale_date', monday).sort((a, b) => a.name.localeCompare(b.name)), postventa: group(culqi, 'postventa'), entel_pending: !records.some((record) => record.campaign === 'Entel') };
};
