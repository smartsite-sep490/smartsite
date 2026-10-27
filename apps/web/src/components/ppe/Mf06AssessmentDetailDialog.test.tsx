// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mf06AssessmentDetailDialog } from './Mf06AssessmentDetailDialog';
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraResponse,
  type Mf06AssessmentResponse,
} from '@smartsite/api-client';
import type { AssessmentTargetContext } from './mf06AssessmentDetailBinding';

type CameraCatalogItem = Pick<CameraResponse, 'id' | 'siteId' | 'code' | 'name'>;

const SITE_1 = '33333333-3333-4333-8333-333333333331';
const CREDENTIAL_1 = 'cred-test-1';
const TOKEN_1 = 'token-test-1';

const sampleTarget: AssessmentTargetContext = {
  assessmentId: '11111111-1111-4111-8111-111111111111',
  siteId: SITE_1,
  requestId: '22222222-2222-4222-8222-222222222222',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  capturedAt: '2026-10-12T10:00:00.123456Z',
};

const sampleRecord: Mf06AssessmentResponse = {
  assessmentId: sampleTarget.assessmentId,
  siteId: sampleTarget.siteId,
  requestId: sampleTarget.requestId,
  eventId: sampleTarget.eventId,
  cameraId: sampleTarget.cameraId,
  zoneId: sampleTarget.zoneId,
  capturedAt: '2026-10-12T10:00:00.123456000Z',
  assessedAt: '2026-10-12T10:00:02.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  outcome: 'UNAVAILABLE',
  reasonCode: 'IDENTITY_UNAVAILABLE',
  evaluatorVersion: 'SYNTHETIC_READ_V1',
  provenance: 'UNAVAILABLE',
};

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
});

function mount(ui: (queries: QueryClient) => React.ReactElement) {
  const queries = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  clients.push(queries);
  const view = render(<QueryClientProvider client={queries}>{ui(queries)}</QueryClientProvider>);
  return {
    ...view,
    queries,
  };
}

