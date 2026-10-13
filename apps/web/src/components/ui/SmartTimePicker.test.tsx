// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SmartTimePicker } from './SmartFormControls';

afterEach(cleanup);
function Form() {
  const [value, setValue] = useState('00:07');
  return (
    <>
      <SmartTimePicker label="Proposed out time" value={value} onChange={setValue} minuteStep={1} />
      <output aria-label="Selected time">{value}</output>
    </>
  );
}
it('keeps hour, exact minutes and AM/PM selectable and returns a 24-hour value without seconds', async () => {
  render(<Form />);
  fireEvent.click(screen.getByLabelText('Proposed out time'));
  expect(await screen.findByRole('button', { name: /^AM$/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^PM$/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Hour 12' }));
  fireEvent.click(screen.getByRole('button', { name: 'Minute 47' }));
  fireEvent.click(screen.getByRole('button', { name: /^PM$/ }));
  expect(screen.getByLabelText('Selected time').textContent).toBe('12:47');
  expect(screen.getByRole('button', { name: 'Minute 47' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: /^AM$/ }));
  expect(screen.getByLabelText('Selected time').textContent).toBe('00:47');
});
it('closes with Done or Escape and preserves the selected time', async () => {
  render(<Form />);
  fireEvent.click(screen.getByLabelText('Proposed out time'));
  fireEvent.click(await screen.findByRole('button', { name: '04:00 PM' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByLabelText('Selected time').textContent).toBe('16:00');
  fireEvent.click(screen.getByLabelText('Proposed out time'));
  fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
