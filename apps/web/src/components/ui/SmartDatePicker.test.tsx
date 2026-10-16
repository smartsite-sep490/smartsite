// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartDatePicker } from './SmartFormControls';
afterEach(cleanup);
it('fixes day/month/year display, enforces bounds and returns ISO calendar dates with keyboard-accessible calendar controls', async () => {
  const change = vi.fn();
  render(
    <SmartDatePicker
      label="End date"
      value="2026-10-12"
      onChange={change}
      disablePast={false}
      min="2026-10-12"
      max="2026-10-14"
    />,
  );
  expect(screen.getByLabelText('End date').textContent).toContain('12/10/2026');
  await userEvent.setup().click(screen.getByLabelText('End date'));
  expect(screen.getByRole('button', { name: /October 11.*2026/ }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(screen.getByRole('button', { name: /October 15.*2026/ }).hasAttribute('disabled')).toBe(
    true,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: /October 13.*2026/ }));
  expect(change).toHaveBeenCalledWith('2026-10-13');
});

it('supports clearable compact mode with placeholder and clear button', async () => {
  const change = vi.fn();
  const { rerender } = render(
    <SmartDatePicker
      id="test-date"
      label="From"
      value="2026-10-15"
      onChange={change}
      placeholder="dd/mm/yyyy"
      clearable
      compact
    />,
  );
  expect(screen.getByLabelText('From').textContent).toContain('15/10/2026');
  const clearButton = screen.getByRole('button', { name: /clear/i });
  await userEvent.setup().click(clearButton);
  expect(change).toHaveBeenCalledWith('');

  rerender(
    <SmartDatePicker
      id="test-date"
      label="From"
      value=""
      onChange={change}
      placeholder="dd/mm/yyyy"
      clearable
      compact
    />,
  );
  expect(screen.getByLabelText('From').textContent).toContain('dd/mm/yyyy');
});
