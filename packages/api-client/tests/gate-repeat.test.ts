import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
it('preserves the already-recorded error code and explicit separate-passage command', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          success: false,
          statusCode: 409,
          code: 'GATE_PASSAGE_ALREADY_RECORDED',
          message: 'Already checked in.',
          requestId: 'synthetic-request',
          timestamp: '2030-01-01T00:00:00Z',
          path: '/api/v1/sites/site-1/access-attempts/attempt-1/confirm',
        }),
        { status: 409 },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const input = {
    idempotencyKey: 'request-1',
    separatePassage: true,
    reviewNote: 'Distinct passage confirmed',
  };
  try {
    await new SmartSiteManagementClient('https://synthetic.test').confirmGatePassage(
      'synthetic-token',
      'site-1',
      'attempt-1',
      input,
    );
    throw new Error('Expected a repeated-scan response');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).backendError?.code).toBe('GATE_PASSAGE_ALREADY_RECORDED');
  }
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual(input);
});
