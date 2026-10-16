import { translate as tr } from '../../../i18n';
import { attendanceHours } from './attendance-display';

export function AttendanceDistributionDonut({
  regularMinutes,
  overtimeMinutes,
}: {
  regularMinutes: number;
  overtimeMinutes: number;
}) {
  const total = regularMinutes + overtimeMinutes;

  const regularPercent = total > 0 ? Math.round((regularMinutes / total) * 1000) / 10 : 0;
  const overtimePercent = total > 0 ? Math.round((overtimeMinutes / total) * 1000) / 10 : 0;

  // SVG Donut calculation: radius = 54, circumference = 2 * PI * 54 = 339.292
  const r = 54;
  const circumference = 2 * Math.PI * r;

  // Regular arc offset and strokeDasharray
  const regularStroke = (regularPercent / 100) * circumference;
  const overtimeStroke = (overtimePercent / 100) * circumference;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-[#071A2B]">
        {tr('attendance_report.work_time_distribution')}
      </h3>

      <div className="flex flex-col sm:flex-row items-center gap-6 justify-center">
        {/* Donut SVG */}
        <div className="relative w-36 h-36 flex items-center justify-center shrink-0">
          <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 140 140">
            {/* Background track circle */}
            <circle
              cx="70"
              cy="70"
              r={r}
              className="text-slate-100"
              strokeWidth="16"
              stroke="currentColor"
              fill="transparent"
            />

            {total > 0 && (
              <>
                {/* Regular hours segment (Blue) */}
                <circle
                  cx="70"
                  cy="70"
                  r={r}
                  strokeWidth="16"
                  strokeDasharray={`${regularStroke} ${circumference}`}
                  strokeDashoffset="0"
                  strokeLinecap="round"
                  className="text-blue-500 transition-all duration-500"
                  stroke="currentColor"
                  fill="transparent"
                />

                {/* Overtime hours segment (Amber) */}
                {overtimeMinutes > 0 && (
                  <circle
                    cx="70"
                    cy="70"
                    r={r}
                    strokeWidth="16"
                    strokeDasharray={`${overtimeStroke} ${circumference}`}
                    strokeDashoffset={-regularStroke}
                    strokeLinecap="round"
                    className="text-amber-500 transition-all duration-500"
                    stroke="currentColor"
                    fill="transparent"
                  />
                )}
              </>
            )}
          </svg>

          {/* Centered label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2">
            <span className="text-base font-extrabold text-[#071A2B] leading-tight">
              {attendanceHours(total)}
            </span>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
              {tr('attendance_report.total_hours')}
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="space-y-3 min-w-[140px]">
          <div className="flex items-start gap-2.5">
            <span className="w-3 h-3 rounded-full bg-blue-500 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-slate-700">
                {tr('attendance_report.regular')}
              </p>
              <p className="text-xs font-mono font-bold text-[#071A2B]">
                {attendanceHours(regularMinutes)}{' '}
                <span className="text-slate-400 font-normal">({regularPercent}%)</span>
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <span
              className="w-3 h-3 rounded-full bg-amber-500 mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="text-xs font-semibold text-slate-700">
                {tr('attendance_report.overtime')}
              </p>
              <p className="text-xs font-mono font-bold text-[#071A2B]">
                {attendanceHours(overtimeMinutes)}{' '}
                <span className="text-slate-400 font-normal">({overtimePercent}%)</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
