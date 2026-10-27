import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { parseRotationWorkbook } from './rotationWorkbook';
import { normalizeTerminations } from '../../backend/src/services/rotationService';

test('Notificaciones Excel round-trip preserves document zeros, dates, long descriptions and sheet selection', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Summary'], [23]]), 'Resumen');
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Notificaciones de personal'], [],
    ['DNI/CE', 'Nombres y apellidos', 'Fecha de cese', 'Motivo', 'Descripción', 'Proveedor'],
    [130365, 'Ana', new Date(2026, 9, 20), 'Renuncia', 'Detalle completo '.repeat(100), 'Proveedor'],
    ['CE123456', 'Bruno', new Date(2026, 9, 21), 'Despido', 'Descripción completa', 'Otro'],
  ]);
  sheet.A4.z = '00000000';
  XLSX.utils.book_append_sheet(workbook, sheet, 'Notificaciones');
  const rows = parseRotationWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['DNI/CE'], '00130365');
  const normalized = normalizeTerminations(rows);
  assert.equal(normalized[0].fecha, '2026-10-20');
  assert.equal(normalized[1].dni, 'CE123456');
  assert.equal(normalized[0].descripcion, 'Detalle completo '.repeat(100).trim());
  assert.equal(normalized[0].proveedor, 'Proveedor');
});

test('rejects missing and duplicate headers rather than dropping data', () => {
  for (const grid of [[['Nombre'], ['Ana']], [['DNI', 'DNI', 'Cese'], ['1', '2', '20/10/2026']]]) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), 'Notificaciones');
    assert.throws(() => parseRotationWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));
  }
});
