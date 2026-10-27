// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CameraResponse } from '@smartsite/contracts/management';
import i18n from '../../i18n';
import { CameraManagementDialog, type CameraManagementDialogProps } from './CameraManagementDialog';

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMERA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const baseCamera: CameraResponse = {
  id: CAMERA,
  siteId: SITE,
  code: 'CAM-01',
  name: 'Entrance',
  externalId: 'opaque-source-01',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-10-15T00:00:00Z',
};
const queries: QueryClient[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function mount(overrides: Partial<CameraManagementDialogProps> = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  queries.push(client);
  const props: CameraManagementDialogProps = {
    open: true,
    onClose: vi.fn(),
    apiUrl: 'https://backend.invalid',
    token: 'private-token',
    sessionScope: 'session-current',
    credentialId: 1,
    siteId: SITE,
    siteName: 'Site Alpha',
    camera: { ...baseCamera },
    canManageCamera: true,
    onUpdated: vi.fn(),
    onUnauthorized: vi.fn(),
    ...overrides,
  };
  render(
    <QueryClientProvider client={client}>
      <CameraManagementDialog {...props} />
    </QueryClientProvider>,
  );
  return { props, client };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  cleanup();
  queries.splice(0).forEach((query) => query.clear());
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

it.each([200, 409, 403])(
  'keeps deliberate focus on the dialog after HTTP %i instead of stealing it',
  async (status) => {
    const pending = deferred<Response>();
    const fetcher = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetcher);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate camera' }));
    const confirmation = screen.getByRole('button', { name: 'Confirm deactivation' });
    confirmation.focus();
    fireEvent.click(confirmation);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const dialog = screen.getByRole('dialog', { name: 'Manage camera' });
    dialog.focus();
    expect(document.activeElement).toBe(dialog);
    await act(async () => {
      pending.resolve(
        status === 200
          ? Response.json({ ...baseCamera, status: 'INACTIVE', configurationVersion: 4 })
          : Response.json({ message: 'Operation refused' }, { status }),
      );
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirm deactivation' })).toBeNull(),
    );
    expect(document.activeElement).toBe(dialog);
  },
);

it.each([
  {
    initialStatus: 'ACTIVE' as const,
    initialVersion: 3,
    triggerLabel: 'Deactivate camera',
    confirmLabel: 'Confirm deactivation',
    nextStatus: 'INACTIVE' as const,
    nextVersion: 4,
    nextTriggerLabel: 'Activate camera',
  },
  {
    initialStatus: 'INACTIVE' as const,
    initialVersion: 4,
    triggerLabel: 'Activate camera',
    confirmLabel: 'Confirm activation',
    nextStatus: 'ACTIVE' as const,
    nextVersion: 5,
    nextTriggerLabel: 'Deactivate camera',
  },
])(
  'locks dismissal/duplicate submit while pending and restores focus to $nextTriggerLabel after $initialStatus -> $nextStatus success',
  async ({
    initialStatus,
    initialVersion,
    triggerLabel,
    confirmLabel,
    nextStatus,
    nextVersion,
    nextTriggerLabel,
  }) => {
    const pending = deferred<Response>();
    const fetcher = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetcher);

    const { props, client } = mount({
      camera: { ...baseCamera, status: initialStatus, configurationVersion: initialVersion },
    });

    const triggerButton = screen.getByRole('button', { name: triggerLabel });
    triggerButton.focus();
    fireEvent.click(triggerButton);

    const confirmButton = screen.getByRole('button', { name: confirmLabel });
    const cancelConfirm = within(confirmButton.parentElement!).getByRole('button', {
      name: 'Cancel',
    });
    expect(document.activeElement).toBe(cancelConfirm);

    confirmButton.focus();
    act(() => {
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
    });

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const updatingButton = screen.getByRole('button', { name: 'Updating…' }) as HTMLButtonElement;
    const closeButton = screen.getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement;
    expect(updatingButton.disabled).toBe(true);
    expect(closeButton.disabled).toBe(true);

    // Pending status mutation cannot be dismissed or duplicated
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Manage camera' }), { key: 'Escape' });
    fireEvent.click(closeButton);
    fireEvent.click(updatingButton);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);

    const updatedCamera: CameraResponse = {
      ...baseCamera,
      status: nextStatus,
      configurationVersion: nextVersion,
    };
    await act(async () => {
      pending.resolve(Response.json(updatedCamera));
    });

    await waitFor(() => expect(props.onUpdated).toHaveBeenCalledWith(updatedCamera));
    const [url, init] = fetcher.mock.calls[0]! as unknown as [
      string,
      RequestInit & { body: string },
    ];
    expect(url).toBe(`https://backend.invalid/api/v1/sites/${SITE}/cameras/${CAMERA}/status`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      status: nextStatus,
      expectedConfigurationVersion: initialVersion,
    });
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.options.mutationKey),
      ),
    ).not.toContain('private-token');

    expect(screen.queryByRole('button', { name: confirmLabel })).toBeNull();
    const nextTrigger = screen.getByRole('button', { name: nextTriggerLabel }) as HTMLButtonElement;
    expect(nextTrigger.disabled).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(nextTrigger);
  },
);

