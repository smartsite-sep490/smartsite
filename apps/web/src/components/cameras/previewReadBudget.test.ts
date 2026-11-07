import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { deferPreviewReads, waitForPreviewRead } from './previewReadBudget';

describe('preview budget elapsed time', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-11-07T00:00:00Z'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('refills a waiting read after elapsed time when the wall clock moves backward', async () => {
    const client = new QueryClient();
    const signal = new AbortController().signal;
    for (let index = 0; index < 4; index++)
      await waitForPreviewRead(client, 'http://localhost:3000', signal);
    let admitted = false;
    void waitForPreviewRead(client, 'http://localhost:3000', signal).then(() => {
      admitted = true;
    });
    vi.setSystemTime(Date.now() - 3_600_000);
    await vi.advanceTimersByTimeAsync(650);
    expect(admitted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    client.clear();
  });

  it('keeps a server retry delay when the wall clock moves forward', async () => {
    const client = new QueryClient();
    deferPreviewReads(client, 'http://localhost:3000', 60);
    vi.setSystemTime(Date.now() + 3_600_000);
    let admitted = false;
    void waitForPreviewRead(client, 'http://localhost:3000', new AbortController().signal).then(
      () => {
        admitted = true;
      },
    );
    await vi.advanceTimersByTimeAsync(59_999);
    expect(admitted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(admitted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    client.clear();
  });
});