describe('Mf06AssessmentDetailDialog', () => {
  let mockGetMf06Assessment: ReturnType<typeof vi.fn>;
  let mockClient: SmartSiteManagementClient;

  beforeEach(() => {
    mockGetMf06Assessment = vi.fn().mockResolvedValue(sampleRecord);
    mockClient = {
      getMf06AssessmentFrame: vi
        .fn()
        .mockRejectedValue(new ApiError('http', 'No frame fixture', 404)),
      getMf06Assessment: mockGetMf06Assessment,
    } as unknown as SmartSiteManagementClient;
  });

  it.each([
    ['PARTIAL', 1, 'Frame data incomplete · 1/2 parts'],
    ['COMPLETE', 2, 'All frame data received · 2/2 parts'],
  ] as const)('shows %s on the bound detail', async (status, receivedParts, label) => {
    mockGetMf06Assessment.mockResolvedValue({
      ...sampleRecord,
      frameDelivery: {
        frameId: '00000000-0000-4000-8000-000000000401',
        sequenceNumber: '9007199254740994',
        partCount: 2,
        receivedParts,
        status,
      },
    });
    mount(() => (
      <Mf06AssessmentDetailDialog
        open
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));
    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.getByText('Identity Unavailable')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
  });
  it('renders dialog with title "Recorded assessment" and fetches assessment via client', async () => {
    mount(() => (
      <Mf06AssessmentDetailDialog
        open={true}
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    const dialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
    expect(dialog).toBeTruthy();

    await waitFor(() => {
      expect(mockGetMf06Assessment).toHaveBeenCalledWith(
        TOKEN_1,
        SITE_1,
        sampleTarget.assessmentId,
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    expect(await screen.findByText('Identity Unavailable')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText('Allowed')).toBeNull();
    expect(
      screen.getByText(/This record represents a historical technical assessment projection/i),
    ).toBeTruthy();
  });

  it('rejects data mismatch on UUID and shows alert without displaying record', async () => {
    mockGetMf06Assessment.mockResolvedValue({
      ...sampleRecord,
      requestId: '99999999-9999-4999-8999-999999999999',
      frameDelivery: {
        frameId: '00000000-0000-4000-8000-000000000401',
        sequenceNumber: '9007199254740994',
        partCount: 2,
        receivedParts: 1,
        status: 'PARTIAL',
      },
    });

    mount(() => (
      <Mf06AssessmentDetailDialog
        open={true}
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    expect(
      await screen.findByText(/Assessment record does not match expected request context/i),
    ).toBeTruthy();
    expect(screen.queryByText('Identity Unavailable')).toBeNull();
    expect(screen.queryByText(/Frame data incomplete/)).toBeNull();
  });

  it('rejects mismatch on capturedAt microsecond precision (.123456 vs .123457)', async () => {
    mockGetMf06Assessment.mockResolvedValue({
      ...sampleRecord,
      capturedAt: '2026-10-12T10:00:00.123457Z',
    });

    mount(() => (
      <Mf06AssessmentDetailDialog
        open={true}
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    expect(
      await screen.findByText(/Assessment record does not match expected request context/i),
    ).toBeTruthy();
  });

  it('handles hard 401 error: calls onUnauthorized once and purges cache', async () => {
    mockGetMf06Assessment.mockRejectedValue(new ApiError('http', 'Unauthorized', 401));
    const onUnauthorized = vi.fn();

    mount(() => (
      <Mf06AssessmentDetailDialog
        open={true}
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        onUnauthorized={onUnauthorized}
      />
    ));

    expect(
      await screen.findByText('Session expired or unauthorized. Please sign in again.'),
    ).toBeTruthy();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('handles hard 403 Forbidden: displays error without calling onUnauthorized', async () => {
    mockGetMf06Assessment.mockRejectedValue(new ApiError('http', 'Forbidden', 403));
    const onUnauthorized = vi.fn();

    mount(() => (
      <Mf06AssessmentDetailDialog
        open={true}
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        onUnauthorized={onUnauthorized}
      />
    ));

    expect(
      await screen.findByText('You do not have permission to view this assessment.'),
    ).toBeTruthy();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('handles hard 404 Not Found: displays specific unavailable message', async () => {
    mockGetMf06Assessment.mockRejectedValue(new ApiError('http', 'Not Found', 404));

    mount(() => (
      <Mf06AssessmentDetailDialog
        open={true}
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    expect(await screen.findByText('Assessment record not found or unavailable.')).toBeTruthy();
  });

  it('supports retry on 503 Service Unavailable', async () => {
    mockGetMf06Assessment
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503))
      .mockResolvedValueOnce(sampleRecord);

    mount(() => (
      <Mf06AssessmentDetailDialog
        open={true}
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    expect(
      await screen.findByText('Assessment service temporarily unavailable (503).'),
    ).toBeTruthy();

    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    expect(await screen.findByText('Identity Unavailable')).toBeTruthy();
  });

  it('dismisses and hides data on scope rotation in same render', async () => {
    const onClose = vi.fn();
    function Harness() {
      const [token, setToken] = React.useState(TOKEN_1);
      return (
        <div>
          <button onClick={() => setToken('new-token')}>Rotate</button>
          <Mf06AssessmentDetailDialog
            open={true}
            onClose={onClose}
            target={sampleTarget}
            token={token}
            siteId={SITE_1}
            credentialId={CREDENTIAL_1}
            client={mockClient}
          />
        </div>
      );
    }

    mount(() => <Harness />);
    expect(await screen.findByText('Identity Unavailable')).toBeTruthy();

    fireEvent.click(screen.getByText('Rotate'));
    expect(onClose).toHaveBeenCalled();
  });

  it('abort signal triggers on dialog close', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockGetMf06Assessment.mockImplementation(
      (_t: string, _s: string, _id: string, opts: { signal?: AbortSignal }) => {
        capturedSignal = opts?.signal;
        return new Promise(() => {});
      },
    );

    const onClose = vi.fn();
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <Mf06AssessmentDetailDialog
          open={true}
          onClose={onClose}
          target={sampleTarget}
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(capturedSignal).toBeDefined());
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('aborts in-flight query when parent sets open=false via onClose state', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockGetMf06Assessment.mockImplementation(
      (_t: string, _s: string, _id: string, opts: { signal?: AbortSignal }) => {
        capturedSignal = opts?.signal;
        return new Promise(() => {});
      },
    );

    function Harness() {
      const [open, setOpen] = React.useState(true);
      return (
        <div>
          <button onClick={() => setOpen(false)}>Close Dialog</button>
          <Mf06AssessmentDetailDialog
            open={open}
            onClose={() => setOpen(false)}
            target={sampleTarget}
            token={TOKEN_1}
            siteId={SITE_1}
            credentialId={CREDENTIAL_1}
            client={mockClient}
          />
        </div>
      );
    }

    mount(() => <Harness />);
    await waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);

    fireEvent.click(screen.getByText('Close Dialog'));
    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
  });

  it('supports scope rotation while closed followed by legitimate reopen without stale dismissal', async () => {
    const SITE_2 = '44444444-4444-4444-8444-444444444442';
    const target2: AssessmentTargetContext = {
      ...sampleTarget,
      siteId: SITE_2,
      assessmentId: '22222222-2222-4222-8222-222222222222',
    };
    const record2: Mf06AssessmentResponse = {
      ...sampleRecord,
      siteId: SITE_2,
      assessmentId: target2.assessmentId,
    };

    mockGetMf06Assessment.mockImplementation((_t: string, siteId: string) => {
      if (siteId === SITE_2) return Promise.resolve(record2);
      return Promise.resolve(sampleRecord);
    });

    const onClose = vi.fn();
    function Harness() {
      const [open, setOpen] = React.useState(false);
      const [site, setSite] = React.useState(SITE_1);
      const [target, setTarget] = React.useState<AssessmentTargetContext | null>(sampleTarget);

      return (
        <div>
          <button
            onClick={() => {
              setSite(SITE_2);
              setTarget(target2);
            }}
          >
            Switch Site Closed
          </button>
          <button onClick={() => setOpen(true)}>Open Dialog</button>
          <Mf06AssessmentDetailDialog
            open={open}
            onClose={onClose}
            target={target}
            token={TOKEN_1}
            siteId={site}
            credentialId={CREDENTIAL_1}
            client={mockClient}
          />
        </div>
      );
    }

    mount(() => <Harness />);
    // Rotate scope while dialog is closed
    fireEvent.click(screen.getByText('Switch Site Closed'));
    expect(onClose).not.toHaveBeenCalled();

    // Reopen dialog with new scope
    fireEvent.click(screen.getByText('Open Dialog'));
    await waitFor(() => {
      expect(mockGetMf06Assessment).toHaveBeenCalledWith(
        TOKEN_1,
        SITE_2,
        target2.assessmentId,
        expect.objectContaining({ signal: expect.anything() }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('triggers onClose when apiUrl rotates while dialog is open', async () => {
    const onClose = vi.fn();
    function Harness() {
      const [apiUrl, setApiUrl] = React.useState('http://localhost:3000');
      return (
        <div>
          <button onClick={() => setApiUrl('https://api.smartsite.internal')}>Rotate API</button>
          <Mf06AssessmentDetailDialog
            open={true}
            onClose={onClose}
            target={sampleTarget}
            token={TOKEN_1}
            siteId={SITE_1}
            credentialId={CREDENTIAL_1}
            apiUrl={apiUrl}
            client={mockClient}
          />
        </div>
      );
    }

    mount(() => <Harness />);
    expect(await screen.findByText('Identity Unavailable')).toBeTruthy();

    fireEvent.click(screen.getByText('Rotate API'));
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores late response/error from previous scope and does not trigger onAccessError for new scope', async () => {
    let rejectOldRequest: ((err: Error) => void) | undefined;
    mockGetMf06Assessment.mockImplementation((_t: string, siteId: string) => {
      if (siteId === SITE_1) {
        return new Promise((_, reject) => {
          rejectOldRequest = reject;
        });
      }
      return Promise.resolve(sampleRecord);
    });

    const onAccessError = vi.fn();
    const onClose = vi.fn();

    function Harness() {
      const [siteId, setSiteId] = React.useState(SITE_1);
      return (
        <div>
          <button onClick={() => setSiteId('new-site-id')}>Change Site</button>
          <Mf06AssessmentDetailDialog
            open={true}
            onClose={onClose}
            target={sampleTarget}
            token={TOKEN_1}
            siteId={siteId}
            credentialId={CREDENTIAL_1}
            client={mockClient}
            onAccessError={onAccessError}
          />
        </div>
      );
    }

    mount(() => <Harness />);
    await waitFor(() => expect(rejectOldRequest).toBeDefined());

    // Change scope so old request belongs to previous scope
    fireEvent.click(screen.getByText('Change Site'));

    // Late rejection from old request with 401
    act(() => {
      rejectOldRequest!(new ApiError('http', 'Old session expired', 401));
    });

    // Access error must NOT be invoked because it belongs to old scope
    expect(onAccessError).not.toHaveBeenCalled();
  });

  it('current camera catalog renders matched same-Site camera label outside default-collapsed technical details while keeping raw assessment, request, event, camera, and zone IDs inside details', async () => {
    const cameraCatalog: ReadonlyArray<CameraCatalogItem> = [
      {
        id: sampleTarget.cameraId.toUpperCase(),
        siteId: SITE_1,
        code: 'CAM-01',
        name: 'North Gate Camera',
      },
    ];

    mount(() => (
      <Mf06AssessmentDetailDialog
        open={true}
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        cameraCatalog={cameraCatalog}
      />
    ));

    const dialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
    expect(await screen.findByText('Identity Unavailable')).toBeTruthy();
    expect(screen.getByText('Camera (current catalog)')).toBeTruthy();
    expect(screen.getByText(/North Gate Camera/)).toBeTruthy();
    expect(screen.getByText(/CAM-01/)).toBeTruthy();

    const details = dialog.querySelector('details');
    expect(details).toBeTruthy();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).not.toContain('North Gate Camera');
    expect(details?.textContent).not.toContain('CAM-01');
    expect(details?.textContent).toContain(sampleRecord.cameraId);
    expect(details?.textContent).toContain(sampleRecord.zoneId);
    expect(details?.textContent).toContain(sampleRecord.assessmentId);
    expect(details?.textContent).toContain(sampleRecord.requestId);
    expect(details?.textContent).toContain(sampleRecord.eventId);
    expect(details?.textContent).toContain(sampleRecord.provenance);
  });

  it('current camera catalog withholds foreign-Site camera label and clears label when rerendered without catalog', async () => {
    const foreignCatalog: ReadonlyArray<CameraCatalogItem> = [
      {
        id: sampleTarget.cameraId,
        siteId: '99999999-9999-4999-8999-999999999999',
        code: 'CAM-FOREIGN',
        name: 'Foreign Gate Camera',
      },
    ];
    const sameSiteCatalog: ReadonlyArray<CameraCatalogItem> = [
      {
        id: sampleTarget.cameraId,
        siteId: SITE_1,
        code: 'CAM-01',
        name: 'North Gate Camera',
      },
    ];

    const ui = (catalog?: ReadonlyArray<CameraCatalogItem>) => (
      <Mf06AssessmentDetailDialog
        open={true}
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        cameraCatalog={catalog}
      />
    );
    const view = mount(() => ui(foreignCatalog));
    expect(await screen.findByText('Identity Unavailable')).toBeTruthy();
    expect(screen.queryByText('Camera (current catalog)')).toBeNull();
    expect(screen.queryByText(/Foreign Gate Camera/)).toBeNull();

    view.rerender(
      <QueryClientProvider client={view.queries}>{ui(sameSiteCatalog)}</QueryClientProvider>,
    );
    expect(screen.getByText('Camera (current catalog)')).toBeTruthy();
    expect(screen.getByText(/North Gate Camera/)).toBeTruthy();
    expect(screen.getByText(/CAM-01/)).toBeTruthy();

    view.rerender(<QueryClientProvider client={view.queries}>{ui(undefined)}</QueryClientProvider>);
    expect(screen.queryByText('Camera (current catalog)')).toBeNull();
    expect(screen.queryByText(/North Gate Camera/)).toBeNull();
    expect(screen.queryByText(/CAM-01/)).toBeNull();
  });
});
