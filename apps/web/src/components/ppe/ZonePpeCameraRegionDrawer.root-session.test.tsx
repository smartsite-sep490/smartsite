// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type ManagementSession } from '@smartsite/api-client';
import type { CameraResponse, ZoneResponse } from '@smartsite/contracts';
import type { RegionPolygonCanvasEditorProps } from './RegionPolygonCanvasEditor';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';
import { ZonePpeCameraRegionDrawer } from './ZonePpeCameraRegionDrawer';

vi.mock('./RegionPolygonCanvasEditor', () => ({
  RegionPolygonCanvasEditor: (props: RegionPolygonCanvasEditorProps) => (
    <>
      <button
        onClick={() =>
          props.onChangePoints([
            [0.2, 0.2],
            [0.8, 0.2],
            [0.8, 0.8],
            [0.2, 0.8],
          ])
        }
      >
        Fixture polygon
      </button>
      <button onClick={props.onSaveRegion}>Fixture save</button>
    </>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const cameraId = '22222222-2222-4222-8222-222222222222';
const zoneId = '33333333-3333-4333-8333-333333333333';
const regionId = '44444444-4444-4444-8444-444444444444';
const referenceId = '55555555-5555-4555-8555-555555555555';
const confirmedRegion = {
  id: regionId,
  cameraId,
  zoneId,
  geometryConfirmation: {
    status: 'MANUALLY_CONFIRMED',
    referenceId,
    viewRevision: 1,
    confirmedByUserId: '66666666-6666-4666-8666-666666666666',
    confirmedAt: '2026-10-16T00:00:00.000Z',
  },
};
const camera: CameraResponse = {
  id: cameraId,
  siteId: 'site',
  externalId: 'fixture-camera',
  code: 'CAM',
  name: 'Fixture camera',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-10-16T00:00:00Z',
};
const zone: ZoneResponse = {
  id: zoneId,
  siteId: 'site',
  code: 'ZONE',
  name: 'Fixture zone',
  type: 'STANDARD',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT'],
  configurationLocked: false,
  createdAt: '2026-10-16T00:00:00Z',
};
function reference(): CameraConfigurationReference {
  const now = Date.now();
  const capturedAt = new Date(now).toISOString();
  const referenceExpiresAt = new Date(now + 300_000).toISOString();
  return {
    siteId: 'site',
    cameraId,
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    configurationVersion: 1,
    sourceKind: 'LIVE',
    referenceExpiresAt,
    frame: {
      cameraExternalId: 'fixture-camera',
      sessionId: '11111111-1111-4111-8111-111111111111',
      sequenceNumber: '1',
      capturedAt,
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      imageSha256: 'a'.repeat(64),
    },
    issuedReference: {
      schemaVersion: '1.0.0',
      purpose: 'REGION_CONFIGURATION',
      sourceKind: 'LIVE',
      referenceId,
      siteId: 'site',
      cameraId,
      sessionId: '11111111-1111-4111-8111-111111111111',
      imageSha256: 'a'.repeat(64),
      width: 640,
      height: 480,
      capturedAt,
      issuedAt: capturedAt,
      expiresAt: referenceExpiresAt,
      configurationVersion: 1,
      viewRevision: 1,
    },
    image: {} as HTMLImageElement,
  };
}
function mount() {
  let token = 'synthetic-old';
  const session: ManagementSession = {
    signal: new AbortController().signal,
    getAccessToken: vi.fn(() => token),
    refreshAccessToken: vi.fn(async () => (token = 'synthetic-new')),
    onUnauthorized: vi.fn(),
  };
  const client = new SmartSiteManagementClient('https://api.example.test', session);
  const saved = vi.fn();
  const revoked = vi.fn();
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const frozenReference = reference();
  const content = (client: SmartSiteManagementClient) => (
    <QueryClientProvider client={cache}>
      <ZonePpeCameraRegionDrawer
        apiUrl="https://api.example.test"
        token="synthetic-old"
        sessionScope="fixture-session"
        credentialId={1}
        internalNonce={1}
        siteId="site"
        selectedCamera={camera}
        selectedZone={zone}
        frozenReference={frozenReference}
        candidateReference={null}
        lastSavedDraft={null}
        client={client}
        onAcceptCandidateReference={vi.fn()}
        onCancelCandidateReview={vi.fn()}
        onScopeRevoked={revoked}
        onSaveSuccess={saved}
        onClose={vi.fn()}
      />
    </QueryClientProvider>
  );
  const view = render(content(client));
  return {
    cache,
    session,
    saved,
    revoked,
    ...view,
    replaceClient: () =>
      view.rerender(content(new SmartSiteManagementClient('https://api.example.test'))),
  };
}
function submit() {
  fireEvent.click(screen.getByText('Fixture polygon'));
  fireEvent.click(screen.getByText('Fixture save'));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Fixture save'));
}

it('uses the owning client for one authenticated retry with unchanged polygon and revision', async () => {
  const posts: Array<{ auth: string | null; payload: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return Response.json(camera);
      const auth = new Headers(init.headers).get('Authorization');
      const payload = JSON.parse(init.body as string);
      posts.push({ auth, payload });
      if (auth === 'Bearer synthetic-old') return Response.json({}, { status: 401 });
      return Response.json({
        configurationVersion: 2,
        region: confirmedRegion,
      });
    }),
  );
  const { saved, revoked, session } = mount();
  submit();
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(posts.map((row) => row.auth)).toEqual(['Bearer synthetic-old', 'Bearer synthetic-new']);
  expect(posts[1]!.payload).toEqual(posts[0]!.payload);
  expect(posts[0]!.payload).toMatchObject({
    expectedConfigurationVersion: 1,
    zoneId,
    referenceId,
    viewRevision: 1,
    confirmReferenceView: true,
  });
  expect(session.refreshAccessToken).toHaveBeenCalledOnce();
  expect(revoked).not.toHaveBeenCalled();
});

it('does not replay a region write after its drawer unmounts while refresh is pending', async () => {
  const posts = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return Response.json(camera);
      posts();
      return Response.json({}, { status: 401 });
    }),
  );
  const { unmount, session, saved } = mount();
  let release!: (value: string) => void;
  vi.mocked(session.refreshAccessToken).mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  submit();
  await waitFor(() => expect(session.refreshAccessToken).toHaveBeenCalledOnce());
  unmount();
  release('synthetic-new');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(posts).toHaveBeenCalledOnce();
  expect(saved).not.toHaveBeenCalled();
});

