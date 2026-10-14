import type { WorkflowProps } from './safety-workflow';
import type { SafetyContractorResponse, SafetyTeamOption } from '@smartsite/api-client';
export const localDay = (d = new Date()) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function dayWindow(day: string) {
  const from = new Date(day + 'T00:00:00');
  const until = new Date(from);
  until.setDate(until.getDate() + 1);
  return { capturedFrom: from.toISOString(), capturedUntil: until.toISOString() };
}
export function localInput(value: string) {
  const d = new Date(value);
  return (
    localDay(d) +
    'T' +
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0')
  );
}
export async function safetyContractors(p: WorkflowProps, signal: AbortSignal) {
  const items: SafetyContractorResponse[] = [];
  let total = 1;
  while (items.length < total) {
    const page = await p.client.listSafetyContractors(
      p.token,
      p.siteId,
      { offset: items.length, limit: 100 },
      { signal },
    );
    total = page.total;
    if (!page.items.length && items.length < total) throw Error('Contractor lookup unavailable');
    items.push(...page.items);
  }
  return items;
}
export async function safetyTeams(
  p: WorkflowProps,
  day: string,
  timezone: string,
  contractorId: string,
  signal: AbortSignal,
) {
  const items: SafetyTeamOption[] = [];
  let total = 1;
  while (items.length < total) {
    const page = await p.client.getSafetyTeamOptions(
      p.token,
      p.siteId,
      {
        date: day,
        timezone,
        contractorId: contractorId || undefined,
        offset: items.length,
        limit: 100,
      },
      { signal },
    );
    total = page.total;
    if (!page.items.length && items.length < total) throw Error('Team lookup unavailable');
    items.push(...page.items);
  }
  return items;
}
export interface RelatedAlertFilter {
  contextTeamId?: string;
  attentionOnly?: boolean;
  zoneId?: string;
  cameraExternalId?: string;
  capturedFrom: string;
  capturedUntil: string;
  caption: string;
}

export interface RelatedChecklistFilter {
  teamId: string;
  fromDate: string;
  toDate: string;
  timezone: string;
  caption: string;
}
export async function overviewContractors(
  p: WorkflowProps,
  day: string,
  timezone: string,
  signal: AbortSignal,
) {
  const items: SafetyContractorResponse[] = [];
  let total = 1;
  while (items.length < total) {
    const page = await p.client.listSafetyOverviewContractors(
      p.token,
      p.siteId,
      { date: day, timezone, offset: items.length, limit: 100 },
      { signal },
    );
    total = page.total;
    if (!page.items.length && items.length < total) throw Error('Contractor lookup unavailable');
    items.push(...page.items);
  }
  return items;
}
