// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RegisterScreen } from './RegisterScreen';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('explains administrator-provisioned access without collecting credentials or offering fake registration', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<RegisterScreen onBackToLogin={vi.fn()} onBackToSite={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Get access to SmartSite' })).toBeDefined();
  expect(screen.getByText(/ask your SmartSite administrator/i)).toBeDefined();
  expect(document.querySelector('form')).toBeNull();
  expect(document.querySelector('input')).toBeNull();
  expect(screen.queryByRole('button', { name: /create account/i })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('lets keyboard users return directly to sign in or the homepage', async () => {
  const user = userEvent.setup();
  const signIn = vi.fn();
  const home = vi.fn();
  render(<RegisterScreen onBackToLogin={signIn} onBackToSite={home} />);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to homepage' }));
  await user.keyboard('{Enter}');
  expect(home).toHaveBeenCalledTimes(1);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose language' }));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in' }));
  await user.keyboard('{Enter}');
  expect(signIn).toHaveBeenCalledTimes(1);
});
