import { WorkerDocumentBundleForm } from './WorkerDocumentBundleForm';
import { WorkerDocumentStatusTags } from './WorkerDocumentStatusTags';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  SmartSiteManagementClient,
  WorkerComplianceResponse,
  WorkerDocumentKind,
  WorkerDocumentResponse,
} from '@smartsite/api-client';
import { ApiError, healthCertificateExpiry } from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { DocumentMediaPicker } from './DocumentMediaPicker';
import { Dialog, SmartDatePicker } from '../../ui';
import { DocumentIdentityNotice } from './DocumentIdentityNotice';
import { WorkerDocumentAnalysisNotice } from './WorkerDocumentAnalysisNotice';
import { WorkerDocumentDateNotice } from './WorkerDocumentDateNotice';
import { documentKinds } from './worker-document-files';
import {
  IconEye,
  IconRefresh,
  IconCheck,
  IconX,
  IconClock,
  IconShield,
  IconAlertTriangle,
  IconLoader,
  IconChevronDown,
} from '../../icons';

const fieldClass =
  'block w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#F66B17] focus:bg-white focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all shadow-2xs';

const secondaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold shadow-2xs hover:bg-slate-50 hover:border-slate-300 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer';

const approveButtonClass =
  'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white text-xs font-extrabold shadow-2xs hover:shadow-xs active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer';

const rejectButtonClass =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50/80 hover:bg-rose-100 text-rose-700 text-xs font-bold shadow-2xs active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer';