it('keeps a revision conflict after refresh instead of rebasing or creating a second Region', async () => {
  const versions: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return Response.json(camera);
      versions.push(JSON.parse(init.body as string).expectedConfigurationVersion);
      const auth = new Headers(init.headers).get('Authorization');
      // Simulate a committed first attempt whose late response was denied: the
      // replacement request must keep version1 and observe409, not create twice.
      return Response.json({}, { status: auth === 'Bearer synthetic-old' ? 401 : 409 });
    }),
  );
  const { saved, revoked, session } = mount();
  submit();
  expect(await screen.findByRole('alert')).not.toBeNull();
  expect(versions).toEqual([1, 1]);
  expect(session.refreshAccessToken).toHaveBeenCalledOnce();
  expect(saved).not.toHaveBeenCalled();
  expect(revoked).not.toHaveBeenCalled();
});

it('revokes the Region scope on a second401 without another replay', async () => {
  const posts = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return Response.json(camera);
      posts();
      return Response.json({}, { status: 401 });
    }),
  );
  const { saved, revoked, session } = mount();
  submit();
  await waitFor(() => expect(session.onUnauthorized).toHaveBeenCalledOnce());
  expect(revoked).toHaveBeenCalledExactlyOnceWith(401);
  expect(posts).toHaveBeenCalledTimes(2);
  expect(saved).not.toHaveBeenCalled();
});

it('suppresses an old write result when its owning client is replaced', async () => {
  let release!: (value: Response) => void;
  const posts = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) =>
      init.method === 'GET' ? Response.json(camera) : posts(),
    ),
  );
  const { saved, revoked, replaceClient } = mount();
  submit();
  await waitFor(() => expect(posts).toHaveBeenCalledOnce());
  replaceClient();
  release(
    Response.json({
      configurationVersion: 2,
      region: confirmedRegion,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(saved).not.toHaveBeenCalled();
  expect(revoked).not.toHaveBeenCalled();
});

it.each([200, 409])(
  'invalidates current-scoped camera-setup cameras and selected-camera queries on %i write result',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) =>
        init.method === 'GET'
          ? Response.json(camera)
          : status === 200
            ? Response.json({
                configurationVersion: 2,
                region: confirmedRegion,
              })
            : Response.json({}, { status: 409 }),
      ),
    );
    const { cache, saved } = mount();
    const api = 'https://api.example.test';
    const roles = [{ role: 'SITE_MANAGER', siteId: 'site' }];
    const currentKeys = [
      ['camera-setup', api, 'fixture-session', 'user', 1, roles, 'site', 'cameras'],
      [
        'camera-setup',
        api,
        'fixture-session',
        'user',
        1,
        roles,
        'site',
        'selected-camera',
        cameraId,
      ],
    ] as const;
    const foreignKeys = [
      ['camera-setup', api, 'fixture-session', 'user', 1, roles, 'sites'],
      [
        'camera-setup',
        'https://other.example.test',
        'fixture-session',
        'user',
        1,
        roles,
        'site',
        'cameras',
      ],
      ['camera-setup', api, 'other-session', 'user', 1, roles, 'site', 'cameras'],
      ['camera-setup', api, 'fixture-session', 'user', 2, roles, 'site', 'cameras'],
      ['camera-setup', api, 'fixture-session', 'user', 1, roles, 'other-site', 'cameras'],
      [
        'camera-setup',
        api,
        'fixture-session',
        'user',
        1,
        roles,
        'site',
        'selected-camera',
        'other-camera',
      ],
    ] as const;
    cache.setQueryData(currentKeys[0], [camera]);
    cache.setQueryData(currentKeys[1], { ...camera, configurationVersion: 1 });
    for (const key of foreignKeys) cache.setQueryData(key, [camera]);

    submit();
    if (status === 200) {
      await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    } else {
      expect(await screen.findByRole('alert')).not.toBeNull();
    }
    for (const key of currentKeys) {
      expect(cache.getQueryState(key)?.isInvalidated).toBe(true);
    }
    for (const key of foreignKeys) {
      expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
    }
  },
);
