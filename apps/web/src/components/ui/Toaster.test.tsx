// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@smartsite/api-client';
import { Toaster } from './Toaster';
import { Dialog } from '../safety/SafetyWorkflowUi';
import { notifyWorkflowFailure } from '../safety/workflow-feedback';
import { toast } from './toast-manager';

afterEach(cleanup);

it('uses one shared toaster for success and error notifications from any feature', async () => {
  const { container } = render(<Toaster />);
  act(() => {
    toast.add({ title: 'Account saved', type: 'success' });
    toast.add({ title: 'Upload failed', type: 'error' });
  });
  await waitFor(() => expect(document.querySelectorAll('.app-toast')).toHaveLength(2));
  expect(document.querySelector('.app-toast[data-type="success"]')?.textContent).toContain(
    'Account saved',
  );
  expect(document.querySelector('.app-toast[data-type="error"]')?.textContent).toContain(
    'Upload failed',
  );
  expect(container.querySelectorAll('.app-toast-viewport')).toHaveLength(0);
  expect(document.querySelectorAll('.app-toast-viewport')).toHaveLength(1);
});

it('renders a single operation error inside the active native dialog top layer', async () => {
  render(
    <>
      <Toaster />
      <Dialog title="Checklist" onClose={() => {}}>
        <p>Form</p>
      </Dialog>
    </>,
  );
  const error = new ApiError('network', 'PRIVATE_DIAGNOSTIC');
  act(() => {
    notifyWorkflowFailure(error);
    notifyWorkflowFailure(error);
  });
  const dialog = screen.getByRole('dialog');
  const message = 'Could not connect. Check your connection and try again.';
  await waitFor(() => expect(dialog.querySelectorAll('.app-toast')).toHaveLength(1));
  expect(dialog.querySelector('.app-toast')?.textContent).toContain(message);
  expect(screen.queryByText('PRIVATE_DIAGNOSTIC')).toBeNull();
});
