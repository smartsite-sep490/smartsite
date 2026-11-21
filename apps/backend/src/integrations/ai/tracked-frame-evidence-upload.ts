import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { DataSource, EntityManager } from 'typeorm';
import type { AiFrameEvidenceReceipt } from '@smartsite/contracts/ai-frame-evidence';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import type { StorageService } from '../storage/storage.service.js';

interface BoundEvidencePart {
  classification: 'LIVE' | 'REVIEW_ONLY';
  eventId: string;
  payloadHash: string;
  bindingHash: string;
  payload: unknown;
}

/** The existing tracked authenticator supplies all camera/generation/profile authority. */
interface EvidencePartAuthenticator {
  authenticate(
    manager: EntityManager,
    payload: unknown,
    context: unknown,
    secret: string,
  ): Promise<BoundEvidencePart>;
}

function reject(status: 400 | 409 | 503): never {
  throw new PublicHttpException(status, {
    code:
      status === 400 ? 'VALIDATION_FAILED' : status === 409 ? 'CONFLICT' : 'SERVICE_UNAVAILABLE',
    message: 'AI frame evidence upload is unavailable',
  });
}

/** Disabled/unregistered LIVE transport prototype. It never stores/admit events or emits alerts.
 * A stale upload may leave a private immutable object, but never a receipt or public media grant.
 */
export class TrackedFrameEvidenceUpload {
  constructor(
    private readonly authenticator: EvidencePartAuthenticator,
    private readonly storage: Pick<StorageService, 'saveAiFrame'>,
    private readonly enabled = false,
  ) {}

  async store(
    source: DataSource,
    payload: unknown,
    context: unknown,
    secret: string,
    bytes: Buffer,
  ): Promise<AiFrameEvidenceReceipt> {
    if (!this.enabled) reject(503);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 1_048_576) reject(400);
    // Snapshot before any await: a caller cannot swap the event, binding or image mid-upload.
    const content = Buffer.from(bytes);
    let originalPayload: unknown;
    let originalContext: unknown;
    try {
      originalPayload = structuredClone(payload);
      originalContext = structuredClone(context);
    } catch {
      reject(400);
    }
    const bound = await source.transaction((manager) =>
      this.authenticator.authenticate(manager, originalPayload, originalContext, secret),
    );
    if (bound.classification !== 'LIVE') reject(409);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const event = bound.payload as {
      evidence?: { kind?: unknown; sha256?: unknown }[];
      frameDimensions?: { width?: unknown; height?: unknown };
    } | null;
    if (
      !Array.isArray(event?.evidence) ||
      !event.evidence.some((item) => item?.kind === 'FRAME' && item.sha256 === sha256)
    )
      reject(400);
    try {
      const image = sharp(content, { failOn: 'warning', limitInputPixels: 16_000_000 });
      const metadata = await image.metadata();
      if (
        metadata.format !== 'jpeg' ||
        (metadata.orientation ?? 1) !== 1 ||
        metadata.width !== event.frameDimensions?.width ||
        metadata.height !== event.frameDimensions?.height ||
        (metadata.pages ?? 1) !== 1
      )
        reject(400);
      // Force decoding as well as header inspection. Stored bytes remain the original image.
      await image.resize(1, 1).jpeg().toBuffer();
    } catch {
      reject(400);
    }
    // Remote I/O is deliberately outside both short authorization transactions.
    await this.storage.saveAiFrame(content, sha256);
    const current = await source.transaction((manager) =>
      this.authenticator.authenticate(manager, originalPayload, originalContext, secret),
    );
    if (
      current.classification !== 'LIVE' ||
      current.eventId !== bound.eventId ||
      current.payloadHash !== bound.payloadHash ||
      current.bindingHash !== bound.bindingHash
    )
      reject(409);
    return {
      schemaVersion: '1.0.0',
      kind: 'EVIDENCE_STORED',
      eventId: bound.eventId,
      payloadHash: bound.payloadHash,
      bindingHash: bound.bindingHash,
      sha256,
    };
  }
}
