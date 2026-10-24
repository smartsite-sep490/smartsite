// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeferredAppLayout } from './deferred-app-layout';
import i18n from './i18n';

const layoutLoadState = vi.hoisted(() => ({
  rejectLoad: null as ((reason?: unknown) => void) | null,
}));

vi.mock('./components/layout/AppLayout', () => {
  return new Promise<typeof import('./components/layout/AppLayout')>((_resolve, reject) => {
    layoutLoadState.rejectLoad = reject;
  });
});

describe('DeferredAppLayout lazy shell rejection boundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    layoutLoadState.rejectLoad = null;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    cleanup();
    consoleErrorSpy.mockRestore();
    await i18n.changeLanguage('en');
  });

  it('exposes Sign out while shell chunk is pending and falls back to a safe alert with Reload Page and Sign out on rejection without mounting protected children', async () => {
    const onLoadSignOut = vi.fn();

    const { container } = render(
      <MemoryRouter initialEntries={['/ppe']}>
        <DeferredAppLayout onLoadSignOut={onLoadSignOut}>
          <div data-testid="protected-workspace-child">Confidential PPE Workspace</div>
        </DeferredAppLayout>
      </MemoryRouter>,
    );

    const loadingStatus = screen.getByRole('status');
    expect(loadingStatus).toBeTruthy();
    expect(screen.queryByTestId('protected-workspace-child')).toBeNull();

    const pendingSignOutBtn = within(loadingStatus).getByRole('button', { name: 'Sign out' });
    fireEvent.click(pendingSignOutBtn);
    expect(onLoadSignOut).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(layoutLoadState.rejectLoad).toBeTypeOf('function'));
    const controlledError = new Error('private-bearer-token-shell-chunk-failed');

    await act(async () => {
      layoutLoadState.rejectLoad?.(controlledError);
    });

    const alertRegion = await screen.findByRole('alert');
    expect(within(alertRegion).getByRole('heading', { name: 'Unable to load page' })).toBeTruthy();
    expect(within(alertRegion).getByRole('button', { name: 'Reload Page' })).toBeTruthy();

    const errorSignOutBtn = within(alertRegion).getByRole('button', { name: 'Sign out' });
    fireEvent.click(errorSignOutBtn);
    expect(onLoadSignOut).toHaveBeenCalledTimes(2);

    expect(screen.queryByTestId('protected-workspace-child')).toBeNull();
    expect(screen.queryByText(/private-bearer-token-shell-chunk-failed/i)).toBeNull();
    expect(container.textContent).not.toContain('private-bearer-token-shell-chunk-failed');
  });
});
