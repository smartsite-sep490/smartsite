import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  applyVisitorAttendance,
  createVisitorRoster,
} from '../src/modules/workforce/access/visitor-roster.js';
import {
  newVisitorCode,
  encryptVisitorCode,
  decryptVisitorCode,
} from '../src/modules/workforce/access/visitor-code.js';
import { command } from '../src/common/configuration/commands.js';
import {
  RegisterVisitCommand,
  VerifyVisitorQrCommand,
} from '../src/modules/workforce/access/qr-access.commands.js';
import { visitorEmailContent } from '../src/modules/workforce/access/visitor-email.service.js';
const input = [
  { fullName: 'Synthetic A', identityNumber: '000000000001' },
  { fullName: 'Synthetic B', identityNumber: '000000000002' },
];
test('roster requires the exact registered size and unique citizen IDs', () => {
  assert.throws(() => createVisitorRoster(2), /VISITOR_ROSTER_SIZE/);
  assert.throws(() => createVisitorRoster(2, [input[0]!, input[0]!]), /VISITOR_ROSTER_DUPLICATE/);
  assert.equal(createVisitorRoster(1).length, 0);
});
test('partial attendance records replacements without changing original registration or previous snapshots', () => {
  const roster = createVisitorRoster(2, input);
  const entry = {
    memberId: roster[0]!.id,
    fullName: 'Synthetic C',
    identityNumber: '000000000003',
  };
  const result = applyVisitorAttendance(roster, 'IN', [entry]);
  assert.equal(result.members.filter((m) => m.inside).length, 1);
  assert.deepEqual(result.attendees[0]?.replacedFrom, input[0]);
  assert.equal(roster[0]?.inside, false);
  assert.equal(result.members[0]?.registeredFullName, input[0]?.fullName);
  assert.throws(() => applyVisitorAttendance(result.members, 'IN', [entry]), /PRESENCE/);
  assert.throws(() => applyVisitorAttendance(roster, 'IN', [entry, entry]), /DUPLICATE/);
  assert.throws(
    () => applyVisitorAttendance(roster, 'IN', [{ ...entry, memberId: randomUUID() }]),
    /UNKNOWN/,
  );
  assert.throws(
    () =>
      applyVisitorAttendance(roster, 'IN', [
        { ...entry, identityNumber: input[1]!.identityNumber },
      ]),
    /DUPLICATE/,
  );
  assert.throws(
    () => applyVisitorAttendance(result.members, 'OUT', [{ ...entry, fullName: 'Forged' }]),
    /EXIT_IDENTITY/,
  );
  const out = applyVisitorAttendance(result.members, 'OUT', [entry]);
  assert.equal(out.members[0]?.inside, false);
  assert.equal(result.attendees[0]?.fullName, 'Synthetic C');
});
test('nested commands reject invalid identities and invented trusted fields', () => {
  const qr = {
    token: newVisitorCode(),
    direction: 'IN',
    requestId: randomUUID(),
    expectedVersion: 2,
    attendees: [{ memberId: randomUUID(), ...input[0] }],
  };
  command(VerifyVisitorQrCommand, qr);
  for (const identityNumber of ['', '1234', 123456789012, '  ', 'abcdefgh1234'])
    assert.throws(() =>
      command(VerifyVisitorQrCommand, {
        ...qr,
        attendees: [{ ...qr.attendees[0], identityNumber }],
      }),
    );
  assert.throws(() =>
    command(VerifyVisitorQrCommand, { ...qr, attendees: [{ ...qr.attendees[0], inside: true }] }),
  );
  assert.throws(() => command(RegisterVisitCommand, { members: input }));
});
test('short booking codes are authenticated encrypted at rest and contain eight readable characters', () => {
  const code = newVisitorCode(),
    secret = 'synthetic-secret-used-only-in-this-test';
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  const encrypted = encryptVisitorCode(code, secret);
  assert.equal(decryptVisitorCode(encrypted, secret), code);
  assert.throws(() => decryptVisitorCode(encrypted, 'different-secret'));
});
test('QR email supports both languages and escapes customer text in HTML', () => {
  const visit = {
    language: 'vi' as const,
    visitorName: '<img src=x>',
    groupSize: 2,
    targetArea: 'Office & yard',
    validFrom: new Date('2026-10-15T01:00:00Z'),
    validUntil: new Date('2026-10-15T02:00:00Z'),
  };
  const vi = visitorEmailContent(visit, 'ABCD2345');
  assert.match(vi.subject, /phê duyệt/);
  assert.match(vi.text, /ABCD2345/);
  assert.ok(!vi.html.includes('<img src=x>'));
  assert.match(vi.html, /&lt;img/);
  assert.match(visitorEmailContent({ ...visit, language: 'en' }, 'ABCD2345').subject, /approved/);
});

test('rejection and cancellation emails explain the decision without disclosing a booking code', () => {
  for (const status of ['REJECTED', 'CANCELLED'] as const) {
    for (const language of ['en', 'vi'] as const) {
      const visit = {
        status,
        language,
        visitorName: '<Guest>',
        groupSize: 2,
        targetArea: 'Office & yard',
        validFrom: new Date('2026-10-15T01:00:00Z'),
        validUntil: new Date('2026-10-15T02:00:00Z'),
        reviewNote: '<Schedule changed>',
      };
      const content = visitorEmailContent(visit, 'ABCD2345');
      assert.match(content.subject, status === 'REJECTED' ? /rejected|từ chối/ : /cancelled|hủy/);
      assert.ok(content.text.includes(visit.reviewNote));
      assert.ok(content.text.includes(visit.targetArea));
      assert.ok(!content.text.includes('ABCD2345'));
      assert.ok(!content.html.includes('<Schedule changed>'));
      assert.match(content.html, /&lt;Schedule changed&gt;/);
      assert.ok(!content.html.includes('<img'));
    }
  }
});
