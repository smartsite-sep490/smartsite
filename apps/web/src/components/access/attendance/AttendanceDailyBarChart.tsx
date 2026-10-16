import { translate as tr, uiLocale } from '../../../i18n';
import { localizedLabel } from '../../../i18n/labels';
import { attendanceHours } from './attendance-display';
import type { AttendanceReportDay } from '@smartsite/contracts';

export function AttendanceDailyBarChart({ daily }: { daily: AttendanceReportDay[] }) {
  // Find max daily minutes to scale bars reasonably. Baseline at least 10h (600 mins) or 12h (720 mins).
  const maxDayMinutes = Math.max(
    720,
    ...daily.map((d) => (d.hoursStatus === 'CONFIRMED' ? d.totalMinutes : d.provisionalMinutes)),
  );

  const formatDayName = (dateStr: string) => {
    try {
      const d = new Date(`${dateStr}T00:00:00Z`);
      return d.toLocaleDateString(uiLocale(), { weekday: 'short', timeZone: 'UTC' });
    } catch {
      return dateStr;
    }
  };

  const formatShortDate = (dateStr: string) => {
    try {
      const d = new Date(`${dateStr}T00:00:00Z`);
      return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
    } catch {
      return dateStr;
    }
  };

  const chartHeight = 160;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#071A2B]">
          {tr('attendance_report.daily_working_hours')}
        </h3>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-blue-500" aria-hidden="true" />
            <span className="text-slate-600 font-medium">{tr('attendance_report.regular')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-amber-500" aria-hidden="true" />
            <span className="text-slate-600 font-medium">{tr('attendance_report.overtime')}</span>
          </div>
        </div>
      </div>

      {/* Accessible table hidden visually for screen readers */}
      <table className="sr-only">
        <caption>{tr('attendance_report.chart_accessible_table')}</caption>
        <thead>
          <tr>
            <th>{tr('attendance_report.date')}</th>
            <th>{tr('attendance_report.regular')}</th>
            <th>{tr('attendance_report.overtime')}</th>
            <th>{tr('attendance_report.status')}</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((d) => (
            <tr key={d.workDate}>
              <td>{d.workDate}</td>
              <td>{attendanceHours(d.regularMinutes)}</td>
              <td>{attendanceHours(d.overtimeMinutes)}</td>
              <td>{localizedLabel(d.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Chart Canvas Area */}
      <div className="relative pt-6 pb-2" aria-hidden="true">
        {/* Y Axis Grid lines (12h, 8h, 4h, 0h) */}
        <div className="absolute inset-x-0 top-6 bottom-8 flex flex-col justify-between pointer-events-none">
          {[12, 8, 4, 0].map((h) => (
            <div key={h} className="relative flex items-center w-full">
              <span className="w-8 text-[11px] font-mono text-slate-400 text-right pr-2 shrink-0">
                {tr('attendance_report.chart_hours', { hours: h })}
              </span>
              <div className="w-full border-b border-dashed border-slate-100" />
            </div>
          ))}
        </div>

        {/* Bars Container */}
        <div className="ml-8 flex items-end justify-around" style={{ height: `${chartHeight}px` }}>
          {daily.map((d) => {
            const isConfirmed = d.hoursStatus === 'CONFIRMED';
            const regular = isConfirmed ? d.regularMinutes : d.provisionalMinutes;
            const overtime = isConfirmed ? d.overtimeMinutes : 0;
            const total = regular + overtime;

            const regularHeightPercent = Math.min(100, (regular / maxDayMinutes) * 100);
            const overtimeHeightPercent = Math.min(
              100 - regularHeightPercent,
              (overtime / maxDayMinutes) * 100,
            );

            return (
              <div
                key={d.workDate}
                className="flex-1 flex flex-col items-center justify-end h-full group relative px-1 max-w-[64px]"
              >
                {/* Tooltip on hover */}
                <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                  <div className="bg-[#071A2B] text-white text-[11px] font-medium py-1.5 px-2.5 rounded-lg shadow-lg whitespace-nowrap">
                    <p className="font-bold border-b border-white/10 pb-1 mb-1">{d.workDate}</p>
                    <p>
                      {tr('attendance_report.regular')}: {attendanceHours(regular)}
                    </p>
                    {overtime > 0 && (
                      <p>
                        {tr('attendance_report.overtime')}: {attendanceHours(overtime)}
                      </p>
                    )}
                    {!isConfirmed && d.provisionalMinutes > 0 && (
                      <p className="text-amber-300 text-[10px]">
                        {tr('attendance_report.provisional')}
                      </p>
                    )}
                  </div>
                  <div className="w-2 h-2 bg-[#071A2B] rotate-45 -mt-1" />
                </div>

                {/* Bar */}
                <div className="w-full max-w-[28px] flex flex-col justify-end rounded-t-sm overflow-hidden bg-slate-100/60 h-full">
                  {total > 0 ? (
                    <div className="w-full flex flex-col justify-end h-full">
                      {overtime > 0 && (
                        <div
                          style={{ height: `${overtimeHeightPercent}%` }}
                          className="w-full bg-amber-500 transition-all duration-300 rounded-t-sm"
                        />
                      )}
                      {regular > 0 && (
                        <div
                          style={{ height: `${regularHeightPercent}%` }}
                          className={`w-full bg-blue-500 transition-all duration-300 ${overtime === 0 ? 'rounded-t-sm' : ''} ${!isConfirmed ? 'opacity-70 border-t-2 border-dashed border-blue-400' : ''}`}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-0.5 bg-slate-200" />
                  )}
                </div>

                {/* Day label */}
                <div className="mt-2 text-center select-none">
                  <p className="text-[11px] font-bold text-slate-700 leading-tight">
                    {formatDayName(d.workDate)}
                  </p>
                  <p className="text-[10px] text-slate-400">{formatShortDate(d.workDate)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
