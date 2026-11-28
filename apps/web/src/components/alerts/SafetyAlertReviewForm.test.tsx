// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SafetyAlertReviewForm } from './SafetyAlertReviewForm';

afterEach(cleanup);

it('explains a short decision reason at its field and prevents an invalid review', () => {
  const submit = vi.fn();
  const { rerender } = render(
    <SafetyAlertReviewForm
      reason="x"
      onReasonChange={() => {}}
      pending={false}
      onSubmit={submit}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm violation' }));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByText('Enter at least 5 characters.')).not.toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('textbox'));
  rerender(
    <SafetyAlertReviewForm
      reason="Verified original evidence"
      onReasonChange={() => {}}
      pending={false}
      onSubmit={submit}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm violation' }));
  expect(submit).toHaveBeenCalledExactlyOnceWith('CONFIRMED');
});
