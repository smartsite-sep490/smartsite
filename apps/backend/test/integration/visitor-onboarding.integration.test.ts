import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { QrAccessService } from '../../src/modules/workforce/qr-access.service.js';
import { AuthClientType, UserRole } from '../../src/database/entities/index.js';
import { createTestConfig } from '../support/config.js';
import dataSource from '../support/test-data-source.js';

test('new Site Manager must change their temporary password before visitor registration, approval and QR entry', async () => {
  await dataSource.initialize();
  const siteId = randomUUID();
  const userIds: string[] = [];
  const sites = new SiteConfigurationService(dataSource);
  const users = new UsersService(dataSource, sites);
  const auth = new AuthService(
    dataSource,
    new AuthTokenService(new JwtService(), createTestConfig()),
  );
  const access = new QrAccessService(dataSource);
  const registration = {
    requestId: randomUUID(),
    accessKey: randomBytes(32).toString('hex'),
    visitorName: 'Synthetic tour representative',
    company: 'Synthetic group',
    contact: 'synthetic@example.test',
    hostName: 'Synthetic host',
    purpose: 'Tour',
    targetArea: 'Office',
    groupSize: 20,
    gateId: 'gate-north-01',
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
  };
  try {
    await dataSource.query('INSERT INTO site (id,code,name) VALUES ($1,$2,$3)', [
      siteId,
      siteId,
      'Synthetic onboarding site',
    ]);
    const account = await users.create({
      username: `manager-${randomUUID()}`,
      displayName: 'Synthetic Site Manager',
      temporaryPassword: 'InitialDemo2026!',
      roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
    });
    userIds.push(account.id);
    const temporary = await auth.login(account.username, 'InitialDemo2026!', AuthClientType.MOBILE);
    assert.equal(temporary.user.mustChangePassword, true);
    await assert.rejects(access.register(siteId, registration), /no active Site Manager/);
    await assert.rejects(
      access.listVisits((await auth.authenticate(temporary.accessToken)).user, siteId),
    );
    await assert.rejects(auth.changePassword(account.id, 'WrongDemo2026!', 'NewDemo2026!'));
    await assert.rejects(access.register(siteId, registration), /no active Site Manager/);
    await auth.changePassword(account.id, 'InitialDemo2026!', 'NewDemo2026!');
    await assert.rejects(auth.authenticate(temporary.accessToken));
    await assert.rejects(auth.refresh(temporary.refreshToken, AuthClientType.MOBILE));
    const permanent = await auth.login(account.username, 'NewDemo2026!', AuthClientType.MOBILE);
    const actor = (await auth.authenticate(permanent.accessToken)).user;
    assert.equal(actor.mustChangePassword, false);
    const visit = await access.register(siteId, registration);
    assert.equal(visit.status, 'PENDING');
    assert.equal((await access.listVisits(actor, siteId)).items[0]?.id, visit.id);
    assert.equal(
      (await access.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })).pass,
      null,
    );
    await assert.rejects(
      access.decideVisit(
        { ...actor, roleAssignments: [{ role: UserRole.ADMIN, siteId: null }] },
        siteId,
        visit.id,
        { status: 'APPROVED' },
      ),
    );
    await access.decideVisit(actor, siteId, visit.id, { status: 'APPROVED' });
    const pass = (
      await access.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })
    ).pass;
    assert.ok(pass);
    const entry = await access.visitorGate(actor, siteId, registration.gateId, {
      requestId: randomUUID(),
      token: pass.token,
      direction: 'IN',
      count: 20,
    });
    assert.equal(entry.visit.enteredCount, 20);
    assert.equal(entry.visit.decidedByUserId, account.id);
  } finally {
    try {
      await dataSource.query(
        'DELETE FROM qr_credential WHERE visit_id IN (SELECT id FROM visitor_visit WHERE site_id=$1)',
        [siteId],
      );
      await dataSource.query(
        'DELETE FROM visitor_gate_event WHERE visit_id IN (SELECT id FROM visitor_visit WHERE site_id=$1)',
        [siteId],
      );
      await dataSource.query('DELETE FROM visitor_visit WHERE site_id=$1', [siteId]);
      await dataSource.query('DELETE FROM app_user WHERE id=ANY($1)', [userIds]);
      await dataSource.query('DELETE FROM site WHERE id=$1', [siteId]);
    } finally {
      await dataSource.destroy();
    }
  }
});
