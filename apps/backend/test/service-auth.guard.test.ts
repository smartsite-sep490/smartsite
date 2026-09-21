import { createTestConfig } from './support/config.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ServiceAuthGuard } from '../src/modules/auth/service-auth.guard.js';

function makeContext(header?: string | string[], rawHeaders?: string[]): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: header !== undefined ? { authorization: header } : {},
        rawHeaders,
      }),
    }),
  } as unknown as ExecutionContext;
}

test('ServiceAuthGuard rejects missing authorization header', () => {
  const guard = new ServiceAuthGuard(
    createTestConfig({ SMARTSITE_AI_SERVICE_TOKEN: 'expected-super-secret-token' }),
  );
  assert.throws(() => guard.canActivate(makeContext()), UnauthorizedException);
});

test('ServiceAuthGuard rejects malformed authorization headers and strict whitespace violations', () => {
  const guard = new ServiceAuthGuard(
    createTestConfig({ SMARTSITE_AI_SERVICE_TOKEN: 'expected-super-secret-token' }),
  );

  const malformedHeaders: Array<string | string[]> = [
    '',
    '   ',
    'Basic expected-super-secret-token',
    'Token expected-super-secret-token',
    'Bearer',
    'Bearer ',
    'Bearer   ',
    'Bearer token1 token2',
    'Bearer   token1   token2',
    ' Bearer expected-super-secret-token',
    'Bearer expected-super-secret-token ',
    'Bearer  expected-super-secret-token',
    'Bearer\texpected-super-secret-token',
    'Bearer\nexpected-super-secret-token',
    'Bearer expected-super-secret-token\n',
    ['Bearer expected-super-secret-token', 'Bearer other'],
  ];

  for (const header of malformedHeaders) {
    assert.throws(
      () => guard.canActivate(makeContext(header)),
      (error: unknown) => {
        assert.ok(error instanceof UnauthorizedException);
        assert.doesNotMatch(error.message, /expected-super-secret-token/);
        return true;
      },
    );
  }
});

test('ServiceAuthGuard rejects duplicate raw Authorization headers', () => {
  const guard = new ServiceAuthGuard(
    createTestConfig({ SMARTSITE_AI_SERVICE_TOKEN: 'expected-super-secret-token' }),
  );

  const duplicateRawCases = [
    [
      'Authorization',
      'Bearer expected-super-secret-token',
      'authorization',
      'Bearer expected-super-secret-token',
    ],
    ['Authorization', 'Bearer expected-super-secret-token', 'AUTHORIZATION', 'Bearer wrong-token'],
    [
      'X-Other',
      '1',
      'authorization',
      'Bearer expected-super-secret-token',
      'Authorization',
      'Bearer expected-super-secret-token',
    ],
  ];

  for (const rawHeaders of duplicateRawCases) {
    assert.throws(
      () => guard.canActivate(makeContext('Bearer expected-super-secret-token', rawHeaders)),
      UnauthorizedException,
    );
  }
});

test('ServiceAuthGuard rejects wrong token without leaking credential in error', () => {
  const guard = new ServiceAuthGuard(
    createTestConfig({ SMARTSITE_AI_SERVICE_TOKEN: 'expected-super-secret-token' }),
  );

  assert.throws(
    () => guard.canActivate(makeContext('Bearer wrong-secret-token-value')),
    (error: unknown) => {
      assert.ok(error instanceof UnauthorizedException);
      assert.doesNotMatch(error.message, /expected-super-secret-token/);
      assert.doesNotMatch(error.message, /wrong-secret-token-value/);
      return true;
    },
  );
});

test('ServiceAuthGuard accepts exact Bearer token with single header entry', () => {
  const guard = new ServiceAuthGuard(
    createTestConfig({ SMARTSITE_AI_SERVICE_TOKEN: 'expected-super-secret-token' }),
  );

  const allowedWithoutRaw = guard.canActivate(makeContext('Bearer expected-super-secret-token'));
  assert.equal(allowedWithoutRaw, true);

  const allowedWithSingleRaw = guard.canActivate(
    makeContext('Bearer expected-super-secret-token', [
      'Content-Type',
      'application/json',
      'Authorization',
      'Bearer expected-super-secret-token',
    ]),
  );
  assert.equal(allowedWithSingleRaw, true);
});
