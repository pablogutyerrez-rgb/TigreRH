import * as XLSX from 'xlsx';

const key = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const documents = new Set(['dni', 'ce', 'dnice', 'documento', 'numerodocumento', 'numerodedocumento', 'numerodoc', 'nrodocumento', 'ndocumento']);
const dates = new Set(['fecha', 'cese', 'fechabaja', 'fechacese', 'fechadecese', 'fechadebaja', 'fechanotificacion', 'fechafin', 'fechainicio', 'fechainicioyfin', 'periodo', 'fechareingreso', 'fechaefectiva']);
const dateRange = (value: unknown) => String(value ?? '').match(/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/g) || [];
const isDateHeader = (value: unknown) => dates.has(key(value)) || (key(value).includes('fecha') && /(inicio|fin|periodo)/.test(key(value)));

export function parseRotationWorkbook(content: ArrayBuffer) {
  const workbook = XLSX.read(content, { type: 'array', cellDates: true });
  const name = workbook.SheetNames.find((sheetName) => sheetName.trim().toLowerCase() === 'notificaciones');
  if (!name) throw new Error('El archivo debe contener una hoja llamada Notificaciones.');
  {
    const sheet = workbook.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
    const headerRow = grid.findIndex((row) => row.some((cell) => documents.has(key(cell))) && row.some(isDateHeader));
    if (headerRow < 0) throw new Error('La hoja Notificaciones no contiene documento DNI/CE y fecha de inicio o fin.');
    const headers = grid[headerRow].map((cell) => String(cell).trim());
    const nonempty = headers.filter(Boolean).map(key);
    if (new Set(nonempty).size !== nonempty.length) throw new Error('Hay encabezados duplicados en la hoja de notificaciones.');
    const rows = grid.slice(headerRow + 1).flatMap((cells, index) => {
      if (cells.every((cell) => cell === '' || cell == null)) return [];
      const row: Record<string, unknown> = {};
      headers.forEach((header, column) => {
        if (!header) return;
        const cell = sheet[XLSX.utils.encode_cell({ r: headerRow + index + 1, c: column })];
        const value = cells[column] ?? '';
        row[header] = value instanceof Date
          ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
          : documents.has(key(header)) && cell ? XLSX.utils.format_cell(cell).trim() : value;
      });
      headers.forEach((header) => {
        if (!isDateHeader(header)) return;
        const range = dateRange(row[header]);
        if (range.length > 1) {
          row['Fecha inicio'] ||= range[0];
          row['Fecha fin'] ||= range.at(-1)!;
        }
      });
      return [row];
    });
    if (!rows.length) throw new Error('El archivo no contiene notificaciones.');
    if (rows.length > 20000) throw new Error('El máximo por carga es 20 000 notificaciones.');
    return rows;
  }
  throw new Error('La hoja Notificaciones no contiene documento DNI/CE y fecha de inicio o fin.');
}
