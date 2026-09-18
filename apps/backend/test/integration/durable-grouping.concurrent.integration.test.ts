import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AlertStatus, AlertType } from '../../src/database/entities/enums.js';
import { SafetyAlertEntity } from '../../src/database/entities/safety-alert.entity.js';
import { SiteEntity } from '../../src/database/entities/site.entity.js';
import dataSource from '../../src/database/typeorm.data-source.js';
import type { AlertCandidate } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';

async function withDataSource<T>(fn: (source: DataSource) => Promise<T>): Promise<T> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
  return await fn(dataSource);
}

after(async () => {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
});

test('DurableGroupingService: 10 concurrent transactions with identical site/groupingKey result in exactly 1 open alert with detectionCount=10', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-CONCURRENT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Concurrent Grouping Site',
      });

      const groupingKey = `PPE_HARD_HAT_MISSING:cam-c1:sess-s1:none:${Date.now()}`;
      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1001,
        groupingKey,
        details: {},
      };

      const baseTime = Date.now();
      // Fire 10 transactions concurrently
      const tasks = Array.from({ length: 10 }).map((_, i) =>
        source.transaction(async (manager) => {
          const capturedAt = new Date(baseTime + i * 200);
          return await service.groupCandidate(manager, siteId, candidate, capturedAt);
        }),
      );

      await Promise.all(tasks);

      const alerts = await source.getRepository(SafetyAlertEntity).find({
        where: { siteId, groupingKey },
      });

      assert.equal(alerts.length, 1);
      const alert = alerts[0]!;
      assert.equal(alert.detectionCount, 10);
      assert.equal(alert.status, AlertStatus.PENDING_REVIEW);
      assert.equal(alert.groupingKey, groupingKey);
      assert.equal(alert.lastDetectedAt.getTime(), baseTime + 9 * 200);
    } finally {
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: preserves lastDetectedAt when out-of-order candidate arrives with earlier timestamp (max(old, new))', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-OUT-OF-ORDER-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Out of Order Site',
      });

      const groupingKey = `PPE_SAFETY_VEST_MISSING:cam-ooo:sess-ooo:none:${Date.now()}`;
      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1002,
        groupingKey,
        details: {},
      };

      const laterTime = new Date('2026-09-19T10:05:00.000Z');
      const earlierTime = new Date('2026-09-19T10:04:30.000Z'); // 30s earlier, within 60s cooldown

      // First event arrives with laterTime
      await source.transaction(async (manager) => {
        await service.groupCandidate(manager, siteId, candidate, laterTime);
      });

      // Second event arrives out of order with earlierTime
      await source.transaction(async (manager) => {
        await service.groupCandidate(manager, siteId, candidate, earlierTime);
      });

      const alerts = await source.getRepository(SafetyAlertEntity).find({
        where: { siteId, groupingKey },
      });

      assert.equal(alerts.length, 1);
      const alert = alerts[0]!;
      assert.equal(alert.detectionCount, 2);
      // lastDetectedAt must remain laterTime: max(old, new)
      assert.equal(alert.lastDetectedAt.toISOString(), '2026-09-19T10:05:00.000Z');
      assert.equal(alert.firstDetectedAt.toISOString(), '2026-09-19T10:05:00.000Z');
    } finally {
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: cooldown boundary creates a new alert once cooldown window is exceeded', async () => {
  await withDataSource(async (source) => {
    // 10-second cooldown window
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 10 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-COOLDOWN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Cooldown Boundary Site',
      });

      const groupingKey = `ZONE_ENTRY_PROHIBITED:cam-cd:sess-cd:zone-z1:${Date.now()}`;
      const candidate: AlertCandidate = {
        alertType: 'RESTRICTED_ZONE_INTRUSION',
        candidateSubtype: 'ZONE_ENTRY_PROHIBITED',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1003,
        groupingKey,
        details: {},
      };

      const t0 = new Date('2026-09-19T12:00:00.000Z');
      const tInsideBoundary = new Date('2026-09-19T12:00:10.000Z'); // Exactly 10s: within boundary
      const tOutsideBoundary = new Date('2026-09-19T12:00:25.000Z'); // 15s after lastDetectedAt: exceeds 10s cooldown

      // 1. Initial detection
      await source.transaction(async (manager) => {
        await service.groupCandidate(manager, siteId, candidate, t0);
      });

      // 2. Second detection exactly at boundary (10s <= 10s cooldown) -> groups into existing alert
      await source.transaction(async (manager) => {
        await service.groupCandidate(manager, siteId, candidate, tInsideBoundary);
      });

      // 3. Third detection at +25s (15s after tInsideBoundary > 10s cooldown) -> creates new alert
      await source.transaction(async (manager) => {
        await service.groupCandidate(manager, siteId, candidate, tOutsideBoundary);
      });

      const alerts = await source.getRepository(SafetyAlertEntity).find({
        where: { siteId, groupingKey },
        order: { createdAt: 'ASC' },
      });

      assert.equal(alerts.length, 2);

      // First alert: grouped 2 detections
      assert.equal(alerts[0]!.detectionCount, 2);
      assert.equal(alerts[0]!.firstDetectedAt.toISOString(), '2026-09-19T12:00:00.000Z');
      assert.equal(alerts[0]!.lastDetectedAt.toISOString(), '2026-09-19T12:00:10.000Z');
      assert.equal(alerts[0]!.status, AlertStatus.PENDING_REVIEW);

      // Second alert: new alert created after cooldown window
      assert.equal(alerts[1]!.detectionCount, 1);
      assert.equal(alerts[1]!.firstDetectedAt.toISOString(), '2026-09-19T12:00:25.000Z');
      assert.equal(alerts[1]!.lastDetectedAt.toISOString(), '2026-09-19T12:00:25.000Z');
      assert.equal(alerts[1]!.status, AlertStatus.PENDING_REVIEW);
    } finally {
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: never reopens DISMISSED or CLOSED alerts and creates a new one', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-DISMISSED-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Dismissed Test Site',
      });

      const groupingKey = `ZONE_ENTRY_PROHIBITED:cam-c2:sess-s2:zone-z1:${Date.now()}`;
      const capturedAt = new Date();

      // Pre-seed a DISMISSED alert
      await source.getRepository(SafetyAlertEntity).save({
        id: randomUUID(),
        siteId,
        zoneId: null,
        alertType: AlertType.RESTRICTED_ZONE_INTRUSION,
        candidateSubtype: 'ZONE_ENTRY_PROHIBITED',
        groupingKey,
        status: AlertStatus.DISMISSED,
        firstDetectedAt: capturedAt,
        lastDetectedAt: capturedAt,
        detectionCount: 1,
      });

      // Pre-seed a CLOSED alert
      await source.getRepository(SafetyAlertEntity).save({
        id: randomUUID(),
        siteId,
        zoneId: null,
        alertType: AlertType.RESTRICTED_ZONE_INTRUSION,
        candidateSubtype: 'ZONE_ENTRY_PROHIBITED',
        groupingKey,
        status: AlertStatus.CLOSED,
        firstDetectedAt: capturedAt,
        lastDetectedAt: capturedAt,
        detectionCount: 1,
      });

      const candidate: AlertCandidate = {
        alertType: 'RESTRICTED_ZONE_INTRUSION',
        candidateSubtype: 'ZONE_ENTRY_PROHIBITED',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1004,
        groupingKey,
        details: {},
      };

      // Run grouping inside a transaction
      await source.transaction(async (manager) => {
        await service.groupCandidate(
          manager,
          siteId,
          candidate,
          new Date(capturedAt.getTime() + 1000),
        );
      });

      const alerts = await source.getRepository(SafetyAlertEntity).find({
        where: { siteId, groupingKey },
        order: { createdAt: 'ASC' },
      });

      // Must have 3 alerts: DISMISSED, CLOSED, and newly created PENDING_REVIEW alert
      assert.equal(alerts.length, 3);
      assert.equal(alerts[0]!.status, AlertStatus.DISMISSED);
      assert.equal(alerts[1]!.status, AlertStatus.CLOSED);
      assert.equal(alerts[2]!.status, AlertStatus.PENDING_REVIEW);
      assert.equal(alerts[2]!.detectionCount, 1);
    } finally {
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: preserves human workflow status (e.g. CONFIRMED) and updates lastDetectedAt', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-CONFIRMED-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Confirmed Test Site',
      });

      const groupingKey = `PPE_SAFETY_VEST_MISSING:cam-c3:sess-s3:none:${Date.now()}`;
      const initialTime = new Date(Date.now() - 10000);

      // Pre-seed a CONFIRMED alert
      await source.getRepository(SafetyAlertEntity).save({
        id: randomUUID(),
        siteId,
        zoneId: null,
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
        groupingKey,
        status: AlertStatus.CONFIRMED,
        firstDetectedAt: initialTime,
        lastDetectedAt: initialTime,
        detectionCount: 3,
      });

      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1005,
        groupingKey,
        details: {},
      };

      const newTime = new Date();
      await source.transaction(async (manager) => {
        await service.groupCandidate(manager, siteId, candidate, newTime);
      });

      const alerts = await source.getRepository(SafetyAlertEntity).find({
        where: { siteId, groupingKey },
      });

      assert.equal(alerts.length, 1);
      const alert = alerts[0]!;
      assert.equal(alert.status, AlertStatus.CONFIRMED); // Human status must NOT be reset to PENDING_REVIEW
      assert.equal(alert.detectionCount, 4);
      assert.equal(alert.lastDetectedAt.getTime(), newTime.getTime());
    } finally {
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: never overwrites existing identity evidence', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-IDENTITY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Identity Test Site',
      });

      const groupingKey = `PPE_HARD_HAT_MISSING:cam-c4:sess-s4:none:${Date.now()}`;
      const initialTime = new Date();

      // Alert initially has candidateWorkerId 'WORKER-INITIAL'
      await source.getRepository(SafetyAlertEntity).save({
        id: randomUUID(),
        siteId,
        zoneId: null,
        candidateWorkerId: 'WORKER-INITIAL',
        identitySimilarityScore: 0.95,
        identityQualityScore: 0.88,
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: initialTime,
        lastDetectedAt: initialTime,
        detectionCount: 1,
      });

      // New candidate provides different identity evidence
      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1006,
        groupingKey,
        candidateWorkerId: 'WORKER-NEW-DIFFERENT',
        identitySimilarityScore: 0.75,
        identityQualityScore: 0.6,
        details: {},
      };

      await source.transaction(async (manager) => {
        await service.groupCandidate(
          manager,
          siteId,
          candidate,
          new Date(initialTime.getTime() + 5000),
        );
      });

      const alerts = await source.getRepository(SafetyAlertEntity).find({
        where: { siteId, groupingKey },
      });

      assert.equal(alerts.length, 1);
      const alert = alerts[0]!;
      assert.equal(alert.candidateWorkerId, 'WORKER-INITIAL'); // Must NOT be overwritten
      assert.equal(alert.identitySimilarityScore, 0.95);
      assert.equal(alert.identityQualityScore, 0.88);
      assert.equal(alert.detectionCount, 2);
    } finally {
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: preserves null candidateWorkerId and pre-existing quality score on repeat detection (no backfill or overwrite)', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-NO-BACKFILL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'No Backfill Test Site',
      });

      const groupingKey = `PPE_HARD_HAT_MISSING:cam-nobf:sess-nobf:none:${Date.now()}`;
      const initialTime = new Date();

      // Alert initially has null candidateWorkerId and null similarityScore, but pre-existing qualityScore
      await source.getRepository(SafetyAlertEntity).save({
        id: randomUUID(),
        siteId,
        zoneId: null,
        candidateWorkerId: null,
        identitySimilarityScore: null,
        identityQualityScore: 0.85,
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: initialTime,
        lastDetectedAt: initialTime,
        detectionCount: 1,
      });

      // Repeat detection candidate provides candidateWorkerId and different scores
      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1007,
        groupingKey,
        candidateWorkerId: 'WORKER-LATER-DETECTED',
        identitySimilarityScore: 0.99,
        identityQualityScore: 0.4,
        details: {},
      };

      await source.transaction(async (manager) => {
        await service.groupCandidate(
          manager,
          siteId,
          candidate,
          new Date(initialTime.getTime() + 3000),
        );
      });

      const alerts = await source.getRepository(SafetyAlertEntity).find({
        where: { siteId, groupingKey },
      });

      assert.equal(alerts.length, 1);
      const alert = alerts[0]!;
      // All identity fields must remain untouched on repeat detection
      assert.equal(alert.candidateWorkerId, null);
      assert.equal(alert.identitySimilarityScore, null);
      assert.equal(alert.identityQualityScore, 0.85);
      assert.equal(alert.detectionCount, 2);
    } finally {
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});
