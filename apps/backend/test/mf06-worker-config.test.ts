import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnvironmentValidationError, validateEnvironment } from '../src/config/environment.js';
import path from 'node:path';

test('MF06 worker, enqueue, and read flags default to false with optional cutover release and face model fields', () => {
  const defaults = validateEnvironment({});
  assert.equal(defaults.MF06_ENQUEUE_ENABLED, false);
  assert.equal(defaults.MF06_ENQUEUE_MAX_OUTSTANDING, undefined);
  assert.equal(defaults.MF06_ASSESSMENT_READ_ENABLED, false);
  assert.equal(defaults.MF06_WORKER_ENABLED, false);
  assert.equal(defaults.MF06_CUTOVER_MANIFEST_PATH, undefined);
  assert.equal(defaults.MF06_CUTOVER_MANIFEST_SHA256, undefined);
  assert.equal(defaults.MF06_CUTOVER_RELEASE_ROOT, undefined);
  assert.equal(defaults.MF06_CUTOVER_RELEASE_COMMIT, undefined);
  assert.equal(defaults.MF06_FACE_MODEL_VERSION, undefined);

  const explicitDisabled = validateEnvironment({
    MF06_ENQUEUE_ENABLED: 'false',
    MF06_ASSESSMENT_READ_ENABLED: 'true',
    MF06_WORKER_ENABLED: 'false',
    SMARTSITE_AI_IDENTITY_URL: 'http://127.0.0.1:8000',
  });
  assert.equal(explicitDisabled.MF06_ENQUEUE_ENABLED, false);
  assert.equal(explicitDisabled.MF06_ASSESSMENT_READ_ENABLED, true);
  assert.equal(explicitDisabled.MF06_WORKER_ENABLED, false);
  assert.equal(explicitDisabled.SMARTSITE_AI_IDENTITY_URL, 'http://127.0.0.1:8000');

  assert.throws(
    () => validateEnvironment({ MF06_ENQUEUE_ENABLED: 'true' }),
    /MF06_ENQUEUE_MAX_OUTSTANDING must be explicitly set when MF06 enqueue is enabled/,
  );
  const enqueueOnly = validateEnvironment({
    MF06_ENQUEUE_ENABLED: 'true',
    MF06_ENQUEUE_MAX_OUTSTANDING: '1000',
  });
  assert.equal(enqueueOnly.MF06_ENQUEUE_ENABLED, true);
  assert.equal(enqueueOnly.MF06_ENQUEUE_MAX_OUTSTANDING, 1000);
  assert.equal(enqueueOnly.MF06_WORKER_ENABLED, false);
  assert.equal(enqueueOnly.MF06_ASSESSMENT_READ_ENABLED, false);
});

