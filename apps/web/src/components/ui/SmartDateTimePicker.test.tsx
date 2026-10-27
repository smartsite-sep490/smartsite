// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartDateTimePicker } from './SmartFormControls';

afterEach(cleanup);

it('supports minute precision and clearing an optional date and time', async () => {
  const change = vi.fn();
  render(
    <SmartDateTimePicker
      label="Until"
      value="2026-10-27T08:07:00"
      onChange={change}
      disablePast={false}
      minuteStep={1}
      clearable
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('Until'));
  await user.click(screen.getByRole('button', { name: /minute 09/i }));
  expect(change).toHaveBeenCalledWith('2026-10-27T08:09:00');
  await user.click(screen.getByRole('button', { name: /clear/i }));
  expect(change).toHaveBeenLastCalledWith('');
});
