import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '../src/index';

afterEach(() => {
  vi.unstubAllGlobals();
});

function validJpegBytes(totalLength = 6): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(totalLength);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[totalLength - 2] = 0xff;
  bytes[totalLength - 1] = 0xd9;
  return bytes;
}

describe('checklist and evidence media boundary', () => {
  it('enforces JPEG SOI/EOI magic bytes on getChecklistEvidence whenever actual Content-Type is image/jpeg', async () => {
    const validJpeg = validJpegBytes(8);
    const fetchMock = vi
      .fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(validJpeg, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg; charset=binary' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test/');
    const blob = await client.getChecklistEvidence(
      'checklist-token',
      'site/1',
      'checklist/2',
      'evidence/3',
    );
    expect(blob.type).toBe('image/jpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(validJpeg);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.example.test/api/v1/sites/site%2F1/safety-checklists/checklist%2F2/evidence/evidence%2F3',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: 'image/jpeg, image/png, application/pdf',
        Authorization: 'Bearer checklist-token',
      },
      cache: 'no-store',
      redirect: 'error',
    });

    await expect(
      client.getChecklistEvidence('checklist-token', 'site/1', 'checklist/2', 'evidence/3'),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: 'Backend returned invalid evidence image bytes.',
    });

    await expect(
      client.getChecklistEvidence('checklist-token', 'site/1', 'checklist/2', 'evidence/3'),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: 'Backend returned an invalid evidence size.',
    });
  });

  it('preserves 1 MiB cap on alert/workflow JPEG evidence while allowing up to 5 MiB on checklist evidence', async () => {
    const twoMiBPdf = new Uint8Array(2 * 1024 * 1024);
    twoMiBPdf.fill(0x25);
    const twoMiBJpeg = validJpegBytes(2 * 1024 * 1024);

    let cancelledAlertStream = false;
    let cancelledChecklistStream = false;

    const alertOversizedStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(600_000));
      },
      cancel() {
        cancelledAlertStream = true;
      },
    });

    const checklistOversizedStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(3_000_000));
      },
      cancel() {
        cancelledChecklistStream = true;
      },
    });

    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(twoMiBJpeg, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(twoMiBJpeg.byteLength),
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(alertOversizedStream, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(twoMiBPdf, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(twoMiBPdf.byteLength),
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(twoMiBJpeg, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(twoMiBJpeg.byteLength),
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(0), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': '5242881',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(checklistOversizedStream, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(0), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test');

    await expect(
      client.getSafetyAlertEvidence('token', 'site-1', 'alert-1', 'event-1', 0),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: 'Backend returned an invalid evidence size.',
    });

    await expect(
      client.getWorkflowEvidence('token', 'site-1', 'incidents', 'inc-1', 'ev-1'),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: 'Backend returned an invalid evidence size.',
    });
    expect(cancelledAlertStream).toBe(true);

    const pdfBlob = await client.getChecklistEvidence('token', 'site-1', 'chk-1', 'ev-pdf');
    expect(pdfBlob.type).toBe('application/pdf');
    expect(pdfBlob.size).toBe(twoMiBPdf.byteLength);

    const jpegBlob = await client.getChecklistEvidence('token', 'site-1', 'chk-1', 'ev-jpg');
    expect(jpegBlob.type).toBe('image/jpeg');
    expect(jpegBlob.size).toBe(twoMiBJpeg.byteLength);

    await expect(
      client.getChecklistEvidence('token', 'site-1', 'chk-1', 'ev-too-large-header'),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: 'Backend returned an invalid evidence size.',
    });

    await expect(
      client.getChecklistEvidence('token', 'site-1', 'chk-1', 'ev-too-large-stream'),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: 'Backend returned an invalid evidence size.',
    });
    expect(cancelledChecklistStream).toBe(true);

    await expect(
      client.getChecklistEvidence('token', 'site-1', 'chk-1', 'ev-empty-png'),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: 'Backend returned an invalid evidence size.',
    });
  });

  it('enforces timeout and caller abort on checklist evidence and encodes alert work-context paths', async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test');
    await expect(
      client.getChecklistEvidence('token', 'site-1', 'chk-1', 'ev-1', { timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: 'timeout' });

    const abortController = new AbortController();
    const pending = client.getChecklistEvidence('token', 'site-1', 'chk-1', 'ev-1', {
      signal: abortController.signal,
    });
    abortController.abort();
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          capturedAt: '2026-10-14T08:00:00Z',
          identity: 'UNKNOWN',
          workers: [],
          zoneName: 'Zone A',
          cameraName: 'Cam 1',
          relatedTeams: [],
          warning: 'Technical context only',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const context = await client.getAlertWorkContext('ctx-token', 'site/a', 'alert/b');
    expect(context.identity).toBe('UNKNOWN');
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.example.test/api/v1/sites/site%2Fa/safety-alerts/alert%2Fb/work-context',
    );
  });
});
