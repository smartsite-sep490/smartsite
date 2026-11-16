// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SafetyIdentificationEvidenceImage } from './SafetyIdentificationEvidenceImage';

it('loads on demand, revokes the displayed URL and discards late bytes after unmount', async () => {
  const create = vi.fn(() => 'blob:approved-evidence');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const blob = new Blob([], { type: 'image/jpeg' });
  let finish!: (image: { blob: Blob; validUntil: number }) => void;
  const load = vi.fn<(signal: AbortSignal) => Promise<{ blob: Blob; validUntil: number }>>(
    () =>
      new Promise<{ blob: Blob; validUntil: number }>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <SafetyIdentificationEvidenceImage load={load} vietnamese={false} number={1} />,
  );
  try {
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Evidence image 1' }));
    await act(async () => finish({ blob, validUntil: performance.now() + 60_000 }));
    expect(screen.getByRole('img').getAttribute('src')).toBe('blob:approved-evidence');
    fireEvent.click(screen.getByRole('button', { name: 'Close image' }));
    expect(revoke).toHaveBeenCalledWith('blob:approved-evidence');
    fireEvent.click(screen.getByRole('button', { name: 'Evidence image 1' }));
    const signal = load.mock.calls.at(-1)?.[0];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish({ blob, validUntil: performance.now() + 60_000 }));
    expect(create).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
  }
});

it('removes an open image when its server-provided lifetime ends', async () => {
  vi.useFakeTimers();
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = () => 'blob:expiring';
      static revokeObjectURL = revoke;
    },
  );
  const view = render(
    <SafetyIdentificationEvidenceImage
      load={async () => ({ blob: new Blob(), validUntil: performance.now() + 1000 })}
      vietnamese={false}
      number={1}
    />,
  );
  try {
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Evidence image 1' })),
    );
    expect(screen.getByRole('img')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1001));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('unavailable');
    expect(revoke).toHaveBeenCalledWith('blob:expiring');
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
