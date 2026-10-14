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
      <h3 className="font-bold">Zones and cameras</h3>
      {!selected ? (
        <p className="text-sm">No recorded Zone grant for this date.</p>
      ) : (
        <>
          <label className="block text-sm">
            Zone
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
            Recorded grant: {date(selected.validFrom)} – {date(selected.validUntil)}
          </p>
          <div className="rounded-lg bg-[var(--surface-bone)] p-3">
            <strong className="text-sm">Teams related to this Zone</strong>
            <p className="text-xs">
              Zone grants support verification; they do not establish responsibility or presence.
            </p>
            {teams.isPending && <p>Loading teams…</p>}
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
              View Zone alerts ({selected.attentionAlertCount ?? 0})
            </button>
          )}
          {!cameras.length && <p className="text-sm">No current camera linked to this Zone.</p>}
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
                  Configuration: <StatusBadge value={c.status} />
                </span>
                <span className="block text-xs">
                  Related alerts: {c.attentionAlertCount ?? 'Unavailable'}
                </span>
              </button>
            ))}
          </div>
          {current && (
            <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
              <h4 className="font-semibold">{current.name} · Alert evidence</h4>
              <p className="text-xs">
                Current camera link · This is retained evidence, not a live feed.
              </p>
              {!p.canAlerts ? (
                <p className="text-sm">Alert evidence requires Safety or Admin access.</p>
              ) : !ref ? (
                <p className="text-sm">No alert evidence for this camera and date.</p>
              ) : (
                <>
                  <p className="text-xs">Captured {date(ref.capturedAt)}</p>
                  {ref.evidenceIndex === null ? (
                    <p>Evidence unavailable.</p>
                  ) : (
                    <>
                      {image.isPending && <p>Loading evidence…</p>}
                      <RequestError error={image.error} retry={() => void image.refetch()} />
                      {image.data && (
                        <>
                          <BlobImage
                            blob={image.data}
                            alt={'Alert evidence from ' + current.name}
                          />
                          <button className={buttonClass} onClick={() => setZoom(true)}>
                            Enlarge evidence
                          </button>
                        </>
                      )}
                    </>
                  )}
                  <button
                    className={buttonClass}
                    onClick={() => p.onAlerts(selected.id, current.externalId)}
                  >
                    View camera alerts
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
      {zoom && image.data && (
        <Dialog title="Alert evidence" onClose={() => setZoom(false)}>
          <BlobImage blob={image.data} alt={'Alert evidence from ' + current?.name} />
        </Dialog>
      )}
    </article>
  );
}
