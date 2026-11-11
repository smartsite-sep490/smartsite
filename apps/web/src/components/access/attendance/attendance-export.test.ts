import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import type { AttendanceExportResponse } from '@smartsite/contracts';
import i18n from '../../../i18n';
import { createAttendanceExport } from './attendance-export';

const report: AttendanceExportResponse = {
  siteId: 'site-1',
  siteName: 'Công trường mẫu',
  fromDate: '2026-11-01',
  toDate: '2026-11-07',
  timezone: 'Asia/Ho_Chi_Minh',
  today: '2026-11-11',
  asOf: '2026-11-11T01:00:00Z',
  total: 1,
  items: [
    {
      workerId: 'worker-1',
      workerCode: '000001',
      workerName: 'Nguyễn Văn Bình',
      contractorId: 'contractor-1',
      todayStatus: 'PRESENT',
      todayFirstCheckInAt: null,
      todayLastCheckOutAt: null,
      totalMinutes: 3001,
      regularMinutes: 2880,
      overtimeMinutes: 121,
      provisionalMinutes: 90,
      confirmedDays: 6,
      requiredDays: 6,
      presentDays: 5,
      absentDays: 1,
      reviewDays: 0,
      attendanceRate: 83.33,
      isProvisional: true,
    },
  ],
};
const options = { language: 'vi' as const, exportedAt: new Date('2026-11-11T02:00:00Z') };
const range = { fromDate: '2026-11-01', toDate: '2026-11-07', timezone: 'Asia/Ho_Chi_Minh' };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('creates a rectangular CSV with scoped metadata, minute values, and formula-safe literal cells', async () => {
  const names = [' =1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '\t=1+1', 'Nguyễn, "Bình"'];
  const content = await (
    await createAttendanceExport(
      'csv',
      {
        ...report,
        total: names.length,
        items: names.map((workerName, index) => ({
          ...report.items[0]!,
          workerId: String(index),
          workerName,
        })),
      },
      { ...range, search: '=scope' },
      options,
    )
  ).text();
  expect(content).toContain('"Mã công nhân","Tên công nhân"');
  expect(content).toContain('"000001","\' =1+1","Có mặt",3001,2880,121,90,5,6,83.33');
  expect(content).toContain('"\'+SUM(A1)"');
  expect(content).toContain('"\'-1+1"');
  expect(content).toContain('"\'@SUM(A1)"');
  expect(content).toContain('"\'\t=1+1"');
  expect(content).toContain('"Nguyễn, ""Bình"""');
  const csv = await new ExcelJS.Workbook().csv.read(Readable.from([content]));
  const columnCounts: number[] = [];
  csv.eachRow((row) => columnCounts.push(row.cellCount));
  expect(new Set(columnCounts).size).toBe(1);
  expect(content).toContain('"Công trường mẫu"');
  expect(content).toContain('"2026-11-01"');
  expect(content).toContain('"Asia/Ho_Chi_Minh"');
  expect(content).toContain('"\'=scope"');
  expect(content).toContain('"2026-11-11T02:00:00.000Z"');
});

it('writes real XLSX with literal identity cells, elapsed time fractions, null rate, and frozen language', async () => {
  await i18n.changeLanguage('en');
  const blob = await createAttendanceExport(
    'xlsx',
    {
      ...report,
      total: 2,
      items: [
        { ...report.items[0]!, workerName: '=1+1', attendanceRate: null },
        {
          ...report.items[0]!,
          workerId: 'second',
          workerName: 'Nguyễn Thị Hương – công nhân mẫu có tên dài cần xuống dòng',
        },
      ],
    },
    { ...range, todayStatus: 'PRESENT', shiftId: 'shift-1' },
    { ...options, shiftName: 'Ca ngày' },
  );
  expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  const sheet = workbook.worksheets[0]!;
  let dataRow = 0;
  sheet.eachRow((row) => {
    if (row.getCell(2).value === '=1+1') dataRow = row.number;
  });
  expect(dataRow).toBeGreaterThan(0);
  expect(sheet.getCell(dataRow, 1).value).toBe('000001');
  expect(sheet.getCell(dataRow, 2).type).toBe(ExcelJS.ValueType.String);
  expect(sheet.getCell(dataRow + 1, 2).value).toContain('tên dài cần xuống dòng');
  expect(sheet.getCell(dataRow + 1, 2).alignment.wrapText).toBe(true);
  expect(sheet.getCell(dataRow, 3).value).toBe('Có mặt');
  // ExcelJS reopens time-formatted numeric cells as dates relative to the Excel epoch.
  expect(sheet.getCell(dataRow, 4).value).toEqual(new Date('1900-01-01T02:01:00.000Z'));
  expect(sheet.getCell(dataRow, 4).numFmt).toBe('[h]:mm');
  expect(sheet.getCell(dataRow, 7).value).toEqual(new Date('1899-12-30T01:30:00.000Z'));
  expect(sheet.getCell(dataRow, 10).value).toBe('—');
  expect(sheet.getCell(dataRow + 1, 10).value).toBeCloseTo(0.8333);
  expect(sheet.getCell(dataRow + 1, 10).numFmt).toBe('0.00%');
  expect(sheet.autoFilter).toBe(`A${dataRow - 1}:J${dataRow + 1}`);
  const text = JSON.stringify(sheet.getSheetValues());
  expect(text).toContain('Công trường mẫu');
  expect(text).toContain('2026-11-01');
  expect(text).toContain('Asia/Ho_Chi_Minh');
  expect(text).toContain('2026-11-11T02:00:00.000Z');
  expect(text).toContain('Tổng giờ đã xác nhận');
  expect(text).toContain('Ca ngày (shift-1)');
});

it('creates a multipage A4 PDF with embedded Vietnamese fonts and Unicode maps', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const name = url.split('/').at(-1)!;
      const bytes = await readFile(new URL(`../../../../public/fonts/${name}`, import.meta.url));
      return new Response(new Uint8Array(bytes));
    }),
  );
  const blob = await createAttendanceExport(
    'pdf',
    {
      ...report,
      total: 120,
      items: Array.from({ length: 120 }, (_, index) => ({
        ...report.items[0]!,
        workerId: String(index),
        workerName: `Nguyễn Thị Hương – công nhân thử nghiệm có tên dài ${index}`,
      })),
    },
    range,
    options,
  );
  expect(blob.type).toBe('application/pdf');
  const pdf = new TextDecoder('latin1').decode(await blob.arrayBuffer());
  expect(pdf.startsWith('%PDF-')).toBe(true);
  const dimensions = pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
  expect(Number(dimensions[1])).toBeCloseTo(841.89);
  expect(Number(dimensions[2])).toBeCloseTo(595.28);
  expect(pdf.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
  expect(pdf).toContain('/FontFile2');
  expect(pdf).toContain('/ToUnicode');
  expect(pdf.toLowerCase()).toContain('1ec5');
  expect(pdf).toContain('%%EOF');
});

it('fails the PDF export if a local font cannot be loaded', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 404 })),
  );
  await expect(createAttendanceExport('pdf', report, range, options)).rejects.toThrow();
});

it('rejects an HTML fallback returned instead of a PDF font', async () => {
  const pdfErrors = vi.spyOn(console, 'error');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<!doctype html><html>App</html>')),
  );
  await expect(createAttendanceExport('pdf', report, range, options)).rejects.toThrow();
  expect(pdfErrors).not.toHaveBeenCalled();
});
