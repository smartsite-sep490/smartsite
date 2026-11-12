import type { AttendanceExportResponse, AttendanceReportQuery } from '@smartsite/contracts';
import i18n, { type UiLanguage } from '../../../i18n';

export type AttendanceExportFormat = 'csv' | 'xlsx' | 'pdf';
type ExportOptions = {
  language: UiLanguage;
  exportedAt: Date;
  shiftName?: string;
  signal?: AbortSignal;
};

function csvCell(value: string | number | null) {
  if (typeof value !== 'string') return value ?? '';
  // Quoting alone does not prevent CSV spreadsheet formula evaluation.
  const literal = /^\s*[=+\-@＝＋－＠\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${literal.replaceAll('"', '""')}"`;
}

function duration(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export async function createAttendanceExport(
  format: AttendanceExportFormat,
  report: AttendanceExportResponse,
  filters: AttendanceReportQuery,
  { language, exportedAt, shiftName, signal }: ExportOptions,
): Promise<Blob> {
  const t = i18n.getFixedT(language);
  const headers = [
    t('attendance_export.worker_code'),
    t('attendance_export.worker_name'),
    t('attendance_export.today_status'),
    t(format === 'csv' ? 'attendance_export.total_minutes' : 'attendance_export.total_hours'),
    t(format === 'csv' ? 'attendance_export.regular_minutes' : 'attendance_export.regular_hours'),
    t(format === 'csv' ? 'attendance_export.overtime_minutes' : 'attendance_export.overtime_hours'),
    t(
      format === 'csv'
        ? 'attendance_export.provisional_minutes'
        : 'attendance_export.provisional_hours',
    ),
    t('attendance_export.days_present'),
    t('attendance_export.days_required'),
    t('attendance_export.attendance_rate'),
  ];
  const time =
    format === 'csv'
      ? (minutes: number) => minutes
      : format === 'xlsx'
        ? (minutes: number) => minutes / 1440
        : duration;
  const rows = report.items.map((worker) => [
    worker.workerCode,
    worker.workerName,
    t(`labels.${worker.todayStatus}`),
    time(worker.totalMinutes),
    time(worker.regularMinutes),
    time(worker.overtimeMinutes),
    time(worker.provisionalMinutes),
    worker.presentDays,
    worker.requiredDays,
    worker.attendanceRate === null
      ? '—'
      : format === 'xlsx'
        ? worker.attendanceRate / 100
        : format === 'pdf'
          ? `${worker.attendanceRate}%`
          : worker.attendanceRate,
  ]);
  const metadata = [
    [t('attendance_export.site'), report.siteName],
    [t('attendance_export.site_id'), report.siteId],
    [t('attendance_export.from'), report.fromDate],
    [t('attendance_export.to'), report.toDate],
    [t('attendance_export.timezone'), report.timezone],
    [t('attendance_export.today'), report.today],
    [t('attendance_export.snapshot'), report.asOf],
    [t('attendance_export.exported_at'), exportedAt.toISOString()],
    [t('attendance_export.scope'), t('attendance_export.authorized_scope')],
    [t('attendance_export.contractor'), filters.contractorId ?? ''],
    [
      t('attendance_export.shift'),
      filters.shiftId ? (shiftName ? `${shiftName} (${filters.shiftId})` : filters.shiftId) : '',
    ],
    [t('attendance_export.search'), filters.search ?? ''],
    [t('attendance_export.status'), filters.todayStatus ? t(`labels.${filters.todayStatus}`) : ''],
  ];
  signal?.throwIfAborted();

  if (format === 'csv') {
    const context = metadata.map(([, value]) => value!);
    const content = [
      [...headers, ...metadata.map(([label]) => label!)].map(csvCell).join(','),
      ...rows.map((row) => [...row, ...context].map(csvCell).join(',')),
    ].join('\r\n');
    return new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8;' });
  }

  if (format === 'xlsx') {
    const { Workbook } = (await import('exceljs')).default;
    signal?.throwIfAborted();
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(t('attendance_report.title'));
    sheet.columns = [18, 36, 22, 22, 22, 22, 22, 18, 18, 22].map((width) => ({ width }));
    sheet.getColumn(2).alignment = { wrapText: true };
    for (const [label, value] of metadata) {
      const row = sheet.addRow([label, value]);
      sheet.mergeCells(row.number, 2, row.number, headers.length);
    }
    sheet.addRow([]);
    const header = sheet.addRow(headers);
    header.font = { bold: true };
    header.alignment = { wrapText: true };
    sheet.views = [{ state: 'frozen', ySplit: header.number }];
    sheet.addRows(rows);
    for (const column of [4, 5, 6, 7]) sheet.getColumn(column).numFmt = '[h]:mm';
    sheet.getColumn(10).numFmt = '0.00%';
    sheet.autoFilter = {
      from: { row: header.number, column: 1 },
      to: { row: sheet.rowCount, column: headers.length },
    };
    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  const [{ jsPDF }, { autoTable }, fonts] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    Promise.all(
      ['Regular', 'Bold'].map(async (weight) => {
        const filename = `NotoSans-${weight}.ttf`;
        const response = await fetch(`${import.meta.env.BASE_URL}fonts/${filename}`, { signal });
        if (!response.ok) throw new Error('Attendance PDF font unavailable');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length < 12 || new DataView(bytes.buffer).getUint32(0) !== 0x00010000)
          throw new Error('Attendance PDF font invalid');
        const chunks: string[] = [];
        for (let offset = 0; offset < bytes.length; offset += 32768)
          chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
        return { filename, data: btoa(chunks.join('')) };
      }),
    ),
  ]);
  signal?.throwIfAborted();
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    putOnlyUsedFonts: true,
  });
  fonts.forEach((font, index) => {
    doc.addFileToVFS(font.filename, font.data);
    doc.addFont(font.filename, 'NotoSans', index === 0 ? 'normal' : 'bold');
  });
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(15);
  doc.text(t('attendance_report.title'), 12, 16);
  doc.setProperties({ title: t('attendance_report.title') });
  let tableStart = 24;
  autoTable(doc, {
    body: metadata,
    startY: tableStart,
    theme: 'plain',
    styles: { font: 'NotoSans', fontStyle: 'normal', fontSize: 8, cellPadding: 1 },
    columnStyles: { 0: { cellWidth: 45, fontStyle: 'bold' } },
    margin: { left: 12, right: 12, top: 12, bottom: 14 },
    didDrawPage: ({ cursor }) => {
      tableStart = (cursor?.y ?? 24) + 5;
    },
  });
  autoTable(doc, {
    head: [headers],
    body: rows.map((row) => row.map((cell) => (cell === null ? '' : String(cell)))),
    startY: tableStart,
    showHead: 'everyPage',
    theme: 'grid',
    styles: {
      font: 'NotoSans',
      fontStyle: 'normal',
      fontSize: 8,
      cellPadding: 2,
      overflow: 'linebreak',
    },
    headStyles: { fontStyle: 'bold', fillColor: [7, 26, 43] },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 45 }, 2: { cellWidth: 27 } },
    rowPageBreak: 'avoid',
    margin: { left: 12, right: 12, top: 12, bottom: 14 },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('NotoSans', 'normal');
    doc.setFontSize(8);
    doc.text(t('attendance_export.page', { page, pages }), 285, 203, { align: 'right' });
  }
  return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
}
