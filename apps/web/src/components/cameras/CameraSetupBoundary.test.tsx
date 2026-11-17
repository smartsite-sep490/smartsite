// @vitest-environment jsdom
import { lazy, Suspense } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CameraSetupBoundary } from './CameraSetupBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('contains a rejected lazy route, preserves the shell, and offers explicit reload', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = lazy(() => Promise.reject(new Error('chunk unavailable')));
  const reload = vi.fn();
  render(
    <>
      <nav>Shell navigation</nav>
      <CameraSetupBoundary onReload={reload}>
        <Suspense fallback={<p>Loading</p>}>
          <Broken />
        </Suspense>
      </CameraSetupBoundary>
    </>,
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('navigation').textContent).toBe('Shell navigation');
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button'));
  expect(reload).toHaveBeenCalledTimes(1);
});

it('does not retain a failed screen after leaving and remounting the route', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function Broken(): never {
    throw new Error('chunk unavailable');
  }
  const first = render(
    <CameraSetupBoundary>
      <Broken />
    </CameraSetupBoundary>,
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  first.unmount();
  render(
    <CameraSetupBoundary>
      <h2>Loaded camera setup</h2>
    </CameraSetupBoundary>,
  );
  expect(screen.getByRole('heading', { name: 'Loaded camera setup' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
