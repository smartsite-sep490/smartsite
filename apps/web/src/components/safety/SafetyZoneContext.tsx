import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SafetyTeamDetailResponse } from '@smartsite/api-client';
import { type WorkflowProps, cardClass, buttonClass, date } from './safety-workflow';
import { RequestError, Pager, BlobImage, Dialog, StatusBadge } from './SafetyWorkflowUi';
export function SafetyZoneContext(
  p: WorkflowProps & {
    detail: SafetyTeamDetailResponse;
    day: string;
    timezone: string;
    active: boolean;
    canAlerts: boolean;
    onAlerts: (zoneId?: string, camera?: string) => void;
  },
) {
  useTranslation();

  const [zone, setZone] = useState(''),
    [camera, setCamera] = useState(''),
    [offset, setOffset] = useState(0),
    [zoom, setZoom] = useState(false);
  const selected = p.detail.zones.find((z) => z.id === zone) ?? p.detail.zones[0];
  const cameras = p.detail.cameras.filter((c) => c.zoneId === selected?.id),
    current = cameras.find((c) => c.id === camera) ?? cameras[0],
    ref = current?.latestEvidence;
  const teams = useQuery({
    queryKey: [
      'safety-workflow',
      p.apiUrl,
      p.scope,
      p.siteId,
      'zone-teams',
      selected?.id,
      p.day,
      p.timezone,
      offset,
    ],
    queryFn: ({ signal }) =>
      p.client.listSafetyZoneTeams(
        p.token,
        p.siteId,
        selected!.id,
        { date: p.day, timezone: p.timezone, offset, limit: 20 },
        { signal },
      ),
    enabled: p.active && !!selected,
    retry: false,
  });
  const image = useQuery({
    queryKey: [
      'safety-workflow',
      p.apiUrl,
      p.scope,
      p.siteId,
      'camera-evidence',
      current?.id,
      selected?.id,
      p.day,
      ref?.eventId,
      ref?.evidenceIndex,
    ],
    queryFn: ({ signal }) =>
      p.client.getSafetyAlertEvidence(
        p.token,
        p.siteId,
        ref!.alertId,
        ref!.eventId,
        ref!.evidenceIndex!,
        { signal },
      ),
    enabled:
      p.active && p.canAlerts && ref?.evidenceIndex !== undefined && ref?.evidenceIndex !== null,
    retry: false,
  });
  return (
    <article className={cardClass}>
      <h3 className="font-bold">{tr('safety_workspace.zones_and_cameras')}</h3>
      {!selected ? (
        <p className="text-sm">{tr('safety_workspace.no_recorded_zone_grant_for_this_date')}</p>
      ) : (
        <>
          <label className="block text-sm">
            {tr('common.zone')}
            <select
              className="mt-2 w-full rounded-lg border p-2"
              value={selected.id}
              onChange={(e) => {
                setZone(e.target.value);
                setCamera('');
                setOffset(0);
                setZoom(false);
              }}
            >
              {p.detail.zones.map((z) => (
                <option key={z.id + z.validFrom} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-[var(--text-secondary)]">
            {tr('safety_workspace.recorded_grant_value1_value2', {
              value1: date(selected.validFrom),
              value2: date(selected.validUntil),
            })}
          </p>
          <div className="rounded-lg bg-[var(--surface-bone)] p-3">
            <strong className="text-sm">{tr('safety_workspace.teams_related_to_this_zone')}</strong>
            <p className="text-xs">
              {tr(
                'safety_workspace.zone_grants_support_verification_they_do_not_establish_responsibility_or_presence',
              )}
            </p>
            {teams.isPending && <p>{tr('safety_workspace.loading_teams')}</p>}
            <RequestError error={teams.error} retry={() => void teams.refetch()} />
            {teams.data?.items.map((t) => (
              <p key={t.id} className="text-sm">
                {t.contractorName} · {t.name}
              </p>
            ))}
            {teams.data && <Pager total={teams.data.total} offset={offset} onChange={setOffset} />}
          </div>
          {p.canAlerts && (
            <button className={buttonClass} onClick={() => p.onAlerts(selected.id)}>
              {tr('safety_workspace.view_zone_alerts_value1', {
                value1: selected.attentionAlertCount ?? 0,
              })}
            </button>
          )}
          {!cameras.length && (
            <p className="text-sm">
              {tr('safety_workspace.no_current_camera_linked_to_this_zone')}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {cameras.map((c) => (
              <button
                key={c.id}
                aria-pressed={current?.id === c.id}
                className={
                  'rounded-lg border p-3 text-left ' +
                  (current?.id === c.id ? 'border-[var(--accent)]' : 'border-[var(--border)]')
                }
                onClick={() => {
                  setCamera(c.id);
                  setZoom(false);
                }}
              >
                <strong className="block text-sm">{c.name}</strong>
                <span className="text-xs">
                  {tr('safety_workspace.configuration')}
                  <StatusBadge value={c.status} />
                </span>
                <span className="block text-xs">
                  {tr('safety_workspace.related_alerts_value1', {
                    value1: c.attentionAlertCount ?? tr('labels.UNAVAILABLE'),
                  })}
                </span>
              </button>
            ))}
          </div>
          {current && (
            <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
              <h4 className="font-semibold">
                {tr('safety_workspace.value1_alert_evidence', { value1: current.name })}
              </h4>
              <p className="text-xs">
                {tr(
                  'safety_workspace.current_camera_link_this_is_retained_evidence_not_a_live_feed',
                )}
              </p>
              {!p.canAlerts ? (
                <p className="text-sm">
                  {tr('safety_workspace.alert_evidence_requires_safety_or_admin_access')}
                </p>
              ) : !ref ? (
                <p className="text-sm">
                  {tr('safety_workspace.no_alert_evidence_for_this_camera_and_date')}
                </p>
              ) : (
                <>
                  <p className="text-xs">
                    {tr('safety_workspace.captured_value1', { value1: date(ref.capturedAt) })}
                  </p>
                  {ref.evidenceIndex === null ? (
                    <p>{tr('safety_workspace.evidence_unavailable')}</p>
                  ) : (
                    <>
                      {image.isPending && <p>{tr('safety_workspace.loading_evidence')}</p>}
                      <RequestError error={image.error} retry={() => void image.refetch()} />
                      {image.data && (
                        <>
                          <BlobImage
                            blob={image.data}
                            alt={tr('safety_workspace.alert_evidence_from_value1', {
                              value1: current.name,
                            })}
                          />
                          <button className={buttonClass} onClick={() => setZoom(true)}>
                            {tr('safety_workspace.enlarge_evidence')}
                          </button>
                        </>
                      )}
                    </>
                  )}
                  <button
                    className={buttonClass}
                    onClick={() => p.onAlerts(selected.id, current.externalId)}
                  >
                    {tr('safety_workspace.view_camera_alerts')}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
      {zoom && image.data && (
        <Dialog title={tr('safety_workspace.alert_evidence')} onClose={() => setZoom(false)}>
          <BlobImage
            blob={image.data}
            alt={tr('safety_workspace.alert_evidence_from_value1', { value1: current?.name })}
          />
        </Dialog>
      )}
    </article>
  );
}
