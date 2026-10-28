import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BoundedJsonReadError, fetchBoundedJson } from '../../../common/http/fetch-bounded-json.js';
import { snapshotMf06Json } from './mf06-json-snapshot.js';
import { Mf06RetryableWorkError } from './mf06-assessment-worker.service.js';
import {
  inspectSafetyFaceResponse,
  isSafetyFaceInvocation,
  type SafetyFaceResolveInput,
  type SafetyFaceResponseInspection,
  type SafetyIdentityResolverPort,
} from './safety-identity-resolver.port.js';

const candidatesSchema = z
  .array(
    z.strictObject({
      profileReferenceHash: z.string().regex(/^[0-9a-f]{64}$/),
      profileRevision: z.uuid(),
      encryptedTemplate: z
        .string()
        .max(32768)
        .regex(/^[A-Za-z0-9_-]{100,32766}={0,2}$/)
        .refine((value) => value.trim() === value),
    }),
  )
  .max(32);
type Failure = Extract<SafetyFaceResponseInspection, { state: 'UNAVAILABLE' }>;
const unavailable = (reason: Failure['reason']): Failure => ({ state: 'UNAVAILABLE', reason });

/** Private transport only; consent, calibrated identity and event-time authority remain Backend gates. */
export class HttpSafetyIdentityResolver implements SafetyIdentityResolverPort {
  private readonly endpoint: string | null;
  constructor(
    baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    try {
      const url = new URL(baseUrl);
      this.endpoint =
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        serviceToken.length >= 32 &&
        serviceToken.length <= 4096 &&
        /^[\x21-\x7e]+$/.test(serviceToken)
          ? new URL('/v1/identity/safety-mf06/resolve', url).href
          : null;
    } catch {
      this.endpoint = null;
    }
  }

  async resolve(input: SafetyFaceResolveInput, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) return unavailable('ABORTED');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      if (
        !this.endpoint ||
        !input ||
        Object.getPrototypeOf(input) !== Object.prototype ||
        Object.getOwnPropertySymbols(input).length
      )
        return unavailable('INVALID_RESPONSE');
      const fields = Object.getOwnPropertyDescriptors(input);
      if (
        Object.keys(fields).length !== 3 ||
        !['invocation', 'cropBytes', 'candidates'].every(
          (key) => fields[key]?.enumerable && 'value' in fields[key]!,
        )
      )
        return unavailable('INVALID_RESPONSE');
      const metadata = snapshotMf06Json({
        invocation: fields.invocation!.value,
        candidates: fields.candidates!.value,
      }) as { invocation: unknown; candidates: unknown };
      if (!isSafetyFaceInvocation(metadata.invocation)) return unavailable('INVALID_RESPONSE');
      const parsed = candidatesSchema.safeParse(metadata.candidates);
      if (!parsed.success) return unavailable('INVALID_RESPONSE');
      const candidates = parsed.data;
      if (
        new Set(candidates.map((c) => c.profileReferenceHash)).size !== candidates.length ||
        new Set(candidates.map((c) => c.profileRevision.toLowerCase())).size !== candidates.length
      )
        return unavailable('INVALID_RESPONSE');
      const raw = fields.cropBytes!.value as unknown;
      if (!Buffer.isBuffer(raw) || raw.length < 4 || raw.length > 1_048_576)
        return unavailable('INVALID_RESPONSE');
      const crop = Buffer.from(raw);
      const invocation = metadata.invocation;
      if (
        crop[0] !== 0xff ||
        crop[1] !== 0xd8 ||
        crop.at(-2) !== 0xff ||
        crop.at(-1) !== 0xd9 ||
        createHash('sha256').update(crop).digest('hex') !== invocation.cropSha256
      )
        return unavailable('INVALID_RESPONSE');
      if (!candidates.length) return unavailable('IDENTITY_UNAVAILABLE');
      const body = JSON.stringify({
        invocation,
        cropJpegBase64: crop.toString('base64'),
        candidates,
      });
      if (Buffer.byteLength(body) > 3 * 1024 * 1024) return unavailable('INVALID_RESPONSE');
      const timeout = new AbortController();
      timer = setTimeout(() => {
        timedOut = true;
        timeout.abort();
      }, 8000);
      const response = await fetchBoundedJson(
        async (url, init) => {
          let reply: Response;
          try {
            reply = await this.fetcher(url, init);
          } catch {
            throw new Mf06RetryableWorkError('RESOLVER_UNAVAILABLE');
          }
          if ([408, 429, 500, 502, 503, 504].includes(reply.status)) {
            void reply.body?.cancel().catch(() => {});
            throw new Mf06RetryableWorkError('RESOLVER_UNAVAILABLE');
          }
          return reply;
        },
        this.endpoint,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.serviceToken}`,
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body,
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.any([signal, timeout.signal]),
        },
        32768,
      );
      if (signal.aborted) return unavailable('ABORTED');
      const inspected = inspectSafetyFaceResponse(invocation, response, 'TRUSTED_SERVICE');
      if (inspected.state !== 'CANDIDATE_REFERENCE') {
        // Only a validated, correlated service outage can request a worker retry.
        if (
          inspected.reason === 'IDENTITY_UNAVAILABLE' &&
          (response as { reason: unknown }).reason === 'SERVICE_UNAVAILABLE'
        )
          throw new Mf06RetryableWorkError('RESOLVER_UNAVAILABLE');
        return inspected;
      }
      if (
        !candidates.some(
          (c) =>
            c.profileReferenceHash === inspected.profileReferenceHash &&
            c.profileRevision === inspected.profileRevision,
        )
      )
        return unavailable('INVALID_RESPONSE');
      return response;
    } catch (error) {
      if (!signal.aborted && error instanceof BoundedJsonReadError)
        throw new Mf06RetryableWorkError('RESOLVER_UNAVAILABLE');
      if (!signal.aborted && timedOut) throw new Mf06RetryableWorkError('RESOLVER_UNAVAILABLE');
      if (!signal.aborted && error instanceof Mf06RetryableWorkError) throw error;
      return unavailable(signal.aborted ? 'ABORTED' : 'INVALID_RESPONSE');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
