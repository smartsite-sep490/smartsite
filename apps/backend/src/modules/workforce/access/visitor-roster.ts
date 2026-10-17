import type {
  VisitorAttendanceInput,
  VisitorAttendanceResponse,
  VisitorMemberInput,
  VisitorMemberResponse,
} from '@smartsite/contracts';
import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import {
  PublicHttpException,
  type BackendErrorCode,
} from '../../../common/http/public-http-exception.js';

function reject(code: BackendErrorCode): never {
  throw new PublicHttpException(HttpStatus.BAD_REQUEST, { code, message: code });
}
export function createVisitorRoster(
  groupSize: number,
  input?: VisitorMemberInput[],
): VisitorMemberResponse[] {
  const members = input ?? [];
  if ((groupSize > 1 || members.length) && members.length !== groupSize)
    reject('VISITOR_ROSTER_SIZE');
  if (new Set(members.map((m) => m.identityNumber)).size !== members.length)
    reject('VISITOR_ROSTER_DUPLICATE');
  return members.map((m) => ({
    ...m,
    id: randomUUID(),
    inside: false,
    registeredFullName: m.fullName,
    registeredIdentityNumber: m.identityNumber,
  }));
}

/** Each selected slot represents at most one physical visitor. History is a separate snapshot. */
export function applyVisitorAttendance(
  members: VisitorMemberResponse[],
  direction: 'IN' | 'OUT',
  input: VisitorAttendanceInput[],
): { members: VisitorMemberResponse[]; attendees: VisitorAttendanceResponse[] } {
  if (!input.length || input.length > members.length) reject('VISITOR_ATTENDANCE_SIZE');
  if (new Set(input.map((m) => m.memberId)).size !== input.length)
    reject('VISITOR_ATTENDANCE_DUPLICATE');
  const updated = members.map((m) => ({ ...m }));
  const attendees = input.map((entry): VisitorAttendanceResponse => {
    const member = updated.find((m) => m.id === entry.memberId);
    if (!member) reject('VISITOR_ATTENDANCE_UNKNOWN');
    if (member.inside === (direction === 'IN')) reject('VISITOR_ATTENDANCE_PRESENCE');
    const changed =
      member.fullName !== entry.fullName || member.identityNumber !== entry.identityNumber;
    if (direction === 'OUT' && changed) reject('VISITOR_ATTENDANCE_EXIT_IDENTITY');
    const snapshot = {
      ...entry,
      ...(changed
        ? {
            replacedFrom: {
              fullName: member.fullName,
              identityNumber: member.identityNumber,
            },
          }
        : {}),
    };
    member.fullName = entry.fullName;
    member.identityNumber = entry.identityNumber;
    member.inside = direction === 'IN';
    return snapshot;
  });
  if (new Set(updated.map((m) => m.identityNumber)).size !== updated.length)
    reject('VISITOR_ROSTER_DUPLICATE');
  return { members: updated, attendees };
}
