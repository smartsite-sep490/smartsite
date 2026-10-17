import type { VisitorMemberInput } from '@smartsite/contracts';
import { translate } from '../../i18n';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
export async function readVisitorExcel(file: File): Promise<VisitorMemberInput[]> {
  if (!/\.xlsx$/i.test(file.name) || file.size > 2 * 1024 * 1024)
    throw new Error(translate('visitor.importFile'));
  const { Workbook } = (await import('exceljs')).default;
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error(translate('visitor.importInvalid'));
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(translate('visitor.importInvalid'));
  const headers = sheet.getRow(1);
  let nameColumn = 0,
    idColumn = 0;
  headers.eachCell((cell, col) => {
    const header = normalize(cell.text);
    if (['ho ten', 'full name', 'fullname'].includes(header)) nameColumn = col;
    if (['so cccd', 'cccd', 'citizen id', 'citizen id number', 'identity number'].includes(header))
      idColumn = col;
  });
  if (!nameColumn || !idColumn) throw new Error(translate('visitor.importHeaders'));
  if (sheet.rowCount > 1001) throw new Error(translate('visitor.importRows'));
  const members: VisitorMemberInput[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const name = row.getCell(nameColumn),
      id = row.getCell(idColumn);
    if (!name.text.trim() && !id.text.trim()) return;
    // Never evaluate formulas or use cached formula results as personal identities.
    if (
      (typeof name.value === 'object' && name.value !== null) ||
      (typeof id.value === 'object' && id.value !== null) ||
      !name.text.trim() ||
      name.text.trim().length > 255 ||
      !/^\d{12}$/.test(id.text.trim())
    )
      throw new Error(translate('visitor.importRow', { row: index }));
    members.push({ fullName: name.text.trim(), identityNumber: id.text.trim() });
  });
  if (members.length < 2 || members.length > 1000) throw new Error(translate('visitor.importRows'));
  if (new Set(members.map((m) => m.identityNumber)).size !== members.length)
    throw new Error(translate('visitor.duplicate'));
  return members;
}
export async function downloadVisitorTemplate() {
  const { Workbook } = (await import('exceljs')).default;
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(translate('visitor.members'));
  sheet.columns = [
    { header: translate('visitor.fullName'), key: 'name', width: 35 },
    { header: translate('visitor.identityNumber'), key: 'id', width: 24 },
  ];
  sheet.getColumn(2).numFmt = '@';
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'smartsite-visitors.xlsx';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
