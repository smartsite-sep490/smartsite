import { describe, expect, it } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import { authErrorMessage } from './auth-errors';

describe('auth error messages', () => {
  it('recognizes the actual network error code without exposing internal text', () => {
    expect(authErrorMessage(new ApiError('network', 'private internal host'))).toBe(
      'Could not connect. Check your connection and try again.',
    );
  });
  it('distinguishes an unavailable backend from expired authentication', () => {
    expect(authErrorMessage(new ApiError('invalid-response', 'private HTML', 503))).toContain(
      'temporarily unavailable',
    );
    expect(authErrorMessage(new ApiError('http', 'private detail', 401))).toContain(
      'sign-in details',
    );
  });
  it('shows the retry delay without using a server message as UI text', () => {
    expect(authErrorMessage(new ApiError('http', 'internal detail', 429, undefined, 45))).toContain(
      '45',
    );
  });
});
