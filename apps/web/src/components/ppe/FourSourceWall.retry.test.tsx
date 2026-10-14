// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { FourSourceWallTile } from './FourSourceWall';

const state = vi.hoisted(() => ({
  errorStatus: null as number | null,
  isPolling: false,
  retry: vi.fn(),
}));
vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: null,
    status: 'UNAVAILABLE',
    sourceKind: null,
    capturedAt: null,
    error: 'Snapshot unavailable',
    errorStatus: state.errorStatus,
    isPolling: state.isPolling,
    retry: state.retry,
  }),
}));
const camera: CameraResponse = {
  id: 'camera-one',
  siteId: 'site-one',
  code: 'CAM-01',
  name: 'Camera One',
  externalId: 'CAM-01',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-10-10T00:00:00Z',
};
const client = new SmartSiteManagementClient('http://127.0.0.1:3000');
const select = vi.fn();
function tile() {
  return (
    <FourSourceWallTile
      apiUrl="http://127.0.0.1:3000"
      client={client}
      token="synthetic-token"
      sessionScope="synthetic-scope"
      credentialId={1}
      siteId="site-one"
      camera={camera}
      isSelected={false}
      onSelect={select}
      enabled
      showModelObjects={false}
    />
  );
}
beforeEach(() => {
  state.errorStatus = null;
  state.isPolling = false;
  state.retry.mockReset();
  select.mockReset();
});
afterEach(cleanup);

describe('wall tile retry and keyboard recovery', () => {
  it.each([401, 403, 429])('prevents ineffective Retry interaction for HTTP %s', async (status) => {
    state.errorStatus = status;
    render(tile());
    const retry = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    await userEvent.setup().click(retry);
    expect(state.retry).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    if (status === 429)
      expect(screen.getByRole('status').textContent).toContain(
        'Automatic retry resumes after server cooldown.',
      );
  });

  it('prevents a second manual request while the snapshot is fetching', async () => {
    state.isPolling = true;
    render(tile());
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).not.toHaveBeenCalled();
  });

  it('reenables manual recovery after cooldown changes to service unavailable without selecting the tile', async () => {
    state.errorStatus = 429;
    const rendered = render(tile());
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    state.errorStatus = 503;
    rendered.rerender(tile());
    expect(screen.queryByRole('status')).toBeNull();
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Retry' }).focus();
    await user.keyboard('{Enter}');
    expect(state.retry).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
  });

  it('keeps the native Focus action usable with a keyboard while retry is blocked', async () => {
    state.errorStatus = 403;
    render(tile());
    screen.getByRole('button', { name: 'Focus' }).focus();
    await userEvent.setup().keyboard(' ');
    expect(select).toHaveBeenCalledExactlyOnceWith('camera-one');
    expect(state.retry).not.toHaveBeenCalled();
  });
});
