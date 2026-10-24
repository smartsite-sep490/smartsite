// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { PpeDialog } from './PpeDialog';

beforeEach(async () => {
  window.localStorage.clear();
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  cleanup();
  window.localStorage.clear();
  await i18n.changeLanguage('en');
});

function Harness({ empty = false }: { empty?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Configure zone</button>
    <button>Outside action</button>
    <PpeDialog open={open} onClose={() => setOpen(false)} title="Zone configuration" description="Save requirements for the selected site.">
      {!empty && <><input aria-label="Zone name" /><button>Save zone</button></>}
    </PpeDialog>
  </>;
}

describe('PPE dialog keyboard and page isolation', () => {
  it('has an accessible name and description, focuses the first form control, and cycles keyboard focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Configure zone' }));
    const dialog = screen.getByRole('dialog', { name: 'Zone configuration' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    const field = within(dialog).getByRole('textbox', { name: 'Zone name' });
    expect(document.activeElement).toBe(field);
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Save zone' }));
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close dialog' }));
    await user.tab();
    expect(document.activeElement).toBe(field);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close dialog' }));
  });

  it('closes with Escape and restores trigger focus and the pre-existing body overflow', async () => {
    const user = userEvent.setup();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'clip';
    try {
      render(<Harness />);
      const trigger = screen.getByRole('button', { name: 'Configure zone' });
      await user.click(trigger);
      expect(document.body.style.overflow).toBe('hidden');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(document.body.style.overflow).toBe('clip');
    } finally { document.body.style.overflow = oldOverflow; }
  });

  it('makes the background inert while open and restores existing attributes on unmount', async () => {
    const user = userEvent.setup();
    const background = document.createElement('div');
    background.setAttribute('aria-hidden', 'false');
    document.body.append(background);
    try {
      const result = render(<Harness />);
      await user.click(screen.getByRole('button', { name: 'Configure zone' }));
      expect(background.hasAttribute('inert')).toBe(true);
      expect(background.getAttribute('aria-hidden')).toBe('true');
      result.unmount();
      expect(background.hasAttribute('inert')).toBe(false);
      expect(background.getAttribute('aria-hidden')).toBe('false');
    } finally { background.remove(); }
  });

  it('dismisses only a backdrop click and not interactions with the dialog contents', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<PpeDialog open onClose={close} title="Review observation"><button>Inspect</button></PpeDialog>);
    await user.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('ppe-dialog-backdrop'));
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps focus inside even if another control tries to take it', async () => {
    const user = userEvent.setup();
    const result = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Configure zone' }));
    result.container.querySelectorAll('button')[1]!.focus();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('skips hidden controls and controls disabled by their fieldset when choosing initial focus', () => {
    render(<PpeDialog open title="Configure zone" onClose={() => {}}>
      <div style={{ display: 'none' }}><input aria-label="Hidden field" /></div>
      <fieldset disabled><input aria-label="Disabled field" /></fieldset>
      <input aria-label="Editable field" />
    </PpeDialog>);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Editable field' }));
  });

  it('lets an inline editor handle Escape before closing its parent dialog', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const cancelEditor = vi.fn();
    render(<PpeDialog open title="Configuration" onClose={close}>
      <button onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancelEditor(); } }}>Drawing editor</button>
    </PpeDialog>);
    await user.keyboard('{Escape}');
    expect(cancelEditor).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('localizes the close button accessible name across EN -> VI -> EN while open without losing focus or page isolation', async () => {
    const user = userEvent.setup();
    const background = document.createElement('div');
    background.setAttribute('aria-hidden', 'false');
    document.body.append(background);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'clip';
    try {
      render(<Harness />);
      const trigger = screen.getByRole('button', { name: 'Configure zone' });
      await user.click(trigger);

      const dialog = screen.getByRole('dialog', { name: 'Zone configuration' });
      const field = within(dialog).getByRole('textbox', { name: 'Zone name' }) as HTMLInputElement;
      await user.type(field, 'CRANE-BAY');
      expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toBeTruthy();
      expect(document.activeElement).toBe(field);
      expect(background.hasAttribute('inert')).toBe(true);
      expect(document.body.style.overflow).toBe('hidden');

      await act(async () => {
        await i18n.changeLanguage('vi');
      });

      const viCloseBtn = within(dialog).getByRole('button', { name: 'Đóng hộp thoại' });
      expect(viCloseBtn).toBeTruthy();
      expect(within(dialog).queryByRole('button', { name: 'Close dialog' })).toBeNull();
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe('CRANE-BAY');
      expect(background.hasAttribute('inert')).toBe(true);
      expect(document.body.style.overflow).toBe('hidden');

      await user.tab({ shift: true });
      expect(document.activeElement).toBe(viCloseBtn);

      await act(async () => {
        await i18n.changeLanguage('en');
      });

      const enCloseBtn = within(dialog).getByRole('button', { name: 'Close dialog' });
      expect(enCloseBtn).toBeTruthy();
      expect(within(dialog).queryByRole('button', { name: 'Đóng hộp thoại' })).toBeNull();
      expect(document.activeElement).toBe(enCloseBtn);
      expect(field.value).toBe('CRANE-BAY');
      expect(background.hasAttribute('inert')).toBe(true);

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(background.hasAttribute('inert')).toBe(false);
      expect(background.getAttribute('aria-hidden')).toBe('false');
      expect(document.body.style.overflow).toBe('clip');
    } finally {
      background.remove();
      document.body.style.overflow = oldOverflow;
    }
  });
});
