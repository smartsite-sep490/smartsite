import assert from 'node:assert/strict';
import test from 'node:test';
import { leaveNotice } from '../src/leave-notice.js';
import { scheduledShiftWindow } from '../src/scheduled-shift.js';

test('leave notice uses the actual assigned shift start, with an inclusive 24-hour boundary', () => {
  const shift = scheduledShiftWindow(
    {
      startsAt: new Date('2026-01-01T15:00:00Z'),
      endsAt: new Date('2026-01-02T01:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    },
    '2026-11-20',
  );
  assert.equal(shift.startsAt.toISOString(), '2026-11-20T15:00:00.000Z');
  assert.equal(shift.endsAt.toISOString(), '2026-11-21T01:00:00.000Z');
  assert.equal(
    leaveNotice(shift.startsAt, 'PLANNED', new Date(+shift.startsAt - 86400000)).shortNotice,
    false,
  );
  assert.equal(
    leaveNotice(shift.startsAt, 'PLANNED', new Date(+shift.startsAt - 86400000 + 1)).shortNotice,
    true,
  );
  // Emergencies reported after the shift are accepted and annotated, never auto-rejected.
  assert.deepEqual(leaveNotice(shift.startsAt, 'EMERGENCY', new Date(+shift.endsAt + 86400000)), {
    noticeType: 'EMERGENCY',
    shortNotice: true,
  });
});
