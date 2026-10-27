import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { SafetyFaceCandidateReader } from '../../src/modules/workforce/safety-face-candidate.reader.js';
import { SafetyFaceProfileMetadataReader } from '../../src/modules/workforce/safety-face-profile.reader.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const SYNTHETIC_MODEL = 'synthetic-mf06-face-v1';
const VALID_TEMPLATE_A = `gAAAAAB${'A'.repeat(133)}`;
const VALID_TEMPLATE_B = `gAAAAAB${'B'.repeat(133)}`;
const UNICODE_20K_CHARS_40K_BYTES = 'é'.repeat(20_000);

const HASH_ELIGIBLE = 'a'.repeat(64);
const HASH_NO_CONSENT = 'b'.repeat(64);
const HASH_OTHER_SITE = 'c'.repeat(64);

const CONSENT_ID_1 = '00000000-0000-4000-8000-000000000001';
const CONSENT_ID_2 = '00000000-0000-4000-8000-000000000002';
const CONSENT_ID_3 = '00000000-0000-4000-8000-000000000003';
const CONSENT_ID_4 = '00000000-0000-4000-8000-000000000004';
const CONSENT_ID_OTHER_SITE = '00000000-0000-4000-8000-000000000005';

test(
  'SafetyFaceCandidateReader enforces consent, revision rotation, byte bounds, and schema-qualified reads against pg_temp shadows',
  { timeout: 60_000 },
  async (t) => {
    const isolated = createIsolatedTestDatabase({ canonical: true });
    const db = isolated.dataSource;
    t.after(() => isolated.dispose());
    if (db.options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');
    db.setOptions({ extra: { ...db.options.extra, max: 1 } });
    await isolated.initialize();

    const rawSchema = (db.driver as { schema?: unknown }).schema;
    assert.equal(typeof rawSchema, 'string');
    assert.match(rawSchema as string, /^isolated_test_[0-9a-f]{32}$/);
    const pool = (db.driver as unknown as { master: { options: { max: number } } }).master;
    assert.equal(pool.options.max, 1);
    t.diagnostic(`ownedCandidateSchema=${rawSchema}`);
    const schema = `"${(rawSchema as string).replaceAll('"', '""')}"`;

    const siteTable = `${schema}."site"`;
    const userTable = `${schema}."app_user"`;
    const workerTable = `${schema}."worker"`;
    const profileTable = `${schema}."face_profile"`;
    const consentTable = `${schema}."safety_face_consent"`;
    const revocationTable = `${schema}."safety_face_consent_revocation"`;

    const siteId = randomUUID();
    const otherSiteId = randomUUID();
    const actorUserId = randomUUID();

    const eligibleWorkerId = randomUUID();
    const noConsentWorkerId = randomUUID();
    const otherSiteWorkerId = randomUUID();

    const eligibleProfileId = '10000000-0000-4000-8000-000000000001';
    const noConsentProfileId = '10000000-0000-4000-8000-000000000002';
    const otherSiteProfileId = '10000000-0000-4000-8000-000000000003';

    await db.query(`INSERT INTO ${siteTable}(id, code, name) VALUES ($1, $2, $3), ($4, $5, $6)`, [
      siteId,
      `SITE-A-${siteId.slice(0, 8)}`,
      'Synthetic Candidate Site A',
      otherSiteId,
      `SITE-B-${otherSiteId.slice(0, 8)}`,
      'Synthetic Candidate Site B',
    ]);

    await db.query(
      `INSERT INTO ${userTable}(id, username, display_name, password_hash) VALUES ($1, $2, $3, $4)`,
      [
        actorUserId,
        `candidate-actor-${actorUserId.slice(0, 8)}`,
        'Synthetic Supervised Actor',
        'synthetic-password-hash',
      ],
    );

    await db.query(
      `INSERT INTO ${workerTable}(id, site_id, external_id, display_name)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12)`,
      [
        eligibleWorkerId,
        siteId,
        'W-ELIGIBLE',
        'Eligible Worker',
        noConsentWorkerId,
        siteId,
        'W-NO-CONSENT',
        'No Consent Worker',
        otherSiteWorkerId,
        otherSiteId,
        'W-OTHER-SITE',
        'Other Site Worker',
      ],
    );

    const insertProfile = async (
      profileId: string,
      workerId: string,
      referenceHash: string,
      template: string,
    ): Promise<string> => {
      await db.query(
        `INSERT INTO ${profileTable}(id, worker_id, user_id, encrypted_template, profile_reference_hash, model_version, status, consent_version, consented_at, created_by_user_id, consent_method)
         VALUES ($1, $2, NULL, $3, $4, $5, 'ACTIVE', 'v1', statement_timestamp(), $6, 'SUPERVISED_WORKER_CONFIRMATION')`,
        [profileId, workerId, template, referenceHash, SYNTHETIC_MODEL, actorUserId],
      );
      return readRevision(profileId);
    };

    const insertConsent = async (
      consentId: string,
      profileId: string,
      profileRevision: string,
      hashSeed: string,
    ): Promise<void> => {
      await db.query(
        `INSERT INTO ${consentTable}(id, profile_id, profile_revision, purpose, consent_version, consent_method, consented_at, source_record_id, source_record_hash, recorded_by_user_id)
         VALUES ($1, $2, $3, 'SAFETY_MF06', 'v1', 'SUPERVISED_WORKER_CONFIRMATION', statement_timestamp(), $4, $5, $6)`,
        [consentId, profileId, profileRevision, randomUUID(), hashSeed.repeat(64), actorUserId],
      );
    };

    const readRevision = async (profileId: string): Promise<string> => {
      const rows = (await db.query(
        `SELECT safety_revision AS "safetyRevision" FROM ${profileTable} WHERE id = $1`,
        [profileId],
      )) as Array<{ safetyRevision: string }>;
      assert.equal(rows.length, 1);
      return rows[0]!.safetyRevision;
    };

    const initialRevision = await insertProfile(
      eligibleProfileId,
      eligibleWorkerId,
      HASH_ELIGIBLE,
      VALID_TEMPLATE_A,
    );
    await insertProfile(noConsentProfileId, noConsentWorkerId, HASH_NO_CONSENT, VALID_TEMPLATE_A);
    const otherSiteRevision = await insertProfile(
      otherSiteProfileId,
      otherSiteWorkerId,
      HASH_OTHER_SITE,
      VALID_TEMPLATE_A,
    );

    await insertConsent(CONSENT_ID_1, eligibleProfileId, initialRevision, '1');
    await insertConsent(CONSENT_ID_OTHER_SITE, otherSiteProfileId, otherSiteRevision, '2');

    const reader = new SafetyFaceCandidateReader(db);
    const runRead = (model = SYNTHETIC_MODEL) =>
      reader.readForSafety(siteId, model, new AbortController().signal);

    // 1. Only the same-Site profile with active SAFETY_MF06 consent is returned.
    assert.deepEqual(await runRead(), {
      status: 'AVAILABLE',
      candidates: [
        {
          profileReferenceHash: HASH_ELIGIBLE,
          profileRevision: initialRevision,
          encryptedTemplate: VALID_TEMPLATE_A,
        },
      ],
    });

    // 2. Wrong model version returns AVAILABLE empty.
    assert.deepEqual(await runRead('other-synthetic-model-v2'), {
      status: 'AVAILABLE',
      candidates: [],
    });

    // 3. Revoking the current consent removes the candidate.
    await db.query(
      `INSERT INTO ${revocationTable}(
         consent_id,
         revoked_at,
         source_record_id,
         source_record_hash,
         recorded_by_user_id
       ) VALUES ($1, statement_timestamp(), $2, $3, $4)`,
      [CONSENT_ID_1, randomUUID(), '3'.repeat(64), actorUserId],
    );
    assert.deepEqual(await runRead(), {
      status: 'AVAILABLE',
      candidates: [],
    });

    // 4. A newer consent for the same profile revision restores eligibility.
    await insertConsent(CONSENT_ID_2, eligibleProfileId, initialRevision, '4');
    assert.deepEqual(await runRead(), {
      status: 'AVAILABLE',
      candidates: [
        {
          profileReferenceHash: HASH_ELIGIBLE,
          profileRevision: initialRevision,
          encryptedTemplate: VALID_TEMPLATE_A,
        },
      ],
    });

    // 5. Updating face_profile rotates DB-owned safety_revision so older consent cannot match.
    await db.query(`UPDATE ${profileTable} SET encrypted_template = $1 WHERE id = $2`, [
      VALID_TEMPLATE_B,
      eligibleProfileId,
    ]);
    const rotatedRevision = await readRevision(eligibleProfileId);
    assert.notEqual(rotatedRevision, initialRevision);
    assert.deepEqual(await runRead(), {
      status: 'AVAILABLE',
      candidates: [],
    });

    // 6. 20,000-char multibyte string (40,000 UTF-8 bytes) passes DB char_length check
    // but exceeds SQL octet_length<=32768 bound and fails closed as INVALID_CANDIDATE.
    assert.equal(UNICODE_20K_CHARS_40K_BYTES.length, 20_000);
    assert.equal(Buffer.byteLength(UNICODE_20K_CHARS_40K_BYTES, 'utf8'), 40_000);
    await db.query(`UPDATE ${profileTable} SET encrypted_template = $1 WHERE id = $2`, [
      UNICODE_20K_CHARS_40K_BYTES,
      eligibleProfileId,
    ]);
    const oversizedByteRevision = await readRevision(eligibleProfileId);
    assert.notEqual(oversizedByteRevision, rotatedRevision);
    await insertConsent(CONSENT_ID_3, eligibleProfileId, oversizedByteRevision, '5');
    assert.deepEqual(await runRead(), {
      status: 'UNAVAILABLE',
      reason: 'INVALID_CANDIDATE',
    });

    // 7. Restore valid template + matching consent, then create empty pg_temp shadows for all 4 tables.
    await db.query(`UPDATE ${profileTable} SET encrypted_template = $1 WHERE id = $2`, [
      VALID_TEMPLATE_B,
      eligibleProfileId,
    ]);
    const finalRevision = await readRevision(eligibleProfileId);
    assert.notEqual(finalRevision, oversizedByteRevision);
    await insertConsent(CONSENT_ID_4, eligibleProfileId, finalRevision, '6');
    const metadata = new SafetyFaceProfileMetadataReader();
    const reference = {
      profileReferenceHash: HASH_ELIGIBLE,
      profileRevision: finalRevision,
      modelVersion: SYNTHETIC_MODEL,
    };
    const expectedMetadata = {
      state: 'ELIGIBLE_METADATA',
      workerId: eligibleWorkerId,
      siteId,
      profileId: eligibleProfileId,
      profileRevision: finalRevision,
      consentId: CONSENT_ID_4,
    };
    assert.deepEqual(
      await metadata.findCurrentForSafety(db.manager, siteId, reference),
      expectedMetadata,
    );

    await db.query(`CREATE TEMP TABLE face_profile (LIKE ${profileTable})`);
    await db.query(`CREATE TEMP TABLE worker (LIKE ${workerTable})`);
    await db.query(`CREATE TEMP TABLE safety_face_consent (LIKE ${consentTable})`);
    await db.query(`CREATE TEMP TABLE safety_face_consent_revocation (LIKE ${revocationTable})`);
    try {
      assert.deepEqual(await runRead(), {
        status: 'AVAILABLE',
        candidates: [
          {
            profileReferenceHash: HASH_ELIGIBLE,
            profileRevision: finalRevision,
            encryptedTemplate: VALID_TEMPLATE_B,
          },
        ],
      });
      assert.deepEqual(
        await metadata.findCurrentForSafety(db.manager, siteId, reference),
        expectedMetadata,
      );
      assert.deepEqual(
        await db.transaction('SERIALIZABLE', (manager) =>
          metadata.findCurrentForSafety(manager, siteId, reference, true),
        ),
        expectedMetadata,
      );
    } finally {
      await db.query(
        'DROP TABLE IF EXISTS pg_temp.safety_face_consent_revocation, pg_temp.safety_face_consent, pg_temp.face_profile, pg_temp.worker',
      );
    }
  },
);
