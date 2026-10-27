// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type Mf06AssessmentResponse,
} from '@smartsite/api-client';
import { LocaleProvider } from '../../i18n/locale';
import { changeUiLanguage } from '../../i18n/runtime';
import { Mf06AssessmentFrame } from './Mf06AssessmentFrame';

const SAMPLE_ASSESSMENT: Mf06AssessmentResponse = {
  assessmentId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  siteId: '33333333-3333-4333-8333-333333333331',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  capturedAt: '2026-10-12T10:00:00.123456Z',
  assessedAt: '2026-10-12T10:00:01.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  outcome: 'ALLOWED',
  reasonCode: 'AUTHORIZED',
  evaluatorVersion: 'mf06-v1.0.0',
  provenance: 'TRUSTED_SERVICE',
};

const JPEG_BLOB = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

describe('Mf06AssessmentFrame', () => {
  let urlCounter = 0;

  beforeEach(() => {
    urlCounter = 0;
    changeUiLanguage('en');
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mf06-frame-${++urlCounter}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    changeUiLanguage('en');
    vi.restoreAllMocks();
  });

  it('loads and renders protected JPEG with explicit alt and compact caption in EN/VI', async () => {
    const getMf06AssessmentFrame = vi.fn().mockResolvedValue(JPEG_BLOB);
    const client = { getMf06AssessmentFrame } as unknown as SmartSiteManagementClient;

    const { rerender, unmount } = render(
      <LocaleProvider defaultLocale="en">
        <Mf06AssessmentFrame
          client={client}
          assessment={SAMPLE_ASSESSMENT}
          token="token-alpha"
          credentialId="cred-alpha"
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole('status').textContent).toContain('Loading observation frame…');
    expect(
      screen.getByText(
        'Original observation, not a verified worker identity or proof AI consumed this image.',
      ),
    ).toBeTruthy();

    const img = (await screen.findByRole('img')) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:mf06-frame-1');
    expect(img.getAttribute('alt')).toBe(
      `Original observation frame captured at ${SAMPLE_ASSESSMENT.capturedAt}`,
    );
    expect(getMf06AssessmentFrame).toHaveBeenCalledWith(
      'token-alpha',
      SAMPLE_ASSESSMENT.siteId,
      SAMPLE_ASSESSMENT.assessmentId,
      SAMPLE_ASSESSMENT.requestId,
      SAMPLE_ASSESSMENT.eventId,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    act(() => changeUiLanguage('vi'));
    rerender(
      <LocaleProvider defaultLocale="vi">
        <Mf06AssessmentFrame
          client={client}
          assessment={SAMPLE_ASSESSMENT}
          token="token-alpha"
          credentialId="cred-alpha"
        />
      </LocaleProvider>,
    );
    expect(screen.getByText('Khung hình quan sát gốc')).toBeTruthy();

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mf06-frame-1');
  });

  it('immediately hides old URL on scope change, aborts/ignores late responses, and revokes exact scope URLs', async () => {
    let resolveSecond!: (blob: Blob) => void;
    const signals: AbortSignal[] = [];
    const getMf06AssessmentFrame = vi
      .fn()
      .mockImplementation(
        (
          _t: string,
          _s: string,
          assessmentId: string,
          _r: string,
          _e: string,
          opts?: { signal?: AbortSignal },
        ) => {
          if (opts?.signal) signals.push(opts.signal);
          if (assessmentId === SAMPLE_ASSESSMENT.assessmentId) return Promise.resolve(JPEG_BLOB);
          return new Promise<Blob>((resolve) => {
            resolveSecond = resolve;
          });
        },
      );
    const client = { getMf06AssessmentFrame } as unknown as SmartSiteManagementClient;

    const { rerender } = render(
      <LocaleProvider defaultLocale="en">
        <Mf06AssessmentFrame
          client={client}
          assessment={SAMPLE_ASSESSMENT}
          token="t1"
          credentialId="c1"
        />
      </LocaleProvider>,
    );

    const firstImg = (await screen.findByRole('img')) as HTMLImageElement;
    expect(firstImg.getAttribute('src')).toBe('blob:mf06-frame-1');

    const second = { ...SAMPLE_ASSESSMENT, assessmentId: '99999999-9999-4999-8999-999999999999' };
    rerender(
      <LocaleProvider defaultLocale="en">
        <Mf06AssessmentFrame client={client} assessment={second} token="t1" credentialId="c1" />
      </LocaleProvider>,
    );

    expect(screen.queryByRole('img')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mf06-frame-1');
    expect(signals[0]?.aborted).toBe(true);

    await waitFor(() => expect(getMf06AssessmentFrame).toHaveBeenCalledTimes(2));
    const third = { ...SAMPLE_ASSESSMENT, assessmentId: '88888888-8888-4888-8888-888888888888' };
    getMf06AssessmentFrame.mockResolvedValueOnce(JPEG_BLOB);
    rerender(
      <LocaleProvider defaultLocale="en">
        <Mf06AssessmentFrame client={client} assessment={third} token="t2" credentialId="c2" />
      </LocaleProvider>,
    );

    expect(signals[1]?.aborted).toBe(true);
    await act(async () => resolveSecond(JPEG_BLOB));

    const thirdImg = (await screen.findByRole('img')) as HTMLImageElement;
    expect(thirdImg.getAttribute('src')).toBe('blob:mf06-frame-2');
    fireEvent.error(firstImg);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:mf06-frame-2');
    expect((screen.getByRole('img') as HTMLImageElement).getAttribute('src')).toBe(
      'blob:mf06-frame-2',
    );
  });

  it('handles 403 access alarm (single callback, no retry), neutral 404 status, and transient retry', async () => {
    const onError = vi.fn();
    const getMf06AssessmentFrame = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('http', 'Forbidden', 403))
      .mockRejectedValueOnce(new ApiError('http', 'Not Found', 404))
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503))
      .mockResolvedValueOnce(JPEG_BLOB);
    const client = { getMf06AssessmentFrame } as unknown as SmartSiteManagementClient;

    const { rerender } = render(
      <LocaleProvider defaultLocale="en">
        <Mf06AssessmentFrame
          client={client}
          assessment={SAMPLE_ASSESSMENT}
          token="t403"
          credentialId="c403"
          onError={onError}
        />
      </LocaleProvider>,
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'You do not have permission to view this observation frame.',
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();

    rerender(
      <LocaleProvider defaultLocale="en">
        <Mf06AssessmentFrame
          client={client}
          assessment={SAMPLE_ASSESSMENT}
          token="t404"
          credentialId="c404"
          onError={onError}
        />
      </LocaleProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'No observation frame is available for this assessment.',
      ),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);

    rerender(
      <LocaleProvider defaultLocale="en">
        <Mf06AssessmentFrame
          client={client}
          assessment={SAMPLE_ASSESSMENT}
          token="t503"
          credentialId="c503"
          onError={onError}
        />
      </LocaleProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Observation frame could not be loaded.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('img')).toBeTruthy();
  });
});
