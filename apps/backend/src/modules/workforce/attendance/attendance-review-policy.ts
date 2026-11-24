/** Exit deductions are deterministic; only final early departure may be acknowledged. */
export function canAcknowledgeEarlyCheckout(anomalies: string[]): boolean {
  return (
    anomalies.includes('EARLY_CHECKOUT') &&
    anomalies.every((anomaly) =>
      ['EARLY_CHECKOUT', 'EXIT_DURATION_EXCEEDED', 'MAX_EXITS_EXCEEDED'].includes(anomaly),
    )
  );
}

/** A physical departure before the assigned shift begins is not an early shift exit. */
export function isEarlyShiftExit(
  direction: 'IN' | 'OUT',
  occurredAt: Date,
  startsAt: Date | null,
  endsAt: Date | null,
): boolean {
  return (
    direction === 'OUT' && !!startsAt && !!endsAt && startsAt <= occurredAt && occurredAt < endsAt
  );
}
