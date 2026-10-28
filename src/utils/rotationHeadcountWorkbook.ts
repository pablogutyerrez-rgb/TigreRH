import * as XLSX from 'xlsx';

const key = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const documentHeaders = new Set(['dni', 'ce', 'dnice', 'documento', 'numerodocumento', 'numerodedocumento', 'numerodoc', 'nrodocumento', 'ndocumento']);
const dateHeaders = new Set(['fechacorte', 'fechadecorte', 'asof', 'fechaactualizacion', 'fechavigencia', 'fecha']);
const startDateHeaders = new Set(['fechainicio', 'fechadeinicio', 'fechaingreso', 'fechadeingreso', 'fechaalta', 'fechadealta']);

export function parseHeadcountWorkbook(content: ArrayBuffer, cutoff?: string) {
  const workbook = XLSX.read(content, { type: 'array', cellDates: true });
  const source = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
    const headerRow = grid.findIndex((row) => row.some((cell) => documentHeaders.has(key(cell))) && (row.some((cell) => dateHeaders.has(key(cell))) || Boolean(cutoff) && row.some((cell) => startDateHeaders.has(key(cell)))));
    return { sheet, grid, headerRow };
  }).find((candidate) => candidate.headerRow >= 0);
  if (!source) throw new Error(cutoff ? 'El archivo debe incluir DNI/CE y Fecha de inicio.' : 'El archivo debe incluir una hoja con DNI/CE y Fecha de corte.');
  const { sheet, grid, headerRow } = source;
  const headers = grid[headerRow].map((cell) => String(cell).trim());
  const normalized = headers.filter(Boolean).map(key);
  if (new Set(normalized).size !== normalized.length) throw new Error('Hay encabezados duplicados en la hoja de dotación.');
  const rows = grid.slice(headerRow + 1).flatMap((cells, index) => {
    if (cells.every((cell) => cell === '' || cell == null)) return [];
    const row: Record<string, unknown> = {};
    headers.forEach((header, column) => {
      if (!header) return;
      const cell = sheet[XLSX.utils.encode_cell({ r: headerRow + index + 1, c: column })];
      const value = cells[column] ?? '';
      row[header] = value instanceof Date
        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
        : documentHeaders.has(key(header)) && cell ? XLSX.utils.format_cell(cell).trim() : value;
    });
    if (cutoff && !headers.some((header) => dateHeaders.has(key(header)))) row['FECHA DE CORTE'] = cutoff;
    return [row];
  });
  if (!rows.length) throw new Error('El archivo no contiene personas activas.');
  if (rows.length > 20_000) throw new Error('El máximo por carga es 20 000 personas activas.');
  return rows;
}