it('moves focus to Refresh camera instead of document.body when status confirmation unmounts on HTTP 409 conflict', async () => {
  const pending = deferred<Response>();
  const fetcher = vi.fn(() => pending.promise);
  vi.stubGlobal('fetch', fetcher);

  const { props } = mount();
  const deactivateButton = screen.getByRole('button', { name: 'Deactivate camera' });
  deactivateButton.focus();
  fireEvent.click(deactivateButton);

  const confirmButton = screen.getByRole('button', { name: 'Confirm deactivation' });
  confirmButton.focus();
  act(() => {
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
  });

  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Manage camera' }), { key: 'Escape' });
  expect(props.onClose).not.toHaveBeenCalled();

  await act(async () => {
    pending.resolve(
      Response.json({ message: 'SQL rtsp://secret:password@internal' }, { status: 409 }),
    );
  });

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe(
    'Camera metadata conflict. Refresh camera metadata before retrying.',
  );
  expect(alert.textContent).not.toMatch(/SQL|rtsp|password|internal/);
  expect(screen.queryByRole('button', { name: 'Confirm deactivation' })).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Deactivate camera' }) as HTMLButtonElement).disabled,
  ).toBe(true);

  const refreshButton = screen.getByRole('button', { name: 'Refresh camera' }) as HTMLButtonElement;
  expect(refreshButton.disabled).toBe(false);
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).toBe(refreshButton);
});

it('moves focus to an enabled dialog dismissal control instead of document.body when status confirmation unmounts on HTTP 403 denied', async () => {
  const pending = deferred<Response>();
  const fetcher = vi.fn(() => pending.promise);
  vi.stubGlobal('fetch', fetcher);

  const { props } = mount();
  const deactivateButton = screen.getByRole('button', { name: 'Deactivate camera' });
  deactivateButton.focus();
  fireEvent.click(deactivateButton);

  const confirmButton = screen.getByRole('button', { name: 'Confirm deactivation' });
  confirmButton.focus();
  act(() => {
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
  });

  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Manage camera' }), { key: 'Escape' });
  expect(props.onClose).not.toHaveBeenCalled();

  await act(async () => {
    pending.resolve(
      Response.json({ message: 'SQL rtsp://secret:password@internal' }, { status: 403 }),
    );
  });

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).not.toMatch(/SQL|rtsp|password|internal/);
  expect(props.onUnauthorized).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Confirm deactivation' })).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Deactivate camera' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((screen.getByRole('button', { name: 'Save name' }) as HTMLButtonElement).disabled).toBe(
    true,
  );

  const cancelButton = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
  expect(cancelButton.disabled).toBe(false);
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).toBe(cancelButton);
});

it.each([
  {
    status: 'ACTIVE' as const,
    triggerLabel: 'Deactivate camera',
    confirmLabel: 'Confirm deactivation',
    question:
      'Confirm deactivation? This advances camera and active region revisions. Monitoring will be inactive.',
  },
  {
    status: 'INACTIVE' as const,
    triggerLabel: 'Activate camera',
    confirmLabel: 'Confirm activation',
    question: 'Confirm activation? This advances camera and active region revisions.',
  },
])(
  'links Cancel and $confirmLabel buttons to the rendered confirmation question via aria-describedby when $status',
  ({ status, triggerLabel, confirmLabel, question }) => {
    mount({ camera: { ...baseCamera, status } });
    fireEvent.click(screen.getByRole('button', { name: triggerLabel }));

    const confirmButton = screen.getByRole('button', { name: confirmLabel });
    const cancelConfirm = within(confirmButton.parentElement!).getByRole('button', {
      name: 'Cancel',
    });
    const prompt = screen.getByText(question);

    expect(confirmButton.parentElement?.previousElementSibling).toBe(prompt);
    expect(prompt.id).toBeTruthy();
    expect(cancelConfirm.getAttribute('aria-describedby')).toBe(prompt.id);
    expect(confirmButton.getAttribute('aria-describedby')).toBe(prompt.id);
  },
);
