// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@smartsite/api-client';
import { CommandForm, Dialog, Field } from './SafetyWorkflowUi';

afterEach(cleanup);

it('shows required errors beside fields and rejects whitespace before calling the command', () => {
  const submit = vi.fn();
  render(
    <CommandForm pending={false} label="Save" onSubmit={submit}>
      <Field name="description" label="Description" required />
    </CommandForm>,
  );
  const input = screen.getByLabelText('Description');
  expect(input.closest('.workflow-field')?.textContent).toContain('*');
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.blur(input);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  fireEvent.submit(input.closest('form')!);
  expect(submit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'Prepare equipment' } });
  expect(input.getAttribute('aria-invalid')).not.toBe('true');
  fireEvent.submit(input.closest('form')!);
  expect(submit).toHaveBeenCalledTimes(1);
});

it('places a structured API error on its field without exposing backend diagnostics', () => {
  const error = new ApiError('http', 'PRIVATE_DIAGNOSTIC', 400, {
    success: false,
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'Validation failed',
    requestId: 'test',
    timestamp: '2026-11-27T00:00:00Z',
    path: '/api/v1/incidents',
    issues: [
      { code: 'INVALID_VALUE', path: '/initialAction/description', message: 'PRIVATE_DIAGNOSTIC' },
    ],
  });
  render(
    <Dialog title="Handover" error={error} onClose={() => {}}>
      <CommandForm pending={false} label="Save" onSubmit={() => {}}>
        <Field name="actionDescription" label="Handling request" required />
      </CommandForm>
    </Dialog>,
  );
  const input = screen.getByLabelText('Handling request');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toBeTruthy();
  expect(screen.queryByText(/PRIVATE_DIAGNOSTIC/)).toBeNull();
});

it('responsibility-only submission validates responsibility without requiring handling fields', () => {
  const submit = vi.fn();
  render(
    <CommandForm
      pending={false}
      label="Hand over"
      onSubmit={submit}
      secondaryAction={
        <button type="submit" name="responsibilityOnly" value="true" formNoValidate>
          Confirm only
        </button>
      }
    >
      <Field name="contractorId" label="Contractor" required defaultValue="contractor" />
      <Field name="reason" label="Reason" required defaultValue="Verified" />
      <Field name="actionDescription" label="Handling request" required />
    </CommandForm>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm only' }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0]![0].get('responsibilityOnly')).toBe('true');
});
