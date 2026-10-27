// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

function NestedDialogs() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  return <>
    <button onClick={() => setParentOpen(true)}>Configure area</button>
    <PpeDialog open={parentOpen} onClose={() => setParentOpen(false)} title="Area configuration">
      <input aria-label="Area name" />
      <button onClick={() => setChildOpen(true)}>Open details</button>
    </PpeDialog>
    <PpeDialog open={childOpen} onClose={() => setChildOpen(false)} title="Area details">
      <input aria-label="Details name" />
      <button>Save details</button>
    </PpeDialog>
  </>;
}

describe('overlapping Safety dialogs', () => {
  it('keeps focus in the top dialog and closes only that dialog with Escape', async () => {
    const user = userEvent.setup();
    render(<NestedDialogs />);
    await user.click(screen.getByRole('button', { name: 'Configure area' }));
    const childTrigger = screen.getByRole('button', { name: 'Open details' });
    await user.click(childTrigger);
    const child = screen.getByRole('dialog', { name: 'Area details' });
    expect(document.activeElement).toBe(within(child).getByRole('textbox', { name: 'Details name' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(within(child).getByRole('button', { name: 'Close dialog' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Area details' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Area configuration' })).toBeTruthy();
    expect(document.activeElement).toBe(childTrigger);
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Configure area' }));
  });

  it('localizes close buttons across EN -> VI -> EN while nested dialogs are open without breaking top-dialog focus or Escape stack order', async () => {
    const user = userEvent.setup();
    render(<NestedDialogs />);
    await user.click(screen.getByRole('button', { name: 'Configure area' }));
    const parent = screen.getByRole('dialog', { name: 'Area configuration' });
    const parentInput = within(parent).getByRole('textbox', { name: 'Area name' }) as HTMLInputElement;
    await user.type(parentInput, 'NORTH-YARD');

    const childTrigger = within(parent).getByRole('button', { name: 'Open details' });
    await user.click(childTrigger);
    const child = screen.getByRole('dialog', { name: 'Area details' });
    const childInput = within(child).getByRole('textbox', { name: 'Details name' }) as HTMLInputElement;
    await user.type(childInput, 'GATE-2');

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(within(parent).getByRole('button', { name: 'Đóng hộp thoại', hidden: true })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Area configuration' })).toBeNull();
    expect(parent.closest('[data-testid="ppe-dialog-backdrop"]')?.parentElement?.hasAttribute('inert')).toBe(true);
    expect(within(child).getByRole('button', { name: 'Đóng hộp thoại' })).toBeTruthy();
    expect(document.activeElement).toBe(childInput);
    expect(parentInput.value).toBe('NORTH-YARD');
    expect(childInput.value).toBe('GATE-2');

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(within(child).getByRole('button', { name: 'Đóng hộp thoại' }));

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(within(parent).getByRole('button', { name: 'Close dialog', hidden: true })).toBeTruthy();
    expect(within(child).getByRole('button', { name: 'Close dialog' })).toBeTruthy();
    expect(document.activeElement).toBe(within(child).getByRole('button', { name: 'Close dialog' }));
    expect(parentInput.value).toBe('NORTH-YARD');
    expect(childInput.value).toBe('GATE-2');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Area details' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Area configuration' })).toBeTruthy();
    expect(document.activeElement).toBe(childTrigger);
    expect(parentInput.value).toBe('NORTH-YARD');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it.each(['parent-first', 'child-first'] as const)(
    'restores original background state only after both dialogs unmount (%s)',
    (order) => {
      const background = document.createElement('div');
      background.setAttribute('aria-hidden', 'false');
      document.body.append(background);
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'clip';
      try {
        const parent = render(<PpeDialog open title="Parent" onClose={() => {}}><input aria-label="Parent field" /></PpeDialog>);
        const child = render(<PpeDialog open title="Child" onClose={() => {}}><input aria-label="Child field" /></PpeDialog>);
        const first = order === 'parent-first' ? parent : child;
        const last = order === 'parent-first' ? child : parent;
        first.unmount();
        expect(background.getAttribute('inert')).toBe('');
        expect(background.getAttribute('aria-hidden')).toBe('true');
        expect(document.body.style.overflow).toBe('hidden');
        last.unmount();
        expect(background.hasAttribute('inert')).toBe(false);
        expect(background.getAttribute('aria-hidden')).toBe('false');
        expect(document.body.style.overflow).toBe('clip');
      } finally {
        cleanup();
        background.remove();
        document.body.style.overflow = originalOverflow;
      }
    },
  );
});
