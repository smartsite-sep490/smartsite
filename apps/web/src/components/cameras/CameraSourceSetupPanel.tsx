import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_BUTTON_STYLES, CAMERA_FIELD_STYLES } from './camera-dialog-styles';
import {
  cameraSourceClient,
  SourceSetupError,
  type CameraSourceClient,
  type CameraSourceDraft,
  type CameraSourceKind,
  type SourceTestResult,
} from '@smartsite/api-client';
import './camera-source-copy';
import {
  useCameraSourceResumeController,
  type CameraSourceResumeController,
} from './useCameraSourceResumeController';

export interface CameraSourceSetupProps {
  apiUrl: string;
  token: string;
  siteId: string;
  camera: {
    id: string;
    name: string;
    configurationVersion?: number;
    status?: 'ACTIVE' | 'INACTIVE';
  };
  setupKey: readonly unknown[];
  canWrite: boolean;
  onUnauthorized: () => void;
  onOpenRegions?: () => void;
  client?: CameraSourceClient;
  embedded?: boolean;
  resumeController?: CameraSourceResumeController;
}

function isValidRtspEndpoint(raw: string): boolean {
  if (!raw || /[\s\p{Cc}]/u.test(raw)) return false;
  const match = /^rtsps?:\/\/([^/?#]+)/i.exec(raw);
  if (!match) return false;
  const authority = match[1] ?? '';
  if (!authority || authority.includes('@')) return false;
  return true;
}

export function CameraSourceSetupPanel(props: CameraSourceSetupProps) {
  // Scope replacement unmounts the old draft and aborts any secret-bearing request.
  return (
    <SourceWorkspace
      key={JSON.stringify([props.setupKey, props.siteId, props.camera.id])}
      {...props}
    />
  );
}
function SourceWorkspace({
  apiUrl,
  token,
  siteId,
  camera,
  setupKey,
  canWrite,
  onUnauthorized,
  onOpenRegions,
  client = cameraSourceClient,
  embedded = false,
  resumeController: externalController,
}: CameraSourceSetupProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE),
    id = useId();
  const [kind, setKind] = useState<CameraSourceKind | 'BROWSER'>('WEBCAM');
  const [device, setDevice] = useState(''),
    [asset, setAsset] = useState(''),
    [endpoint, setEndpoint] = useState('');
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const [pending, setPending] = useState(false),
    [result, setResult] = useState<SourceTestResult | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [error, setError] = useState(''),
    [now, setNow] = useState(() => Date.now());
  const operation = useRef<{ version: number; abort?: AbortController }>({ version: 0 });
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const hostSelectRef = useRef<HTMLSelectElement>(null);
  const cache = useQueryClient();

  const internalController = useCameraSourceResumeController({
    apiUrl,
    token,
    siteId,
    camera,
    setupKey,
    canWrite,
    enabled: !externalController,
    onUnauthorized,
    client,
  });
  const controller = externalController ?? internalController;
  const {
    hosts,
    hostAccessDenied,
    availableHosts,
    hostId,
    host,
    caps,
    selectHostId,
    resuming,
    revoked,
    markRevoked,
    setSourceBusy,
    refreshingCaps,
    refreshHosts,
    onSourceApplied,
    triggerResume,
  } = controller;

  const isCameraInactive = camera.status === 'INACTIVE';

  const applying = useMutation({
    mutationFn: async () => {
      if (
        isCameraInactive ||
        hosts.isError ||
        !host?.available ||
        !result ||
        result.sourceKind !== 'LIVE' ||
        !caps?.applySupported ||
        !client.apply ||
        resuming.isPending ||
        now >= Date.parse(result.expiresAt)
      )
        throw new SourceSetupError(409);
      return client.apply(
        apiUrl,
        token,
        siteId,
        camera.id,
        hostId,
        {
          commandId: crypto.randomUUID(),
          receiptId: result.receiptId,
          expectedRevision: caps.sourceRevision ?? 0,
        },
        new AbortController().signal,
      );
    },
    retry: false,
    onSuccess: () => {
      setConfirmApply(false);
      setPassword('');
      onSourceApplied();
      void cache.invalidateQueries({
        predicate: (q) =>
          q.queryKey.includes(siteId) && !q.queryKey.includes('camera-source-hosts'),
      });
    },
    onError: (e) => {
      setConfirmApply(false);
      if (e instanceof SourceSetupError && [401, 403].includes(e.status)) {
        markRevoked();
        setPassword('');
        onUnauthorized();
      }
    },
  });

  useEffect(() => {
    setSourceBusy(pending || applying.isPending);
    return () => {
      setSourceBusy(false);
    };
  }, [pending, applying.isPending, setSourceBusy]);

  const displayedPassword = resuming.isSuccess || revoked ? '' : password;

  useEffect(
    () => () => {
      operation.current.version++;
      operation.current.abort?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!result) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [result]);
  useEffect(() => {
    if (hostAccessDenied) {
      operation.current.version++;
      operation.current.abort?.abort();
    }
  }, [hostAccessDenied]);
  const supported = kind !== 'BROWSER' && host?.available && caps?.sourceKinds.includes(kind);
  const reset = () => {
    operation.current.version++;
    operation.current.abort?.abort();
    setPending(false);
    setResult(null);
    setConfirmApply(false);
    setError('');
  };
  const change = (update: () => void) => {
    if (applying.isPending || resuming.isPending) return;
    reset();
    applying.reset();
    update();
  };
  const trimmedEndpoint = endpoint.trim();
  const rtspInvalid =
    kind === 'RTSP' && trimmedEndpoint.length > 0 && !isValidRtspEndpoint(trimmedEndpoint);
  const draft: CameraSourceDraft | null =
    kind === 'WEBCAM' && device
      ? { kind, deviceId: device }
      : kind === 'VIDEO' && asset
        ? { kind, assetId: asset }
        : kind === 'RTSP' && trimmedEndpoint && !rtspInvalid
          ? {
              kind,
              endpoint: trimmedEndpoint,
              ...(username || password ? { username, password } : {}),
            }
          : null;
  const canTest = Boolean(
    canWrite &&
    !revoked &&
    !hosts.isError &&
    supported &&
    draft &&
    !pending &&
    !applying.isPending &&
    !resuming.isPending,
  );
  async function test() {
    if (!canTest || !draft) return;
    applying.reset();
    reset();
    const version = operation.current.version,
      abort = new AbortController();
    operation.current.abort = abort;
    setPending(true);
    try {
      const value = await client.probe(
        apiUrl,
        token,
        siteId,
        camera.id,
        hostId,
        draft,
        abort.signal,
      );
      if (operation.current.version !== version || abort.signal.aborted) return;
      setResult(value);
      setNow(Date.now());
    } catch (e) {
      if (operation.current.version !== version || abort.signal.aborted) return;
      const status = e instanceof SourceSetupError ? e.status : undefined;
      if (status === 401 || status === 403) {
        markRevoked();
        setPassword('');
        setError('cameraSource.forbidden');
        if (status === 401) onUnauthorized();
      } else setError(status === 409 ? 'cameraSource.busy' : 'cameraSource.error');
    } finally {
      if (operation.current.version === version) setPending(false);
    }
  }
  const blocked = revoked || !canWrite || applying.isPending || resuming.isPending;
  if (hostAccessDenied || revoked) {
    return (
      <section
        role="alert"
        className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
      >
        {t('cameraSource.forbidden')}
      </section>
    );
  }
  const activeResult = result && host?.available && !hosts.isError ? result : null;
  const isExpired = Boolean(activeResult && now >= Date.parse(activeResult.expiresAt));
  const remainingSeconds =
    activeResult && !isExpired
      ? Math.max(1, Math.ceil((Date.parse(activeResult.expiresAt) - now) / 1000))
      : 0;
  const stage2Tone = pending
    ? { dot: 'bg-teal-600', text: 'text-teal-900', key: 'cameraSource.stage2Pending' as const }
    : activeResult
      ? isExpired
        ? {
            dot: 'bg-rose-600',
            text: 'text-rose-800',
            key: 'cameraSource.stage2Expired' as const,
          }
        : activeResult.sourceKind === 'REPLAY'
          ? {
              dot: 'bg-amber-600',
              text: 'text-amber-900',
              key: 'cameraSource.stage2Replay' as const,
            }
          : {
              dot: 'bg-emerald-600',
              text: 'text-emerald-800',
              key: 'cameraSource.stage2Live' as const,
            }
      : error
        ? { dot: 'bg-rose-600', text: 'text-rose-800', key: 'cameraSource.stage2Error' as const }
        : { dot: 'bg-slate-400', text: 'text-slate-700', key: 'cameraSource.stage2Idle' as const };
  const stage4Status = applying.isSuccess
    ? {
        dot: 'bg-emerald-600',
        text: 'text-emerald-800',
        key: 'cameraSource.stage4Running' as const,
      }
    : resuming.isSuccess
      ? { dot: 'bg-teal-600', text: 'text-teal-900', key: 'cameraSource.stage4Resumed' as const }
      : activeResult?.sourceKind === 'REPLAY' && !isExpired
        ? {
            dot: 'bg-amber-600',
            text: 'text-amber-900',
            key: 'cameraSource.stage4ReplayLocked' as const,
          }
        : {
            dot: 'bg-slate-400',
            text: 'text-slate-700',
            key: 'cameraSource.stage4CheckBelow' as const,
          };

  const stageSummaryList = (
    <dl
      data-testid="camera-source-stage-summary"
      aria-label={t('cameraSource.stagesLabel')}
      className="grid grid-cols-1 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/40 sm:grid-cols-2 sm:divide-x [&>*:nth-child(odd)]:sm:divide-y-0 [&>*:nth-child(n+3)]:sm:border-t [&>*:nth-child(n+3)]:sm:border-slate-200"
    >
      <div className="min-w-0 px-3.5 py-2.5 space-y-1">
        <dt className="text-xs font-medium text-slate-600">{t('cameraSource.stage1Label')}</dt>
        <dd className="flex items-start gap-2 text-sm font-semibold text-slate-900 tabular-nums">
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#0F172A]" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {t('cameraSource.stage1Done', {
              name: camera.name,
              version: camera.configurationVersion ?? 0,
            })}
          </span>
        </dd>
        <p className="text-xs leading-5 text-slate-600">{t('cameraSource.stage1MetaOnly')}</p>
      </div>
      <div className="min-w-0 px-3.5 py-2.5 space-y-1">
        <dt className="text-xs font-medium text-slate-600">{t('cameraSource.stage2Label')}</dt>
        <dd className={`flex items-start gap-2 text-sm font-semibold ${stage2Tone.text}`}>
          <span
            aria-hidden="true"
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${stage2Tone.dot}`}
          />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{t(stage2Tone.key)}</span>
        </dd>
      </div>
      <div className="min-w-0 px-3.5 py-2.5 space-y-1">
        <dt className="text-xs font-medium text-slate-600">{t('cameraSource.stage3Label')}</dt>
        <dd className="flex items-start gap-2 text-sm font-semibold text-slate-900 tabular-nums">
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-600" />
          <span>
            {t('cameraSource.stage3Value', { version: camera.configurationVersion ?? 0 })}
          </span>
        </dd>
        <p className="text-xs leading-5 text-slate-600">{t('cameraSource.stage3Note')}</p>
      </div>
      <div className="min-w-0 px-3.5 py-2.5 space-y-1">
        <dt className="text-xs font-medium text-slate-600">{t('cameraSource.stage4Label')}</dt>
        <dd
          className={`flex items-start gap-2 text-sm font-semibold tabular-nums ${stage4Status.text}`}
        >
          <span
            aria-hidden="true"
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${stage4Status.dot}`}
          />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {t(stage4Status.key, { version: camera.configurationVersion ?? 0 })}
          </span>
        </dd>
      </div>
    </dl>
  );

  const hasConfiguredHosts = Boolean(hosts.data && hosts.data.length > 0);
  const hasAvailableHost = availableHosts.length > 0;
  const hasUsableHost = Boolean(!hosts.isPending && !hosts.isError && hasAvailableHost);
  const allHostsOffline = Boolean(hasConfiguredHosts && !hasAvailableHost);
  const isEmptyHostList = Boolean(!hosts.isPending && !hosts.isError && hosts.data?.length === 0);
  const hasMultipleHosts = (hosts.data?.length ?? 0) > 1;
  const hasMultipleUsableHosts = availableHosts.length > 1;
  const needsHostSelection = hasMultipleUsableHosts && !hostId;
  const unavailableHosts = hosts.data?.filter((entry) => !entry.available) ?? [];
  const allCameraUnbound =
    unavailableHosts.length > 0 &&
    unavailableHosts.every((entry) => entry.reason === 'CAMERA_UNBOUND');
  const allAgentUnavailable =
    unavailableHosts.length > 0 &&
    unavailableHosts.every((entry) => entry.reason === 'AGENT_UNAVAILABLE');
  const unavailableGate = allCameraUnbound
    ? {
        state: 'unbound' as const,
        headingKey: 'cameraSource.unboundHeading' as const,
        bodyKey: 'cameraSource.unboundBody' as const,
      }
    : allAgentUnavailable
      ? {
          state: 'agent-unavailable' as const,
          headingKey: 'cameraSource.agentUnavailableHeading' as const,
          bodyKey: 'cameraSource.agentUnavailableBody' as const,
        }
      : {
          state: 'unavailable' as const,
          headingKey: 'cameraSource.allHostsOfflineHeading' as const,
          bodyKey: 'cameraSource.allHostsOffline' as const,
        };
  const selectedUnavailableKey =
    host?.reason === 'CAMERA_UNBOUND'
      ? ('cameraSource.unboundSelected' as const)
      : host?.reason === 'AGENT_UNAVAILABLE'
        ? ('cameraSource.agentUnavailableSelected' as const)
        : ('cameraSource.unavailable' as const);

  const connectionStatus =
    hosts.isPending || pending || applying.isPending
      ? {
          state: 'checking' as const,
          dot: 'bg-teal-600 animate-pulse',
          pill: 'border-teal-200 bg-teal-50 text-teal-900',
          key: 'cameraSource.statusChecking' as const,
        }
      : applying.isSuccess
        ? {
            state: 'activation-acknowledged' as const,
            dot: 'bg-teal-600',
            pill: 'border-teal-200 bg-teal-50 text-teal-900',
            key: 'cameraSource.statusConnected' as const,
          }
        : activeResult && !isExpired
          ? {
              state: 'tested' as const,
              dot: 'bg-sky-600',
              pill: 'border-sky-200 bg-sky-50 text-sky-900',
              key: 'cameraSource.statusTested' as const,
            }
          : {
              state: 'not-checked' as const,
              dot: 'bg-slate-400',
              pill: 'border-slate-200 bg-slate-50 text-slate-700',
              key: 'cameraSource.statusNotConnected' as const,
            };

  const hasLiveApplyCta = Boolean(
    activeResult &&
    !isExpired &&
    activeResult.sourceKind === 'LIVE' &&
    !isCameraInactive &&
    !hosts.isError &&
    caps?.applySupported &&
    canWrite &&
    !applying.isSuccess,
  );

  const openConnectionDetailsAndFocus = () => {
    if (detailsRef.current) {
      detailsRef.current.open = true;
    }
    hostSelectRef.current?.focus();
  };

  const renderSourceOption = (
    option: CameraSourceKind | 'BROWSER',
    secondary = false,
    badgeKey?: 'cameraSource.badgeUnavailable' | 'cameraSource.badgeReplay',
  ) => (
    <label
      key={option}
      className={`min-w-0 cursor-pointer rounded-lg border px-2.5 py-1.5 transition-colors focus-within:ring-2 focus-within:ring-[#0F172A] ${
        kind === option
          ? 'border-[#0F172A] bg-slate-50 ring-1 ring-[#0F172A]/10'
          : secondary
            ? 'border-slate-200/90 bg-slate-50/45 hover:border-slate-300 hover:bg-white'
            : 'border-slate-200 bg-white hover:border-slate-400'
      }`}
    >
      <span className="flex items-start gap-2">
        <input
          className="mt-0.5 shrink-0 accent-[#0F172A]"
          type="radio"
          name={`${id}-kind`}
          checked={kind === option}
          onChange={() =>
            change(() => {
              setKind(option);
              setPassword('');
            })
          }
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs sm:text-sm font-semibold leading-snug text-slate-950">
              {t(`cameraSource.${option}`)}
            </span>
            {badgeKey && (
              <span
                className={`inline-flex items-center rounded-md border px-1.5 text-[11px] leading-4 font-medium ${
                  option === 'BROWSER'
                    ? 'border-amber-200 bg-amber-50/90 text-amber-900'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {t(badgeKey)}
              </span>
            )}
          </span>
          <span className="block text-xs leading-snug text-slate-600">
            {t(`cameraSource.${option}Help`)}
          </span>
        </span>
      </span>
    </label>
  );

  return (
    <section
      data-testid="camera-source-setup-panel"
      className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white"
      aria-labelledby={`${id}-heading`}
    >
      <header
        className={
          embedded
            ? 'border-b border-slate-200/80 px-4 py-2.5'
            : 'border-b border-slate-200 px-4 py-3.5 sm:px-5'
        }
      >
        {!embedded && (
          <p className="text-sm font-semibold text-slate-700 tabular-nums">{camera.name}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2
              id={`${id}-heading`}
              className={
                embedded
                  ? 'text-sm sm:text-base font-bold tracking-tight text-slate-950'
                  : 'mt-0.5 text-lg font-bold tracking-tight text-slate-950'
              }
            >
              {t('cameraSource.title')}
            </h2>
            <span
              data-testid="camera-source-connection-status"
              data-connection-status={connectionStatus.state}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${connectionStatus.pill}`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${connectionStatus.dot}`}
              />
              {t(connectionStatus.key)}
            </span>
            {isCameraInactive && (
              <span
                data-testid="camera-source-inactive-badge"
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                {t(
                  hasUsableHost
                    ? 'cameraSource.inactiveBadge'
                    : 'cameraSource.inactiveBadgeBlocked',
                )}
              </span>
            )}
            {embedded && hasUsableHost && (
              <span className="hidden md:inline text-xs text-slate-500">
                {t('cameraSource.stepFlowHint')}
              </span>
            )}
          </div>
          {embedded && (
            <details
              data-testid="camera-source-stages-disclosure"
              className="group min-w-0 text-xs text-slate-600"
            >
              <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
                <span>{t('cameraSetup.sourceStageSummaryDisclosure')}</span>
                <span
                  aria-hidden="true"
                  className="text-xs text-slate-400 transition-transform duration-150 group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <div className="mt-2">{stageSummaryList}</div>
            </details>
          )}
        </div>
        {!embedded && (
          <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-slate-600">
            {t('cameraSource.intro')}
          </p>
        )}
      </header>
      <div className={embedded ? 'space-y-2.5 px-3.5 py-2.5' : 'space-y-4 p-4 sm:p-5'}>
        {isCameraInactive && !embedded && (
          <p
            role="status"
            data-testid="camera-source-inactive-notice"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs sm:text-sm leading-snug text-slate-700"
          >
            {t(
              hasUsableHost
                ? 'cameraSource.inactivePrepNotice'
                : 'cameraSource.inactiveBlockedNotice',
            )}
          </p>
        )}
        {!embedded && stageSummaryList}

        {hosts.isPending ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="camera-source-host-loading"
            className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-700"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-slate-400"
            />
            <p className="min-w-0 leading-relaxed">{t('cameraSource.loading')}</p>
          </div>
        ) : hosts.isError ? (
          <div
            role="alert"
            data-testid="camera-source-host-prerequisite"
            data-host-state="error"
            className="min-w-0 space-y-3 rounded-xl border border-rose-200 border-l-[3px] border-l-rose-600 bg-rose-50/80 p-4 text-rose-950"
          >
            <div className="space-y-1">
              <h3 className="text-sm font-semibold tracking-tight text-rose-950">
                {t('cameraSource.hostFetchErrorHeading')}
              </h3>
              <p className="max-w-[65ch] text-sm leading-relaxed text-rose-900 break-words">
                {t('cameraSource.hostFetchError')}
              </p>
            </div>
            <div>
              <button
                type="button"
                className={CAMERA_BUTTON_STYLES.compactSecondary}
                disabled={hosts.isFetching || pending || applying.isPending}
                onClick={() => {
                  reset();
                  void refreshHosts();
                }}
              >
                {t(hosts.isFetching ? 'cameraSource.refreshing' : 'cameraSource.retryHosts')}
              </button>
            </div>
          </div>
        ) : isEmptyHostList ? (
          <div
            role="status"
            data-testid="camera-source-host-prerequisite"
            data-host-state="empty"
            className="min-w-0 space-y-3 rounded-xl border border-amber-200/90 border-l-[3px] border-l-amber-600 bg-amber-50/60 p-4 text-amber-950"
          >
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-amber-900/80">
                {t('cameraSource.prerequisiteLabel')}
              </p>
              <h3 className="text-sm font-semibold tracking-tight text-slate-950">
                {t('cameraSource.noHostsHeading')}
              </h3>
              <p className="max-w-[65ch] text-sm leading-relaxed text-slate-700 break-words">
                {t('cameraSource.noHosts')}
              </p>
            </div>
            <div>
              <button
                type="button"
                className={CAMERA_BUTTON_STYLES.secondary}
                disabled={hosts.isFetching || pending || applying.isPending}
                onClick={() => {
                  reset();
                  void refreshHosts();
                }}
              >
                {t(hosts.isFetching ? 'cameraSource.refreshing' : 'cameraSource.refresh')}
              </button>
            </div>
          </div>
        ) : allHostsOffline ? (
          <div
            role="status"
            data-testid="camera-source-host-prerequisite"
            data-host-state={unavailableGate.state}
            className="min-w-0 space-y-3 rounded-xl border border-amber-200/90 border-l-[3px] border-l-amber-600 bg-amber-50/60 p-4 text-amber-950"
          >
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-amber-900/80">
                {t('cameraSource.prerequisiteLabel')}
              </p>
              <h3 className="text-sm font-semibold tracking-tight text-slate-950">
                {t(unavailableGate.headingKey)}
              </h3>
              <p
                data-testid="camera-source-prerequisite-message"
                className="max-w-[65ch] text-sm leading-relaxed text-slate-700 break-words"
              >
                {t(unavailableGate.bodyKey)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={CAMERA_BUTTON_STYLES.secondary}
                disabled={hosts.isFetching || pending || applying.isPending}
                onClick={() => {
                  reset();
                  void refreshHosts();
                }}
              >
                {t(hosts.isFetching ? 'cameraSource.refreshing' : 'cameraSource.refresh')}
              </button>
            </div>
            <details
              data-testid="camera-source-unavailable-details"
              className="group min-w-0 rounded-lg border border-amber-200/80 bg-white/80 px-3 py-2 text-xs text-slate-700"
            >
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md py-0.5 font-medium text-slate-700 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
                <span>{t('cameraSource.technicalDetailsToggle')}</span>
                <span
                  aria-hidden="true"
                  className="text-xs text-slate-400 transition-transform duration-150 group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <ul className="mt-2 space-y-1.5 border-t border-slate-200 pt-2">
                {unavailableHosts.map((entry) => (
                  <li key={entry.id} className="min-w-0 break-words leading-relaxed">
                    <span className="font-semibold text-slate-900">{entry.label}</span>{' '}
                    <span className="font-mono text-[11px] text-slate-500">({entry.id})</span>
                    {' — '}
                    <span>
                      {t(
                        entry.reason === 'CAMERA_UNBOUND'
                          ? 'cameraSource.reasonDetail.CAMERA_UNBOUND'
                          : entry.reason === 'AGENT_UNAVAILABLE'
                            ? 'cameraSource.reasonDetail.AGENT_UNAVAILABLE'
                            : 'cameraSource.reasonDetail.UNKNOWN',
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ) : (
          <>
            <fieldset className="min-w-0 space-y-2" disabled={blocked}>
              <legend className="sr-only">{t('cameraSource.title')}</legend>
              <div data-testid="camera-source-group-live" className="space-y-1">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  {t('cameraSource.groupLive')}
                </p>
                <div className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {renderSourceOption('WEBCAM')}
                  {renderSourceOption('RTSP')}
                </div>
              </div>
              <div data-testid="camera-source-group-secondary" className="space-y-1">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  {t('cameraSource.groupSecondary')}
                </p>
                <div className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {renderSourceOption('BROWSER', true, 'cameraSource.badgeUnavailable')}
                  {renderSourceOption('VIDEO', true, 'cameraSource.badgeReplay')}
                </div>
              </div>
            </fieldset>
            {kind === 'BROWSER' ? (
              <div
                role="status"
                data-testid="camera-source-browser-unavailable"
                className="space-y-1 rounded-xl border border-amber-200 border-l-[3px] border-l-amber-600 bg-amber-50/70 px-3.5 py-2.5 text-sm text-amber-950"
              >
                <p className="font-semibold text-slate-950">
                  {t('cameraSource.browserUnavailableHeading')}
                </p>
                <p className="max-w-[70ch] text-xs sm:text-sm leading-relaxed text-slate-700">
                  {t('cameraSource.browserUnavailable')}
                </p>
              </div>
            ) : (
              <>
                {needsHostSelection && (
                  <div
                    role="status"
                    data-testid="camera-source-host-choice-required"
                    className="flex min-w-0 flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-200/90 border-l-[3px] border-l-amber-600 bg-amber-50/60 px-3.5 py-2.5 text-sm text-slate-800"
                  >
                    <p className="min-w-0 flex-1 leading-relaxed break-words">
                      {t('cameraSource.multipleHostsPrompt')}
                    </p>
                    <button
                      type="button"
                      className={CAMERA_BUTTON_STYLES.compactSecondary}
                      disabled={blocked}
                      onClick={openConnectionDetailsAndFocus}
                    >
                      {t('cameraSource.chooseConnectionAction')}
                    </button>
                  </div>
                )}
                {host && !host.available && !allHostsOffline && (
                  <p role="status" className="text-sm text-amber-900">
                    {t(selectedUnavailableKey)}
                  </p>
                )}
                {host?.available && caps && caps.applySupported === false && (
                  <p
                    role="status"
                    data-testid="camera-source-test-only-note"
                    className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs leading-relaxed text-slate-700"
                  >
                    {t('cameraSource.testOnlyNote')}
                  </p>
                )}
                {host?.available && !supported && (
                  <p role="status" className="text-sm text-amber-900">
                    {t('cameraSource.unsupported')}
                  </p>
                )}
                {supported && (
                  <div className="max-w-3xl space-y-2.5 border-t border-slate-200/80 pt-3">
                    {kind === 'WEBCAM' && (
                      <div className="space-y-1.5">
                        <p
                          data-testid="camera-source-webcam-scope"
                          className="text-xs leading-relaxed text-slate-600"
                        >
                          {t('cameraSource.webcamScope')}
                        </p>
                        <label htmlFor={`${id}-device`} className={CAMERA_FIELD_STYLES.label}>
                          {t('cameraSource.device')}
                        </label>
                        <select
                          id={`${id}-device`}
                          className={CAMERA_FIELD_STYLES.input}
                          value={device}
                          disabled={blocked || (caps?.webcams.length ?? 0) === 0}
                          onChange={(e) => change(() => setDevice(e.target.value))}
                        >
                          <option value="">{t('cameraSource.chooseDevice')}</option>
                          {caps?.webcams.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                        {host && caps && caps.webcams.length === 0 && (
                          <p
                            role="status"
                            data-testid="camera-source-empty-devices"
                            className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-950"
                          >
                            {t('cameraSource.emptyWebcams')}
                          </p>
                        )}
                      </div>
                    )}
                    {kind === 'VIDEO' && (
                      <div className="space-y-1.5">
                        <p
                          data-testid="camera-source-video-scope"
                          className="text-xs leading-relaxed text-slate-600"
                        >
                          {t('cameraSource.videoScope')}
                        </p>
                        <label htmlFor={`${id}-asset`} className={CAMERA_FIELD_STYLES.label}>
                          {t('cameraSource.video')}
                        </label>
                        <select
                          id={`${id}-asset`}
                          className={CAMERA_FIELD_STYLES.input}
                          value={asset}
                          disabled={blocked || (caps?.videos.length ?? 0) === 0}
                          onChange={(e) => change(() => setAsset(e.target.value))}
                        >
                          <option value="">{t('cameraSource.chooseVideo')}</option>
                          {caps?.videos.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                        {host && caps && caps.videos.length === 0 && (
                          <p
                            role="status"
                            data-testid="camera-source-empty-videos"
                            className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-950"
                          >
                            {t('cameraSource.emptyVideos')}
                          </p>
                        )}
                      </div>
                    )}
                    {kind === 'RTSP' && (
                      <fieldset className="space-y-2.5" disabled={blocked}>
                        <div className="space-y-1">
                          <label htmlFor={`${id}-endpoint`} className={CAMERA_FIELD_STYLES.label}>
                            {t('cameraSource.endpoint')}
                          </label>
                          <input
                            id={`${id}-endpoint`}
                            value={endpoint}
                            autoComplete="off"
                            aria-invalid={rtspInvalid}
                            aria-describedby={
                              rtspInvalid
                                ? `${id}-rtsp-error ${id}-rtsp-reachability`
                                : `${id}-rtsp-reachability`
                            }
                            placeholder={t('cameraSource.endpointExample')}
                            className={CAMERA_FIELD_STYLES.input}
                            onChange={(e) => change(() => setEndpoint(e.target.value))}
                          />
                          {rtspInvalid && (
                            <p
                              id={`${id}-rtsp-error`}
                              role="alert"
                              data-testid="camera-source-rtsp-error"
                              className={CAMERA_FIELD_STYLES.error}
                            >
                              {t('cameraSource.rtspValidationError')}
                            </p>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label htmlFor={`${id}-username`} className={CAMERA_FIELD_STYLES.label}>
                              {t('cameraSource.username')}
                            </label>
                            <input
                              id={`${id}-username`}
                              value={username}
                              autoComplete="off"
                              className={CAMERA_FIELD_STYLES.input}
                              onChange={(e) => change(() => setUsername(e.target.value))}
                            />
                          </div>
                          <div className="space-y-1">
                            <label htmlFor={`${id}-password`} className={CAMERA_FIELD_STYLES.label}>
                              {t('cameraSource.password')}
                            </label>
                            <input
                              id={`${id}-password`}
                              type="password"
                              value={displayedPassword}
                              autoComplete="new-password"
                              className={CAMERA_FIELD_STYLES.input}
                              onChange={(e) => change(() => setPassword(e.target.value))}
                            />
                          </div>
                        </div>
                        <p
                          id={`${id}-rtsp-reachability`}
                          data-testid="camera-source-rtsp-reachability"
                          className="text-xs leading-relaxed text-slate-600"
                        >
                          {t('cameraSource.credentialHelp')}
                        </p>
                      </fieldset>
                    )}
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <button
                        type="button"
                        className={
                          hasLiveApplyCta
                            ? CAMERA_BUTTON_STYLES.secondary
                            : CAMERA_BUTTON_STYLES.primary
                        }
                        disabled={!canTest}
                        onClick={() => void test()}
                      >
                        {t(pending ? 'cameraSource.testing' : 'cameraSource.test')}
                      </button>
                      {pending && (
                        <button
                          type="button"
                          className={CAMERA_BUTTON_STYLES.secondary}
                          onClick={reset}
                        >
                          {t('cameraSource.cancel')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <details
                  ref={detailsRef}
                  data-testid="camera-source-connection-details"
                  className="group min-w-0 border-t border-slate-200/80 pt-2.5 text-sm text-slate-700"
                >
                  <summary className="inline-flex cursor-pointer list-none flex-wrap items-center gap-1.5 rounded-md py-0.5 text-xs font-medium text-slate-600 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
                    <span>{t('cameraSource.connectionDetailsToggle')}</span>
                    {needsHostSelection && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                        {t('cameraSource.connectionDetailsNeeded')}
                      </span>
                    )}
                    <span
                      aria-hidden="true"
                      className="text-xs text-slate-400 transition-transform duration-150 group-open:rotate-180"
                    >
                      ▾
                    </span>
                  </summary>
                  <div className="mt-2 space-y-2.5 rounded-lg border border-slate-200/90 bg-slate-50/50 px-3 py-2.5">
                    <p className="max-w-[65ch] text-xs leading-relaxed text-slate-600">
                      {t('cameraSource.hostHelp')}
                    </p>
                    {!hasMultipleHosts && host ? (
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <p
                            data-testid="camera-source-bound-host"
                            className="min-w-0 break-words text-xs text-slate-700"
                          >
                            <span className="font-medium text-slate-600">
                              {t('cameraSource.host')}:{' '}
                            </span>
                            <span className="font-semibold text-slate-950">{host.label}</span>
                          </p>
                          <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {t('cameraSource.technicalHostId', { id: host.id })}
                            {caps?.sourceRevision !== undefined
                              ? ` · ${t('cameraSource.technicalRevision', { revision: caps.sourceRevision })}`
                              : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          className={CAMERA_BUTTON_STYLES.compactSecondary}
                          disabled={hosts.isFetching || pending || applying.isPending}
                          onClick={() => {
                            reset();
                            void refreshHosts();
                          }}
                        >
                          {t(hosts.isFetching ? 'cameraSource.refreshing' : 'cameraSource.refresh')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex min-w-0 flex-wrap items-end gap-2.5">
                        <div className="min-w-0 flex-1 space-y-1">
                          <label className={CAMERA_FIELD_STYLES.label} htmlFor={`${id}-host`}>
                            {t('cameraSource.host')}
                          </label>
                          <select
                            ref={hostSelectRef}
                            id={`${id}-host`}
                            className={CAMERA_FIELD_STYLES.input}
                            value={hostId}
                            disabled={blocked || hosts.isPending}
                            onChange={(e) =>
                              change(() => {
                                selectHostId(e.target.value);
                                setDevice('');
                                setAsset('');
                                setPassword('');
                              })
                            }
                          >
                            <option value="">{t('cameraSource.chooseHost')}</option>
                            {hosts.data?.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.label}
                                {h.available
                                  ? ''
                                  : ` — ${t(
                                      h.reason === 'CAMERA_UNBOUND'
                                        ? 'cameraSource.reasonShort.CAMERA_UNBOUND'
                                        : h.reason === 'AGENT_UNAVAILABLE'
                                          ? 'cameraSource.reasonShort.AGENT_UNAVAILABLE'
                                          : 'cameraSource.offline',
                                    )}`}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          className={CAMERA_BUTTON_STYLES.secondary}
                          disabled={hosts.isFetching || pending || applying.isPending}
                          onClick={() => {
                            reset();
                            void refreshHosts();
                          }}
                        >
                          {t(hosts.isFetching ? 'cameraSource.refreshing' : 'cameraSource.refresh')}
                        </button>
                      </div>
                    )}
                  </div>
                </details>
              </>
            )}
          </>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-900"
          >
            {t(error)}
          </p>
        )}
        {(hasUsableHost || resuming.isPending || resuming.isSuccess || resuming.isError) &&
          !isCameraInactive &&
          !externalController &&
          caps?.configurationResumeSupported === true &&
          client.resume &&
          camera.configurationVersion !== undefined && (
            <aside
              id="camera-source-resume-section"
              data-testid="camera-source-resume-card"
              className="space-y-3 rounded-xl border border-slate-200 border-l-[3px] border-l-teal-700 bg-slate-50/50 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-950">
                  {t('cameraSource.savedConfiguration')}
                </h3>
                <span className="font-mono text-xs font-semibold tabular-nums text-slate-600">
                  {t('cameraSource.stage3Value', { version: camera.configurationVersion })}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-slate-700">
                {t('cameraSource.resumeHelp')}
              </p>
              <button
                type="button"
                className={CAMERA_BUTTON_STYLES.secondary}
                disabled={
                  blocked || pending || refreshingCaps || hosts.isError || resuming.isSuccess
                }
                onClick={triggerResume}
              >
                {t(
                  resuming.isPending
                    ? 'cameraSource.resuming'
                    : resuming.isError
                      ? 'cameraSource.retryResume'
                      : 'cameraSource.resume',
                )}
              </button>
              {resuming.isSuccess && (
                <p role="status" className="text-sm font-medium text-teal-900">
                  {t('cameraSource.resumeStarted')}
                </p>
              )}
              {resuming.isError && (
                <p role="alert" className="text-sm font-medium text-rose-900">
                  {t('cameraSource.resumeError')}
                </p>
              )}
            </aside>
          )}
        {applying.isError && (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-900"
          >
            {t('cameraSource.applyError')}
          </p>
        )}
        {applying.isSuccess && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm font-medium text-emerald-950"
          >
            <p className="min-w-0 flex-1 leading-relaxed">{t('cameraSource.running')}</p>
            {onOpenRegions && (
              <button
                type="button"
                data-testid="camera-source-next-regions"
                className={CAMERA_BUTTON_STYLES.primary}
                onClick={onOpenRegions}
              >
                {t('cameraSource.nextConfigureRegions')}
              </button>
            )}
          </div>
        )}
        {activeResult && (
          <figure className="max-w-3xl space-y-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <figcaption className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-950">
                {t('cameraSource.tested')}
              </span>
              <span className="flex flex-wrap items-center gap-3">
                {!isExpired && (
                  <span className="text-xs font-medium tabular-nums text-slate-600">
                    {t('cameraSource.liveExpiresIn', { seconds: remainingSeconds })}
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                    isExpired
                      ? 'text-rose-800'
                      : activeResult.sourceKind === 'REPLAY'
                        ? 'text-amber-900'
                        : 'text-emerald-800'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${
                      isExpired
                        ? 'bg-rose-600'
                        : activeResult.sourceKind === 'REPLAY'
                          ? 'bg-amber-600'
                          : 'bg-emerald-600'
                    }`}
                  />
                  {t(
                    activeResult.sourceKind === 'REPLAY'
                      ? 'cameraSource.replay'
                      : 'cameraSource.live',
                  )}
                </span>
              </span>
            </figcaption>
            <img
              src={activeResult.frame.imageDataUrl}
              alt={t('cameraSource.preview', { camera: camera.name })}
              width={activeResult.frame.width}
              height={activeResult.frame.height}
              className="max-h-96 w-full rounded-lg bg-slate-950 object-contain"
            />
            <p className="text-sm leading-relaxed text-slate-700">
              {t(isExpired ? 'cameraSource.expired' : 'cameraSource.notApplied')}
            </p>
            {activeResult.sourceKind === 'REPLAY' && (
              <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-950">
                {t('cameraSource.replayNoLiveApply')}
              </p>
            )}
            {isCameraInactive && activeResult.sourceKind === 'LIVE' && !isExpired && (
              <p
                role="status"
                data-testid="camera-source-inactive-enable-required"
                className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-950"
              >
                {t('cameraSource.inactiveEnableToActivate')}
              </p>
            )}
            {!isCameraInactive &&
              !hosts.isError &&
              caps?.applySupported &&
              canWrite &&
              activeResult.sourceKind === 'LIVE' &&
              !applying.isSuccess && (
                <div className="space-y-2.5">
                  <p
                    data-testid="camera-source-shared-notice"
                    className="text-xs leading-relaxed text-slate-600"
                  >
                    {t('cameraSource.sharedPersistenceNote')}
                  </p>
                  {confirmApply ? (
                    <div
                      role="region"
                      aria-label={t('cameraSource.apply')}
                      data-testid="camera-source-apply-confirm"
                      className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50/75 p-3 text-sm text-amber-950"
                    >
                      <p className="leading-relaxed">
                        {t('cameraSource.confirmApplyPrompt', { camera: camera.name })}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={CAMERA_BUTTON_STYLES.primary}
                          disabled={blocked || hosts.isError || applying.isError || isExpired}
                          onClick={() => applying.mutate()}
                        >
                          {t(
                            applying.isPending
                              ? 'cameraSource.applying'
                              : 'cameraSource.confirmApplyBtn',
                          )}
                        </button>
                        <button
                          type="button"
                          className={CAMERA_BUTTON_STYLES.secondary}
                          disabled={applying.isPending}
                          onClick={() => setConfirmApply(false)}
                        >
                          {t('cameraSource.cancelApplyConfirm')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={CAMERA_BUTTON_STYLES.primary}
                      disabled={blocked || hosts.isError || applying.isError || isExpired}
                      onClick={() => setConfirmApply(true)}
                    >
                      {t(applying.isPending ? 'cameraSource.applying' : 'cameraSource.apply')}
                    </button>
                  )}
                </div>
              )}
          </figure>
        )}
        {hasUsableHost && !embedded && (
          <p className="border-t border-slate-200 pt-3 text-sm leading-relaxed text-slate-600">
            {t('cameraSource.next')}
          </p>
        )}
      </div>
    </section>
  );
}
