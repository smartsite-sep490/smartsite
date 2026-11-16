// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  API_URL,
  CONTRACTOR_1_ID,
  EPISODE_1_DETAIL,
  EPISODE_1_ID,
  EPISODE_2_ID,
  MANAGER_A_ID,
  REQUEST_1_ID,
  REQUEST_2_ID,
  SITE_A_ID,
  SITE_B_ID,
  WORKER_1_ID,
  WORKSPACE_EN,
  makeHistoryEntry,
  makeRequest,
  officerSession,
} from './safetyIdentificationTestFixtures';
import {
  openRequestRow,
  renderWorkspace,
  setupWorkspaceTestLifecycle,
} from './safetyIdentificationTestHarness';

const { getSpies } = setupWorkspaceTestLifecycle();

it('returns a closed request to its exact Inbox row and clears the origin when another episode opens', async () => {
  const spies = getSpies();
  const origin = makeRequest({
    id: REQUEST_1_ID,
    siteId: SITE_A_ID,
    episodeId: EPISODE_1_ID,
    status: 'CLOSED',
    reason: 'Originating request',
  });
  const other = makeRequest({
    id: REQUEST_2_ID,
    siteId: SITE_A_ID,
    episodeId: EPISODE_2_ID,
    status: 'CLOSED',
    reason: 'Different episode request',
  });
  spies.listRequests.mockResolvedValue({ items: [origin, other], total: 2 });
  spies.getRequest.mockImplementation(async (_token, _siteId, requestId) =>
    requestId === origin.id ? origin : other,
  );
  const recipientId = '11111111-2222-4333-8444-555555555555';
  const onClearOrigin = vi.fn();
  renderWorkspace({
    apiUrl: API_URL,
    session: officerSession(),
    initialSiteId: SITE_A_ID,
    initialEpisodeId: EPISODE_1_ID,
    originRecipientId: recipientId,
    originFrameKey: 'event:source-frame',
    onClearOrigin,
  });

  await openRequestRow(origin);
  const exact = await screen.findByRole('link', { name: WORKSPACE_EN.detail.returnToInboxLink });
  const route = new URL(exact.getAttribute('href') ?? '', 'http://localhost');
  expect(route.pathname).toBe('/incidents');
  expect(Object.fromEntries(route.searchParams)).toEqual({
    tab: 'episodes',
    siteId: SITE_A_ID,
    recipientId,
    frameKey: 'event:source-frame',
  });
  expect(onClearOrigin).not.toHaveBeenCalled();

  await openRequestRow(other);
  expect(
    await screen.findByRole('link', { name: WORKSPACE_EN.detail.openIncidentsLink }),
  ).toBeTruthy();
  expect(screen.queryByRole('link', { name: WORKSPACE_EN.detail.returnToInboxLink })).toBeNull();
  expect(onClearOrigin).toHaveBeenCalledOnce();
});

it('preserves validated cameraId on active OPEN/RESPONDED requests, strips untrusted origin params, and keeps raw worker/contractor UUIDs inside technical details for Officers', async () => {
  const spies = getSpies();
  const cameraId = '44444444-4444-4444-8444-444444444444';
  const recipientId = '11111111-2222-4333-8444-555555555555';
  const respondedOrigin = makeRequest({
    id: REQUEST_1_ID,
    siteId: SITE_A_ID,
    episodeId: EPISODE_1_ID,
    status: 'RESPONDED',
    version: 2,
    reason: 'Active responded request from grouped frame',
    result: {
      outcome: 'IDENTIFIED',
      workerId: WORKER_1_ID,
      contractorId: CONTRACTOR_1_ID,
      reason: 'Confirmed shift sign-in sheet at Gate 1',
      evidenceRefs: [],
      respondedBy: MANAGER_A_ID,
      respondedAt: '2026-11-11T05:20:00.000Z',
    },
  });

  spies.listRequests.mockResolvedValue({ items: [respondedOrigin], total: 1 });
  spies.getRequest.mockResolvedValue(respondedOrigin);
  spies.listHistory.mockResolvedValue({
    items: [
      makeHistoryEntry(
        2,
        'RESPOND',
        'Submitted shift roster identification',
        MANAGER_A_ID,
        respondedOrigin.result,
      ),
    ],
    total: 1,
  });

  const { unmount } = renderWorkspace({
    apiUrl: API_URL,
    session: officerSession(),
    initialSiteId: SITE_A_ID,
    initialEpisodeId: EPISODE_1_ID,
    originRecipientId: recipientId,
    originFrameKey: 'event:source-frame',
    originCameraId: cameraId,
  });

  await openRequestRow(respondedOrigin);
  const returnLink = await screen.findByRole('link', {
    name: WORKSPACE_EN.detail.returnToInboxLink,
  });
  const route = new URL(returnLink.getAttribute('href') ?? '', 'http://localhost');
  expect(route.pathname).toBe('/incidents');
  expect(Object.fromEntries(route.searchParams)).toEqual({
    tab: 'episodes',
    siteId: SITE_A_ID,
    recipientId,
    frameKey: 'event:source-frame',
    cameraId,
  });

  // Raw workerId and contractorId UUIDs must stay inside <details> and never leak into primary summary cards.
  const detailPanel = screen.getByLabelText(WORKSPACE_EN.detail.title);
  const cloneWithoutDetails = detailPanel.cloneNode(true) as HTMLElement;
  cloneWithoutDetails.querySelectorAll('details').forEach((node) => node.remove());
  expect(cloneWithoutDetails.textContent ?? '').not.toContain(WORKER_1_ID);
  expect(cloneWithoutDetails.textContent ?? '').not.toContain(CONTRACTOR_1_ID);

  const allDetailsText = Array.from(detailPanel.querySelectorAll('details'))
    .map((el) => el.textContent ?? '')
    .join(' ');
  expect(allDetailsText).toContain(WORKER_1_ID);
  expect(allDetailsText).toContain(CONTRACTOR_1_ID);
  unmount();

  // Untrusted originFrameKey or originCameraId props must be dropped even when passed directly.
  renderWorkspace({
    apiUrl: API_URL,
    session: officerSession(),
    initialSiteId: SITE_A_ID,
    initialEpisodeId: EPISODE_1_ID,
    originRecipientId: recipientId,
    originFrameKey: 'javascript:alert(1)',
    originCameraId: '//evil.example/hijack',
  });
  await openRequestRow(respondedOrigin);
  const sanitizedReturn = await screen.findByRole('link', {
    name: WORKSPACE_EN.detail.returnToInboxLink,
  });
  const sanitizedRoute = new URL(sanitizedReturn.getAttribute('href') ?? '', 'http://localhost');
  expect(sanitizedRoute.pathname).toBe('/incidents');
  expect(Object.fromEntries(sanitizedRoute.searchParams)).toEqual({
    tab: 'episodes',
    siteId: SITE_A_ID,
    recipientId,
  });
});

