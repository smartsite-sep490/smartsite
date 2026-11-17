export function buildFindingReviewHref(siteId: string, alertId: string): string | null {
  const normalizedSiteId = siteId.trim();
  const normalizedAlertId = alertId.trim();
  if (!normalizedSiteId || !normalizedAlertId) {
    return null;
  }
  const search = new URLSearchParams({
    siteId: normalizedSiteId,
    alertId: normalizedAlertId,
  }).toString();
  return `/incidents?${search}`;
}
