import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { isUUID } from 'class-validator';
import { z } from 'zod';
import { invalid, uuid } from '../../../common/configuration/commands.js';

const normalizedUuid = z
  .string()
  .refine((value) => isUUID(value))
  .transform((value) => value.toLowerCase());
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const reason = z
  .string()
  .trim()
  .min(5)
  .max(1000)
  .refine(
    (value) =>
      !value.includes('\u0000') &&
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),
  );
const common = {
  commandId: normalizedUuid,
  expectedRevision: z.number().int().min(0).max(2147483646),
  expectedEventHash: digest,
  reason,
};
const schema = z.discriminatedUnion('action', [
  z
    .object({
      ...common,
      action: z.literal('RESOLVE'),
      workerId: normalizedUuid,
      evidenceIndex: z.number().int().min(0).max(255),
      expectedEvidenceSha256: digest,
    })
    .strict(),
  z.object({ ...common, action: z.literal('CLEAR') }).strict(),
]);

export type ObservationIdentityDecisionCommand = z.infer<typeof schema>;
export interface ObservationIdentitySubjectScope {
  siteId: string;
  alertId: string;
  eventId: string;
  personObservationIndex: number;
}
export interface ObservationIdentityCommandScope extends ObservationIdentitySubjectScope {
  actorUserId: string;
}

export function parseObservationIdentityCommand(
  input: unknown,
): ObservationIdentityDecisionCommand {
  const result = schema.safeParse(input);
  if (!result.success) return invalid('Invalid observation identity command');
  return result.data;
}

export function normalizeObservationIdentitySubjectScope(
  scope: ObservationIdentitySubjectScope,
): ObservationIdentitySubjectScope {
  if (
    !Number.isInteger(scope.personObservationIndex) ||
    scope.personObservationIndex < 0 ||
    scope.personObservationIndex > 255
  )
    invalid('Invalid observation PERSON index');
  return {
    siteId: uuid(scope.siteId).toLowerCase(),
    alertId: uuid(scope.alertId).toLowerCase(),
    eventId: uuid(scope.eventId).toLowerCase(),
    personObservationIndex: scope.personObservationIndex,
  };
}

export function normalizeObservationIdentityScope(
  scope: ObservationIdentityCommandScope,
): ObservationIdentityCommandScope {
  return {
    ...normalizeObservationIdentitySubjectScope(scope),
    actorUserId: uuid(scope.actorUserId).toLowerCase(),
  };
}

export function observationIdentityCommandHash(
  scope: ObservationIdentityCommandScope,
  input: ObservationIdentityDecisionCommand,
): string {
  return computeCanonicalPayloadHash({
    scope: normalizeObservationIdentityScope(scope),
    input: parseObservationIdentityCommand(input),
  });
}
