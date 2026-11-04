import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
const moduleUrl = new URL('../src/modules/auth/configuration-command-context.js', import.meta.url)
  .href;

test('configuration command binds the original actor and rejects identity replacement after reauthentication', async () => {
  const { configurationCommandContext } = await import(moduleUrl);
  const actorId = randomUUID();
  const request = { user: { id: actorId, mustChangePassword: false } };
  const manager = {};
  let receivedManager: unknown;
  const auth = {
    authenticateRequest: async (r: typeof request, m: unknown) => {
      receivedManager = m;
      r.user = { id: randomUUID(), mustChangePassword: false };
    },
  };
  const context = configurationCommandContext(request, auth);
  assert.equal(context.actorUserId, actorId);
  await assert.rejects(context.reauthorize(manager), { status: 401 });
  assert.equal(receivedManager, manager);
});

test('ordinary configuration forbids temporary-password actor while password-change context remains usable', async () => {
  const { configurationCommandContext, passwordChangeCommandContext } = await import(moduleUrl);
  const request = { user: { id: randomUUID(), mustChangePassword: true } };
  const auth = { authenticateRequest: async () => {} };
  const context = configurationCommandContext(request, auth);
  await assert.rejects(
    context.reauthorize({}),
    (error) =>
      typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      (error as { getStatus: () => number }).getStatus() === 403,
  );
  await passwordChangeCommandContext(request, auth).reauthorize({});
});

test('configuration context rejects a missing authenticated actor', async () => {
  const { configurationCommandContext } = await import(moduleUrl);
  assert.throws(() => configurationCommandContext({}, {}), { status: 401 });
});

test('partial history capability refuses a configuration mutation before the callback', async () => {
  const { executeMainConfigurationCommand } = await import(
    new URL('../src/common/configuration/main-configuration-authority.js', import.meta.url).href
  );
  let mutations = 0;
  const source = {
    transaction: async (work: (manager: unknown) => Promise<unknown>) =>
      work({ query: async () => [{ n: 1, legacy: 0 }] }),
  };
  await assert.rejects(
    executeMainConfigurationCommand(source, undefined, 'ZONE_POLICY_UPDATE', {}, async () => {
      mutations++;
    }),
    (error) =>
      typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      (error as { getStatus: () => number }).getStatus() === 503,
  );
  assert.equal(mutations, 0);
});

test('disabled actor cannot reach an authorized command callback', async () => {
  const { executeMainConfigurationCommand } = await import(
    new URL('../src/common/configuration/main-configuration-authority.js', import.meta.url).href
  );
  let rechecks = 0,
    mutations = 0;
  const source = {
    transaction: async (_isolation: string, work: (manager: unknown) => Promise<unknown>) =>
      work({ query: async () => [] }),
  };
  await assert.rejects(
    executeMainConfigurationCommand(
      source,
      {
        actorUserId: randomUUID(),
        reauthorize: async () => {
          rechecks++;
        },
      },
      'ZONE_POLICY_UPDATE',
      {},
      async () => {
        mutations++;
      },
    ),
    (error) =>
      typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      (error as { getStatus: () => number }).getStatus() === 403,
  );
  assert.equal(rechecks, 1);
  assert.equal(mutations, 0);
});

test('legacy no-journal mutation does not fabricate a command witness or authority acknowledgement', async () => {
  const { executeMainConfigurationCommand } = await import(
    new URL('../src/common/configuration/main-configuration-authority.js', import.meta.url).href
  );
  let witnesses = 0;
  const source = {
    transaction: async (work: (manager: unknown) => Promise<unknown>) =>
      work({ query: async () => [{ n: 0, legacy: 0 }] }),
    query: async () => {
      witnesses++;
    },
  };
  assert.equal(
    await executeMainConfigurationCommand(
      source,
      undefined,
      'ZONE_POLICY_UPDATE',
      {},
      async () => 'legacy-result',
    ),
    'legacy-result',
  );
  assert.equal(witnesses, 0);
});
