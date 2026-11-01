// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { LANGUAGE_STORAGE_KEY, translate } from '../../i18n';
import { changeUiLanguage, SAFETY_NAMESPACE } from '../../i18n/runtime';
import { PpeDialog } from './PpeDialog';

describe('PpeDialog foundation primitive', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.style.overflow = '';
    act(() => {
      changeUiLanguage('en');
    });
  });

  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
    vi.restoreAllMocks();
  });

  it('renders wide labelled dialog, moves initial focus inside content, wraps Tab/Shift+Tab, and returns focus on close', () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    trigger.textContent = 'Open setup dialog';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    try {
      const view = render(
        <PpeDialog
          open
          onClose={onClose}
          title="Camera Region Setup"
          description="Draw and confirm polygon vertices."
          wide
        >
          <button type="button">First content action</button>
          <button type="button">Second content action</button>
        </PpeDialog>,
      );

      const dialog = screen.getByRole('dialog', { name: 'Camera Region Setup' });
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.className).toContain('max-w-5xl');

      const descriptionId = dialog.getAttribute('aria-describedby');
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId!)?.textContent).toBe(
        'Draw and confirm polygon vertices.',
      );

      const closeButton = screen.getByRole('button', { name: 'Close dialog' });
      const firstAction = screen.getByRole('button', { name: 'First content action' });
      const secondAction = screen.getByRole('button', { name: 'Second content action' });

      // Initial focus targets the first focusable control inside [data-ppe-dialog-content]
      expect(document.activeElement).toBe(firstAction);

      // Tab from last focusable element wraps to first focusable element in dialog (closeButton)
      secondAction.focus();
      expect(document.activeElement).toBe(secondAction);
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(closeButton);

      // Shift+Tab from first focusable element wraps back to last focusable element (secondAction)
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(secondAction);

      // Focus escaping to outside element is pulled back inside the top dialog
      trigger.focus();
      fireEvent.focusIn(trigger);
      expect(document.activeElement).toBe(firstAction);

      // Closing restores focus to the trigger element
      view.rerender(
        <PpeDialog
          open={false}
          onClose={onClose}
          title="Camera Region Setup"
          description="Draw and confirm polygon vertices."
          wide
        >
          <button type="button">First content action</button>
          <button type="button">Second content action</button>
        </PpeDialog>,
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      trigger.remove();
    }
  });

  it('isolates background siblings and restores previous scroll overflow and inert/aria-hidden attributes after stacked close', () => {
    document.body.style.overflow = 'clip';
    const presetSibling = document.createElement('div');
    presetSibling.setAttribute('inert', 'custom-inert');
    presetSibling.setAttribute('aria-hidden', 'false');
    const plainSibling = document.createElement('div');
    document.body.append(presetSibling, plainSibling);

    try {
      const view = render(
        <>
          <PpeDialog open onClose={vi.fn()} title="Outer Dialog">
            <button type="button">Outer action</button>
          </PpeDialog>
          <PpeDialog open onClose={vi.fn()} title="Inner Dialog">
            <button type="button">Inner action</button>
          </PpeDialog>
        </>,
      );

      expect(document.body.style.overflow).toBe('hidden');
      expect(presetSibling.getAttribute('inert')).toBe('');
      expect(presetSibling.getAttribute('aria-hidden')).toBe('true');
      expect(plainSibling.getAttribute('inert')).toBe('');
      expect(plainSibling.getAttribute('aria-hidden')).toBe('true');

      // Closing only the inner dialog keeps page isolation active for the outer dialog
      view.rerender(
        <>
          <PpeDialog open onClose={vi.fn()} title="Outer Dialog">
            <button type="button">Outer action</button>
          </PpeDialog>
          <PpeDialog open={false} onClose={vi.fn()} title="Inner Dialog">
            <button type="button">Inner action</button>
          </PpeDialog>
        </>,
      );
      expect(document.body.style.overflow).toBe('hidden');
      expect(presetSibling.getAttribute('inert')).toBe('');
      expect(plainSibling.getAttribute('aria-hidden')).toBe('true');

      // Closing the outer dialog restores exact prior overflow and sibling attributes
      view.rerender(
        <>
          <PpeDialog open={false} onClose={vi.fn()} title="Outer Dialog">
            <button type="button">Outer action</button>
          </PpeDialog>
          <PpeDialog open={false} onClose={vi.fn()} title="Inner Dialog">
            <button type="button">Inner action</button>
          </PpeDialog>
        </>,
      );
      expect(document.body.style.overflow).toBe('clip');
      expect(presetSibling.getAttribute('inert')).toBe('custom-inert');
      expect(presetSibling.getAttribute('aria-hidden')).toBe('false');
      expect(plainSibling.hasAttribute('inert')).toBe(false);
      expect(plainSibling.hasAttribute('aria-hidden')).toBe(false);
    } finally {
      presetSibling.remove();
      plainSibling.remove();
    }
  });

  it('routes Escape only to the topmost open dialog in LIFO order', () => {
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();

    const view = render(
      <>
        <PpeDialog open onClose={onOuterClose} title="Parent Dialog">
          <button type="button">Parent button</button>
        </PpeDialog>
        <PpeDialog open onClose={onInnerClose} title="Child Dialog">
          <button type="button">Child button</button>
        </PpeDialog>
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();

    view.rerender(
      <>
        <PpeDialog open onClose={onOuterClose} title="Parent Dialog">
          <button type="button">Parent button</button>
        </PpeDialog>
        <PpeDialog open={false} onClose={onInnerClose} title="Child Dialog">
          <button type="button">Child button</button>
        </PpeDialog>
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOuterClose).toHaveBeenCalledTimes(1);
  });

  it('prevents backdrop click, Escape key, and close button actions when closeDisabled is true', () => {
    const onClose = vi.fn();

    const view = render(
      <PpeDialog open onClose={onClose} title="Saving Region" closeDisabled>
        <button type="button">In-flight control</button>
      </PpeDialog>,
    );

    const closeButton = screen.getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement;
    expect(closeButton.disabled).toBe(true);

    fireEvent.click(closeButton);
    fireEvent.click(screen.getByTestId('ppe-dialog-backdrop'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    view.rerender(
      <PpeDialog open onClose={onClose} title="Saving Region" closeDisabled={false}>
        <button type="button">In-flight control</button>
      </PpeDialog>,
    );

    fireEvent.click(screen.getByTestId('ppe-dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches close button aria-label via changeUiLanguage while keeping Main common resources untouched', () => {
    const commonEnBefore = {
      ...(i18n.getResourceBundle('en', 'common') as Record<string, unknown>),
    };
    const commonViBefore = {
      ...(i18n.getResourceBundle('vi', 'common') as Record<string, unknown>),
    };
    const enTitleBefore = translate('app.documentTitle');

    render(
      <PpeDialog open onClose={vi.fn()} title="Locale Test Dialog">
        <button type="button">Action</button>
      </PpeDialog>,
    );

    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeTruthy();

    act(() => {
      changeUiLanguage('vi');
    });

    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('vi');
    expect(screen.getByRole('button', { name: 'Đóng hộp thoại' })).toBeTruthy();
    expect(i18n.hasResourceBundle('vi', SAFETY_NAMESPACE)).toBe(true);

    // Main common resources remain untouched and do not contain safety dialog keys
    const commonEnAfter = i18n.getResourceBundle('en', 'common') as Record<string, unknown>;
    const commonViAfter = i18n.getResourceBundle('vi', 'common') as Record<string, unknown>;
    expect(commonEnAfter).toEqual(commonEnBefore);
    expect(commonViAfter).toEqual(commonViBefore);
    expect(commonEnAfter['dialog.closeAria']).toBeUndefined();
    expect(commonViAfter['dialog.closeAria']).toBeUndefined();

    act(() => {
      changeUiLanguage('en');
    });
    expect(translate('app.documentTitle')).toBe(enTitleBefore);
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeTruthy();
  });
});
