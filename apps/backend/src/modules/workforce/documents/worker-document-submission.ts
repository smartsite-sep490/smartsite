import { z } from 'zod';
import { isWorkerDocumentDate } from '@smartsite/contracts';
import { invalid } from '../../../common/configuration/commands.js';

const date = z.string().refine(isWorkerDocumentDate);
const coverageDates = z.strictObject({
  submittedIssuedOn: date.optional(),
  submittedExpiresOn: date,
});
const orderedDates = (value: { submittedIssuedOn?: string; submittedExpiresOn?: string }) =>
  !value.submittedIssuedOn ||
  !value.submittedExpiresOn ||
  value.submittedIssuedOn <= value.submittedExpiresOn;
const documentCoverageDates = coverageDates.refine(orderedDates);
export const draftDocumentCoverageDates = coverageDates
  .partial({ submittedExpiresOn: true })
  .refine(orderedDates);

export const documentSubmissionSchema = z.strictObject({
  requestId: z.uuid(),
  expectedVersion: z.number().int().min(0),
  safetyCardRequired: z.boolean(),
  documents: z.strictObject({
    SAFETY_CARD: documentCoverageDates.optional(),
    HEALTH_CERTIFICATE: z.strictObject({ submittedIssuedOn: date }).optional(),
    PERSONAL_INSURANCE: documentCoverageDates.optional(),
  }),
});

const workerIdentitySchema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  nationalId: z.string().regex(/^[0-9]{12}$/),
  phoneNumber: z.string().regex(/^\+?[0-9]{9,15}$/),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  address: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .regex(/^[^\p{Cc}\p{Cs}]+$/u),
});

const workerBatchSchema = z.strictObject({
  items: z
    .array(z.strictObject({ id: z.uuid(), version: z.number().int().min(0) }))
    .min(1)
    .max(50),
});

export function parseDocumentSubmission(input: unknown) {
  const parsed = documentSubmissionSchema.safeParse(input);
  if (!parsed.success) invalid('Invalid document submission');
  return parsed.data;
}

export function parseWorkerIdentity(input: unknown) {
  const parsed = workerIdentitySchema.safeParse(input);
  if (!parsed.success) invalid('Invalid worker identity');
  return parsed.data;
}

export function parseWorkerDocumentBatch(input: unknown) {
  const parsed = workerBatchSchema.safeParse(input);
  if (!parsed.success) invalid('Select up to 50 worker profiles');
  const items = parsed.data.items.map(({ id, version }) => ({ id: id.toLowerCase(), version }));
  if (new Set(items.map((item) => item.id)).size !== items.length)
    invalid('Worker profiles must be unique');
  return items;
}
