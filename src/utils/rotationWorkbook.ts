import * as XLSX from 'xlsx';

const key = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const documents = new Set(['dni', 'ce', 'dnice', 'documento', 'numerodocumento', 'numerodedocumento', 'numerodoc', 'nrodocumento', 'ndocumento']);
const dates = new Set(['fecha', 'cese', 'fechabaja', 'fechacese', 'fechadecese', 'fechadebaja', 'fechanotificacion', 'fechafin', 'fechareingreso', 'fechaefectiva']);

export function parseRotationWorkbook(content: ArrayBuffer) {
  const workbook = XLSX.read(content, { type: 'array', cellDates: true });
  const named = workbook.SheetNames.filter((name) => /^(notificaciones|base)$/i.test(name.trim()));
  const candidates = named.length ? named.sort((a) => a.trim().toLowerCase() === 'notificaciones' ? -1 : 1) : workbook.SheetNames;
  for (const name of candidates) {
    const sheet = workbook.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
    const headerRow = grid.findIndex((row) => row.some((cell) => documents.has(key(cell))) && row.some((cell) => dates.has(key(cell))));
    if (headerRow < 0) continue;
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
      return [row];
    });
    if (!rows.length) throw new Error('El archivo no contiene notificaciones.');
    if (rows.length > 20000) throw new Error('El máximo por carga es 20 000 notificaciones.');
    return rows;
  }
  throw new Error('No se encontró una hoja con documento DNI/CE y fecha del movimiento.');
}
