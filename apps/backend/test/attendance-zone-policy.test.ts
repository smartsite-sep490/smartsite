import assert from 'node:assert/strict';
import test from 'node:test';
import { zoneAttendanceIssue } from '../src/modules/workforce/attendance/attendance-zone-policy.js';
import { canAcknowledgeEarlyCheckout } from '../src/modules/workforce/attendance/attendance-review-policy.js';
const requirement = {
  version: 1 as const,
  required: true,
  teamId: 'team',
  membershipId: 'membership',
  zoneId: 'zone',
};
const record = { teamId: 'team', membershipId: 'membership', zoneId: 'zone', status: 'PRESENT' };
test('requires matching team, membership, work zone, leader presence and real gate evidence', () => {
  assert.equal(zoneAttendanceIssue(requirement, record, true), null);
  assert.equal(zoneAttendanceIssue(requirement, null, true), 'ZONE_ATTENDANCE_PENDING');
  assert.equal(
    zoneAttendanceIssue(requirement, { ...record, status: 'ABSENT' }, true),
    'ZONE_ATTENDANCE_ABSENT',
  );
  assert.equal(zoneAttendanceIssue(requirement, record, false), 'ZONE_GATE_MISSING');
  for (const field of ['teamId', 'membershipId', 'zoneId'] as const)
    assert.equal(
      zoneAttendanceIssue(requirement, { ...record, [field]: 'different' }, true),
      'ZONE_ATTENDANCE_MISMATCH',
    );
  assert.equal(
    zoneAttendanceIssue({ ...requirement, zoneId: null }, record, true),
    'ZONE_ASSIGNMENT_UNRESOLVED',
  );
});
test('does not invent a zone requirement for a legacy/unassigned day', () => {
  assert.equal(zoneAttendanceIssue(null, null, false), null);
  assert.equal(zoneAttendanceIssue({ ...requirement, required: false }, null, false), null);
});
test('early-checkout acknowledgement cannot bypass missing zone attendance or any other blocking evidence', () => {
  assert.equal(canAcknowledgeEarlyCheckout(['EARLY_CHECKOUT']), true);
  assert.equal(canAcknowledgeEarlyCheckout(['EARLY_CHECKOUT', 'MAX_EXITS_EXCEEDED']), true);
  for (const anomaly of [
    'ZONE_ATTENDANCE_PENDING',
    'ZONE_ATTENDANCE_MISMATCH',
    'ZONE_GATE_MISSING',
    'MISSING_OUT',
    'PENDING_REQUEST',
  ])
    assert.equal(canAcknowledgeEarlyCheckout(['EARLY_CHECKOUT', anomaly]), false);
  assert.equal(canAcknowledgeEarlyCheckout([]), false);
});
