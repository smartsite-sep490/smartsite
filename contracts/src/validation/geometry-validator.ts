export interface ValidationIssue {
  code: 'SCHEMA_VIOLATION' | 'INVALID_GEOMETRY';
  path: string;
  message: string;
}

interface BoxLike {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function checkBox(box: BoxLike, path: string, issues: ValidationIssue[]): void {
  if (box.x1 >= box.x2) {
    issues.push({ code: 'INVALID_GEOMETRY', path, message: 'x1 must be less than x2' });
  }
  if (box.y1 >= box.y2) {
    issues.push({ code: 'INVALID_GEOMETRY', path, message: 'y1 must be less than y2' });
  }
}

/**
 * Validates semantic normalized bounding-box invariants (x1 < x2, y1 < y2)
 * across all observations and evidence items.
 */
export function validateGeometries(payload: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!payload || typeof payload !== 'object') return issues;
  const event = payload as { observations?: unknown[]; evidence?: unknown[] };
  for (const [index, observation] of (event.observations ?? []).entries()) {
    if (observation && typeof observation === 'object' && 'boundingBox' in observation) {
      const box = (observation as { boundingBox?: BoxLike }).boundingBox;
      if (box) checkBox(box, `/observations/${index}/boundingBox`, issues);
    }
  }
  for (const [index, evidence] of (event.evidence ?? []).entries()) {
    if (evidence && typeof evidence === 'object' && 'boundingBox' in evidence) {
      const box = (evidence as { boundingBox?: BoxLike }).boundingBox;
      if (box) checkBox(box, `/evidence/${index}/boundingBox`, issues);
    }
  }
  return issues;
}