test('MF06 worker requires all four trusted cutover release fields when enabled, rejects partial identity config, and keeps flags independent', () => {
  const validWorkerEnv = {
    MF06_WORKER_ENABLED: 'true',
    MF06_CUTOVER_MANIFEST_PATH: ` ${path.resolve('releases', 'mf06-cutover-manifest.json')} `,
    MF06_CUTOVER_MANIFEST_SHA256: 'a'.repeat(64),
    MF06_CUTOVER_RELEASE_ROOT: ` ${path.resolve('releases', 'current')} `,
    MF06_CUTOVER_RELEASE_COMMIT: 'b'.repeat(40),
  };

  const enabledWithoutIdentity = validateEnvironment(validWorkerEnv);
  assert.equal(enabledWithoutIdentity.MF06_WORKER_ENABLED, true);
  assert.equal(
    enabledWithoutIdentity.MF06_CUTOVER_MANIFEST_PATH,
    path.resolve('releases', 'mf06-cutover-manifest.json'),
  );
  assert.equal(enabledWithoutIdentity.MF06_CUTOVER_MANIFEST_SHA256, 'a'.repeat(64));
  assert.equal(
    enabledWithoutIdentity.MF06_CUTOVER_RELEASE_ROOT,
    path.resolve('releases', 'current'),
  );
  assert.equal(enabledWithoutIdentity.MF06_CUTOVER_RELEASE_COMMIT, 'b'.repeat(40));
  assert.equal(enabledWithoutIdentity.MF06_FACE_MODEL_VERSION, undefined);
  assert.equal(enabledWithoutIdentity.SMARTSITE_AI_IDENTITY_URL, undefined);
  assert.equal(enabledWithoutIdentity.MF06_ENQUEUE_ENABLED, false);
  assert.equal(enabledWithoutIdentity.MF06_ASSESSMENT_READ_ENABLED, false);

  const evidenceRoot = path.resolve('runtime', 'evidence');
  const enabledWithIdentity = validateEnvironment({
    ...validWorkerEnv,
    SMARTSITE_AI_IDENTITY_URL: 'http://127.0.0.1:8000',
    EVIDENCE_LOCAL_ROOT: evidenceRoot,
    MF06_FACE_MODEL_VERSION: 'arcface-r100-v1',
  });
  assert.equal(enabledWithIdentity.SMARTSITE_AI_IDENTITY_URL, 'http://127.0.0.1:8000');
  assert.equal(enabledWithIdentity.EVIDENCE_LOCAL_ROOT, evidenceRoot);
  assert.equal(enabledWithIdentity.MF06_FACE_MODEL_VERSION, 'arcface-r100-v1');

  assert.throws(
    () =>
      validateEnvironment({
        ...validWorkerEnv,
        SMARTSITE_AI_IDENTITY_URL: 'http://127.0.0.1:8000',
      }),
    (error: unknown) => {
      assert.ok(error instanceof EnvironmentValidationError);
      assert.match(
        error.message,
        /EVIDENCE_LOCAL_ROOT must be explicitly set when MF06 worker face identity is configured/,
      );
      assert.match(
        error.message,
        /MF06_FACE_MODEL_VERSION must be explicitly set when MF06 worker face identity is configured/,
      );
      return true;
    },
  );

  assert.throws(
    () =>
      validateEnvironment({
        ...validWorkerEnv,
        MF06_FACE_MODEL_VERSION: 'arcface-r100-v1',
      }),
    (error: unknown) => {
      assert.ok(error instanceof EnvironmentValidationError);
      assert.match(
        error.message,
        /SMARTSITE_AI_IDENTITY_URL must be explicitly set when MF06 worker face identity is configured/,
      );
      assert.match(
        error.message,
        /EVIDENCE_LOCAL_ROOT must be explicitly set when MF06 worker face identity is configured/,
      );
      return true;
    },
  );

  assert.throws(
    () => validateEnvironment({ MF06_WORKER_ENABLED: 'true' }),
    (error: unknown) => {
      assert.ok(error instanceof EnvironmentValidationError);
      for (const requiredField of [
        'MF06_CUTOVER_MANIFEST_PATH',
        'MF06_CUTOVER_MANIFEST_SHA256',
        'MF06_CUTOVER_RELEASE_ROOT',
        'MF06_CUTOVER_RELEASE_COMMIT',
      ]) {
        assert.match(
          error.message,
          new RegExp(`${requiredField} must be explicitly set when MF06 worker is enabled`),
        );
      }
      return true;
    },
  );

  for (const missingField of [
    'MF06_CUTOVER_MANIFEST_PATH',
    'MF06_CUTOVER_MANIFEST_SHA256',
    'MF06_CUTOVER_RELEASE_ROOT',
    'MF06_CUTOVER_RELEASE_COMMIT',
  ] as const) {
    const partial: Record<string, unknown> = { ...validWorkerEnv };
    delete partial[missingField];
    assert.throws(
      () => validateEnvironment(partial),
      new RegExp(`${missingField} must be explicitly set when MF06 worker is enabled`),
    );
  }
});

test('MF06 worker rejects invalid secret-bearing SMARTSITE_AI_IDENTITY_URL with EnvironmentValidationError and never retains raw .input or .cause', () => {
  const validWorkerEnv = {
    MF06_WORKER_ENABLED: 'true',
    MF06_CUTOVER_MANIFEST_PATH: path.resolve('releases', 'mf06-cutover-manifest.json'),
    MF06_CUTOVER_MANIFEST_SHA256: 'a'.repeat(64),
    MF06_CUTOVER_RELEASE_ROOT: path.resolve('releases', 'current'),
    MF06_CUTOVER_RELEASE_COMMIT: 'b'.repeat(40),
    EVIDENCE_LOCAL_ROOT: path.resolve('runtime', 'evidence'),
    MF06_FACE_MODEL_VERSION: 'arcface-r100-v1',
  };

  for (const secretInvalidUrl of [
    'not-a-valid-url-with-secret-credential-998877',
    '://broken-url-secret-token-value',
    'http://user:super-secret-password@127.0.0.1:8000',
    'http://127.0.0.1:8000?secret_query=leaked_value',
    'http://127.0.0.1:8000#secret_fragment_leaked',
    123456789,
  ]) {
    assert.throws(
      () =>
        validateEnvironment({
          ...validWorkerEnv,
          SMARTSITE_AI_IDENTITY_URL: secretInvalidUrl,
        }),
      (error: unknown) => {
        assert.ok(error instanceof EnvironmentValidationError);
        assert.equal(error.name, 'EnvironmentValidationError');
        assert.equal('input' in error, false);
        assert.equal((error as { input?: unknown }).input, undefined);
        assert.equal(error.cause, undefined);
        assert.ok(Array.isArray(error.issues) && error.issues.length >= 1);
        assert.ok(error.issues.some((issue) => issue.field === 'SMARTSITE_AI_IDENTITY_URL'));
        const serialized = `${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`;
        assert.doesNotMatch(
          serialized,
          /secret-credential-998877|broken-url-secret-token-value|super-secret-password|leaked_value|secret_fragment_leaked|123456789/,
        );
        return true;
      },
    );
  }
});

