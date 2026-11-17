// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '../ui/Dialog';
import { ActionDrawer } from './ActionDrawer';

describe('ActionDrawer accessibility, focus trap/restore, Escape, and inert close transition (FE-F01)', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    document.body.style.overflow = '';
  });

  it('wires dialog semantics and aria-labelledby/describedby, traps Tab/Shift+Tab, preserves drafts, closes on Escape, marks closing drawer inert, and restores opener focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    function DrawerHarness() {
      const [isOpen, setIsOpen] = useState(false);
      const [comment, setComment] = useState('');
      return (
        <div>
          <button type="button" onClick={() => setIsOpen(true)}>
            Inspect Alert Action
          </button>
          <button type="button">Outside Button</button>
          <ActionDrawer
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            title="Corrective Action Drawer"
            description="Review and record action details before saving."
            badge="URGENT"
            badgeType="warning"
          >
            <input
              aria-label="Action note"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button type="button" disabled>
              Disabled Submit
            </button>
            <button type="button">Apply Update</button>
          </ActionDrawer>
        </div>
      );
    }

    render(<DrawerHarness />);
    const opener = screen.getByRole('button', { name: 'Inspect Alert Action' });
    opener.focus();

    await user.click(opener);

    const drawer = screen.getByRole('dialog', { name: 'Corrective Action Drawer' });
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    const describedById = drawer.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)?.textContent).toBe(
      'Review and record action details before saving.',
    );
    expect(drawer.hasAttribute('inert')).toBe(false);

    const noteInput = screen.getByLabelText('Action note') as HTMLInputElement;
    const applyBtn = screen.getByRole('button', { name: 'Apply Update' });
    const closeBtn = screen.getByRole('button', { name: /close/i });

    expect(document.activeElement).toBe(noteInput);

    // Draft typing stays stable without losing focus
    await user.type(noteInput, 'Check harness');
    expect(noteInput.value).toBe('Check harness');
    expect(document.activeElement).toBe(noteInput);

    // Tab skips disabled button and loops inside drawer; Shift+Tab wraps first -> last
    await user.tab();
    expect(document.activeElement).toBe(applyBtn);
    await user.tab();
    expect(document.activeElement).toBe(closeBtn);
    await user.tab();
    expect(document.activeElement).toBe(noteInput);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(closeBtn);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(applyBtn);

    // Escape initiates close: drawer stays mounted during 500ms transition BUT is immediately inert & restores focus
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(opener);
    expect(drawer.isConnected).toBe(true);
    expect(drawer.hasAttribute('inert')).toBe(true);
    expect(drawer.getAttribute('aria-hidden')).toBe('true');

    // After 500ms close animation completes, drawer unmounts cleanly
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(drawer.isConnected).toBe(false);
  });

  it('prevents focus escape into covered ActionDrawer when a Dialog opens on top and avoids restoring focus into an inert closing drawer (F1/F3)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    function DrawerWithDialogHarness() {
      const [drawerOpen, setDrawerOpen] = useState(false);
      const [confirmOpen, setConfirmOpen] = useState(false);
      return (
        <React.StrictMode>
          <div>
            <button type="button" onClick={() => setDrawerOpen(true)}>
              Open Action Drawer
            </button>
            <ActionDrawer
              isOpen={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              title="Parent Action Drawer"
            >
              <input aria-label="Drawer auto field" autoFocus />
              <button type="button" onClick={() => setConfirmOpen(true)}>
                Open Confirm Dialog
              </button>
            </ActionDrawer>
            <Dialog
              open={confirmOpen}
              onClose={() => setConfirmOpen(false)}
              title="Confirm Drawer Action"
            >
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setDrawerOpen(false);
                }}
              >
                Confirm And Close Both
              </button>
            </Dialog>
          </div>
        </React.StrictMode>
      );
    }

    render(<DrawerWithDialogHarness />);
    const outerOpener = screen.getByRole('button', { name: 'Open Action Drawer' });
    outerOpener.focus();
    await user.click(outerOpener);

    const drawerAutoInput = screen.getByLabelText('Drawer auto field');
    expect(document.activeElement).toBe(drawerAutoInput);

    // Open sibling Dialog on top of ActionDrawer
    const openConfirmBtn = screen.getByRole('button', { name: 'Open Confirm Dialog' });
    await user.click(openConfirmBtn);

    const confirmDialog = screen.getByRole('dialog', { name: 'Confirm Drawer Action' });
    const confirmBothBtn = screen.getByRole('button', { name: 'Confirm And Close Both' });
    expect(document.activeElement).toBe(confirmBothBtn);

    // F1: Attempting to focus an input inside the covered ActionDrawer snaps focus back into Confirm Dialog
    drawerAutoInput.focus();
    expect(confirmDialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(drawerAutoInput);

    // F3: Closing both Dialog and ActionDrawer together marks drawer inert and restores focus to outerOpener (never inside inert drawer)
    await user.click(confirmBothBtn);
    expect(screen.queryByRole('dialog', { name: 'Confirm Drawer Action' })).toBeNull();
    expect(document.activeElement).toBe(outerOpener);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });
});
