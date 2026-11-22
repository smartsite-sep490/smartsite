import { z } from 'zod';
import { isWorkerDocumentDate } from '@smartsite/contracts';
import { invalid } from '../../../common/configuration/commands.js';

const date = z.string().refine(isWorkerDocumentDate);
export const documentSubmissionSchema = z.strictObject({
  requestId: z.uuid(),
  expectedVersion: z.number().int().min(0),
  safetyCardRequired: z.boolean(),
  documents: z.strictObject({
    SAFETY_CARD: z.strictObject({ submittedExpiresOn: date }).optional(),
    HEALTH_CERTIFICATE: z.strictObject({ submittedIssuedOn: date }).optional(),
    PERSONAL_INSURANCE: z.strictObject({ submittedExpiresOn: date }).optional(),
  }),
  identity: z
    .strictObject({
      nationalId: z.string().regex(/^[0-9]{12}$/),
      phoneNumber: z.string().regex(/^\+?[0-9]{9,15}$/),
      gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
      address: z
        .string()
        .trim()
        .min(1)
        .max(1000)
        .regex(/^[^\p{Cc}\p{Cs}]+$/u),
    })
    .optional(),
});

export function parseDocumentSubmission(input: unknown) {
  const parsed = documentSubmissionSchema.safeParse(input);
  if (!parsed.success) invalid('Invalid document submission');
  return parsed.data;
}
