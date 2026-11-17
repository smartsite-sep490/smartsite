// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import { SmartDatePicker } from './SmartFormControls';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

describe('Dialog accessibility, focus lifecycle, and nested stack (FE-F01)', () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
  });

  it('exposes accessible name/description, traps Tab/Shift+Tab skipping disabled/hidden controls, preserves drafts across re-renders, and restores focus + body overflow on Escape', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'clip';

    function Harness() {
      const [open, setOpen] = useState(false);
      const [draft, setDraft] = useState('');
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open Shift Dialog
          </button>
          <button type="button">Background Action</button>
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            title="Create Shift"
            description="Configure shift hours for this site."
          >
            <div className="space-y-2">
              <input
                aria-label="Shift name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="button" disabled>
                Disabled Action
              </button>
              <button type="button" hidden>
                Hidden Action
              </button>
              <button type="button">Save Shift</button>
            </div>
          </Dialog>
        </div>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open Shift Dialog' });
    opener.focus();
    expect(document.activeElement).toBe(opener);

    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Create Shift' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const describedById = dialog.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)?.textContent).toBe(
      'Configure shift hours for this site.',
    );
    expect(document.body.style.overflow).toBe('hidden');

    const input = screen.getByLabelText('Shift name') as HTMLInputElement;
    const saveBtn = screen.getByRole('button', { name: 'Save Shift' });
    const closeBtn = screen.getByRole('button', { name: /close/i });

    // Initial focus moves to first interactive body control
    expect(document.activeElement).toBe(input);

    // Typing with inline onClose={() => setOpen(false)} preserves focus & draft
    await user.type(input, 'Morning Shift');
    expect(input.value).toBe('Morning Shift');
    expect(document.activeElement).toBe(input);

    // Tab order skips disabled and hidden buttons and wraps inside dialog
    await user.tab();
    expect(document.activeElement).toBe(saveBtn);
    await user.tab();
    expect(document.activeElement).toBe(closeBtn);
    await user.tab();
    expect(document.activeElement).toBe(input);

    // Shift+Tab moves from input to first control (closeBtn) and wraps from first to last (saveBtn)
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(closeBtn);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(saveBtn);

    // Escape closes dialog, restores focus to opener, and restores prior body overflow
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('clip');
  });

  it('handles nested dialogs so Escape closes only the top dialog and preserves scroll lock until the parent closes', async () => {
    const user = userEvent.setup();

    function NestedHarness() {
      const [outerOpen, setOuterOpen] = useState(false);
      const [innerOpen, setInnerOpen] = useState(false);
      const [note, setNote] = useState('Draft preserved');
      return (
        <div>
          <button type="button" onClick={() => setOuterOpen(true)}>
            Open Outer
          </button>
          <Dialog open={outerOpen} onClose={() => setOuterOpen(false)} title="Outer Team Dialog">
            <input aria-label="Team note" value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" onClick={() => setInnerOpen(true)}>
              Open Inner Confirm
            </button>
            <Dialog open={innerOpen} onClose={() => setInnerOpen(false)} title="Inner Zone Confirm">
              <button type="button">Confirm Zone</button>
            </Dialog>
          </Dialog>
        </div>
      );
    }

    render(<NestedHarness />);
    const outerOpener = screen.getByRole('button', { name: 'Open Outer' });
    await user.click(outerOpener);

    expect(screen.getByRole('dialog', { name: 'Outer Team Dialog' })).toBeTruthy();
    const innerOpener = screen.getByRole('button', { name: 'Open Inner Confirm' });
    await user.click(innerOpener);

    const innerDialog = screen.getByRole('dialog', { name: 'Inner Zone Confirm' });
    expect(innerDialog.getAttribute('aria-describedby')).toBeNull();
    const confirmZoneBtn = screen.getByRole('button', { name: 'Confirm Zone' });
    expect(document.activeElement).toBe(confirmZoneBtn);

    // F1: Programmatic/pointer focus onto a control in the covered parent dialog must be pulled back into the top inner dialog
    const outerNoteInput = screen.getByLabelText('Team note') as HTMLInputElement;
    outerNoteInput.focus();
    expect(innerDialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(outerNoteInput);

    // First Escape closes ONLY the inner dialog and restores focus to innerOpener
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Inner Zone Confirm' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Outer Team Dialog' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(innerOpener);
    expect((screen.getByLabelText('Team note') as HTMLInputElement).value).toBe('Draft preserved');

    // Second Escape closes the outer dialog and restores focus to outerOpener
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(outerOpener);
    expect(document.body.style.overflow).toBe('');
  });

  it('does not close the dialog when Escape dismisses an open SmartDatePicker popover inside it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <Dialog open onClose={onClose} title="Assign Zone Dates">
        <SmartDatePicker label="Start date" value="2026-11-17" onChange={() => {}} />
      </Dialog>,
    );

    const trigger = screen.getByLabelText('Start date');
    await user.click(trigger);
    // Calendar grid inside Radix Popover portal is open
    expect(screen.getByRole('grid')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('grid')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Assign Zone Dates' })).toBeTruthy();
  });

  it('orders the modal stack and preserves external opener when parent and nested child dialogs mount in the same commit (F2)', async () => {
    const user = userEvent.setup();

    function SimultaneousNestedHarness() {
      const [bothOpen, setBothOpen] = useState(false);
      const [innerOpen, setInnerOpen] = useState(true);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              setInnerOpen(true);
              setBothOpen(true);
            }}
          >
            Launch Nested Pair
          </button>
          {bothOpen && (
            <Dialog open onClose={() => setBothOpen(false)} title="Simultaneous Outer">
              <button type="button">Outer Action</button>
              <Dialog
                open={innerOpen}
                onClose={() => setInnerOpen(false)}
                title="Simultaneous Inner"
              >
                <button type="button">Inner Primary</button>
              </Dialog>
            </Dialog>
          )}
        </div>
      );
    }

    render(<SimultaneousNestedHarness />);
    const launcher = screen.getByRole('button', { name: 'Launch Nested Pair' });
    launcher.focus();
    await user.click(launcher);

    const innerDialog = screen.getByRole('dialog', { name: 'Simultaneous Inner' });
    const innerPrimary = screen.getByRole('button', { name: 'Inner Primary' });
    expect(document.activeElement).toBe(innerPrimary);

    // Tab stays trapped inside Simultaneous Inner, never reaching Outer Action
    await user.tab();
    expect(innerDialog.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(innerPrimary);

    // First Escape closes ONLY Simultaneous Inner; Simultaneous Outer stays open and receives focus
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Simultaneous Inner' })).toBeNull();
    const outerDialog = screen.getByRole('dialog', { name: 'Simultaneous Outer' });
    expect(outerDialog).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
    expect(outerDialog.contains(document.activeElement)).toBe(true);

    // Second Escape closes Simultaneous Outer and restores focus to the external launcher
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(launcher);
    expect(document.body.style.overflow).toBe('');
  });

  it('restores opener focus under StrictMode with child autoFocus and defers Escape to higher external modals (F1/F3)', async () => {
    const user = userEvent.setup();

    function AutoFocusStrictHarness() {
      const [open, setOpen] = useState(false);
      const [externalModalOpen, setExternalModalOpen] = useState(false);
      return (
        <React.StrictMode>
          <div>
            <button type="button" onClick={() => setOpen(true)}>
              Open AutoFocus Dialog
            </button>
            <Dialog open={open} onClose={() => setOpen(false)} title="AutoFocus Dialog">
              <input aria-label="Auto focused field" autoFocus />
              <button type="button" onClick={() => setExternalModalOpen(true)}>
                Open External Modal
              </button>
            </Dialog>
            {externalModalOpen && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="External Higher Modal"
                tabIndex={-1}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setExternalModalOpen(false);
                  }
                }}
              >
                <button type="button" onClick={() => setExternalModalOpen(false)}>
                  Dismiss External
                </button>
              </div>
            )}
          </div>
        </React.StrictMode>
      );
    }

    render(<AutoFocusStrictHarness />);
    const opener = screen.getByRole('button', { name: 'Open AutoFocus Dialog' });
    opener.focus();
    await user.click(opener);

    const autoInput = screen.getByLabelText('Auto focused field');
    expect(document.activeElement).toBe(autoInput);

    // Open external non-shared-stack modal mounted after Dialog
    await user.click(screen.getByRole('button', { name: 'Open External Modal' }));
    const externalBtn = screen.getByRole('button', { name: 'Dismiss External' });
    externalBtn.focus();
    expect(document.activeElement).toBe(externalBtn);

    // Escape while inside higher external modal must NOT close the lower Dialog
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'External Higher Modal' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'AutoFocus Dialog' })).toBeTruthy();

    // Next Escape closes AutoFocus Dialog and restores focus to opener despite autoFocus + StrictMode
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('never overwrites openerRef with an internal dialog control under StrictMode when the immediate trigger unmounts on open (F3.2)', async () => {
    const user = userEvent.setup();

    function UnmountingMenuTriggerHarness() {
      const [menuOpen, setMenuOpen] = useState(false);
      const [dialogOpen, setDialogOpen] = useState(false);
      return (
        <React.StrictMode>
          <div>
            <button type="button" onClick={() => setMenuOpen(true)}>
              Actions Menu
            </button>
            {menuOpen && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setDialogOpen(true);
                }}
              >
                Edit Shift Item
              </button>
            )}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Edit Shift">
              <input aria-label="Edited shift title" />
            </Dialog>
          </div>
        </React.StrictMode>
      );
    }

    render(<UnmountingMenuTriggerHarness />);
    const menuTrigger = screen.getByRole('button', { name: 'Actions Menu' });
    await user.click(menuTrigger);
    await user.click(screen.getByRole('button', { name: 'Edit Shift Item' }));

    expect(screen.queryByRole('button', { name: 'Edit Shift Item' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Edited shift title'));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(menuTrigger);
  });
});
