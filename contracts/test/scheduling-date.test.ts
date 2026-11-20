import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPastWorkDate, isShiftEnded, isShiftStarted } from '../src/scheduling-date.js';

test('work dates use the shift timezone and never lock today after the shift starts', () => {
  const now = new Date('2030-01-01T23:30:00Z');
  assert.equal(isPastWorkDate('2030-01-01', 'UTC', now), false);
  assert.equal(isPastWorkDate('2030-01-01', 'Asia/Ho_Chi_Minh', now), true);
  assert.equal(isPastWorkDate('2030-01-02', 'Asia/Ho_Chi_Minh', now), false);
  assert.equal(isPastWorkDate('2029-12-31', 'UTC', now), true);
  assert.equal(isPastWorkDate('2030-01-01', 'America/Los_Angeles', now), false);
  assert.throws(() => isPastWorkDate('2030-01-01', 'Invalid/Timezone', now), RangeError);
});

test('start deadline rejects equality, ongoing and ended shifts on the scheduled date', () => {
  const shift = {
    startsAt: '2026-01-01T01:00:00Z',
    endsAt: '2026-01-01T10:00:00Z',
    timezone: 'Asia/Ho_Chi_Minh',
  };
  assert.equal(isShiftStarted('2030-01-01', shift, new Date('2030-01-01T00:59:59.999Z')), false);
  for (const at of ['2030-01-01T01:00:00Z', '2030-01-01T01:00:00.001Z', '2030-01-01T11:00:00Z'])
    assert.equal(isShiftStarted('2030-01-01', shift, new Date(at)), true);
});

test('start deadline handles overnight dates, timezone offsets and invalid inputs', () => {
  const shift = {
    startsAt: '2026-01-01T15:00:00Z',
    endsAt: '2026-01-01T23:00:00Z',
    timezone: 'Asia/Ho_Chi_Minh',
  };
  assert.equal(isShiftStarted('2030-01-01', shift, new Date('2030-01-01T14:59:59.999Z')), false);
  assert.equal(isShiftStarted('2030-01-01', shift, new Date('2030-01-01T15:00:00Z')), true);
  assert.equal(isShiftStarted('2030-01-01', shift, new Date('2030-01-01T18:00:00Z')), true);
  const dst = {
    startsAt: '2026-01-01T13:00:00Z',
    endsAt: '2026-01-01T22:00:00Z',
    timezone: 'America/New_York',
  };
  assert.equal(isShiftStarted('2030-07-01', dst, new Date('2030-07-01T11:59:59.999Z')), false);
  assert.equal(isShiftStarted('2030-07-01', dst, new Date('2030-07-01T12:00:00Z')), true);
  for (const date of ['2030-02-30', 'invalid']) assert.throws(() => isShiftStarted(date, shift));
  assert.throws(() => isShiftStarted('2030-01-01', { ...shift, timezone: 'Invalid/Timezone' }));
  assert.throws(() => isShiftStarted('2030-01-01', { ...shift, startsAt: 'bad' }));
  assert.throws(() => isShiftStarted('2030-01-01', shift, new Date('bad')));
  assert.throws(() => isShiftStarted('2030-01-01', { ...shift, timezone: undefined } as never));
  assert.throws(() => isShiftStarted('2030-01-01', { ...shift, startsAt: null } as never));
});

test('start deadline uses the first occurrence of a half-hour DST fallback', () => {
  const shift = {
    startsAt: '2026-01-01T14:45:00Z',
    endsAt: '2026-01-01T17:00:00Z',
    timezone: 'Australia/Lord_Howe',
  };
  assert.equal(isShiftStarted('2026-04-05', shift, new Date('2026-04-04T14:44:59.999Z')), false);
  assert.equal(isShiftStarted('2026-04-05', shift, new Date('2026-04-04T14:45:00Z')), true);
});

test('shift changes remain available during work and lock at the scheduled end, not the template date', () => {
  const shift = {
    startsAt: '2026-01-01T01:00:00Z',
    endsAt: '2026-01-01T10:00:00Z',
    timezone: 'Asia/Ho_Chi_Minh',
  };
  for (const at of ['2030-01-01T00:00:00Z', '2030-01-01T01:00:00Z', '2030-01-01T09:59:59.999Z'])
    assert.equal(isShiftEnded('2030-01-01', shift, new Date(at)), false);
  for (const at of ['2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z', '2030-01-02T00:00:00Z'])
    assert.equal(isShiftEnded('2030-01-01', shift, new Date(at)), true);
});

test('overnight shifts remain available after midnight until their end on the next local day', () => {
  const shift = {
    startsAt: '2026-01-01T15:00:00Z',
    endsAt: '2026-01-01T23:00:00Z',
    timezone: 'Asia/Ho_Chi_Minh',
  };
  assert.equal(isShiftEnded('2030-01-01', shift, new Date('2030-01-01T18:00:00Z')), false);
  assert.equal(isShiftEnded('2030-01-01', shift, new Date('2030-01-01T22:59:59.999Z')), false);
  assert.equal(isShiftEnded('2030-01-01', shift, new Date('2030-01-01T23:00:00Z')), true);
});

test('shift end follows timezone offset changes on the scheduled date', () => {
  const shift = {
    startsAt: '2026-01-01T13:00:00Z',
    endsAt: '2026-01-01T22:00:00Z',
    timezone: 'America/New_York',
  };
  assert.equal(isShiftEnded('2030-07-01', shift, new Date('2030-07-01T20:59:59.999Z')), false);
  assert.equal(isShiftEnded('2030-07-01', shift, new Date('2030-07-01T21:00:00Z')), true);
  assert.throws(() => isShiftEnded('2030-02-30', shift), RangeError);
  assert.throws(() => isShiftEnded('2030-01-01', { ...shift, endsAt: 'bad' }), RangeError);
  assert.throws(
    () => isShiftEnded('2030-01-01', { ...shift, timezone: 'Invalid/Timezone' }),
    RangeError,
  );
});
