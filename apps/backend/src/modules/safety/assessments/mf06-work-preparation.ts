import type { Mf06ClaimContextLookup } from './mf06-claim-context.reader.js';
import type { Mf06FacePreparationResult } from './mf06-face-preparation.js';
import type { Mf06JobClaim } from './mf06-job-lease.service.js';
import { snapshotMf06Json } from './mf06-json-snapshot.js';
export type MatchedClaimContext = Extract<Mf06ClaimContextLookup, { status: 'MATCHED' }>;

/** Keep external preparation results private across awaits and SQL retries. */
export function snapshotWorkContext(context: MatchedClaimContext): MatchedClaimContext {
  return deepFreezePlain(context);
}
function deepFreezePlain<T>(value: T): T {
  const cloned = snapshotMf06Json(value) as T;
  const freezeNode = (node: unknown): void => {
    if (node && typeof node === 'object') {
      Object.freeze(node);
      for (const child of Object.values(node as Record<string, unknown>)) freezeNode(child);
    }
  };
  freezeNode(cloned);
  return cloned;
}

export const snapshotWorkClaim = (claim: Mf06JobClaim): Mf06JobClaim =>
  Object.freeze({
    requestId: claim.requestId,
    leaseToken: claim.leaseToken,
    headRevision: claim.headRevision,
    attemptCount: claim.attemptCount,
    leaseExpiresAt: claim.leaseExpiresAt,
    deadlineAt: claim.deadlineAt,
  });

export function snapshotWorkFace(
  faceResult: Mf06FacePreparationResult,
  expected: MatchedClaimContext,
): Mf06FacePreparationResult {
  if (faceResult.state === 'UNAVAILABLE')
    return Object.freeze({ state: 'UNAVAILABLE' as const, reason: faceResult.reason });
  try {
    const rawCrop = faceResult.media?.crop;
    if (
      !rawCrop ||
      !Buffer.isBuffer(rawCrop.bytes) ||
      rawCrop.bytes.length === 0 ||
      rawCrop.bytes.length > 2 * 1024 * 1024
    ) {
      return Object.freeze({ state: 'UNAVAILABLE' as const, reason: 'MEDIA_UNAVAILABLE' });
    }
    const context = deepFreezePlain(faceResult.context);
    if (
      context.claimContextDigest !== expected.claimContextDigest ||
      context.contextDigest !== expected.contextDigest
    ) {
      return Object.freeze({ state: 'UNAVAILABLE' as const, reason: 'CONTEXT_UNAVAILABLE' });
    }
    const invocation = deepFreezePlain(faceResult.media.invocation);
    const subject = deepFreezePlain(rawCrop.subject);
    const rectangle = deepFreezePlain(rawCrop.rectangle);
    const response = deepFreezePlain(faceResult.response);
    const crop = Object.freeze({
      bytes: Buffer.from(rawCrop.bytes),
      frameSha256: rawCrop.frameSha256,
      cropSha256: rawCrop.cropSha256,
      subject,
      rectangle,
      cropAlgorithmVersion: rawCrop.cropAlgorithmVersion,
    });
    const media = Object.freeze({ state: 'BOUND_UNATTESTED' as const, invocation, crop });
    return Object.freeze({ state: 'PREPARED_UNATTESTED' as const, context, media, response });
  } catch {
    return Object.freeze({ state: 'UNAVAILABLE' as const, reason: 'PREPARATION_FAILED' });
  }
}