it('clears origin when follow-up or create episode changes and prevents cross-site initialEpisodeId prefill after site switch', async () => {
  const spies = getSpies();
  const episode2 = { ...EPISODE_1_DETAIL, id: EPISODE_2_ID };
  const cancelledOther = makeRequest({
    id: REQUEST_2_ID,
    siteId: SITE_A_ID,
    episodeId: EPISODE_2_ID,
    status: 'CANCELLED',
    reason: 'Cancelled request for second episode',
  });
  spies.listRequests.mockImplementation(async (_token, siteId) =>
    siteId === SITE_A_ID ? { items: [cancelledOther], total: 1 } : { items: [], total: 0 },
  );
  spies.getRequest.mockResolvedValue(cancelledOther);
  spies.listSafetyEpisodes.mockImplementation(async (_token, siteId) => ({
    items: siteId === SITE_A_ID ? [EPISODE_1_DETAIL, episode2] : [],
    total: siteId === SITE_A_ID ? 2 : 0,
  }));

  const onClearOrigin = vi.fn();
  const onActiveSiteChange = vi.fn();
  renderWorkspace({
    apiUrl: API_URL,
    session: officerSession([SITE_A_ID, SITE_B_ID]),
    initialSiteId: SITE_A_ID,
    initialEpisodeId: EPISODE_1_ID,
    originRecipientId: '11111111-2222-4333-8444-555555555555',
    onClearOrigin,
    onActiveSiteChange,
  });

  // Initially on SITE_A_ID, prefilledEpisodeLabel locks onto EPISODE_1_ID
  expect(await screen.findByText(WORKSPACE_EN.createPanel.prefilledEpisodeLabel)).toBeTruthy();

  // Opening follow-up on cancelledOther unlocks the episode dropdown on SITE_A_ID; changing episode clears origin
  await openRequestRow(cancelledOther);
  onClearOrigin.mockClear();
  fireEvent.click(
    await screen.findByRole('button', { name: WORKSPACE_EN.detail.createFollowUpButton }),
  );
  expect(onClearOrigin).toHaveBeenCalledTimes(1);

  const episodeSelect = (await screen.findByLabelText(
    WORKSPACE_EN.createPanel.episodeSelectLabel,
  )) as HTMLSelectElement;
  expect(episodeSelect.value).toBe(EPISODE_2_ID);
  onClearOrigin.mockClear();
  fireEvent.change(episodeSelect, { target: { value: '' } });
  expect(onClearOrigin).toHaveBeenCalledTimes(1);

  // Switching site notifies onActiveSiteChange(SITE_B_ID) and opening Create on SITE_B_ID does not prefill SITE_A_ID's EPISODE_1_ID
  const siteSelect = screen.getByLabelText(WORKSPACE_EN.filters.siteLabel) as HTMLSelectElement;
  fireEvent.change(siteSelect, { target: { value: SITE_B_ID } });
  expect(onActiveSiteChange).toHaveBeenCalledWith(SITE_B_ID);

  fireEvent.click(screen.getByRole('button', { name: WORKSPACE_EN.header.newFromEpisode }));
  expect(screen.queryByText(WORKSPACE_EN.createPanel.prefilledEpisodeLabel)).toBeNull();
  const siteBEpisodeSelect = (await screen.findByLabelText(
    WORKSPACE_EN.createPanel.episodeSelectLabel,
  )) as HTMLSelectElement;
  expect(siteBEpisodeSelect.value).toBe('');
  expect(spies.getSafetyEpisode).not.toHaveBeenCalledWith(
    expect.anything(),
    SITE_B_ID,
    EPISODE_1_ID,
    expect.anything(),
  );
});
