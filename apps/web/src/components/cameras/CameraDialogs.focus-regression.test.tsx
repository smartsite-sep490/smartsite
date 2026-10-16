// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CameraResponse } from '@smartsite/contracts/management';
import i18n from '../../i18n';
import { CameraManagementDialog } from './CameraManagementDialog';
import { CameraRegistrationDialog } from './CameraRegistrationDialog';

const siteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const camera: CameraResponse = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  siteId,
  code: 'CAM-01',
  name: 'Entrance',
  externalId: 'source-camera-01',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-10-15T00:00:00Z',
};
const queries: QueryClient[] = [];

function mount(kind: 'register' | 'manage', status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  const query = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  queries.push(query);
  const onClose = vi.fn();
  const props = {
    open: true,
    onClose,
    apiUrl: 'https://backend.invalid',
    token: 'synthetic-private-token',
    sessionScope: 'current-session',
    credentialId: 1,
    siteId,
    siteName: 'Site Alpha',
    isAdmin: true,
  };
  render(
    <QueryClientProvider client={query}>
      {kind === 'manage' ? (
        <CameraManagementDialog {...props} camera={{ ...camera, status }} />
      ) : (
        <CameraRegistrationDialog {...props} />
      )}
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  queries.splice(0).forEach((query) => query.clear());
  vi.unstubAllGlobals();
});

it.each(['register', 'manage'] as const)(
  '%s moves focus into discard confirmation and restores the initiating field',
  (kind) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { onClose } = mount(kind);
    const field = screen.getByRole('textbox', { name: 'Camera name' });
    fireEvent.change(field, { target: { value: 'Unsaved camera name' } });
    field.focus();
    fireEvent.keyDown(field, { key: 'Escape' });
    const keepEditing = screen.getByRole('button', { name: 'Keep editing' });
    expect(document.activeElement).toBe(keepEditing);
    expect((field as HTMLInputElement).disabled || field.matches(':disabled')).toBe(true);
    fireEvent.click(keepEditing);
    expect(document.activeElement).toBe(field);
    expect((field as HTMLInputElement).value).toBe('Unsaved camera name');
    expect(onClose).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it.each([
  ['ACTIVE', 'Deactivate camera', 'Confirm deactivation'],
  ['INACTIVE', 'Activate camera', 'Confirm activation'],
] as const)(
  'returns focus after cancelling the %s camera status confirmation',
  (status, trigger, confirm) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    mount('manage', status);
    const launch = screen.getByRole('button', { name: trigger });
    launch.focus();
    fireEvent.click(launch);
    const confirmButton = screen.getByRole('button', { name: confirm });
    const cancel = within(confirmButton.parentElement!).getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    expect(screen.queryByRole('button', { name: confirm })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: trigger }));
    expect(fetcher).not.toHaveBeenCalled();
  },
);
