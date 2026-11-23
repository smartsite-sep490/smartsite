export type SafetyOperationsView =
  'Overview' | 'Alerts' | 'Incidents' | 'Checklists' | 'Safety Tasks' | 'Documents';

export const safetyOperationTabs = [
  { view: 'Alerts', tab: 'alerts', label: 'labels.ALERTS' },
  { view: 'Incidents', tab: 'incidents', label: 'labels.INCIDENTS' },
  { view: 'Checklists', tab: 'checklists', label: 'labels.CHECKLISTS' },
  { view: 'Safety Tasks', tab: 'tasks', label: 'labels.SAFETY_TASKS' },
] as const;

export function safetyViewFromSearch(
  params: URLSearchParams,
  fallback: SafetyOperationsView = 'Alerts',
): SafetyOperationsView {
  if (params.has('incidentId')) return 'Incidents';
  if (params.has('checklistId')) return 'Checklists';
  if (params.has('alertId')) return 'Alerts';
  return safetyOperationTabs.find((item) => item.tab === params.get('tab'))?.view ?? fallback;
}

export function safetyViewHref(view: SafetyOperationsView, current: URLSearchParams): string {
  const params = new URLSearchParams();
  const site = current.get('siteId');
  if (site) params.set('siteId', site);
  if (view === 'Overview' || view === 'Documents') {
    return (
      (view === 'Overview' ? '/dashboard' : '/worker-documents') + (params.size ? '?' + params : '')
    );
  }
  params.set('tab', safetyOperationTabs.find((item) => item.view === view)?.tab ?? 'alerts');
  return '/incidents?' + params;
}

export function legacySafetyHref(current: URLSearchParams): string | null {
  const tab = current.get('tab');
  if (tab !== 'documents' && tab !== 'overview') return null;
  const params = new URLSearchParams(current);
  params.delete('tab');
  return (
    (tab === 'documents' ? '/worker-documents' : '/dashboard') + (params.size ? '?' + params : '')
  );
}
