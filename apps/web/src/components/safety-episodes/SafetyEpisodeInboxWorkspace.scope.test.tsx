// @vitest-environment jsdom
import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type { SafetyEpisodeReadResponse } from '@smartsite/contracts/safety-episodes';
import { changeUiLanguage } from '../../i18n/runtime';
import {
  SafetyEpisodeInboxWorkspace,
  type SafetyEpisodeInboxClient,
} from './SafetyEpisodeInboxWorkspace';
import {
  createDeferred,
  createTestQueryClient,
  ITEM_A_1,
  ITEM_B_1,
  renderWorkspace,
  SITE_A_ID,
  SITE_B_ID,
} from './safety-episode-inbox.test-support';

describe('SafetyEpisodeInboxWorkspace — scope isolation and hard denial', () => {
  beforeEach(() => {
    window.localStorage.clear();
    changeUiLanguage('en');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('hides previous rows, aborts in-flight requests, blocks late read responses on Site/scope/token changes, and never leaks raw token into query keys or DOM', async () => {
    const staleReadDeferred = createDeferred<SafetyEpisodeReadResponse>();
    let capturedReadSignal: AbortSignal | undefined;

    const listMock = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockResolvedValueOnce({
        items: [ITEM_A_1, ITEM_B_1],
        total: 2,
        unreadCount: 1,
      })
      .mockResolvedValueOnce({
        items: [ITEM_B_1],
        total: 1,
        unreadCount: 0,
      });

    const readMock = vi
      .fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>()
      .mockImplementationOnce((_token, _id, _input, requestOptions) => {
        capturedReadSignal = requestOptions?.signal;
        return staleReadDeferred.promise;
      });

    const client: SafetyEpisodeInboxClient = {
      listSafetyEpisodeInbox: listMock,
      readSafetyEpisodeInbox: readMock,
    };

    const queryClient = createTestQueryClient();
    const { rerender, props } = renderWorkspace({ client }, queryClient);

    await waitFor(() => {
      expect(screen.getByTestId(`safety-inbox-open-${ITEM_A_1.id}`)).toBeTruthy();
    });

    // Verify raw token is never in query keys or DOM text
    const cachedKeysJson = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((entry) => entry.queryKey),
    );
    expect(cachedKeysJson).not.toContain(props.token);
    expect(document.body.textContent ?? '').not.toContain(props.token);

    // Start mark-read on ITEM_A_1 (remains pending)
    fireEvent.click(screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`));
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(capturedReadSignal?.aborted).toBe(false);

    // Revoke SITE_A from authorized sites and rotate token/scopeKey
    rerender(
      <QueryClientProvider client={queryClient}>
        <SafetyEpisodeInboxWorkspace
          {...props}
          client={client}
          token="rotated-jwt-token-inbox-beta"
          scopeKey="user-1::org-1::safety-inbox-revoked-a"
          sites={[{ id: SITE_B_ID, name: 'South Depot' }]}
        />
      </QueryClientProvider>,
    );

    // In-flight mark-read from previous scope is aborted and SITE_A row is immediately gone
    expect(capturedReadSignal?.aborted).toBe(true);
    expect(screen.queryByTestId(`safety-inbox-open-${ITEM_A_1.id}`)).toBeNull();
    expect(screen.queryByTestId(`safety-inbox-site-group-${SITE_A_ID}`)).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId(`safety-inbox-open-${ITEM_B_1.id}`)).toBeTruthy();
    });

    // Late resolution of the stale read response from the old scope cannot leak or trigger refetch
    const listCallsBeforeLateResolve = listMock.mock.calls.length;
    await act(async () => {
      staleReadDeferred.resolve({
        id: ITEM_A_1.id,
        contentRevision: 2,
        seenRevision: 2,
        unread: false,
      });
    });

    expect(listMock).toHaveBeenCalledTimes(listCallsBeforeLateResolve);
    expect(screen.queryByTestId(`safety-inbox-open-${ITEM_A_1.id}`)).toBeNull();
    expect(screen.getByTestId(`safety-inbox-site-count-${SITE_B_ID}`).textContent).toContain(
      'Loaded rows: 1',
    );
  });

  it('aborts pending read after hard list denial and ignores its late acknowledgement', async () => {
    const pending = createDeferred<SafetyEpisodeReadResponse>();
    const captured: { signal?: AbortSignal } = {};
    const list = vi
      .fn<SafetyEpisodeInboxClient['listSafetyEpisodeInbox']>()
      .mockResolvedValueOnce({ items: [ITEM_A_1], total: 1, unreadCount: 1 })
      .mockRejectedValueOnce(new ApiError('http', 'Scoped metadata denied', 403))
      .mockResolvedValue({ items: [ITEM_A_1], total: 1, unreadCount: 1 });
    const read = vi.fn<SafetyEpisodeInboxClient['readSafetyEpisodeInbox']>(
      (_token, _id, _input, options) => {
        captured.signal = options?.signal;
        return pending.promise;
      },
    );
    const { queryClient } = renderWorkspace({
      client: { listSafetyEpisodeInbox: list, readSafetyEpisodeInbox: read },
    });
    await waitFor(() =>
      expect(screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`)).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId(`safety-inbox-mark-read-${ITEM_A_1.id}`));
    await act(async () => {
      await queryClient.refetchQueries();
    });
    await waitFor(() => expect(screen.getByTestId('safety-inbox-forbidden')).toBeTruthy());
    expect(captured.signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve({ id: ITEM_A_1.id, contentRevision: 2, seenRevision: 2, unread: false });
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId(`safety-inbox-open-${ITEM_A_1.id}`)).toBeNull();
  });
});
