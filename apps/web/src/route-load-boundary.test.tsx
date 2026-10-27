// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PageLoadingFallback, RouteErrorBoundary } from './route-load-boundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps the original sign-out command usable while the shell module is pending', () => {
  const signOut = vi.fn();
  render(<PageLoadingFallback label="Loading protected shell" onSignOut={signOut} />);
  expect(screen.getByRole('status').textContent).toContain('Loading protected shell');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(signOut).toHaveBeenCalledTimes(1);
});

it('retains reload and sign-out after a shell failure without rendering its raw error', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const signOut = vi.fn();
  function Broken(): never {
    throw new Error('CONTROLLED_PRIVATE_CHUNK_FAILURE');
  }
  render(
    <RouteErrorBoundary onSignOut={signOut}>
      <Broken />
    </RouteErrorBoundary>,
  );
  expect(screen.getByRole('alert').textContent).toContain('Unable to load page');
  expect(screen.getByRole('alert').textContent).not.toContain('CONTROLLED_PRIVATE_CHUNK_FAILURE');
  expect(screen.getByRole('button', { name: 'Reload Page' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(signOut).toHaveBeenCalledTimes(1);
});

it('does not add a sign-out action to ordinary public loading fallbacks', () => {
  render(<PageLoadingFallback label="Loading public page" />);
  expect(screen.getByRole('status').textContent).toContain('Loading public page');
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
});

it('renders successful children without the failure-only sign-out action', () => {
  render(
    <RouteErrorBoundary onSignOut={vi.fn()}>
      <main>Allowed page content</main>
    </RouteErrorBoundary>,
  );
  expect(screen.getByRole('main').textContent).toBe('Allowed page content');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
});
