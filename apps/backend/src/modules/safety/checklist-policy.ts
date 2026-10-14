import { PublicHttpException } from '../../common/http/public-http-exception.js';
import type { ChecklistStatus, ChecklistResultInput } from '@smartsite/contracts';
import { conflict, invalid } from '../../common/configuration/commands.js';
export function checklistTransition(
  status: ChecklistStatus,
  operation: 'start' | 'submit' | 'accept' | 'return' | 'cancel',
): ChecklistStatus {
  if (operation === 'start' && status === 'ASSIGNED') return 'IN_PROGRESS';
  if (operation === 'submit' && status === 'IN_PROGRESS') return 'SUBMITTED';
  if (operation === 'accept' && status === 'SUBMITTED') return 'ACCEPTED';
  if (operation === 'return' && status === 'SUBMITTED') return 'IN_PROGRESS';
  if (operation === 'cancel' && (status === 'ASSIGNED' || status === 'IN_PROGRESS'))
    return 'CANCELLED';
  return conflict(
    'This checklist cannot perform the requested operation. Reload its current state.',
  );
}
export function requireChecklistReviewer(actorId: string, submitterId: string) {
  if (actorId === submitterId)
    throw new PublicHttpException(403, {
      code: 'FORBIDDEN',
      message: 'You cannot review your own submission',
    });
}
export function validateChecklistResults(
  items: { id: string; evidenceRequired: boolean }[],
  results: ChecklistResultInput[],
  fileCount: number,
) {
  if (
    results.length !== items.length ||
    new Set(results.map((r) => r.itemId)).size !== items.length
  )
    invalid('Report every checklist item exactly once');
  const used = new Set<number>();
  for (const result of results) {
    const item = items.find((i) => i.id === result.itemId);
    if (!item || !['PASS', 'FAIL', 'NOT_APPLICABLE'].includes(result.answer))
      invalid('Invalid checklist result');
    if (result.answer !== 'PASS' && !result.note.trim())
      invalid('Explain failed or not applicable items');
    if (result.fileIndexes.length > 3) invalid('At most three files per item');
    if (item.evidenceRequired && result.answer === 'PASS' && !result.fileIndexes.length)
      invalid('Evidence is required to report this item as Pass');
    for (const index of result.fileIndexes) {
      if (!Number.isInteger(index) || index < 0 || index >= fileCount || used.has(index))
        invalid('Invalid or duplicate file reference');
      used.add(index);
    }
  }
  if (used.size !== fileCount) invalid('Every uploaded file must belong to one checklist item');
}
