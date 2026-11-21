import {
  scheduledShiftWindow,
  type ContractorTeamCalendarItem,
  type ContractorTeamCalendarResponse,
} from '@smartsite/contracts';

export interface TeamCalendarSchedule {
  scheduleId: string;
  workerId: string;
  workDate: string;
  shiftId: string;
  scheduleVersionId: string;
  recordedTeamId: string | null;
  recordedTeamName: string | null;
}
export interface TeamCalendarMembership {
  workerId: string;
  teamId: string;
  teamName: string;
  joinedAt: Date;
  leftAt: Date | null;
}
export interface TeamCalendarShift {
  id: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
}

/** Recorded team assignments take priority; legacy schedules use membership at shift start. */
export function groupTeamCalendar(
  schedules: TeamCalendarSchedule[],
  memberships: TeamCalendarMembership[],
  shifts: TeamCalendarShift[],
  filterTeamId?: string,
): ContractorTeamCalendarResponse {
  const requestedTeam = filterTeamId?.toLowerCase();
  const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]));
  const shiftStarts = new Map<string, Date | null>();
  const memberHistory = new Map<string, TeamCalendarMembership[]>();
  for (const member of memberships)
    memberHistory.set(member.workerId, [...(memberHistory.get(member.workerId) ?? []), member]);
  const bySchedule = new Map<string, TeamCalendarSchedule[]>();
  for (const schedule of schedules)
    bySchedule.set(schedule.scheduleId, [...(bySchedule.get(schedule.scheduleId) ?? []), schedule]);
  const groups = new Map<string, { item: ContractorTeamCalendarItem; workers: Set<string> }>();
  let unassignedScheduleCount = 0;
  for (const candidates of bySchedule.values()) {
    const schedule = candidates[0]!;
    const recorded = new Map(
      candidates
        .filter((row) => row.recordedTeamId && row.recordedTeamName)
        .map((row) => [row.recordedTeamId!, row.recordedTeamName!]),
    );
    let team: { id: string; name: string } | undefined;
    if (recorded.size === 1) {
      const [id, name] = recorded.entries().next().value!;
      team = { id, name };
    } else if (recorded.size === 0) {
      const shift = shiftsById.get(schedule.shiftId);
      if (shift) {
        try {
          const shiftKey = `${schedule.shiftId}:${schedule.workDate}`;
          if (!shiftStarts.has(shiftKey)) {
            shiftStarts.set(shiftKey, null);
            shiftStarts.set(shiftKey, scheduledShiftWindow(shift, schedule.workDate).startsAt);
          }
          const startsAt = shiftStarts.get(shiftKey);
          if (!startsAt) {
            if (!requestedTeam) unassignedScheduleCount += 1;
            continue;
          }
          const atStart = new Map(
            (memberHistory.get(schedule.workerId) ?? [])
              .filter(
                (member) =>
                  member.joinedAt <= startsAt &&
                  (member.leftAt === null || member.leftAt > startsAt),
              )
              .map((member) => [member.teamId, member.teamName]),
          );
          if (atStart.size === 1) {
            const [id, name] = atStart.entries().next().value!;
            team = { id, name };
          }
        } catch {
          /* An invalid shift time cannot establish a historical membership. */
        }
      }
    }
    if (!team) {
      if (!requestedTeam) unassignedScheduleCount += 1;
      continue;
    }
    if (requestedTeam && team.id.toLowerCase() !== requestedTeam) continue;
    const key = `${team.id}:${schedule.workDate}:${schedule.shiftId}:${schedule.scheduleVersionId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        item: {
          teamId: team.id,
          teamName: team.name,
          workDate: schedule.workDate,
          shiftId: schedule.shiftId,
          scheduleVersionId: schedule.scheduleVersionId,
          workerCount: 0,
        },
        workers: new Set(),
      };
      groups.set(key, group);
    }
    group.workers.add(schedule.workerId);
  }
  return {
    items: [...groups.values()]
      .map(({ item, workers }) => ({ ...item, workerCount: workers.size }))
      .sort(
        (a, b) =>
          a.workDate.localeCompare(b.workDate) ||
          a.teamName.localeCompare(b.teamName) ||
          a.shiftId.localeCompare(b.shiftId) ||
          a.scheduleVersionId.localeCompare(b.scheduleVersionId),
      ),
    unassignedScheduleCount,
  };
}
