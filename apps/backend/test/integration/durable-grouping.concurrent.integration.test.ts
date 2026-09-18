import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { DataSource, type QueryRunner } from 'typeorm';
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

test('DurableGroupingService: delayed candidate at t=30s groups into matching open alert at t=0s despite newer open alert at t=120s (cooldown 60s)', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-DELAYED-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Delayed Candidate Test Site',
      });

      const groupingKey = `PPE_HARD_HAT_MISSING:cam-delayed:sess-delayed:none:${Date.now()}`;
      const t0 = new Date('2026-09-19T10:00:00.000Z');
      const t120 = new Date('2026-09-19T10:02:00.000Z');
      const t30Delayed = new Date('2026-09-19T10:00:30.000Z');

      const alertIdT0 = randomUUID();
      const alertIdT120 = randomUUID();

      // Pre-seed open alert at t=0
      await source.getRepository(SafetyAlertEntity).save({
        id: alertIdT0,
        siteId,
        zoneId: null,
        candidateWorkerId: 'WORKER-T0',
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: t0,
        lastDetectedAt: t0,
        detectionCount: 1,
      });

      // Pre-seed newer open alert at t=120s
      await source.getRepository(SafetyAlertEntity).save({
        id: alertIdT120,
        siteId,
        zoneId: null,
        candidateWorkerId: 'WORKER-T120',
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: t120,
        lastDetectedAt: t120,
        detectionCount: 1,
      });

      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1008,
        groupingKey,
        details: {},
      };

      // Delayed candidate captured at t=30s arrives
      await source.transaction(async (manager) => {
        await service.groupCandidate(manager, siteId, candidate, t30Delayed);
      });

      const alerts = await source.getRepository(SafetyAlertEntity).find({
        where: { siteId, groupingKey },
        order: { firstDetectedAt: 'ASC' },
      });

      // Must NOT create a 3rd alert: delayed candidate must group with t=0 alert!
      assert.equal(alerts.length, 2);

      const alertAtT0 = alerts.find((a) => a.id === alertIdT0)!;
      assert.ok(alertAtT0);
      assert.equal(alertAtT0.detectionCount, 2);
      assert.equal(alertAtT0.lastDetectedAt.toISOString(), '2026-09-19T10:00:30.000Z');

      const alertAtT120 = alerts.find((a) => a.id === alertIdT120)!;
      assert.ok(alertAtT120);
      assert.equal(alertAtT120.detectionCount, 1);
      assert.equal(alertAtT120.lastDetectedAt.toISOString(), '2026-09-19T10:02:00.000Z');
    } finally {
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: human concurrent identity update is preserved and not overwritten by grouping update', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    let humanRunner: QueryRunner | undefined;
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-RACE-ID-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Race Identity Test Site',
      });

      const groupingKey = `PPE_HARD_HAT_MISSING:cam-race-id:sess-race-id:none:${Date.now()}`;
      const alertId = randomUUID();
      const initialTime = new Date();

      // Alert pre-seeded with initial values
      await source.getRepository(SafetyAlertEntity).save({
        id: alertId,
        siteId,
        zoneId: null,
        candidateWorkerId: 'WORKER-INITIAL',
        identitySimilarityScore: 0.5,
        identityQualityScore: 0.6,
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: initialTime,
        lastDetectedAt: initialTime,
        detectionCount: 1,
      });

      // 1. Human operator connection starts transaction and updates identity, holding the row lock
      humanRunner = source.createQueryRunner();
      await humanRunner.connect();
      await humanRunner.startTransaction();

      await humanRunner.manager.update(SafetyAlertEntity, alertId, {
        candidateWorkerId: 'HUMAN-SUPERVISOR-ID',
        identitySimilarityScore: 0.985,
        identityQualityScore: 0.92,
        status: AlertStatus.CONFIRMED,
      });

      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1009,
        groupingKey,
        candidateWorkerId: 'AI-INFERRED-OTHER',
        identitySimilarityScore: 0.45,
        identityQualityScore: 0.5,
        details: {},
      };

      // 2. Concurrently, grouping transaction starts on another connection.
      const groupingTask = source.transaction(async (manager) => {
        return await service.groupCandidate(
          manager,
          siteId,
          candidate,
          new Date(initialTime.getTime() + 5000),
        );
      });

      // 3. Human transaction commits, releasing row lock and making updated identity visible
      await humanRunner.commitTransaction();
      await humanRunner.release();
      humanRunner = undefined;

      // 4. Grouping transaction unblocks, executes narrow conditional update
      const updatedAlert = await groupingTask;

      // Assert human updates are preserved and only detection_count/last_detected_at changed
      assert.equal(updatedAlert.id, alertId);
      assert.equal(updatedAlert.candidateWorkerId, 'HUMAN-SUPERVISOR-ID');
      assert.equal(updatedAlert.identitySimilarityScore, 0.985);
      assert.equal(updatedAlert.identityQualityScore, 0.92);
      assert.equal(updatedAlert.status, AlertStatus.CONFIRMED);
      assert.equal(updatedAlert.detectionCount, 2);
    } finally {
      if (humanRunner) {
        if (humanRunner.isTransactionActive) {
          await humanRunner.rollbackTransaction();
        }
        await humanRunner.release();
      }
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: human concurrent alert closure is respected and grouping creates new alert without reopening', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    let humanRunner: QueryRunner | undefined;
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-RACE-CLOSE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Race Close Test Site',
      });

      const groupingKey = `PPE_HARD_HAT_MISSING:cam-race-close:sess-race-close:none:${Date.now()}`;
      const alertId = randomUUID();
      const initialTime = new Date();

      // Alert pre-seeded as PENDING_REVIEW
      await source.getRepository(SafetyAlertEntity).save({
        id: alertId,
        siteId,
        zoneId: null,
        candidateWorkerId: 'WORKER-INITIAL',
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: initialTime,
        lastDetectedAt: initialTime,
        detectionCount: 1,
      });

      // 1. Human operator connection starts transaction and closes the alert, holding the row lock
      humanRunner = source.createQueryRunner();
      await humanRunner.connect();
      await humanRunner.startTransaction();

      await humanRunner.manager.update(SafetyAlertEntity, alertId, {
        status: AlertStatus.CLOSED,
      });

      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1010,
        groupingKey,
        candidateWorkerId: 'WORKER-NEW',
        details: {},
      };

      // 2. Concurrently, grouping transaction starts on another connection.
      const groupingTask = source.transaction(async (manager) => {
        return await service.groupCandidate(
          manager,
          siteId,
          candidate,
          new Date(initialTime.getTime() + 5000),
        );
      });

      // 3. Human transaction commits CLOSED status, releasing the lock
      await humanRunner.commitTransaction();
      await humanRunner.release();
      humanRunner = undefined;

      // 4. Grouping transaction unblocks. Row is now CLOSED so it is excluded from openAlerts.
      const createdAlert = await groupingTask;

      assert.notEqual(createdAlert.id, alertId);
      assert.equal(createdAlert.status, AlertStatus.PENDING_REVIEW);
      assert.equal(createdAlert.detectionCount, 1);
      assert.equal(createdAlert.candidateWorkerId, 'WORKER-NEW');

      const originalAlert = await source
        .getRepository(SafetyAlertEntity)
        .findOneBy({ id: alertId });
      assert.ok(originalAlert);
      assert.equal(originalAlert.status, AlertStatus.CLOSED);
      assert.equal(originalAlert.detectionCount, 1);
    } finally {
      if (humanRunner) {
        if (humanRunner.isTransactionActive) {
          await humanRunner.rollbackTransaction();
        }
        await humanRunner.release();
      }
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: candidate matching newer alert completes without blocking when unrelated stale open alert row lock is held by another transaction', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    let humanRunner: QueryRunner | undefined;
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-STALE-LOCK-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Stale Lock Test Site',
      });

      const groupingKey = `PPE_HARD_HAT_MISSING:cam-stale:sess-stale:none:${Date.now()}`;
      const oldAlertId = randomUUID();
      const newerAlertId = randomUUID();

      const tOld = new Date('2026-09-19T10:00:00.000Z');
      const tNewer = new Date('2026-09-19T10:10:00.000Z'); // 10 minutes later (beyond 60s cooldown)
      const tCandidate = new Date('2026-09-19T10:10:20.000Z'); // 20s after newer alert (matches newer alert)

      // Pre-seed stale open alert at t=0
      await source.getRepository(SafetyAlertEntity).save({
        id: oldAlertId,
        siteId,
        zoneId: null,
        candidateWorkerId: 'WORKER-OLD',
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: tOld,
        lastDetectedAt: tOld,
        detectionCount: 1,
      });

      // Pre-seed newer open alert at t=10m
      await source.getRepository(SafetyAlertEntity).save({
        id: newerAlertId,
        siteId,
        zoneId: null,
        candidateWorkerId: 'WORKER-NEWER',
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: tNewer,
        lastDetectedAt: tNewer,
        detectionCount: 1,
      });

      // 1. Human transaction acquires and HOLDS an exclusive row lock on the old stale alert
      humanRunner = source.createQueryRunner();
      await humanRunner.connect();
      await humanRunner.startTransaction();
      await humanRunner.query('SELECT id FROM safety_alert WHERE id = $1 FOR UPDATE', [oldAlertId]);

      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1011,
        groupingKey,
        details: {},
      };

      // 2. Group candidate matching only the newer alert while humanRunner continues to hold lock on oldAlertId.
      // If the grouping query attempts to lock all open alerts before cooldown filtering, it will block on oldAlertId.
      // Pushing time-window eligibility into SQL ensures only newerAlertId is locked, so this completes without blocking.
      const updatedAlert = await source.transaction(async (manager) => {
        return await service.groupCandidate(manager, siteId, candidate, tCandidate);
      });

      // Assert newer alert was updated and completed without blocking on old row
      assert.equal(updatedAlert.id, newerAlertId);
      assert.equal(updatedAlert.detectionCount, 2);
      assert.equal(updatedAlert.lastDetectedAt.toISOString(), '2026-09-19T10:10:20.000Z');

      const oldAlert = await source.getRepository(SafetyAlertEntity).findOneBy({ id: oldAlertId });
      assert.ok(oldAlert);
      assert.equal(oldAlert.detectionCount, 1);
      assert.equal(oldAlert.lastDetectedAt.toISOString(), '2026-09-19T10:00:00.000Z');
    } finally {
      if (humanRunner) {
        if (humanRunner.isTransactionActive) {
          await humanRunner.rollbackTransaction();
        }
        await humanRunner.release();
      }
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: handles maximum safe integer ALERT_COOLDOWN_SECONDS without Date overflow or statement failure', async () => {
  await withDataSource(async (source) => {
    // Test maximum configured cooldown supported by environment validation: floor(Number.MAX_SAFE_INTEGER / 1000)
    const maxSafeSeconds = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: maxSafeSeconds });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-MAX-COOLDOWN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Max Cooldown Site',
      });

      const groupingKey = `PPE_HARD_HAT_MISSING:cam-maxcd:sess-maxcd:none:${Date.now()}`;
      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1012,
        groupingKey,
        details: {},
      };

      const t0 = new Date('2026-09-19T10:00:00.000Z');
      const t1 = new Date('2026-09-19T10:05:00.000Z');

      // 1. First event creates alert
      const createdAlert = await source.transaction(async (manager) => {
        return await service.groupCandidate(manager, siteId, candidate, t0);
      });
      assert.equal(createdAlert.detectionCount, 1);

      // 2. Second event with massive cooldown must group successfully without Invalid Date overflow
      const updatedAlert = await source.transaction(async (manager) => {
        return await service.groupCandidate(manager, siteId, candidate, t1);
      });

      assert.equal(updatedAlert.id, createdAlert.id);
      assert.equal(updatedAlert.detectionCount, 2);
      assert.equal(updatedAlert.lastDetectedAt.toISOString(), '2026-09-19T10:05:00.000Z');
    } finally {
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});

