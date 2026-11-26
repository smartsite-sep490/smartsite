import {
  isWorkerDocumentDate,
  type WorkerDocumentDateCheck,
  type WorkerDocumentKind,
} from '@smartsite/contracts';

/** AI compares the worker certificate dates without modifying the original or approval. */
export function compareDocumentDates(
  kind: WorkerDocumentKind,
  submitted: { submittedIssuedOn?: string | null; submittedExpiresOn?: string | null },
  evidence: { issuedOn: string | null; expiresOn: string | null } | null,
  field: WorkerDocumentDateCheck['field'] = kind === 'HEALTH_CERTIFICATE'
    ? 'ISSUED_ON'
    : 'EXPIRES_ON',
): WorkerDocumentDateCheck {
  const start = field === 'ISSUED_ON';
  const submittedDate =
    (start ? submitted.submittedIssuedOn : submitted.submittedExpiresOn) ?? null;
  const detected = start ? evidence?.issuedOn : evidence?.expiresOn;
  const detectedDate = isWorkerDocumentDate(detected) ? detected : null;
  return {
    field,
    submittedDate,
    detectedDate,
    status: !isWorkerDocumentDate(submittedDate)
      ? 'NO_REFERENCE'
      : !detectedDate
        ? 'UNAVAILABLE'
        : detectedDate === submittedDate
          ? 'MATCH'
          : 'MISMATCH',
  };
}
