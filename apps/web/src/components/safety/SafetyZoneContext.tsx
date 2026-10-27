import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SafetyTeamDetailResponse } from '@smartsite/api-client';
import { type WorkflowProps, cardClass, buttonClass, fieldClass, date } from './safety-workflow';
import {
  RequestError,
  Pager,
  BlobImage,
  Dialog,
  StatusBadge,
  TechnicalDetails,
} from './SafetyWorkflowUi';
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2.5">
        <h3 className="font-bold text-[var(--text-heading)]">
          {tr('safety_workspace.zones_and_cameras')}
        </h3>
        <span className="rounded bg-[var(--surface-bone)] px-2 py-0.5 font-mono text-xs text-[var(--text-secondary)]">
          {p.day} ({p.timezone})
        </span>
      </div>
      {!selected ? (
        <p className="rounded-lg bg-[var(--surface-canvas)] p-3 text-sm text-[var(--text-secondary)]">
          {tr('safety_workspace.no_recorded_zone_grant_for_this_date')}
        </p>
      ) : (
        <>
          <div className="space-y-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-canvas)] p-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <label className="block flex-1 text-sm font-medium text-[var(--text-heading)]">
                {tr('common.zone')}
                <select
                  className={'mt-1.5 ' + fieldClass}
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
              {p.canAlerts && (
                <button className={buttonClass} onClick={() => p.onAlerts(selected.id)}>
                  {tr('safety_workspace.view_zone_alerts_value1', {
                    value1: selected.attentionAlertCount ?? 0,
                  })}
                </button>
              )}
            </div>
            <div className="border-t border-[var(--border)] pt-2">
              <p className="text-xs text-[var(--text-secondary)]">
                {tr('safety_workspace.recorded_grant_value1_value2', {
                  value1: date(selected.validFrom),
                  value2: date(selected.validUntil),
                })}
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg bg-[var(--surface-bone)] p-3">
            <div className="space-y-0.5">
              <strong className="block text-sm text-[var(--text-heading)]">
                {tr('safety_workspace.teams_related_to_this_zone')}
              </strong>
              <p className="text-xs text-[var(--text-secondary)]">
                {tr(
                  'safety_workspace.zone_grants_support_verification_they_do_not_establish_responsibility_or_presence',
                )}
              </p>
            </div>
            {teams.isPending && (
              <p className="text-sm text-[var(--text-secondary)]">
                {tr('safety_workspace.loading_teams')}
              </p>
            )}
            <RequestError error={teams.error} retry={() => void teams.refetch()} />
            {!!teams.data?.items.length && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {teams.data.items.map((t) => (
                  <p
                    key={t.id}
                    className="rounded border border-[var(--border)] bg-[var(--surface-white)] px-2.5 py-1 text-sm text-[var(--text-body)]"
                  >
                    {t.contractorName} · {t.name}
                  </p>
                ))}
              </div>
            )}
            {teams.data && <Pager total={teams.data.total} offset={offset} onChange={setOffset} />}
          </div>

          <div className="space-y-2.5">
            {!cameras.length && (
              <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-canvas)] p-3 text-sm text-[var(--text-secondary)]">
                {tr('safety_workspace.no_current_camera_linked_to_this_zone')}
              </p>
            )}
            <div className="grid gap-2.5 sm:grid-cols-2">
              {cameras.map((c) => {
                const isSelected = current?.id === c.id;
                return (
                  <button
                    key={c.id}
                    aria-pressed={isSelected}
                    className={
                      'space-y-1.5 rounded-lg border p-3 text-left transition-colors ' +
                      (isSelected
                        ? 'border-[var(--accent)] bg-[var(--surface-bone)] ring-1 ring-[var(--accent)]'
                        : 'border-[var(--border)] bg-[var(--surface-white)] hover:bg-[var(--surface-canvas)]')
                    }
                    onClick={() => {
                      setCamera(c.id);
                      setZoom(false);
                    }}
                  >
                    <strong className="block text-sm text-[var(--text-heading)]">{c.name}</strong>
                    <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      {tr('safety_workspace.configuration')}
                      <StatusBadge value={c.status} />
                    </span>
                    <span className="block text-xs font-medium text-[var(--text-body)]">
                      {tr('safety_workspace.related_alerts_value1', {
                        value1: c.attentionAlertCount ?? tr('labels.UNAVAILABLE'),
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {current && (
            <div className="space-y-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-canvas)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
                <div>
                  <h4 className="font-semibold text-[var(--text-heading)]">
                    {tr('safety_workspace.value1_alert_evidence', { value1: current.name })}
                  </h4>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {tr(
                      'safety_workspace.current_camera_link_this_is_retained_evidence_not_a_live_feed',
                    )}
                  </p>
                </div>
                {p.canAlerts && ref && (
                  <button
                    className={buttonClass}
                    onClick={() => p.onAlerts(selected.id, current.externalId)}
                  >
                    {tr('safety_workspace.view_camera_alerts')}
                  </button>
                )}
              </div>
              {!p.canAlerts ? (
                <p className="rounded-md bg-[var(--surface-bone)] p-2.5 text-sm text-[var(--text-secondary)]">
                  {tr('safety_workspace.alert_evidence_requires_safety_or_admin_access')}
                </p>
              ) : !ref ? (
                <p className="rounded-md bg-[var(--surface-bone)] p-2.5 text-sm text-[var(--text-secondary)]">
                  {tr('safety_workspace.no_alert_evidence_for_this_camera_and_date')}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--text-secondary)]">
                    {tr('safety_workspace.captured_value1', { value1: date(ref.capturedAt) })}
                  </p>
                  {ref.evidenceIndex === null ? (
                    <p className="text-sm text-[var(--text-secondary)]">
                      {tr('safety_workspace.evidence_unavailable')}
                    </p>
                  ) : (
                    <>
                      {image.isPending && (
                        <p className="text-sm text-[var(--text-secondary)]">
                          {tr('safety_workspace.loading_evidence')}
                        </p>
                      )}
                      <RequestError error={image.error} retry={() => void image.refetch()} />
                      {image.data && (
                        <div className="space-y-2">
                          <BlobImage
                            blob={image.data}
                            alt={tr('safety_workspace.alert_evidence_from_value1', {
                              value1: current.name,
                            })}
                          />
                          <button className={buttonClass} onClick={() => setZoom(true)}>
                            {tr('safety_workspace.enlarge_evidence')}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
      <TechnicalDetails>
        <dl className="grid gap-1 font-mono">
          <div className="flex flex-wrap gap-2">
            <dt className="font-semibold">{tr('common.site')}</dt>
            <dd>{p.siteId || tr('labels.UNAVAILABLE')}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="font-semibold">{tr('common.code')}:</dt>
            <dd>{selected?.code ?? tr('labels.UNAVAILABLE')}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="font-semibold">{tr('common.camera')}:</dt>
            <dd>{current?.externalId ?? tr('labels.UNAVAILABLE')}</dd>
          </div>
        </dl>
      </TechnicalDetails>
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