test('MF06 worker, cutover, and face model fields reject invalid booleans, relative paths, and malformed values without leaking input', () => {
  for (const field of [
    'MF06_ENQUEUE_ENABLED',
    'MF06_ASSESSMENT_READ_ENABLED',
    'MF06_WORKER_ENABLED',
  ] as const) {
    for (const invalidFlag of ['', '1', '0', 'TRUE', 'yes', 'secret-flag-input', true]) {
      assert.throws(
        () => validateEnvironment({ [field]: invalidFlag }),
        (error: unknown) => {
          assert.ok(error instanceof EnvironmentValidationError);
          assert.match(error.message, new RegExp(field));
          assert.doesNotMatch(error.message, /secret-flag-input/);
          return true;
        },
      );
    }
  }

  for (const pathField of ['MF06_CUTOVER_MANIFEST_PATH', 'MF06_CUTOVER_RELEASE_ROOT'] as const) {
    for (const invalidPath of [
      '',
      '   ',
      'relative/cutover/path',
      './manifest.json',
      `${path.resolve('cutover')}\0bad`,
      `${path.resolve('cutover')}\nbad`,
      12345,
    ]) {
      assert.throws(
        () => validateEnvironment({ [pathField]: invalidPath }),
        (error: unknown) => {
          assert.ok(error instanceof EnvironmentValidationError);
          assert.match(error.message, new RegExp(pathField));
          assert.doesNotMatch(error.message, /relative\/cutover\/path|12345/);
          return true;
        },
      );
    }
  }

  for (const invalidSha256 of [
    '',
    ' ',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    `${'a'.repeat(63)}g`,
    ` ${'a'.repeat(64)} `,
    'secret-sha256-input',
  ]) {
    assert.throws(
      () => validateEnvironment({ MF06_CUTOVER_MANIFEST_SHA256: invalidSha256 }),
      (error: unknown) => {
        assert.ok(error instanceof EnvironmentValidationError);
        assert.match(error.message, /MF06_CUTOVER_MANIFEST_SHA256/);
        assert.doesNotMatch(error.message, /secret-sha256-input/);
        return true;
      },
    );
  }

  for (const invalidCommit of [
    '',
    ' ',
    'b'.repeat(39),
    'b'.repeat(41),
    'B'.repeat(40),
    `${'b'.repeat(39)}z`,
    ` ${'b'.repeat(40)} `,
    'secret-commit-input',
  ]) {
    assert.throws(
      () => validateEnvironment({ MF06_CUTOVER_RELEASE_COMMIT: invalidCommit }),
      (error: unknown) => {
        assert.ok(error instanceof EnvironmentValidationError);
        assert.match(error.message, /MF06_CUTOVER_RELEASE_COMMIT/);
        assert.doesNotMatch(error.message, /secret-commit-input/);
        return true;
      },
    );
  }

  for (const invalidModelVersion of [
    '',
    '   ',
    ' arcface-r100-v1',
    'arcface-r100-v1 ',
    'm'.repeat(129),
    'secret-model\0version',
    'secret-model\nversion',
    12345,
  ]) {
    assert.throws(
      () => validateEnvironment({ MF06_FACE_MODEL_VERSION: invalidModelVersion }),
      (error: unknown) => {
        assert.ok(error instanceof EnvironmentValidationError);
        assert.match(error.message, /MF06_FACE_MODEL_VERSION/);
        assert.doesNotMatch(error.message, /secret-model|arcface-r100-v1|12345/);
        return true;
      },
    );
  }
});
