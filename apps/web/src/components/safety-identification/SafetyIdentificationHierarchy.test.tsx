// @vitest-environment jsdom
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import i18n from '../../i18n';
import {
  API_URL,
  CONTRACTOR_1_ID,
  EPISODE_1_ID,
  EVENT_2_ID,
  MANAGER_A_ID,
  REQUEST_1_ID,
  REQUEST_2_ID,
  SEGMENT_1_ID,
  SITE_A_ID,
  WORKER_1_ID,
  WORKSPACE_EN,
  WORKSPACE_VI,
  makeRequest,
  officerSession,
} from './safetyIdentificationTestFixtures';
import {
  openRequestRow,
  renderWorkspace,
  setupWorkspaceTestLifecycle,
} from './safetyIdentificationTestHarness';

describe('SafetyIdentificationWorkspace — operator hierarchy, subject summary, and lifecycle separation (C02 Web)', () => {
  const { getSpies } = setupWorkspaceTestLifecycle();

  it('surfaces originating Inbox return bar at the top of detail, shows human subject summary without leaking UUIDs/hashes, and distinguishes pending proposal vs C02 conclusion vs separate MF08 closure', async () => {
    const spies = getSpies();
    const recipientId = '11111111-2222-4333-8444-555555555555';
    const cameraId = '44444444-4444-4444-8444-444444444444';
    const scopeHash = '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b';

    const respondedTracked = makeRequest({
      id: REQUEST_1_ID,
      siteId: SITE_A_ID,
      episodeId: EPISODE_1_ID,
      status: 'RESPONDED',
      version: 2,
      subject: {
        kind: 'TRACKED',
        segmentId: SEGMENT_1_ID,
        scopeSha256: scopeHash,
      },
      evidenceAvailability: {
        status: 'AVAILABLE',
        reason: null,
      },
      evidenceRefs: ['eeeeeeee-1111-4111-8111-111111111111'],
      reason: 'Confirm walkway person without chin-strap before shift handover',
      result: {
        outcome: 'IDENTIFIED',
        workerId: WORKER_1_ID,
        contractorId: CONTRACTOR_1_ID,
        reason: 'Matched Gate 1 sign-in roster with crew supervisor',
        evidenceRefs: [],
        respondedBy: MANAGER_A_ID,
        respondedAt: '2026-11-19T03:15:00.000Z',
      },
    });

    const closedUnresolvedLocal = makeRequest({
      id: REQUEST_2_ID,
      siteId: SITE_A_ID,
      episodeId: EPISODE_1_ID,
      status: 'CLOSED',
      version: 3,
      subject: {
        kind: 'EVENT_LOCAL',
        eventId: EVENT_2_ID,
        personObservationIndex: 2,
      },
      reason: 'Single-frame perimeter observation with obscured badge',
      result: {
        outcome: 'UNRESOLVED',
        workerId: null,
        contractorId: null,
        reason: 'Visitor left perimeter before supervisor arrived; identity remains unknown',
        evidenceRefs: [],
        respondedBy: MANAGER_A_ID,
        respondedAt: '2026-11-19T03:30:00.000Z',
      },
    });

    spies.listRequests.mockResolvedValue({
      items: [respondedTracked, closedUnresolvedLocal],
      total: 2,
    });
    spies.getRequest.mockImplementation(async (_token, _siteId, id) =>
      id === REQUEST_2_ID ? closedUnresolvedLocal : respondedTracked,
    );
    vi.spyOn(
      SmartSiteManagementClient.prototype,
      'readSafetyIdentificationEvidence',
    ).mockResolvedValue({
      blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
      validUntil: performance.now() + 60_000,
      sha256: 'a'.repeat(64),
      frameSha256: null,
    });

    const { unmount } = renderWorkspace({
      apiUrl: API_URL,
      session: officerSession(),
      initialSiteId: SITE_A_ID,
      initialEpisodeId: EPISODE_1_ID,
      originRecipientId: recipientId,
      originFrameKey: 'event:frame-north-01',
      originCameraId: cameraId,
    });

    // Close auto-opened create panel if open so we inspect the operator detail flow cleanly.
    const closeCreateBtn = screen.queryByRole('button', { name: WORKSPACE_EN.header.closeCreate });
    if (closeCreateBtn) {
      fireEvent.click(closeCreateBtn);
    }

    await openRequestRow(respondedTracked);
    const detailPanel = await screen.findByLabelText(WORKSPACE_EN.detail.title);

    // 1) Originating grouped-Inbox return bar is rendered at the TOP of detail (ahead of Overview & History).
    const returnBar = within(detailPanel).getByTestId('c02-origin-return-bar');
    const overviewHeading = within(detailPanel).getByRole('heading', {
      name: WORKSPACE_EN.detail.title,
    });
    expect(
      Boolean(
        returnBar.compareDocumentPosition(overviewHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    const returnLink = within(returnBar).getByRole('link', {
      name: WORKSPACE_EN.detail.returnToInboxLink,
    });
    expect(returnLink.getAttribute('href')).toContain(`recipientId=${recipientId}`);

    // 2) Subject status strip visibly identifies the tracked subject & approved crop count without leaking raw UUIDs/SHA-256 outside <details>.
    const subjectStrip = within(detailPanel).getByTestId('c02-subject-status-strip');
    expect(subjectStrip.textContent).toContain('Tracked person episode');
    expect(subjectStrip.textContent).toContain('1 approved subject crop');

    const cloneWithoutDetails = detailPanel.cloneNode(true) as HTMLElement;
    cloneWithoutDetails.querySelectorAll('details').forEach((node) => node.remove());
    const primaryVisibleText = cloneWithoutDetails.textContent ?? '';
    expect(primaryVisibleText).not.toContain(SEGMENT_1_ID);
    expect(primaryVisibleText).not.toContain(scopeHash);
    expect(primaryVisibleText).not.toContain(WORKER_1_ID);
    expect(primaryVisibleText).not.toContain(CONTRACTOR_1_ID);

    // 3) Pending Manager proposal is explicitly marked unaccepted, separated from C02 conclusion and MF08 Incident/CAPA.
    const lifecycleStrip = within(detailPanel).getByTestId('c02-lifecycle-separation-strip');
    expect(lifecycleStrip.textContent).toContain('1. Site Manager proposal');
    expect(lifecycleStrip.textContent).toContain('Candidate submitted (unverified)');
    expect(lifecycleStrip.textContent).toContain('2. Officer C02 conclusion');
    expect(lifecycleStrip.textContent).toContain('Not yet accepted');
    expect(lifecycleStrip.textContent).toContain('3. Separate MF08 Incident / CAPA');
    expect(lifecycleStrip.textContent).toContain(
      'Never auto-assigned from UNKNOWN or from closing C02',
    );
    expect(within(detailPanel).getByText('Pending Officer review')).toBeTruthy();

    // 4) Approved subject evidence renders inside a dedicated labeled card.
    const evidenceCard = within(detailPanel).getByTestId('c02-approved-evidence-card');
    expect(within(evidenceCard).getByRole('button', { name: 'Evidence image 1' })).toBeTruthy();

    // 5) Switching to a CLOSED + UNRESOLVED event-local request shows human person #2 summary,
    //    marks C02 conclusion as accepted while explicitly keeping identity unknown & MF08 separate.
    await openRequestRow(closedUnresolvedLocal);
    const closedPanel = await screen.findByLabelText(WORKSPACE_EN.detail.title);
    expect(within(closedPanel).getByTestId('c02-subject-status-strip').textContent).toContain(
      'Observed person #2 (single frame)',
    );
    const closedClone = closedPanel.cloneNode(true) as HTMLElement;
    closedClone.querySelectorAll('details').forEach((node) => node.remove());
    expect(closedClone.textContent ?? '').not.toContain(EVENT_2_ID);

    expect(within(closedPanel).getByText('Accepted request conclusion')).toBeTruthy();
    expect(
      within(closedPanel).getByTestId('c02-lifecycle-separation-strip').textContent,
    ).toContain('Remains unresolved / unknown');

    unmount();

    // 6) Vietnamese locale renders localized subject & lifecycle separation copy cleanly.
    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    renderWorkspace({
      apiUrl: API_URL,
      session: officerSession(),
      initialSiteId: SITE_A_ID,
    });
    await openRequestRow(closedUnresolvedLocal);
    const viPanel = await screen.findByLabelText(WORKSPACE_VI.detail.title);
    expect(within(viPanel).getByTestId('c02-subject-status-strip').textContent).toContain(
      'Người quan sát #2 (khung hình đơn)',
    );
    expect(within(viPanel).getByTestId('c02-lifecycle-separation-strip').textContent).toContain(
      'Không tự động gán nhà thầu từ UNKNOWN hoặc khi đóng C02',
    );
  });
});
