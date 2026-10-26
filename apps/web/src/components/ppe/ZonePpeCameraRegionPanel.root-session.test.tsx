// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type ManagementSession } from '@smartsite/api-client';
import type { CameraResponse, ZoneResponse } from '@smartsite/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import type { RegionPolygonCanvasEditorProps } from './RegionPolygonCanvasEditor';
import { buildCanonicalReference } from './ZonePpeCameraRegionPanel.reference.fixtures';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';

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

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const camera: CameraResponse = {
  id: cameraId,
  siteId,
  externalId: 'fixture-camera',
  code: 'CAM',
  name: 'Fixture camera',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-10-16T00:00:00Z',
};
const zone: ZoneResponse = {
  id: '44444444-4444-4444-8444-444444444444',
  siteId,
  code: 'ZONE',
  name: 'Fixture zone',
  type: 'STANDARD',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT'],
  configurationLocked: false,
  createdAt: '2026-10-16T00:00:00Z',
};
const savedRegionId = '55555555-5555-4555-8555-555555555555';

it.each(['reference', 'write'])(
  'forwards the owning client through the real panel to its %s leaf',
  async (failureAt) => {
    let token = 'synthetic-old';
    let injected401 = false;
    const writes: unknown[] = [];
    const session: ManagementSession = {
      signal: new AbortController().signal,
      getAccessToken: () => token,
      refreshAccessToken: vi.fn(async () => (token = 'synthetic-new')),
      onUnauthorized: vi.fn(),
    };
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        naturalWidth = 120;
        naturalHeight = 80;
        decode = async () => undefined;
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const isReference = url.includes('/configuration-reference');
        const isWrite = init.method === 'POST';
        if (isWrite) writes.push(JSON.parse(init.body as string));
        if (
          !injected401 &&
          ((failureAt === 'reference' && isReference) || (failureAt === 'write' && isWrite))
        ) {
          injected401 = true;
          return Response.json({}, { status: 401 });
        }
        const {
          image: _decoded,
          issuedReference,
          ...image
        } = buildCanonicalReference(
          { siteId, cameraId, configurationVersion: 1 },
          { cameraExternalId: camera.externalId, capturedAt: new Date(Date.now()).toISOString() },
        );
        void _decoded; // Decoded browser image is excluded from the HTTP fixture.
        if (isReference) {
          return Response.json({
            image,
            reference: issuedReference,
            viewValidity: 'UNCONFIRMED',
          });
        }
        if (isWrite)
          return Response.json({
            configurationVersion: 2,
            region: {
              id: savedRegionId,
              cameraId,
              zoneId: zone.id,
              version: 1,
              geometryConfirmation: {
                status: 'MANUALLY_CONFIRMED',
                referenceId: issuedReference.referenceId,
                viewRevision: issuedReference.viewRevision,
                confirmedByUserId: '66666666-6666-4666-8666-666666666666',
                confirmedAt: '2026-10-16T00:00:00.000Z',
              },
            },
          });
        if (url.includes('/regions')) return Response.json({ items: [], total: 0 });
        if (url.endsWith(`/cameras/${cameraId}`)) return Response.json(camera);
        if (url.includes('/cameras?')) return Response.json({ items: [camera], total: 1 });
        throw new Error(`Unexpected fixture route: ${url}`);
      }),
    );
    const client = new SmartSiteManagementClient('https://api.example.test', session);
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={cache}>
        <ZonePpeCameraRegionPanel
          apiUrl="https://api.example.test"
          client={client}
          token="synthetic-old"
          sessionScope="fixture-session"
          credentialId={1}
          siteId={siteId}
          zones={[zone]}
        />
      </QueryClientProvider>,
    );
    await screen.findByRole('option', { name: 'CAM · Fixture camera' });
    const getReference = screen.getByRole('button', { name: 'Get configuration image' });
    await waitFor(() => expect((getReference as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getReference);
    const start = screen.getByRole('button', { name: 'Start Drawing Region' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    fireEvent.click(screen.getByText('Fixture polygon'));
    fireEvent.click(screen.getByText('Fixture save'));
    await screen.findByText(new RegExp(`Saved region "${savedRegionId}" \\(v1\\)`));
    expect(session.refreshAccessToken).toHaveBeenCalledExactlyOnceWith('synthetic-old');
    expect(session.onUnauthorized).not.toHaveBeenCalled();
    expect(writes).toHaveLength(failureAt === 'write' ? 2 : 1);
    expect(writes[0]).toMatchObject({
      zoneId: zone.id,
      expectedConfigurationVersion: 1,
      referenceId: '77777777-7777-4777-8777-000000000101',
      viewRevision: 1,
      confirmReferenceView: true,
    });
    if (failureAt === 'write') expect(writes[1]).toEqual(writes[0]);
  },
);
