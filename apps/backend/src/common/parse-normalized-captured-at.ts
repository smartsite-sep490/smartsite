/** Matches ingestion normalization while preserving the original timestamp in raw evidence. */
export function parseNormalizedCapturedAt(dateString: string): Date | null {
  if (!dateString || typeof dateString !== 'string') return null;
  const normalized = dateString
    .trim()
    .replace(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):60(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i,
      (_match, prefix, fraction, tz) => `${prefix}:59${fraction ?? ''}${tz ?? ''}`,
    );
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
