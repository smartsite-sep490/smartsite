import type { Mf06ClaimContextLookup } from './mf06-claim-context.reader.js';
import { bindMf06FaceInvocation, type Mf06FaceBinding } from './mf06-face-binding.js';
import { readMf06SubjectMedia } from './mf06-frame-media.reader.js';
import { snapshotMf06Json } from './mf06-json-snapshot.js';
import type { SafetySubjectCrop } from '../identity/safety-subject-cropper.js';

export type Mf06PreparedFaceMedia =
  | (Extract<Mf06FaceBinding, { state: 'BOUND_UNATTESTED' }> & { crop: SafetySubjectCrop })
  | { state: 'UNAVAILABLE'; reason: 'INVALID_BINDING' | 'MEDIA_UNAVAILABLE' | 'ABORTED' };

/** Preparation outside database locks; finalization must revalidate the claim and consent. */
export async function prepareMf06FaceMedia(
  context: Mf06ClaimContextLookup,
  root: string,
  invocationId: string,
  modelVersion: string,
  signal: AbortSignal,
): Promise<Mf06PreparedFaceMedia> {
  try {
    if (signal.aborted) return { state: 'UNAVAILABLE', reason: 'ABORTED' };
    const saved = snapshotMf06Json(context) as Mf06ClaimContextLookup;
    if (
      saved.status !== 'MATCHED' ||
      !saved.frameReference ||
      !saved.subject ||
      saved.request.subjectBindingStatus !== 'BOUND'
    )
      return { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' };
    const crop = await readMf06SubjectMedia(root, saved.frameReference, saved.subject, signal);
    if (signal.aborted) return { state: 'UNAVAILABLE', reason: 'ABORTED' };
    if (!crop || crop.frameSha256 !== saved.frameReference.sha256)
      return { state: 'UNAVAILABLE', reason: 'MEDIA_UNAVAILABLE' };
    const bound = bindMf06FaceInvocation(saved, crop, invocationId, modelVersion);
    if (bound.state !== 'BOUND_UNATTESTED')
      return { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' };
    return { ...bound, crop };
  } catch {
    return { state: 'UNAVAILABLE', reason: signal.aborted ? 'ABORTED' : 'INVALID_BINDING' };
  }
}
