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
  camera: { id: string; name: string; configurationVersion?: number };
  setupKey: readonly unknown[];
  canWrite: boolean;
  onUnauthorized: () => void;
  client?: CameraSourceClient;
  embedded?: boolean;
  resumeController?: CameraSourceResumeController;
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
  const [error, setError] = useState(''),
    [now, setNow] = useState(() => Date.now());
  const operation = useRef<{ version: number; abort?: AbortController }>({ version: 0 });
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
    hostId,
    host,
    caps,
    selectHostId,
    resuming,
    revoked,
    markRevoked,
    setSourceBusy,
    triggerResume,
  } = controller;

  const applying = useMutation({
    mutationFn: async () => {
      if (
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
      setPassword('');
      void hosts.refetch();
      void cache.invalidateQueries({ predicate: (q) => q.queryKey.includes(siteId) });
    },
    onError: (e) => {
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
    setError('');
  };
  const change = (update: () => void) => {
    if (applying.isPending || resuming.isPending) return;
    reset();
    applying.reset();
    update();
  };
  const draft: CameraSourceDraft | null =
    kind === 'WEBCAM' && device
      ? { kind, deviceId: device }
      : kind === 'VIDEO' && asset
        ? { kind, assetId: asset }
        : kind === 'RTSP' && endpoint.trim()
          ? {
              kind,
              endpoint: endpoint.trim(),
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
  if (hostAccessDenied) {
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

  return (
    <section
      data-testid="camera-source-setup-panel"
      className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white"
      aria-labelledby={`${id}-heading`}
    >
      <header
        className={
          embedded
            ? 'border-b border-slate-200 px-4 py-3'
            : 'border-b border-slate-200 px-4 py-4 sm:px-5'
        }
      >
        {!embedded && (
          <p className="text-sm font-semibold text-slate-700 tabular-nums">{camera.name}</p>
        )}
        <h2
          id={`${id}-heading`}
          className={
            embedded
              ? 'text-base font-bold tracking-tight text-slate-950'
              : 'mt-1 text-lg font-bold tracking-tight text-slate-950'
          }
        >
          {t('cameraSource.title')}
        </h2>
        <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-slate-600">
          {t('cameraSource.intro')}
        </p>
      </header>
      <div className={embedded ? 'space-y-4 p-4' : 'space-y-5 p-4 sm:p-5'}>
        {embedded ? (
          <details
            data-testid="camera-source-stages-disclosure"
            className="group min-w-0 text-xs text-slate-600"
          >
            <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
              <span>{t('cameraSetup.sourceStageSummaryDisclosure')}</span>
              <span
                aria-hidden="true"
                className="text-xs text-slate-500 transition-transform duration-150 group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <div className="mt-2">{stageSummaryList}</div>
          </details>
        ) : (
          stageSummaryList
        )}

        <fieldset className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2" disabled={blocked}>
          <legend className="sr-only">{t('cameraSource.title')}</legend>
          {(['WEBCAM', 'RTSP', 'VIDEO', 'BROWSER'] as const).map((option) => (
            <label
              key={option}
              className={`min-w-0 cursor-pointer rounded-xl border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-[#0F172A] ${
                kind === option
                  ? 'border-[#0F172A] bg-slate-50 ring-1 ring-[#0F172A]/10'
                  : 'border-slate-200 bg-white hover:border-slate-400'
              }`}
            >
              <span className="flex items-start gap-2.5">
                <input
                  className="mt-1 shrink-0 accent-[#0F172A]"
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
                <span className="text-sm font-semibold text-slate-950">
                  {t(`cameraSource.${option}`)}
                </span>
              </span>
              <span className="mt-2 block text-sm leading-relaxed text-slate-600">
                {t(`cameraSource.${option}Help`)}
              </span>
            </label>
          ))}
        </fieldset>
        {kind === 'BROWSER' ? (
          <p
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
          >
            {t('cameraSource.browserUnavailable')}
          </p>
        ) : (
          <>
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <label className={CAMERA_FIELD_STYLES.label} htmlFor={`${id}-host`}>
                  {t('cameraSource.host')}
                </label>
                <select
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
                      {h.available ? '' : ` — ${t('cameraSource.offline')}`}
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
                  void hosts.refetch();
                }}
              >
                {t('cameraSource.refresh')}
              </button>
            </div>
            <p className="text-sm leading-relaxed text-slate-600">{t('cameraSource.hostHelp')}</p>
            {hosts.isPending ? (
              <p role="status" className="text-sm text-slate-600">
                {t('cameraSource.loading')}
              </p>
            ) : hosts.isError ? (
              <p role="alert" className="text-sm text-amber-900">
                {t('cameraSource.unavailable')}
              </p>
            ) : hosts.data?.length === 0 ? (
              <p
                role="status"
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
              >
                {t('cameraSource.noHosts')}
              </p>
            ) : null}
            {host && !host.available && (
              <p role="status" className="text-sm text-amber-900">
                {t('cameraSource.unavailable')}
              </p>
            )}
            {host?.available && !supported && (
              <p role="status" className="text-sm text-amber-900">
                {t('cameraSource.unsupported')}
              </p>
            )}
            {supported && (
              <div className="max-w-3xl space-y-3">
                {kind === 'WEBCAM' && (
                  <div className="space-y-1.5">
                    <label htmlFor={`${id}-device`} className={CAMERA_FIELD_STYLES.label}>
                      {t('cameraSource.device')}
                    </label>
                    <select
                      id={`${id}-device`}
                      className={CAMERA_FIELD_STYLES.input}
                      value={device}
                      disabled={blocked}
                      onChange={(e) => change(() => setDevice(e.target.value))}
                    >
                      <option value="">{t('cameraSource.chooseDevice')}</option>
                      {caps?.webcams.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {kind === 'VIDEO' && (
                  <div className="space-y-1.5">
                    <label htmlFor={`${id}-asset`} className={CAMERA_FIELD_STYLES.label}>
                      {t('cameraSource.video')}
                    </label>
                    <select
                      id={`${id}-asset`}
                      className={CAMERA_FIELD_STYLES.input}
                      value={asset}
                      disabled={blocked}
                      onChange={(e) => change(() => setAsset(e.target.value))}
                    >
                      <option value="">{t('cameraSource.chooseVideo')}</option>
                      {caps?.videos.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {kind === 'RTSP' && (
                  <fieldset className="space-y-3" disabled={blocked}>
                    <div className="space-y-1.5">
                      <label htmlFor={`${id}-endpoint`} className={CAMERA_FIELD_STYLES.label}>
                        {t('cameraSource.endpoint')}
                      </label>
                      <input
                        id={`${id}-endpoint`}
                        value={endpoint}
                        autoComplete="off"
                        placeholder={t('cameraSource.endpointExample')}
                        className={CAMERA_FIELD_STYLES.input}
                        onChange={(e) => change(() => setEndpoint(e.target.value))}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
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
                      <div className="space-y-1.5">
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
                    <p className="text-sm leading-relaxed text-slate-600">
                      {t('cameraSource.credentialHelp')}
                    </p>
                  </fieldset>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={CAMERA_BUTTON_STYLES.primary}
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
        {!externalController &&
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
                disabled={blocked || pending || resuming.isSuccess}
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
          <p
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm font-medium text-emerald-950"
          >
            {t('cameraSource.running')}
          </p>
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
            {caps?.applySupported &&
              canWrite &&
              activeResult.sourceKind === 'LIVE' &&
              !applying.isSuccess && (
                <button
                  type="button"
                  className={CAMERA_BUTTON_STYLES.primary}
                  disabled={blocked || applying.isError || isExpired}
                  onClick={() => applying.mutate()}
                >
                  {t(applying.isPending ? 'cameraSource.applying' : 'cameraSource.apply')}
                </button>
              )}
          </figure>
        )}
        <p className="border-t border-slate-200 pt-3 text-sm leading-relaxed text-slate-600">
          {t('cameraSource.next')}
        </p>
      </div>
    </section>
  );
}
