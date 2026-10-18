import { expect, it } from 'vitest';
import { allPages, validDates } from './data';
it('loads all pages and fails on an incomplete response instead of accepting a partial roster', async () => {
  const offsets: number[] = [];
  expect(
    await allPages(async ({ offset }) => {
      offsets.push(offset);
      return { items: [offset], total: 3 };
    }),
  ).toEqual([0, 1, 2]);
  expect(offsets).toEqual([0, 1, 2]);
  await expect(allPages(async () => ({ items: [], total: 1 }))).rejects.toThrow('chưa đầy đủ');
});
it('rejects nonexistent or inverted dates', () => {
  expect(() => validDates('2026-02-30', '2026-03-02')).toThrow();
  expect(() => validDates('2026-10-20', '2026-10-19')).toThrow();
  expect(() => validDates('2026-10-20', '2026-10-20')).not.toThrow();
});
it('supports native AbortSignal objects that expose aborted but no throwIfAborted method', async () => {
  const signal = { aborted: false } as AbortSignal;
  expect(await allPages(async () => ({ items: ['a'], total: 1 }), signal)).toEqual(['a']);
  await expect(
    allPages(async () => {
      Object.assign(signal, { aborted: true });
      return { items: ['a'], total: 2 };
    }, signal),
  ).rejects.toMatchObject({ code: 'cancelled' });
});
