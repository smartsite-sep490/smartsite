import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ServiceAuthGuard } from '../src/modules/auth/service-auth.guard.js';

function makeContext(header?: string | string[]): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: header !== undefined ? { authorization: header } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

test('ServiceAuthGuard rejects missing authorization header', () => {
  const guard = new ServiceAuthGuard(
    new ConfigService({ SMARTSITE_AI_SERVICE_TOKEN: 'expected-super-secret-token' }),
  );
  assert.throws(() => guard.canActivate(makeContext()), UnauthorizedException);
});

test('ServiceAuthGuard rejects malformed authorization headers', () => {
  const guard = new ServiceAuthGuard(
    new ConfigService({ SMARTSITE_AI_SERVICE_TOKEN: 'expected-super-secret-token' }),
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

test('ServiceAuthGuard rejects wrong token without leaking credential in error', () => {
  const guard = new ServiceAuthGuard(
    new ConfigService({ SMARTSITE_AI_SERVICE_TOKEN: 'expected-super-secret-token' }),
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

test('ServiceAuthGuard accepts exact Bearer token', () => {
  const guard = new ServiceAuthGuard(
    new ConfigService({ SMARTSITE_AI_SERVICE_TOKEN: 'expected-super-secret-token' }),
  );

  const allowed = guard.canActivate(makeContext('Bearer expected-super-secret-token'));
  assert.equal(allowed, true);
});
