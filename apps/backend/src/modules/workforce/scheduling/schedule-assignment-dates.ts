import type { ScheduleAssignmentInput } from '@smartsite/contracts';
import { invalid } from '../../../common/configuration/commands.js';

export function assignmentDates(input: ScheduleAssignmentInput): string[] {
  const start = Date.parse(`${input.fromDate}T00:00:00Z`);
  const end = Date.parse(`${input.toDate}T00:00:00Z`);
  const span = (end - start) / 86400000;
  if (!Number.isInteger(span) || span < 0 || span > 365)
    invalid('Choose a range of at most 366 days');
  if (input.mode === 'DAY' && span !== 0) invalid('Daily assignment requires one date');
  if (input.mode === 'WEEK' && (span !== 6 || new Date(start).getUTCDay() !== 1))
    invalid('Select a Monday-to-Sunday week');
  if (
    input.target === 'TEAM'
      ? !input.teamId || Boolean(input.workerId)
      : !input.workerId || Boolean(input.teamId) || Boolean(input.selectedWorkerIds)
  )
    invalid('Choose either a team or a worker');
  const dates: string[] = [];
  for (let at = start; at <= end; at += 86400000) {
    const date = new Date(at);
    if (input.mode === 'DAY' || input.weekdays.includes(date.getUTCDay() || 7))
      dates.push(date.toISOString().slice(0, 10));
  }
  if (!dates.length) invalid('Select at least one work date');
  return dates;
}
