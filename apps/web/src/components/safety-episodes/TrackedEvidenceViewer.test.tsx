// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeUiLanguage } from '../../i18n/runtime';
import {
  TrackedEvidenceViewer,
  type TrackedEvidenceViewerMedia,
  type TrackedEvidenceViewerProps,
} from './TrackedEvidenceViewer';

if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => 'blob:polyfill-initial',
  });
}

if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
}

function createJpegBlob(byteLength = 512, type = 'image/jpeg'): Blob {
  return new Blob([new Uint8Array(byteLength)], { type });
}

function buildMedia(
  overrides: Partial<TrackedEvidenceViewerMedia> = {},
): TrackedEvidenceViewerMedia {
  return {
    scopeKey: 'site-1:episode-1',
    selectionKey: 'alert-1:event-1:0:0:FRAME',
    blob: createJpegBlob(512),
    ...overrides,
  };
}

function buildProps(
  overrides: Partial<TrackedEvidenceViewerProps> = {},
): TrackedEvidenceViewerProps {
  return {
    open: true,
    scopeKey: 'site-1:episode-1',
    selectionKey: 'alert-1:event-1:0:0:FRAME',
    representation: 'FRAME',
    status: 'READY',
    media: buildMedia(),
    onClose: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
}

describe('TrackedEvidenceViewer', () => {
  let urlSequence = 0;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    changeUiLanguage('en');
    urlSequence = 0;
    createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:tracked-evidence-${++urlSequence}`);
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('creates one object URL per accepted JPEG Blob, revokes across replacement/close/unmount, validates Blob boundaries, and fires close/retry callbacks only on explicit user action', async () => {
    const onClose = vi.fn();
    const onRetry = vi.fn();
    const blobA = createJpegBlob(256);
    const blobB = createJpegBlob(1024);

    // Closed viewer must never allocate an object URL or fire callbacks
    const { rerender, unmount } = render(
      <TrackedEvidenceViewer
        {...buildProps({
          open: false,
          media: buildMedia({ blob: blobA }),
          onClose,
          onRetry,
        })}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();

    // Opening with valid READY JPEG allocates exactly 1 object URL
    await act(async () => {
      rerender(
        <TrackedEvidenceViewer
          {...buildProps({
            open: true,
            media: buildMedia({ blob: blobA }),
            onClose,
            onRetry,
          })}
        />,
      );
    });

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy).toHaveBeenLastCalledWith(blobA);
    const imgA = screen.getByTestId('tracked-viewer-image') as HTMLImageElement;
    expect(imgA.getAttribute('src')).toBe('blob:tracked-evidence-1');
    expect(imgA.className).toContain('object-contain');
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();

    // Replacing the Blob for the same selection hides the old URL immediately and revokes it
    rerender(
      <TrackedEvidenceViewer
        {...buildProps({
          open: true,
          media: buildMedia({ blob: blobB }),
          onClose,
          onRetry,
        })}
      />,
    );
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenLastCalledWith('blob:tracked-evidence-1');
    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();

    await act(async () => {});
    const imgB = screen.getByTestId('tracked-viewer-image') as HTMLImageElement;
    expect(imgB.getAttribute('src')).toBe('blob:tracked-evidence-2');
    expect(createObjectURLSpy).toHaveBeenCalledTimes(2);

    // Explicit Close button invokes onClose without revoking until open becomes false
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();

    // Closing revokes active object URL
    rerender(
      <TrackedEvidenceViewer
        {...buildProps({
          open: false,
          media: buildMedia({ blob: blobB }),
          onClose,
          onRetry,
        })}
      />,
    );
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(2);
    expect(revokeObjectURLSpy).toHaveBeenLastCalledWith('blob:tracked-evidence-2');

    // Rejects non-JPEG, empty (0 B), and oversized (> 1048576 B) Blobs without calling createObjectURL
    for (const invalidBlob of [
      createJpegBlob(128, 'image/png'),
      createJpegBlob(0, 'image/jpeg'),
      createJpegBlob(1_048_577, 'image/jpeg'),
    ]) {
      await act(async () => {
        rerender(
          <TrackedEvidenceViewer
            {...buildProps({
              open: true,
              media: buildMedia({ blob: invalidBlob }),
              onClose,
              onRetry,
            })}
          />,
        );
      });
      expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
      expect(screen.getByTestId('tracked-viewer-unavailable')).toBeTruthy();
    }
    expect(createObjectURLSpy).toHaveBeenCalledTimes(2);

    // Re-open with valid JPEG and verify unmount revokes the URL
    await act(async () => {
      rerender(
        <TrackedEvidenceViewer
          {...buildProps({
            open: true,
            media: buildMedia({ blob: blobA }),
            onClose,
            onRetry,
          })}
        />,
      );
    });
    expect(screen.getByTestId('tracked-viewer-image').getAttribute('src')).toBe(
      'blob:tracked-evidence-3',
    );
    unmount();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:tracked-evidence-3');
  });

  it('hides old image immediately on LOADING, ERROR, FORBIDDEN, or mismatched scopeKey', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<TrackedEvidenceViewer {...buildProps({ onRetry })} />);
    await act(async () => {});

    expect(screen.getByTestId('tracked-viewer-image').getAttribute('src')).toBe(
      'blob:tracked-evidence-1',
    );

    // Transition to LOADING hides old image immediately and revokes its URL
    rerender(<TrackedEvidenceViewer {...buildProps({ status: 'LOADING', onRetry })} />);
    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
    expect(screen.getByTestId('tracked-viewer-loading').getAttribute('role')).toBe('status');
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:tracked-evidence-1');

    // Restore READY, then transition to ERROR
    await act(async () => {
      rerender(<TrackedEvidenceViewer {...buildProps({ status: 'READY', onRetry })} />);
    });
    expect(screen.getByTestId('tracked-viewer-image')).toBeTruthy();

    rerender(<TrackedEvidenceViewer {...buildProps({ status: 'ERROR', onRetry })} />);
    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
    const errorAlert = screen.getByTestId('tracked-viewer-error');
    expect(errorAlert.getAttribute('role')).toBe('alert');
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(within(errorAlert).getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Restore READY, then transition to FORBIDDEN
    await act(async () => {
      rerender(<TrackedEvidenceViewer {...buildProps({ status: 'READY', onRetry })} />);
    });
    expect(screen.getByTestId('tracked-viewer-image')).toBeTruthy();

    rerender(<TrackedEvidenceViewer {...buildProps({ status: 'FORBIDDEN', onRetry })} />);
    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
    expect(screen.getByTestId('tracked-viewer-forbidden').getAttribute('role')).toBe('alert');

    // Restore READY, then switch scopeKey while media still has old scopeKey
    await act(async () => {
      rerender(<TrackedEvidenceViewer {...buildProps({ status: 'READY', onRetry })} />);
    });
    expect(screen.getByTestId('tracked-viewer-image')).toBeTruthy();
    const callsBeforeMismatch = createObjectURLSpy.mock.calls.length;

    rerender(
      <TrackedEvidenceViewer
        {...buildProps({
          scopeKey: 'site-2:episode-99',
          status: 'READY',
          media: buildMedia({ scopeKey: 'site-1:episode-1' }),
          onRetry,
        })}
      />,
    );
    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
    expect(screen.getByTestId('tracked-viewer-unavailable')).toBeTruthy();
    expect(createObjectURLSpy).toHaveBeenCalledTimes(callsBeforeMismatch);
  });

  it('switching selectionKey before replacement Blob arrives immediately hides old pixels, resets technical disclosure, and blocks stale microtasks', async () => {
    const { rerender } = render(
      <TrackedEvidenceViewer
        {...buildProps({
          selectionKey: 'alert-1:event-1:0:0:FRAME',
          media: buildMedia({ selectionKey: 'alert-1:event-1:0:0:FRAME' }),
        })}
      />,
    );
    await act(async () => {});

    expect(screen.getByTestId('tracked-viewer-image').getAttribute('src')).toBe(
      'blob:tracked-evidence-1',
    );

    // Expand technical details on the first selection
    fireEvent.click(screen.getByRole('button', { name: /show technical details/i }));
    expect(screen.getByTestId('tracked-viewer-technical')).toBeTruthy();

    // Switch selectionKey while media still points to the previous selectionKey
    rerender(
      <TrackedEvidenceViewer
        {...buildProps({
          selectionKey: 'alert-1:event-1:0:0:SUBJECT',
          representation: 'SUBJECT',
          media: buildMedia({ selectionKey: 'alert-1:event-1:0:0:FRAME' }),
        })}
      />,
    );

    // Immediately synchronous: old image is gone, old URL revoked, technical disclosure reset
    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
    expect(screen.queryByTestId('tracked-viewer-technical')).toBeNull();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:tracked-evidence-1');
    expect(screen.getByTestId('tracked-viewer-unavailable')).toBeTruthy();

    // Even after microtasks flush, old media cannot be shown for the new selectionKey
    await act(async () => {});
    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);

    // Also verify switching selectionKey BEFORE the first selection's microtask flushes cannot restore old URL
    rerender(
      <TrackedEvidenceViewer
        {...buildProps({
          selectionKey: 'alert-1:event-1:0:1:FRAME',
          representation: 'FRAME',
          media: buildMedia({ selectionKey: 'alert-1:event-1:0:1:FRAME' }),
        })}
      />,
    );
    // Before awaiting microtask, immediately switch to another selectionKey with stale media
    rerender(
      <TrackedEvidenceViewer
        {...buildProps({
          selectionKey: 'alert-1:event-1:0:1:SUBJECT',
          representation: 'SUBJECT',
          media: buildMedia({ selectionKey: 'alert-1:event-1:0:1:FRAME' }),
        })}
      />,
    );
    await act(async () => {});
    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:tracked-evidence-2');
  });

  it('hides image on decoder onError or URL creation failure and allows explicit retry', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<TrackedEvidenceViewer {...buildProps({ onRetry })} />);
    await act(async () => {});

    const img = screen.getByTestId('tracked-viewer-image');
    fireEvent.error(img);

    // Decoder failure must hide the broken <img> and show explicit retry alert
    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
    const decodeAlert = screen.getByTestId('tracked-viewer-unavailable');
    expect(decodeAlert.getAttribute('role')).toBe('alert');
    expect(decodeAlert.textContent).toContain('could not be decoded');

    fireEvent.click(within(decodeAlert).getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Simulate URL.createObjectURL throwing on a new selection
    createObjectURLSpy.mockImplementationOnce(() => {
      throw new Error('Out of blob URL slots');
    });
    await act(async () => {
      rerender(
        <TrackedEvidenceViewer
          {...buildProps({
            selectionKey: 'alert-1:event-1:0:2:FRAME',
            media: buildMedia({ selectionKey: 'alert-1:event-1:0:2:FRAME' }),
            onRetry,
          })}
        />,
      );
    });

    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
    const unavailableAlert = screen.getByTestId('tracked-viewer-unavailable');
    fireEvent.click(within(unavailableAlert).getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('renders localized EN/VI labels, representation badges, alt text, crop disclaimer, and wrapped technical disclosure', async () => {
    const { rerender } = render(
      <TrackedEvidenceViewer
        {...buildProps({
          representation: 'SUBJECT',
          selectionKey: 'alert-1:event-1:0:0:SUBJECT',
          media: buildMedia({
            selectionKey: 'alert-1:event-1:0:0:SUBJECT',
            blob: createJpegBlob(768),
          }),
        })}
      />,
    );
    await act(async () => {});

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('tracked-viewer-badge').textContent).toContain(
      'Mechanical PERSON crop',
    );
    expect(screen.getByTestId('tracked-viewer-crop-note').textContent).toContain(
      'never a verified Worker identity',
    );
    expect(screen.getByTestId('tracked-viewer-image').getAttribute('alt')).toBe(
      'Mechanical original PERSON bounding-box crop evidence image',
    );

    // Open technical disclosure and check wrapped monospace fields
    fireEvent.click(screen.getByRole('button', { name: /show technical details/i }));
    const techPanel = screen.getByTestId('tracked-viewer-technical');
    expect(techPanel.textContent).toContain('site-1:episode-1');
    expect(techPanel.textContent).toContain('alert-1:event-1:0:0:SUBJECT');
    expect(techPanel.textContent).toContain('SUBJECT');
    expect(techPanel.textContent).toContain('768');
    for (const dd of techPanel.querySelectorAll('dd')) {
      expect(dd.className).toContain('break-all');
      expect(dd.className).toContain('font-mono');
    }

    // Switch to Vietnamese and verify localized labels + FRAME representation
    await act(async () => {
      changeUiLanguage('vi');
    });
    expect(screen.getByTestId('tracked-viewer-badge').textContent).toContain(
      'Ảnh cắt PERSON cơ học',
    );
    expect(screen.getByTestId('tracked-viewer-crop-note').textContent).toContain(
      'tuyệt đối không phải danh tính Công nhân đã xác minh',
    );

    await act(async () => {
      rerender(
        <TrackedEvidenceViewer
          {...buildProps({
            representation: 'FRAME',
            selectionKey: 'alert-1:event-1:0:0:FRAME',
            media: buildMedia({ selectionKey: 'alert-1:event-1:0:0:FRAME' }),
          })}
        />,
      );
    });
    expect(screen.getByTestId('tracked-viewer-badge').textContent).toContain('Toàn khung FRAME');
    expect(screen.getByTestId('tracked-viewer-image').getAttribute('alt')).toBe(
      'Ảnh bằng chứng toàn khung hình quan sát',
    );
  });

  it('uses a named wide modal, moves focus inside and restores it on unmount', async () => {
    const launcher = document.createElement('button');
    launcher.textContent = 'Open evidence';
    document.body.append(launcher);
    try {
      launcher.focus();
      const view = render(<TrackedEvidenceViewer {...buildProps()} />);
      try {
        await act(async () => {
          await Promise.resolve();
        });
        const dialog = screen.getByRole('dialog');
        const labelId = dialog.getAttribute('aria-labelledby');
        expect(labelId).toBeTruthy();
        expect(labelId ? document.getElementById(labelId)?.textContent : '').toContain(
          'Original observation',
        );
        expect(dialog.className).toContain('max-w-5xl');
        expect(dialog.contains(document.activeElement)).toBe(true);

        // Verify Tab and Shift+Tab wrap focus within the modal dialog
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(dialog.contains(document.activeElement)).toBe(true);
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(dialog.contains(document.activeElement)).toBe(true);
      } finally {
        view.unmount();
      }
      expect(document.activeElement).toBe(launcher);
    } finally {
      launcher.remove();
    }
  });

  it('renders optional identityContent slot only after exact activeObjectUrl img onLoad and suppresses it across Blob/scope/status changes or onError', async () => {
    // 1. Default omitted identityContent renders no slot before or after img load
    const { rerender } = render(<TrackedEvidenceViewer {...buildProps()} />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-image')).toBeTruthy();
    });
    expect(screen.queryByTestId('tracked-viewer-identity-slot')).toBeNull();
    fireEvent.load(screen.getByTestId('tracked-viewer-image'));
    expect(screen.queryByTestId('tracked-viewer-identity-slot')).toBeNull();

    // 2. Provided identityContent stays absent on newly allocated URL before fireEvent.load(img), then appears after load
    await act(async () => {
      rerender(
        <TrackedEvidenceViewer
          {...buildProps({
            identityContent: <div data-testid="custom-identity-child">Identity child</div>,
          })}
        />,
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-image')).toBeTruthy();
    });
    expect(screen.queryByTestId('tracked-viewer-identity-slot')).toBeNull();
    expect(screen.queryByTestId('custom-identity-child')).toBeNull();

    fireEvent.load(screen.getByTestId('tracked-viewer-image'));
    expect(screen.getByTestId('tracked-viewer-identity-slot')).toBeTruthy();
    expect(screen.getByTestId('custom-identity-child').textContent).toBe('Identity child');

    // 3. Rerendering with a new Blob or new scopeKey suppresses the slot until the new img fires onLoad
    await act(async () => {
      rerender(
        <TrackedEvidenceViewer
          {...buildProps({
            scopeKey: 'site-1:episode-2',
            media: buildMedia({ scopeKey: 'site-1:episode-2', blob: createJpegBlob(640) }),
            identityContent: <div data-testid="custom-identity-child">Identity child</div>,
          })}
        />,
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-image')).toBeTruthy();
    });
    expect(screen.queryByTestId('tracked-viewer-identity-slot')).toBeNull();
    expect(screen.queryByTestId('custom-identity-child')).toBeNull();

    fireEvent.load(screen.getByTestId('tracked-viewer-image'));
    expect(screen.getByTestId('tracked-viewer-identity-slot')).toBeTruthy();

    // 4. Hidden on LOADING, ERROR, and FORBIDDEN
    for (const nonReadyStatus of ['LOADING', 'ERROR', 'FORBIDDEN'] as const) {
      await act(async () => {
        rerender(
          <TrackedEvidenceViewer
            {...buildProps({
              status: nonReadyStatus,
              identityContent: <div data-testid="custom-identity-child">Identity child</div>,
            })}
          />,
        );
      });
      expect(screen.queryByTestId('tracked-viewer-identity-slot')).toBeNull();
      expect(screen.queryByTestId('custom-identity-child')).toBeNull();
    }

    // 5. Restore READY, fire onLoad so slot appears, then trigger onError -> removes both image and identityContent slot
    await act(async () => {
      rerender(
        <TrackedEvidenceViewer
          {...buildProps({
            status: 'READY',
            identityContent: <div data-testid="custom-identity-child">Identity child</div>,
          })}
        />,
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('tracked-viewer-image')).toBeTruthy();
    });
    expect(screen.queryByTestId('tracked-viewer-identity-slot')).toBeNull();

    fireEvent.load(screen.getByTestId('tracked-viewer-image'));
    expect(screen.getByTestId('custom-identity-child')).toBeTruthy();

    fireEvent.error(screen.getByTestId('tracked-viewer-image'));
    expect(screen.queryByTestId('tracked-viewer-image')).toBeNull();
    expect(screen.queryByTestId('tracked-viewer-identity-slot')).toBeNull();
    expect(screen.queryByTestId('custom-identity-child')).toBeNull();
  });
});
