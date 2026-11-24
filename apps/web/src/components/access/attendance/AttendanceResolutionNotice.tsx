import { teamText } from '../../team-attendance/team-attendance-copy';
import { attendanceResolution } from './attendance-resolution';

export function AttendanceResolutionNotice({
  issues,
  siteId,
}: {
  issues: string[];
  siteId: string;
}) {
  const resolution = attendanceResolution(issues);
  if (!resolution) return null;
  const reviewHours =
    !resolution.assignment &&
    issues.includes('ZONE_ATTENDANCE_PENDING') &&
    !issues.some((i) => ['ZONE_GATE_MISSING', 'MISSING_IN', 'MISSING_OUT'].includes(i));
  return (
    <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2 text-sm text-amber-900">
      <p>{resolution.message}</p>
      <a
        className="font-semibold underline focus-visible:outline"
        href={
          resolution.assignment
            ? `/workforce?${new URLSearchParams({ siteId, tab: 'schedule' })}`
            : reviewHours
              ? '#zone-hours-review'
              : '#attendance-correction-form'
        }
      >
        {teamText(
          resolution.assignment
            ? 'teamWeb.assignmentAction'
            : reviewHours
              ? 'teamWeb.hoursReviewAction'
              : 'teamWeb.correctionAction',
        )}
      </a>
    </aside>
  );
}
