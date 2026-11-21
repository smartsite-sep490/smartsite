import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import type { DataSource, EntityManager } from 'typeorm';
import { TrackedFrameEvidenceUpload } from '../src/integrations/ai/tracked-frame-evidence-upload.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const eventId = '11111111-1111-4111-8111-111111111111';
const jpeg = () =>
  sharp({ create: { width: 32, height: 24, channels: 3, background: '#567890' } })
    .jpeg()
    .toBuffer();

function fixture(bytes: Buffer, enabled = true) {
  let locks = 0;
  let authenticationCalls = 0;
  let writes = 0;
  let staleAfterUpload = false;
  let onFirstAuthentication: (() => void) | undefined;
  let changeBinding = false;
  let reviewOnlyOnCall = 0;
  const payload = {
    eventId,
    frameDimensions: { width: 32, height: 24 },
    evidence: [{ kind: 'FRAME', sha256: sha(bytes) }],
  };
  const source = {
    async transaction<T>(work: (manager: EntityManager) => Promise<T>) {
      locks++;
      try {
        return await work({} as EntityManager);
      } finally {
        locks--;
      }
    },
  } as DataSource;
  const auth = {
    async authenticate(_manager: EntityManager, raw: unknown, _context: unknown, secret: string) {
      authenticationCalls++;
      assert.equal(locks, 1);
      if (authenticationCalls === 1) onFirstAuthentication?.();
      if (secret !== 'issued-secret' || (staleAfterUpload && authenticationCalls > 1))
        throw new Error('generation revoked');
      return {
        classification:
          authenticationCalls >= reviewOnlyOnCall && reviewOnlyOnCall > 0
            ? ('REVIEW_ONLY' as const)
            : ('LIVE' as const),
        eventId,
        payloadHash: 'a'.repeat(64),
        bindingHash: changeBinding && authenticationCalls > 1 ? 'c'.repeat(64) : 'b'.repeat(64),
        payload: raw,
      };
    },
  };
  const storage = {
    async saveAiFrame(content: Buffer, expected: string) {
      assert.equal(locks, 0, 'remote storage must not run inside a DB transaction');
      assert.equal(sha(content), expected);
      writes++;
    },
  };
  return {
    service: new TrackedFrameEvidenceUpload(auth, storage, enabled),
    source,
    payload,
    context: { opaque: 'validated by authenticator' },
    counts: () => ({ authenticationCalls, writes }),
    revokeDuringUpload: () => (staleAfterUpload = true),
    changeBindingDuringUpload: () => (changeBinding = true),
    mutateDuringAuthentication: (work: () => void) => (onFirstAuthentication = work),
    classifyReviewOnlyOnCall: (call: number) => (reviewOnlyOnCall = call),
  };
}

test('evidence upload returns a bound storage-only receipt after rechecking the generation', async () => {
  const bytes = await jpeg();
  const f = fixture(bytes);
  const receipt = await f.service.store(f.source, f.payload, f.context, 'issued-secret', bytes);
  assert.deepEqual(receipt, {
    schemaVersion: '1.0.0',
    kind: 'EVIDENCE_STORED',
    eventId,
    payloadHash: 'a'.repeat(64),
    bindingHash: 'b'.repeat(64),
    sha256: sha(bytes),
  });
  assert.deepEqual(f.counts(), { authenticationCalls: 2, writes: 1 });
});

test('disabled upload performs no authentication, DB work or storage write', async () => {
  const bytes = await jpeg();
  const f = fixture(bytes, false);
  await assert.rejects(
    f.service.store(f.source, f.payload, f.context, 'issued-secret', bytes),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 503,
  );
  assert.deepEqual(f.counts(), { authenticationCalls: 0, writes: 0 });
});

test('unissued credentials and stale generation never receive an evidence receipt', async () => {
  const bytes = await jpeg();
  const denied = fixture(bytes);
  await assert.rejects(
    denied.service.store(denied.source, denied.payload, denied.context, 'wrong', bytes),
    /generation revoked/,
  );
  assert.deepEqual(denied.counts(), { authenticationCalls: 1, writes: 0 });
  const stale = fixture(bytes);
  stale.revokeDuringUpload();
  await assert.rejects(
    stale.service.store(stale.source, stale.payload, stale.context, 'issued-secret', bytes),
    /generation revoked/,
  );
  assert.deepEqual(stale.counts(), { authenticationCalls: 2, writes: 1 });
});

test('mismatched frame hash, CROP-only evidence and wrong decoded dimensions are rejected', async () => {
  const bytes = await jpeg();
  for (const kind of ['hash', 'crop', 'dimensions']) {
    const f = fixture(bytes);
    if (kind === 'hash') f.payload.evidence[0]!.sha256 = 'c'.repeat(64);
    if (kind === 'crop') f.payload.evidence[0]!.kind = 'CROP';
    if (kind === 'dimensions') f.payload.frameDimensions.width++;
    await assert.rejects(f.service.store(f.source, f.payload, f.context, 'issued-secret', bytes));
    assert.equal(f.counts().writes, 0);
  }
});

test('invalid, oversized or non-JPEG bytes never reach object storage', async () => {
  const png = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#567890' },
  })
    .png()
    .toBuffer();
  for (const bytes of [Buffer.from('not an image'), Buffer.alloc(1048577), png]) {
    const f = fixture(bytes);
    await assert.rejects(f.service.store(f.source, f.payload, f.context, 'issued-secret', bytes));
    assert.equal(f.counts().writes, 0);
  }
});

test('caller mutation cannot swap evidence bytes or the original event across awaits', async () => {
  const bytes = await jpeg();
  const expected = sha(bytes);
  const f = fixture(bytes);
  f.mutateDuringAuthentication(() => {
    bytes.fill(0);
    f.payload.evidence[0]!.sha256 = 'c'.repeat(64);
    f.payload.frameDimensions.width = 1;
  });
  const result = await f.service.store(f.source, f.payload, f.context, 'issued-secret', bytes);
  assert.equal(result.sha256, expected);
  assert.equal(result.kind, 'EVIDENCE_STORED');
});

test('a changed authenticated binding after storage yields conflict rather than a receipt', async () => {
  const bytes = await jpeg();
  const f = fixture(bytes);
  f.changeBindingDuringUpload();
  await assert.rejects(
    f.service.store(f.source, f.payload, f.context, 'issued-secret', bytes),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 409,
  );
  assert.deepEqual(f.counts(), { authenticationCalls: 2, writes: 1 });
});

test('REVIEW_ONLY classification is rejected both before storage and on generation recheck', async () => {
  const bytes = await jpeg();
  for (const call of [1, 2]) {
    const f = fixture(bytes);
    f.classifyReviewOnlyOnCall(call);
    await assert.rejects(
      f.service.store(f.source, f.payload, f.context, 'issued-secret', bytes),
      (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 409,
    );
    assert.equal(f.counts().writes, call === 1 ? 0 : 1);
  }
});

test('EXIF rotation and images beyond the existing reader pixel limit are rejected', async () => {
  const rotated = await sharp(await jpeg())
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const oversized = await sharp({
    create: { width: 4001, height: 4000, channels: 3, background: '#567890' },
  })
    .jpeg()
    .toBuffer();
  for (const bytes of [rotated, oversized]) {
    const f = fixture(bytes);
    const metadata = await sharp(bytes).metadata();
    f.payload.frameDimensions.width = metadata.width!;
    f.payload.frameDimensions.height = metadata.height!;
    await assert.rejects(f.service.store(f.source, f.payload, f.context, 'issued-secret', bytes));
    assert.equal(f.counts().writes, 0);
  }
});
