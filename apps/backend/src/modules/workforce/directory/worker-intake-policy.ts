import { isEmail } from 'class-validator';
import { z } from 'zod';
import {
  isWorkerDocumentDate,
  type SaveWorkerOnboardingDraftCommand,
  type WorkerDocumentKind,
} from '@smartsite/contracts';
import { invalid } from '../../../common/configuration/commands.js';
import type { IntakeAttachment } from '../../../database/entities/worker-onboarding-draft.entity.js';
import { DOCUMENT_KINDS } from '../documents/worker-compliance.js';
import { draftDocumentCoverageDates } from '../documents/worker-document-submission.js';

const date = z.string().refine(isWorkerDocumentDate).optional();
const text = (length: number) =>
  z
    .string()
    .trim()
    .max(length)
    .regex(/^[^\p{Cc}\p{Cs}]*$/u);
const metadata = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2147483646),
  displayName: text(255),
  username: text(64).transform((value) => value.toLowerCase()),
  email: text(254).transform((value) => value.toLowerCase()),
  safetyCardRequired: z.boolean().nullable(),
  language: z.enum(['vi', 'en']).optional(),
  documents: z.strictObject({
    SAFETY_CARD: draftDocumentCoverageDates.optional(),
    HEALTH_CERTIFICATE: z.strictObject({ submittedIssuedOn: date }).optional(),
    PERSONAL_INSURANCE: draftDocumentCoverageDates.optional(),
  }),
});

export function parseIntakeDraft(input: unknown): SaveWorkerOnboardingDraftCommand {
  const parsed = metadata.safeParse(input);
  if (!parsed.success) invalid('Invalid worker intake draft');
  return parsed.data;
}

export function missingIntakeDocuments(
  documents: Partial<Record<WorkerDocumentKind, IntakeAttachment>>,
  safetyCardRequired: boolean | null,
) {
  return DOCUMENT_KINDS.filter((kind) => {
    const attachment = documents[kind];
    if (kind === 'SAFETY_CARD' && safetyCardRequired === false) return false;
    return (
      !attachment?.file ||
      !(kind === 'HEALTH_CERTIFICATE'
        ? attachment.submittedIssuedOn
        : attachment.submittedExpiresOn)
    );
  });
}

export function intakeHasAccountDetails(
  row: Pick<
    SaveWorkerOnboardingDraftCommand,
    'displayName' | 'username' | 'email' | 'safetyCardRequired'
  >,
) {
  return Boolean(
    row.displayName &&
    /^[a-z0-9][a-z0-9._-]{2,63}$/.test(row.username) &&
    isEmail(row.email) &&
    row.safetyCardRequired !== null,
  );
}
