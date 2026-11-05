// @vitest-environment jsdom
import { lazy, Suspense } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { SafetyMonitorBoundary } from './SafetyMonitorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('contains a rejected lazy monitor route, preserves the shell, and offers explicit reload', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = lazy(() => Promise.reject(new Error('monitor chunk unavailable')));
  const reload = vi.fn();
  render(
    <MemoryRouter initialEntries={['/live-monitoring']}>
      <nav>Shell navigation</nav>
      <SafetyMonitorBoundary onReload={reload}>
        <Suspense fallback={<p>Loading</p>}>
          <Broken />
        </Suspense>
      </SafetyMonitorBoundary>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('navigation').textContent).toBe('Shell navigation');
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button'));
  expect(reload).toHaveBeenCalledTimes(1);
});

it('resets error state when pathname changes from /ppe to /zones', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function BrokenPpe(): never {
    throw new Error('ppe monitor failed');
  }
  render(
    <MemoryRouter initialEntries={['/ppe']}>
      <nav>
        <Link to="/zones">Open Zones</Link>
      </nav>
      <Routes>
        <Route
          path="/ppe"
          element={
            <SafetyMonitorBoundary>
              <BrokenPpe />
            </SafetyMonitorBoundary>
          }
        />
        <Route
          path="/zones"
          element={
            <SafetyMonitorBoundary>
              <h2>Zones monitor ready</h2>
            </SafetyMonitorBoundary>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Open Zones' }));
  expect(await screen.findByRole('heading', { name: 'Zones monitor ready' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
