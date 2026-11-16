// @vitest-environment jsdom
import { lazy } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { SafetyRouteBoundary } from './SafetyRouteBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('announces a pending chunk and renders it once ready', async () => {
  let resolve!: (module: { default: () => React.ReactNode }) => void;
  const Page = lazy(
    () =>
      new Promise<{ default: () => React.ReactNode }>((done) => {
        resolve = done;
      }),
  );
  render(
    <MemoryRouter>
      <SafetyRouteBoundary>
        <Page />
      </SafetyRouteBoundary>
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).not.toBeNull();
  await act(async () => resolve({ default: () => <h1>Ready</h1> }));
  expect(screen.getByRole('heading', { name: 'Ready' })).not.toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});

it('keeps navigation usable after a rejected chunk and resets on pathname change', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const Page = lazy(() => Promise.reject(new Error('chunk unavailable')));
  const reload = vi.fn();
  function View() {
    const navigate = useNavigate();
    return (
      <>
        <button onClick={() => navigate('/ppe')}>Open PPE</button>
        <SafetyRouteBoundary onReload={reload}>
          <Current />
        </SafetyRouteBoundary>
      </>
    );
  }
  function Current() {
    const location = useLocation();
    return location.pathname === '/zones' ? <Page /> : <h1>PPE</h1>;
  }
  render(
    <MemoryRouter initialEntries={['/zones']}>
      <View />
    </MemoryRouter>,
  );
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toMatch(/load|tải/i);
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /reload|tải lại/i }));
  expect(reload).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Open PPE' }));
  expect(await screen.findByRole('heading', { name: 'PPE' })).not.toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});
