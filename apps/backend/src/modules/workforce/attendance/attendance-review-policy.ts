/** Exit deductions are deterministic; only final early departure may be acknowledged. */
export function canAcknowledgeEarlyCheckout(anomalies: string[]): boolean {
  return (
    anomalies.includes('EARLY_CHECKOUT') &&
    anomalies.every((anomaly) =>
      ['EARLY_CHECKOUT', 'EXIT_DURATION_EXCEEDED', 'MAX_EXITS_EXCEEDED'].includes(anomaly),
    )
  );
}
