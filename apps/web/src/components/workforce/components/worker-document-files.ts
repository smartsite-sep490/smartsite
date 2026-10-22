import type { WorkerDocumentKind } from '@smartsite/api-client';
export const documentKinds: readonly WorkerDocumentKind[] = [
  'SAFETY_CARD',
  'HEALTH_CERTIFICATE',
  'PERSONAL_INSURANCE',
];
export function validDocumentFile(file: File) {
  return (
    ['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) &&
    file.size > 0 &&
    file.size <= 5 * 1024 * 1024
  );
}
