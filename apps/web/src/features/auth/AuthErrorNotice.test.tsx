// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import { AuthErrorNotice } from './AuthErrorNotice';

afterEach(cleanup);

it('shows the approved message without HTTP diagnostics or request identifiers', () => {
  const error = new ApiError('http', 'PRIVATE_SENTINEL', 401, {
    success: false,
    statusCode: 401,
    code: 'UNAUTHORIZED',
    message: 'Unauthorized',
    requestId: 'diagnostic-request-123',
    timestamp: '2026-10-25T00:00:00Z',
    path: '/api/v1/auth/login',
  });
  const { container } = render(<AuthErrorNotice error={error} />);
  expect(screen.getByRole('alert').textContent).toContain('sign-in details');
  expect(container.querySelector('details')).toBeNull();
  expect(container.textContent).not.toMatch(
    /HTTP|UNAUTHORIZED|diagnostic-request|PRIVATE_SENTINEL|Error details/,
  );
});
