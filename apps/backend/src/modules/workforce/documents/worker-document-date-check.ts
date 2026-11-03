import {
  isWorkerDocumentDate,
  type DocumentOcrResult,
  type WorkerDocumentDateCheck,
  type WorkerDocumentKind,
} from '@smartsite/contracts';

/** OCR is technical evidence. A match never approves a document or extends its validity. */
export function compareDocumentDates(
  kind: WorkerDocumentKind,
  submitted: { submittedIssuedOn?: string | null; submittedExpiresOn?: string | null },
  ocr: DocumentOcrResult | null | undefined,
): WorkerDocumentDateCheck {
  const health = kind === 'HEALTH_CERTIFICATE';
  const submittedDate =
    (health ? submitted.submittedIssuedOn : submitted.submittedExpiresOn) ?? null;
  const detected = health ? ocr?.issuedOn : ocr?.expiresOn;
  const detectedDate = ocr?.status === 'READ' && isWorkerDocumentDate(detected) ? detected : null;
  return {
    field: health ? 'ISSUED_ON' : 'EXPIRES_ON',
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
