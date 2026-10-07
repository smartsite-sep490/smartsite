import { expect, it } from 'vitest';
import { loadAllPages } from './load-all-pages';

it('loads later pages so a manager or site beyond the first page remains available', async () => {
  const records = Array.from({ length: 205 }, (_, index) => ({ id: `record-${index}` }));
  const offsets: number[] = [];
  const result = await loadAllPages(async ({ offset, limit }) => {
    offsets.push(offset);
    return { items: records.slice(offset, offset + limit), total: records.length };
  });
  expect(offsets).toEqual([0, 100, 200]);
  expect(result.items).toEqual(records);
});

it('rejects incomplete results instead of silently reporting a missing manager', async () => {
  await expect(loadAllPages(async () => ({ items: [], total: 1 }))).rejects.toThrow('incomplete');
});

it('does not publish partial data after cancellation', async () => {
  const controller = new AbortController();
  await expect(
    loadAllPages(async () => {
      controller.abort();
      return { items: [{ id: 'a' }], total: 2 };
    }, controller.signal),
  ).rejects.toThrow();
});
