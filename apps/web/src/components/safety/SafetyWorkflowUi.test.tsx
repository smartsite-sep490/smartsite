// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@smartsite/api-client';
import { Dialog, RequestError, ResultFields } from './SafetyWorkflowUi';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('file picker cancellation never closes the containing form', () => {
  const close = vi.fn();
  render(
    <Dialog title="Checklist" onClose={close}>
      <input type="file" aria-label="Evidence" />
    </Dialog>,
  );
  const input = screen.getByLabelText('Evidence');
  fireEvent(input, new Event('cancel', { bubbles: true }));
  fireEvent(input, new Event('cancel', { bubbles: true }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).not.toBeNull();
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledTimes(1);
});

it('a child consuming Escape does not close its dialog', () => {
  const close = vi.fn();
  render(
    <Dialog title="Checklist" onClose={close}>
      <input aria-label="Choice" onKeyDown={(e) => e.preventDefault()} />
    </Dialog>,
  );
  fireEvent.keyDown(screen.getByLabelText('Choice'), { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledTimes(1);
});

it('pending dialogs cannot be cancelled', () => {
  const close = vi.fn();
  render(
    <Dialog title="Checklist" onClose={close} pending>
      <input aria-label="Value" />
    </Dialog>,
  );
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  fireEvent.keyDown(screen.getByLabelText('Value'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).not.toHaveBeenCalled();
});

it('business conflict details are not replaced by a generic version message', () => {
  render(
    <RequestError
      error={new ApiError('http', 'The team must have a Zone grant covering this work window', 409)}
    />,
  );
  expect(screen.getByRole('alert').textContent).toContain('Zone grant');
  expect(screen.getByText(/Reload/)).not.toBeNull();
});

it('invalid replacement evidence preserves the previously selected result file', () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:result');
      static revokeObjectURL = vi.fn();
    },
  );
  const changed = vi.fn();
  render(<ResultFields onFileChange={changed} />);
  const input = screen.getByLabelText('Photo (optional JPEG, max 1 MiB)');
  const valid = new File(['photo'], 'valid.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [valid] } });
  fireEvent.change(input, {
    target: { files: [new File(['pdf'], 'wrong.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.change(input, {
    target: { files: [new File([], 'empty.jpg', { type: 'image/jpeg' })] },
  });
  expect(changed).toHaveBeenCalledExactlyOnceWith(valid);
  expect(screen.getByRole('img', { name: 'Selected result photo' })).not.toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('empty');
  fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
  expect(changed).toHaveBeenLastCalledWith(undefined);
});