test('DurableGroupingService: locks only top ordered eligible alert with LIMIT 1 FOR UPDATE, completing without blocking when older still-eligible alert row lock is held', async () => {
  await withDataSource(async (source) => {
    const configService = new ConfigService({ ALERT_COOLDOWN_SECONDS: 60 });
    const service = new DurableGroupingService(configService);

    const siteId = randomUUID();
    let humanRunner: QueryRunner | undefined;
    try {
      await source.getRepository(SiteEntity).save({
        id: siteId,
        code: `SITE-LIMIT-LOCK-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Limit Lock Test Site',
      });

      const groupingKey = `PPE_HARD_HAT_MISSING:cam-limit:sess-limit:none:${Date.now()}`;
      const olderAlertId = randomUUID();
      const newerAlertId = randomUUID();

      // Older open alert at t=0s
      const t0 = new Date('2026-09-19T10:00:00.000Z');
      // Newer open alert at t=100s
      const t100 = new Date('2026-09-19T10:01:40.000Z');
      // Delayed candidate captured at t=50s:
      // With cooldown = 60s:
      // - Older alert (t=0s): capturedAt (50s) - cooldown (60s) = -10s <= lastDetectedAt (0s), and capturedAt (50s) + cooldown (60s) = 110s >= firstDetectedAt (0s) -> TIME-ELIGIBLE!
      // - Newer alert (t=100s): capturedAt (50s) - cooldown (60s) = -10s <= lastDetectedAt (100s), and capturedAt (50s) + cooldown (60s) = 110s >= firstDetectedAt (100s) -> TIME-ELIGIBLE!
      const t50Candidate = new Date('2026-09-19T10:00:50.000Z');

      // Pre-seed older alert at t=0s
      await source.getRepository(SafetyAlertEntity).save({
        id: olderAlertId,
        siteId,
        zoneId: null,
        candidateWorkerId: 'WORKER-OLDER',
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: t0,
        lastDetectedAt: t0,
        detectionCount: 1,
      });

      // Pre-seed newer alert at t=100s
      await source.getRepository(SafetyAlertEntity).save({
        id: newerAlertId,
        siteId,
        zoneId: null,
        candidateWorkerId: 'WORKER-NEWER',
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey,
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: t100,
        lastDetectedAt: t100,
        detectionCount: 1,
      });

      // 1. Human transaction holds exclusive row lock on the older, still-eligible alert
      humanRunner = source.createQueryRunner();
      await humanRunner.connect();
      await humanRunner.startTransaction();
      await humanRunner.query('SELECT id FROM safety_alert WHERE id = $1 FOR UPDATE', [
        olderAlertId,
      ]);

      const candidate: AlertCandidate = {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1013,
        groupingKey,
        details: {},
      };

      // 2. Candidate grouping runs on another connection while humanRunner holds olderAlertId lock.
      // Under ORDER BY alert.lastDetectedAt DESC, the newer alert (t=100s) is ordered first.
      // With LIMIT 1 FOR UPDATE, PostgreSQL only locks the top ordered row (newerAlertId).
      // If LIMIT 1 is omitted from FOR UPDATE, PostgreSQL attempts to lock ALL eligible rows (including olderAlertId),
      // blocking indefinitely or until statement timeout.
      // The database statement timeout fails this test if the query waits for the
      // older row. Awaiting the transaction also ensures it settles before cleanup.
      const updatedAlert = await source.transaction(async (manager) => {
        return await service.groupCandidate(manager, siteId, candidate, t50Candidate);
      });

      // Assert newer alert was chosen and updated without waiting for older alert's lock
      assert.equal(updatedAlert.id, newerAlertId);
      assert.equal(updatedAlert.detectionCount, 2);
      assert.equal(updatedAlert.lastDetectedAt.toISOString(), '2026-09-19T10:01:40.000Z');

      // Assert older alert remained untouched
      const olderAlert = await source
        .getRepository(SafetyAlertEntity)
        .findOneBy({ id: olderAlertId });
      assert.ok(olderAlert);
      assert.equal(olderAlert.detectionCount, 1);
      assert.equal(olderAlert.lastDetectedAt.toISOString(), '2026-09-19T10:00:00.000Z');
    } finally {
      if (humanRunner) {
        if (humanRunner.isTransactionActive) {
          await humanRunner.rollbackTransaction();
        }
        await humanRunner.release();
      }
      await source.getRepository(SafetyAlertEntity).delete({ siteId });
      await source.getRepository(SiteEntity).delete({ id: siteId });
    }
  });
});
