import { it, expect, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { readVisitorExcel } from './visitor-excel';
import i18n from '../../i18n';
afterEach(async () => {
  await i18n.changeLanguage('en');
});
async function workbookFile(headers: string[], rows: unknown[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Visitors');
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  const data = await book.xlsx.writeBuffer();
  return new File([new Uint8Array(data)], 'visitors.xlsx');
}
it('reads Vietnamese and English headers and keeps leading zeros in citizen IDs', async () => {
  const rows = [
    ['Synthetic A', '000000000001'],
    ['Synthetic B', '000000000002'],
  ];
  for (const headers of [
    ['Họ tên', 'Số CCCD'],
    ['Full name', 'Citizen ID number'],
  ]) {
    const people = await readVisitorExcel(await workbookFile(headers, rows));
    expect(people[0]).toEqual({ fullName: 'Synthetic A', identityNumber: '000000000001' });
    expect(people).toHaveLength(2);
  }
});
it('rejects duplicate IDs, incomplete rows, formulas, unsupported files, oversized files and missing headers', async () => {
  for (const rows of [
    [
      ['A', '000000000001'],
      ['B', '000000000001'],
    ],
    [
      ['A', '123'],
      ['B', '000000000002'],
    ],
    [
      ['A', { formula: '1+1', result: '000000000001' }],
      ['B', '000000000002'],
    ],
  ])
    await expect(
      readVisitorExcel(await workbookFile(['Full name', 'Citizen ID'], rows)),
    ).rejects.toThrow();
  await expect(readVisitorExcel(await workbookFile(['Name', 'Other'], []))).rejects.toThrow();
  await expect(readVisitorExcel(new File(['fake'], 'visitors.xls'))).rejects.toThrow();
  await expect(
    readVisitorExcel(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'visitors.xlsx')),
  ).rejects.toThrow();
});
it('reports workbook errors in the selected language', async () => {
  await i18n.changeLanguage('vi');
  await expect(readVisitorExcel(new File(['fake'], 'visitors.xls'))).rejects.toThrow('Chọn tệp');
});
