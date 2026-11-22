import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { ContractorWorkerAccountsService } from '../src/modules/workforce/directory/contractor-worker-accounts.service.js';
import type {
  ContractorOperationsService,
  WorkforceActor,
} from '../src/modules/workforce/directory/contractor-operations.service.js';
import type { UsersService, PreparedWorkerAccount } from '../src/modules/users/users.service.js';
import type { AccountEmailService } from '../src/modules/auth/account-email.service.js';
import { WorkerEntity } from '../src/database/entities/worker.entity.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';

test('worker onboarding emails the exact unique initial password that was hashed without exposing it in response or audit', async () => {
  const stored: unknown[] = [],
    sent: Array<{ password: string; hash: string; email: string }> = [];
  const manager = {
    getRepository: (entity: unknown) => ({
      update: async () => {},
      save: async (value: Record<string, unknown>) => {
        stored.push(value);
        return entity === WorkerEntity ? { ...value, createdAt: new Date() } : value;
      },
    }),
  } as unknown as EntityManager;
  const source = {
    transaction: async (run: (m: EntityManager) => Promise<unknown>) => run(manager),
  } as DataSource;
  const operations = {
    requireWorkerCreationAccess: async () => {},
  } as unknown as ContractorOperationsService;
  const users = {
    prepareWorkerAccount: async (input: {
      username: string;
      displayName: string;
      siteId: string;
      temporaryPassword: string;
    }) => ({ ...input, passwordHash: await hashPassword(input.temporaryPassword) }),
    createWorkerAccount: async (_manager: EntityManager, input: PreparedWorkerAccount) => ({
      id: randomUUID(),
      username: input.username,
      displayName: input.displayName,
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [],
    }),
  } as unknown as UsersService;
  const mail = {
    assertConfigured: () => {},
    queueWelcome: async (
      _manager: EntityManager,
      user: { passwordHash: string; email: string },
      password: string,
    ) => {
      sent.push({ password, hash: user.passwordHash, email: user.email });
    },
  } as unknown as AccountEmailService;
  const service = new ContractorWorkerAccountsService(source, operations, users, mail);
  const siteId = randomUUID(),
    contractorId = randomUUID(),
    actor = { id: randomUUID(), mustChangePassword: false, roleAssignments: [] } as WorkforceActor;
  for (let index = 0; index < 2; index++) {
    const response = await service.create(actor, contractorId, {
      siteId,
      username: `synthetic${index}`,
      externalId: `WTEST${index}`,
      displayName: 'Synthetic Worker',
      email: ` Synthetic${index}@Example.test `,
      language: 'vi',
      nationalId: '000000000001',
      phoneNumber: '0900000001',
      gender: 'OTHER',
      address: 'Synthetic address',
    });
    const welcome = sent[index]!;
    assert.equal(await verifyPassword(welcome.password, welcome.hash), true);
    assert.equal(welcome.email, `synthetic${index}@example.test`);
    assert.equal(response.emailDelivery, 'QUEUED');
    assert.equal(JSON.stringify(response).includes(welcome.password), false);
    assert.equal(JSON.stringify(stored).includes(welcome.password), false);
    assert.equal(response.account.mustChangePassword, false);
  }
  assert.notEqual(sent[0]!.password, sent[1]!.password);
});
