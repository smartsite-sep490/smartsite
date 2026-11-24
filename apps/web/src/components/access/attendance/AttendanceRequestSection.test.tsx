// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { AttendanceRequestSection } from './AttendanceRequestSection';
afterEach(cleanup);
it('starts collapsed, expands independently and keeps the form draft when collapsed', async () => {
  const user = userEvent.setup();
  render(
    <>
      <AttendanceRequestSection title="Create request">
        <input aria-label="Reason" />
      </AttendanceRequestSection>
      <AttendanceRequestSection title="History">
        <p>History items</p>
      </AttendanceRequestSection>
    </>,
  );
  const sections = document.querySelectorAll('details');
  expect(sections[0]?.open).toBe(false);
  expect(sections[1]?.open).toBe(false);
  await user.click(screen.getByText('Create request'));
  expect(sections[0]?.open).toBe(true);
  expect(sections[1]?.open).toBe(false);
  await user.type(screen.getByLabelText('Reason'), 'Doctor appointment');
  await user.click(screen.getByText('Create request'));
  expect(sections[0]?.open).toBe(false);
  await user.click(screen.getByText('Create request'));
  expect((screen.getByLabelText('Reason') as HTMLInputElement).value).toBe('Doctor appointment');
});