export function DocumentFileInputs({
  files,
  onChange,
  validate,
  expiries,
  onExpiryChange,
  disabled = false,
  nationalId = '',
  safetyCardRequired = true,
  validationErrors,
  inputIdPrefix,
}: {
  nationalId?: string;
  safetyCardRequired?: boolean;
  files: Partial<Record<WorkerDocumentKind, File>>;
  onChange: (kind: WorkerDocumentKind, file?: File) => void;
  validate: (file: File) => Promise<import('@smartsite/api-client').DocumentImageQuality>;
  expiries: Partial<Record<WorkerDocumentKind, string>>;
  onExpiryChange: (kind: WorkerDocumentKind, value: string, preserveExisting?: boolean) => void;
  disabled?: boolean;
  validationErrors?: Record<string, string>;
  inputIdPrefix?: string;
}) {
  useTranslation();
  const [checks, setChecks] = useState<
    Partial<Record<WorkerDocumentKind, import('@smartsite/api-client').DocumentImageQuality>>
  >({});
  return (
    <div className="space-y-4 sm:col-span-2">
      <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-3.5 shadow-2xs">
        <p className="text-xs font-medium text-slate-600 flex items-center gap-2">
          <IconShield className="w-4 h-4 text-[#F66B17] shrink-0" />
          <span>{tr('documents.fileHint')}</span>
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
        {documentKinds.map((kind) => {
          const checked = checks[kind];
          const detected =
            kind === 'HEALTH_CERTIFICATE' ? checked?.ocr?.issuedOn : checked?.ocr?.expiresOn;
          const expiry =
            kind === 'HEALTH_CERTIFICATE'
              ? healthCertificateExpiry(expiries[kind])
              : expiries[kind];
          const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
            new Date(),
          );
          return (
            <div
              key={kind}
              className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="min-w-0 flex-1 text-sm font-semibold leading-5 text-slate-800">
                  {tr(`documents.${kind}`)}
                </h4>
                <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                  {tr(
                    kind === 'SAFETY_CARD' && !safetyCardRequired
                      ? 'documents.optional'
                      : 'common.required',
                  )}
                </span>
              </div>
              <fieldset disabled={disabled}>
                <SmartDatePicker
                  id={inputIdPrefix ? `${inputIdPrefix}-${kind}-date` : undefined}
                  error={validationErrors?.[`${kind}-date`]}
                  label={tr(
                    kind === 'HEALTH_CERTIFICATE'
                      ? 'documents.submittedIssuedOn'
                      : 'documents.submittedExpiresOn',
                  )}
                  value={expiries[kind] ?? ''}
                  disablePast={false}
                  onChange={(value) => onExpiryChange(kind, value)}
                />
              </fieldset>
              {kind === 'HEALTH_CERTIFICATE' && (
                <p className="text-xs text-slate-500">
                  {tr('documents.healthExpiryRule')}{' '}
                  {healthCertificateExpiry(expiries[kind]) ?? tr('documents.notDetermined')}
                </p>
              )}
              <DocumentMediaPicker
                inputId={inputIdPrefix ? `${inputIdPrefix}-${kind}-file` : undefined}
                fieldError={validationErrors?.[`${kind}-file`]}
                label={tr(`documents.${kind}`)}
                hideHeader
                file={files[kind]}
                disabled={disabled}
                validate={async (file) => {
                  const result = await validate(file);
                  setChecks((previous) => ({ ...previous, [kind]: result }));
                  if (!expiries[kind] && result.ocr) {
                    const date =
                      kind === 'HEALTH_CERTIFICATE' ? result.ocr.issuedOn : result.ocr.expiresOn;
                    if (date) onExpiryChange(kind, date, true);
                  }
                }}
                onSelect={(file) => onChange(kind, file)}
              />
              {kind === 'SAFETY_CARD' && !safetyCardRequired && (
                <p className="text-xs text-slate-500">{tr('documents.optional')}</p>
              )}
              {expiry && expiry < today && (
                <p className="text-xs font-semibold text-amber-900">
                  {tr('documents.expiredWarning')}
                </p>
              )}
              {checks[kind] && (
                <div role="status" className="space-y-1 text-xs text-amber-900">
                  <p>
                    {tr('documents.dateDetected')}: {detected ?? tr('documents.notDetermined')}
                  </p>
                  {checks[kind]?.status !== 'ACCEPTED' && (
                    <p>{tr('documents.' + checks[kind]?.reason)}</p>
                  )}
                  {!!checks[kind]?.ocr?.nationalIds?.some(
                    (id) => nationalId && id !== nationalId,
                  ) && <p>{tr('documents.identityMismatch')}</p>}
                  {!!expiries[kind] && detected && expiries[kind] !== detected && (
                    <p>{tr('documents.dateMismatch')}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">{tr('documents.submittedExpiryHint')}</p>
    </div>
  );
}

interface Props {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  workerId: string;
  scope: string;
  canUpload?: boolean;
  canReview?: boolean;
  analysisBusy?: boolean;
  onAnalysisChange?: (running: boolean) => void;
}

export function WorkerDocumentsPanel(p: Props) {
  useTranslation();
  const cache = useQueryClient();
  const key = ['worker-documents', p.scope, p.siteId, p.workerId];

  const profile = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      p.client.workerCompliance(p.token, p.siteId, p.workerId, { signal, timeoutMs: 15_000 }),
  });

  const [preview, setPreview] = useState<{
    url: string;
    type: string;
    name: string;
  } | null>(null);

  const allSections = ['IDENTITY', ...documentKinds];
  const [sectionChoices, setSectionChoices] = useState<Record<string, boolean>>({});
  const [reviewChoice, setReviewChoice] = useState<string | null>();
  const pendingSections = new Set(
    profile.data?.documents
      .filter((d) => d.status === 'PENDING' || d.status === 'REJECTED')
      .map((d) => d.kind),
  );
  const defaultReviewSection =
    documentKinds.find((kind) => pendingSections.has(kind)) ??
    (profile.data?.identityImages.length && profile.data.submissionStatus === 'PENDING_REVIEW'
      ? 'IDENTITY'
      : null);
  const reviewSection = reviewChoice === undefined ? defaultReviewSection : reviewChoice;
  const expandedSections = p.canReview
    ? reviewSection
      ? [reviewSection]
      : []
    : allSections.filter(
        (id) =>
          sectionChoices[id] ??
          (id === 'IDENTITY'
            ? !!profile.data?.identityImages.length &&
              profile.data.submissionStatus === 'PENDING_REVIEW'
            : pendingSections.has(id as WorkerDocumentKind)),
      );

  const toggleSection = (id: string) => {
    if (p.canReview) {
      setReviewChoice(reviewSection === id ? null : id);
      return;
    }
    setSectionChoices((prev) => ({ ...prev, [id]: !expandedSections.includes(id) }));
  };

  const toggleAll = () => {
    const shouldCollapse = expandedSections.length > 0;
    setSectionChoices(Object.fromEntries(allSections.map((id) => [id, !shouldCollapse])));
  };

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const action = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: key });
      void cache.invalidateQueries({ queryKey: ['worker-document-queue'] });
    },
  });

  if (profile.isPending) {
    return (
      <div role="status" className="flex items-center justify-center p-12 text-slate-500 gap-3">
        <IconLoader className="w-5 h-5 animate-spin text-[#F66B17]" />
        <span className="text-sm font-semibold">{tr('common.loading')}</span>
      </div>
    );
  }

  const connectionRefreshFailed =
    profile.isRefetchError &&
    profile.error instanceof ApiError &&
    (profile.error.code === 'network' || profile.error.code === 'timeout');
  if (!profile.data || (profile.isError && !connectionRefreshFailed)) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center justify-between gap-3 shadow-xs"
      >
        <div className="flex items-center gap-2.5">
          <IconAlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-semibold">{userErrorMessage(profile.error)}</span>
        </div>
        <button
          type="button"
          onClick={() => void profile.refetch()}
          className="px-3.5 py-1.5 rounded-xl bg-white border border-red-200 text-red-700 font-bold hover:bg-red-100 text-xs shadow-2xs transition-all"
        >
          {tr('documents.refresh')}
        </button>
      </div>
    );
  }

  const data = profile.data;
  const identityUploadedCount = data.identityImages.length;
  const identityMismatch = data.identityImages.some(
    (image) => image.identityCheck?.status === 'MISMATCH',
  );
  const refreshNotice = connectionRefreshFailed ? (
    <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
      {tr('documents.refreshFailed')}{' '}
      <button type="button" className="underline" onClick={() => void profile.refetch()}>
        {tr('documents.refresh')}
      </button>
    </p>
  ) : null;

  return (
    <section
      className={
        p.canReview
          ? '@container min-w-0 space-y-5'
          : 'min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5'
      }
    >
      {!preview && refreshNotice}
      {/* Worker profile */}
      <div className="space-y-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-base font-bold text-[#F66B17]">
              {data.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="space-y-2">
                <h3 className="text-base font-semibold leading-6 text-slate-900 [overflow-wrap:anywhere] sm:text-lg">
                  {data.displayName}
                </h3>
                <WorkerDocumentStatusTags profile={data} workerCode={data.externalId} />
              </div>
              <p className="text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
                {p.canReview
                  ? `${tr('documents.nationalId')}: ${data.nationalId ?? '—'}`
                  : tr('documents.personnelRecord')}
              </p>
            </div>
          </div>
        </div>

        {p.canUpload && (
          <div className="rounded-xl border border-blue-200/80 bg-blue-50/60 px-3.5 py-2.5 text-xs text-blue-900 shadow-2xs">
            <p className="leading-relaxed font-medium">{tr('documents.renewalHint')}</p>
          </div>
        )}

        {/* Read-only warning for workers */}
        {!p.canUpload && !p.canReview && data.status !== 'ACTIVE' && (
          <div
            role="status"
            className="flex items-start gap-2.5 text-xs font-semibold text-amber-800 bg-amber-50/80 border border-amber-200 rounded-xl p-3 shadow-2xs leading-relaxed"
          >
            <IconAlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <span>{tr('documents.readOnly')}</span>
          </div>
        )}

        {/* Personal details */}
        <PersonalDetails data={data} collapsible={!!p.canReview} />

        {/* Expiring alert */}
        {!p.canReview && data.expiringKinds.length > 0 && (
          <div
            role="status"
            className="flex items-center gap-2 p-3 rounded-xl bg-amber-50/90 border border-amber-200 text-xs font-bold text-amber-800 shadow-2xs"
          >
            <IconClock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{tr('documents.expiring')}</span>
          </div>
        )}
      </div>

      {action.isError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700 shadow-2xs"
        >
          {userErrorMessage(action.error)}
        </div>
      )}

      {p.canUpload && (
        <WorkerDocumentBundleForm
          key={data.workerId}
          client={p.client}
          token={p.token}
          siteId={p.siteId}
          profile={data}
          onSubmitted={() => {
            void cache.invalidateQueries({ queryKey: key });
            void cache.invalidateQueries({ queryKey: ['worker-document-queue'] });
          }}
        />
      )}

      {/* Document Section Control Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <span>{tr('documents.complianceChecklist')}</span>
        </h4>
        {!p.canReview && (
          <button
            type="button"
            onClick={toggleAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition-all shadow-2xs active:scale-[0.98] cursor-pointer select-none"
          >
            <span>
              {expandedSections.length > 0
                ? tr('documents.collapseAll')
                : tr('documents.expandAll')}
            </span>
            <IconChevronDown
              className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${
                expandedSections.length > 0 ? 'rotate-180' : ''
              }`}
            />
          </button>
        )}
      </div>

      {p.canReview && (
        <div
          role="group"
          aria-label={tr('documents.complianceChecklist')}
          className="grid grid-cols-2 gap-2 @min-[640px]:grid-cols-4"
        >
          {allSections.map((id) => {
            const identity = id === 'IDENTITY';
            const { currentDoc } = documentVersions(data.documents, id);
            const mismatch = identity
              ? identityMismatch
              : currentDoc?.identityCheck?.status === 'MISMATCH';
            const status = identity
              ? identityUploadedCount === 2
                ? 'identityComplete'
                : 'missing'
              : (currentDoc?.status ??
                (id === 'SAFETY_CARD' && data.safetyCardRequired === false
                  ? 'optional'
                  : 'missing'));
            const selected = reviewSection === id;
            return (
              <button
                key={id}
                type="button"
                aria-label={
                  identity
                    ? `${tr('documents.identityBothSides')} · ${tr(`documents.${status}`)}${mismatch ? ` · ${tr('documents.identityMismatchShort')}` : ''}`
                    : undefined
                }
                title={identity ? tr('documents.identityBothSides') : undefined}
                aria-pressed={selected}
                disabled={action.isPending}
                onClick={() => toggleSection(id)}
                className={`grid min-w-0 grid-rows-[minmax(40px,auto)_auto_20px] items-start gap-1.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F66B17] disabled:opacity-50 ${selected ? 'border-orange-200 bg-orange-50/80' : 'border-transparent bg-slate-50 hover:bg-slate-100'}`}
              >
                <span className="min-h-10 min-w-0 text-xs font-semibold leading-5 text-slate-800 [overflow-wrap:anywhere]">
                  {tr(identity ? 'documents.identityCard' : `documents.${id}`)}
                </span>
                <span
                  className={`text-xs font-medium ${status === 'APPROVED' || status === 'identityComplete' ? 'text-emerald-700' : status === 'REJECTED' ? 'text-rose-700' : status === 'PENDING' ? 'text-amber-800' : 'text-slate-500'}`}
                >
                  {tr(`documents.${status}`)}
                </span>
                <span
                  aria-hidden={!mismatch}
                  className="text-[11px] font-medium leading-5 text-amber-800"
                >
                  {mismatch ? tr('documents.identityMismatchShort') : null}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {p.canReview && !reviewSection && (
        <p className="text-xs leading-5 text-slate-500">{tr('documents.selectDocumentHint')}</p>
      )}

      {/* Accordion 1: Căn cước công dân (Mặt trước & Mặt sau) */}
      {(!p.canReview || reviewSection === 'IDENTITY') && (
        <div
          className={
            p.canReview ? 'min-w-0' : 'overflow-hidden rounded-2xl border border-slate-200 bg-white'
          }
        >
          {!p.canReview && (
            <button
              type="button"
              aria-expanded={expandedSections.includes('IDENTITY')}
              onClick={() => toggleSection('IDENTITY')}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/60 hover:bg-slate-100/60 text-left cursor-pointer transition-colors select-none"
            >
              <div className="min-w-0 flex-1">
                <span className="font-extrabold text-sm text-[#041D2E] block truncate">
                  {tr('documents.identityBothSides')}
                </span>
                <span className="text-xs font-medium text-slate-500 block mt-0.5 truncate">
                  {identityUploadedCount === 2
                    ? tr('documents.identitySidesComplete')
                    : tr('documents.identitySidesIncomplete')}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Identity Mismatch Warning Pill */}
                {identityMismatch && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200/90 shadow-2xs max-w-full whitespace-normal">
                    <IconAlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>{tr('documents.identityMismatchShort')}</span>
                  </span>
                )}

                {/* Status Pill */}
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border max-w-full whitespace-normal ${
                    identityUploadedCount === 2
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      identityUploadedCount === 2 ? 'bg-emerald-500' : 'bg-slate-400'
                    }`}
                  />
                  <span>
                    {identityUploadedCount === 2
                      ? tr('documents.identityComplete')
                      : tr('documents.identityIncomplete', { count: identityUploadedCount })}
                  </span>
                </span>

                <IconChevronDown
                  className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                    expandedSections.includes('IDENTITY') ? 'rotate-180' : ''
                  }`}
                />
              </div>
            </button>
          )}

          {expandedSections.includes('IDENTITY') && (
            <div
              className={
                p.canReview ? 'min-w-0 space-y-4' : 'p-4 sm:p-5 border-t border-slate-100 space-y-4'
              }
            >
              <div className="grid min-w-0 gap-3 @min-[480px]:grid-cols-2 sm:grid-cols-2">
                {(['FRONT', 'BACK'] as const).map((side) => {
                  const image = data.identityImages.find((i) => i.side === side);
                  return (
                    <div
                      key={side}
                      className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-5 text-slate-800">
                          {tr(`documents.${side}`)}
                        </p>
                        {image ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <IconCheck className="w-3 h-3 text-emerald-600" />
                            <span>{tr('documents.qualityAccepted')}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                            {tr('documents.noFile')}
                          </span>
                        )}
                      </div>

                      {image ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className={secondaryButtonClass}
                              onClick={() =>
                                action.mutate(async () => {
                                  const blob = await p.client.workerIdentityImageFile(
                                    p.token,
                                    p.siteId,
                                    p.workerId,
                                    image.id,
                                  );
                                  setPreview({
                                    url: URL.createObjectURL(blob),
                                    type: blob.type,
                                    name: image.originalName,
                                  });
                                })
                              }
                            >
                              <IconEye className="w-3.5 h-3.5 text-slate-500" />
                              <span>{tr('documents.view')}</span>
                            </button>

                            {p.canUpload && !p.canReview && (
                              <button
                                type="button"
                                className={secondaryButtonClass}
                                disabled={action.isPending}
                                onClick={() =>
                                  action.mutate(() =>
                                    p.client.retryWorkerIdentityOcr(
                                      p.token,
                                      p.siteId,
                                      p.workerId,
                                      image.id,
                                    ),
                                  )
                                }
                              >
                                <IconRefresh
                                  className={`w-3.5 h-3.5 text-slate-500 ${action.isPending ? 'animate-spin text-[#F66B17]' : ''}`}
                                />
                                <span>{tr('documents.ocr')}</span>
                              </button>
                            )}
                          </div>
                          <DocumentIdentityNotice
                            check={image.identityCheck}
                            reference={data.nationalId}
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 italic">{tr('documents.noFile')}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Accordions: 3 Safety Documents */}
      <div className="space-y-3">
        {documentKinds.map((kind) => {
          if (p.canReview && reviewSection !== kind) return null;
          const { current, history, currentDoc } = documentVersions(data.documents, kind);
          const required = kind !== 'SAFETY_CARD' || data.safetyCardRequired !== false;

          const isApproved = currentDoc?.status === 'APPROVED';
          const isPendingDoc = currentDoc?.status === 'PENDING';
          const isRejected = currentDoc?.status === 'REJECTED';
          const hasMismatch = currentDoc?.identityCheck?.status === 'MISMATCH';
          const isExpiring = !p.canReview && data.expiringKinds.includes(kind);
          const isOpen = expandedSections.includes(kind);

          const render = (doc: WorkerDocumentResponse) => {
            const isDocApproved = doc.status === 'APPROVED';
            const isDocPending = doc.status === 'PENDING';
            return (
              <div
                key={`${doc.id}:${doc.version}`}
                className={
                  p.canReview && isDocPending
                    ? 'grid min-w-0 items-start gap-4 @min-[760px]:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]'
                    : 'min-w-0'
                }
              >
                <div className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
                      <span className="min-w-0 text-sm font-semibold leading-6 text-slate-800 [overflow-wrap:anywhere]">
                        {doc.originalName}
                      </span>
                      <span className="shrink-0 font-mono text-xs leading-6 text-slate-400">
                        v{doc.version}
                      </span>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold border ${
                        isDocApproved
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : isDocPending
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isDocApproved
                            ? 'bg-emerald-500'
                            : isDocPending
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                        }`}
                      />
                      {tr(`documents.${doc.status}`)}
                    </span>
                  </div>

                  {/* Dates grid */}
                  {(!p.canReview || doc.issuedOn || doc.expiresOn) && (
                    <div className="grid min-w-0 grid-cols-1 gap-3 text-xs @min-[400px]:grid-cols-2">
                      <div className="min-w-0 space-y-1 rounded-lg bg-slate-50 p-3">
                        <span className="font-bold text-slate-500">
                          {tr('documents.issuedOn')}:{' '}
                        </span>
                        <span className="font-semibold text-slate-800">{doc.issuedOn ?? '—'}</span>
                      </div>
                      <div className="min-w-0 space-y-1 rounded-lg bg-slate-50 p-3">
                        <span className="font-bold text-slate-500">
                          {tr('documents.expiresOn')}:{' '}
                        </span>
                        <span className="font-semibold text-slate-800">{doc.expiresOn ?? '—'}</span>
                      </div>
                    </div>
                  )}

                  {/* Review note if any */}
                  {doc.reviewNote && (
                    <div className="bg-white p-3 rounded-xl border border-slate-200/80 text-xs text-slate-700 space-y-1">
                      <p className="font-bold text-slate-500">{tr('documents.note')}:</p>
                      <p className="leading-6 [overflow-wrap:anywhere]">{doc.reviewNote}</p>
                    </div>
                  )}

                  {/* Representative submitted expiry */}
                  {doc.submittedExpiresOn &&
                    (kind !== 'HEALTH_CERTIFICATE' || doc.submittedIssuedOn) && (
                      <div className="inline-flex max-w-full items-start gap-1.5 rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium leading-5 text-orange-800">
                        <IconClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F66B17]" />
                        <span>
                          {tr('documents.submittedExpiryLabel')}: {doc.submittedExpiresOn}
                        </span>
                      </div>
                    )}

                  <DocumentIdentityNotice check={doc.identityCheck} reference={data.nationalId} />
                  {doc.status === 'PENDING' && doc.dateCheck && (
                    <WorkerDocumentDateNotice check={doc.dateCheck} />
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate(async () => {
                          const blob = await p.client.workerDocumentFile(
                            p.token,
                            p.siteId,
                            p.workerId,
                            doc.id,
                          );
                          setPreview({
                            url: URL.createObjectURL(blob),
                            type: blob.type,
                            name: doc.originalName,
                          });
                        })
                      }
                    >
                      <IconEye className="w-3.5 h-3.5 text-slate-500" />
                      <span>{tr('documents.view')}</span>
                    </button>
                  </div>

                  {p.canReview &&
                    doc.status === 'PENDING' &&
                    doc.aiAnalysis?.status !== 'COMPLETE' && (
                      <button
                        type="button"
                        disabled={
                          action.isPending ||
                          p.analysisBusy ||
                          doc.aiAnalysis?.status === 'ANALYZING'
                        }
                        className={secondaryButtonClass}
                        onClick={() =>
                          action.mutate(async () => {
                            p.onAnalysisChange?.(true);
                            try {
                              await p.client.analyzeWorkerDocument(
                                p.token,
                                p.siteId,
                                p.workerId,
                                doc.id,
                              );
                            } finally {
                              p.onAnalysisChange?.(false);
                            }
                          })
                        }
                      >
                        {tr(
                          doc.aiAnalysis?.status === 'ANALYZING'
                            ? 'documents.aiAnalyzing'
                            : doc.aiAnalysis?.status === 'UNAVAILABLE'
                              ? 'documents.aiRetry'
                              : 'documents.aiRun',
                        )}
                      </button>
                    )}
                  {p.canReview && doc.aiAnalysis && (
                    <WorkerDocumentAnalysisNotice
                      analysis={doc.aiAnalysis}
                      reference={data.nationalId}
                      kind={doc.kind}
                    />
                  )}

                  {/* Pending controls: Expiry editor, OCR hint, Safety review */}
                  {doc.status === 'PENDING' && (
                    <div className="space-y-3 pt-3 border-t border-slate-200/70">
                      {kind === 'HEALTH_CERTIFICATE' && (
                        <p className="text-xs">
                          {tr('documents.healthExpiryRule')}{' '}
                          {healthCertificateExpiry(doc.submittedIssuedOn ?? doc.ocr.issuedOn) ??
                            tr('documents.notDetermined')}
                        </p>
                      )}
                      <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs space-y-1.5 shadow-2xs">
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                          <p className="min-w-0 flex-1 text-xs leading-6 text-slate-600">
                            <span>
                              {tr('documents.ocrIssued')}:{' '}
                              <span className="font-normal">
                                {doc.ocr.issuedOn ?? tr('documents.notDetermined')}
                              </span>{' '}
                              {kind !== 'HEALTH_CERTIFICATE' && (
                                <>
                                  {' '}
                                  · {tr('documents.ocrExpires')}:{' '}
                                  <span className="font-normal">
                                    {doc.ocr.expiresOn ?? tr('documents.notDetermined')}
                                  </span>
                                </>
                              )}
                            </span>
                          </p>
                          {(p.canUpload || p.canReview) && (
                            <button
                              type="button"
                              className={secondaryButtonClass}
                              disabled={action.isPending}
                              onClick={() =>
                                action.mutate(() =>
                                  p.client.retryWorkerDocumentOcr(
                                    p.token,
                                    p.siteId,
                                    p.workerId,
                                    doc.id,
                                  ),
                                )
                              }
                            >
                              <IconRefresh
                                className={`w-3.5 h-3.5 text-slate-500 ${action.isPending ? 'animate-spin text-[#F66B17]' : ''}`}
                              />
                              <span>{tr('documents.ocr')}</span>
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] font-semibold text-amber-800">
                          {tr(
                            doc.ocr.status === 'UNAVAILABLE'
                              ? 'documents.ocrUnavailable'
                              : !doc.ocr.issuedOn ||
                                  (kind !== 'HEALTH_CERTIFICATE' && !doc.ocr.expiresOn)
                                ? 'documents.ocrMissing'
                                : 'documents.ocrHint',
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                {p.canReview && isDocPending && (
                  <ReviewDocument
                    key={`${doc.id}:${doc.version}:${doc.submittedIssuedOn}:${doc.submittedExpiresOn}:${doc.ocr.issuedOn}:${doc.ocr.expiresOn}`}
                    doc={doc}
                    disabled={action.isPending}
                    submit={(input) =>
                      action.mutate(() =>
                        p.client.reviewWorkerDocument(p.token, p.siteId, p.workerId, doc.id, input),
                      )
                    }
                  />
                )}
              </div>
            );
          };

          return (
            <article
              key={kind}
              className={
                p.canReview
                  ? 'min-w-0'
                  : 'rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden transition-all'
              }
            >
              {/* Collapsed Header / Accordion Trigger */}
              {!p.canReview && (
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleSection(kind)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/60 hover:bg-slate-100/60 text-left cursor-pointer transition-colors select-none"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-extrabold text-sm text-[#041D2E] block truncate">
                      {tr(`documents.${kind}`)}
                    </span>
                    <span className="text-xs font-mono font-medium text-slate-500 block mt-0.5 truncate">
                      {currentDoc?.expiresOn
                        ? `${tr('documents.expiresOn')}: ${currentDoc.expiresOn}`
                        : currentDoc
                          ? tr('documents.submittedPendingApproval')
                          : tr('documents.documentNotSubmitted')}
                    </span>
                  </div>

                  {/* Status & Warning Pills on the Outside */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Warning Pill for Identity Mismatch */}
                    {hasMismatch && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200/90 shadow-2xs max-w-full whitespace-normal">
                        <IconAlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>{tr('documents.identityMismatchShort')}</span>
                      </span>
                    )}

                    {/* Warning Pill for Expiring */}
                    {isExpiring && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs max-w-full whitespace-normal">
                        <IconClock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>{tr('common.expiring_soon')}</span>
                      </span>
                    )}

                    {/* Document Approval / Pending / Missing Status Badge */}
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border max-w-full whitespace-normal ${
                        isApproved
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : isPendingDoc
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : isRejected
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isApproved
                            ? 'bg-emerald-500'
                            : isPendingDoc
                              ? 'bg-amber-500'
                              : isRejected
                                ? 'bg-rose-500'
                                : 'bg-slate-400'
                        }`}
                      />
                      <span>
                        {currentDoc
                          ? tr(`documents.${currentDoc.status}`)
                          : tr(required ? 'documents.missing' : 'documents.optional')}
                      </span>
                    </span>

                    <IconChevronDown
                      className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </button>
              )}

              {/* Accordion Body (Expanded) */}
              {isOpen && (
                <div
                  className={
                    p.canReview
                      ? 'min-w-0 space-y-4'
                      : 'p-4 sm:p-5 border-t border-slate-100 space-y-4'
                  }
                >
                  {p.canReview && (
                    <h4 className="text-sm font-semibold text-slate-800">
                      {tr(`documents.${kind}`)}
                    </h4>
                  )}
                  {!current.length && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                      <IconAlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{tr('documents.missing')}</span>
                    </div>
                  )}

                  {/* Current documents */}
                  <div className="space-y-3">{current.map(render)}</div>

                  {/* Audit / Revisions History */}
                  {history.length > 0 && (
                    <details className="group rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 text-xs">
                      <summary className="cursor-pointer font-bold text-slate-700 hover:text-[#F66B17] transition-colors select-none">
                        {tr('documents.history')} ({history.length})
                      </summary>
                      <div className="space-y-3 pt-3 mt-2 border-t border-slate-200/60">
                        {history.map(render)}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <Dialog
        open={!!preview}
        onClose={() => setPreview(null)}
        title={tr('documents.view')}
        maxWidth="4xl"
      >
        {preview && (
          <>
            {refreshNotice}
            <p className="mb-3 text-sm font-medium leading-6 text-slate-700 [overflow-wrap:anywhere]">
              {preview.name}
            </p>
            <div className="flex min-w-0 items-center justify-center rounded-xl bg-slate-50 p-2">
              {preview.type === 'application/pdf' ? (
                <iframe
                  src={preview.url}
                  title={tr('documents.view')}
                  className="h-[65dvh] w-full rounded-xl border border-slate-200 bg-white"
                />
              ) : (
                <img
                  src={preview.url}
                  alt={tr('documents.view')}
                  className="max-h-[70dvh] max-w-full rounded-xl object-contain"
                />
              )}
            </div>
          </>
        )}
      </Dialog>
    </section>
  );
}

function PersonalDetails({
  data,
  collapsible,
}: {
  data: WorkerComplianceResponse;
  collapsible: boolean;
}) {
  const details = (
    <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
      {(
        [
          ['nationalId', data.nationalId],
          ['phoneNumber', data.phoneNumber],
          ['gender', data.gender ? tr(`documents.${data.gender}`) : null],
          ['address', data.address],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className={`min-w-0 ${label === 'address' ? 'sm:col-span-3' : ''}`}>
          <dt className="text-xs leading-5 text-slate-500">{tr(`documents.${label}`)}</dt>
          <dd className="mt-0.5 text-sm leading-6 text-slate-800 [overflow-wrap:anywhere]">
            {value || '—'}
          </dd>
        </div>
      ))}
    </dl>
  );
  return collapsible ? (
    <details className="group">
      <summary className="flex w-fit cursor-pointer items-center gap-2 rounded-lg py-1 text-xs font-medium text-slate-500 focus-visible:outline-2 focus-visible:outline-[#F66B17]">
        {tr('documents.personalDetails')}
        <IconChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="pt-3">{details}</div>
    </details>
  ) : (
    details
  );
}

function documentVersions(documents: WorkerDocumentResponse[], kind: string) {
  const docs = documents.filter((doc) => doc.kind === kind);
  const current = docs.filter((doc) => doc.status === 'PENDING' || doc.status === 'APPROVED');
  const latest = [...docs]
    .filter((doc) => doc.status !== 'SUPERSEDED')
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
  if (latest?.status === 'REJECTED') current.unshift(latest);
  const history = docs.filter((doc) => !current.some((item) => item.id === doc.id));
  return { current, history, currentDoc: current[0] };
}

function ReviewDocument({
  doc,
  disabled,
  submit,
}: {
  doc: WorkerDocumentResponse;
  disabled: boolean;
  submit: (input: import('@smartsite/api-client').ReviewWorkerDocumentCommand) => void;
}) {
  const health = doc.kind === 'HEALTH_CERTIFICATE';
  const [issuedOn, setIssuedOn] = useState(
    (health ? doc.submittedIssuedOn : null) ?? doc.ocr.issuedOn ?? '',
  );
  const [enteredExpiry, setExpiresOn] = useState(doc.submittedExpiresOn ?? doc.ocr.expiresOn ?? '');
  const expiresOn = health ? (healthCertificateExpiry(issuedOn) ?? '') : enteredExpiry;
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 [&_label]:text-xs [&_label]:font-medium [&_label]:normal-case [&_label]:tracking-normal"
    >
      <div className="flex items-center gap-2 pb-2 text-xs font-semibold text-slate-700">
        <IconShield className="w-4 h-4 text-[#F66B17]" />
        <span>{tr('documents.reviewDecision')}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SmartDatePicker
          className={fieldClass}
          label={tr('documents.issuedOn')}
          value={issuedOn}
          disablePast={false}
          onChange={(value) => {
            setIssuedOn(value);
            setConfirmed(false);
          }}
        />
        {health ? (
          <div className="space-y-1.5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {tr('documents.expiresOn')}
            </span>
            <output aria-label={tr('documents.expiresOn')} className={fieldClass}>
              {expiresOn ? expiresOn.split('-').reverse().join('/') : '—'}
            </output>
          </div>
        ) : (
          <SmartDatePicker
            className={fieldClass}
            label={tr('documents.expiresOn')}
            value={expiresOn}
            disablePast={false}
            onChange={(value) => {
              setExpiresOn(value);
              setConfirmed(false);
            }}
          />
        )}
      </div>

      {health && <p className="text-xs font-normal">{tr('documents.healthExpiryRule')}</p>}
      <label className="block text-xs font-bold text-slate-700 space-y-1">
        <span>{tr('documents.note')}</span>
        <textarea
          className={fieldClass}
          rows={2}
          value={note}
          maxLength={1000}
          placeholder={tr('documents.reviewNotePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-orange-200/80 text-xs font-semibold text-slate-800 cursor-pointer shadow-2xs select-none hover:bg-orange-50/20 transition-colors">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded text-[#F66B17] focus:ring-[#F66B17] border-slate-300 accent-[#F66B17]"
        />
        <span className="leading-relaxed">{tr('documents.confirm')}</span>
      </label>

      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <button
          type="button"
          className={approveButtonClass}
          disabled={!confirmed || !issuedOn || !expiresOn || !note.trim()}
          onClick={() =>
            submit({
              expectedVersion: doc.version,
              approve: true,
              issuedOn,
              ...(health ? {} : { expiresOn }),
              reviewNote: note.trim(),
            })
          }
        >
          <IconCheck className="w-3.5 h-3.5 text-white" />
          <span>{tr('documents.approve')}</span>
        </button>

        <button
          type="button"
          className={rejectButtonClass}
          disabled={!note.trim()}
          onClick={() =>
            submit({ expectedVersion: doc.version, approve: false, reviewNote: note.trim() })
          }
        >
          <IconX className="w-3.5 h-3.5 text-rose-600" />
          <span>{tr('documents.reject')}</span>
        </button>
      </div>
    </fieldset>
  );
}
