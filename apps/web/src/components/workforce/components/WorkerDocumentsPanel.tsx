import { WorkerDocumentBundleForm } from './WorkerDocumentBundleForm';
import { WorkerDocumentStatusTags } from './WorkerDocumentStatusTags';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  SmartSiteManagementClient,
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
}: {
  nationalId?: string;
  safetyCardRequired?: boolean;
  files: Partial<Record<WorkerDocumentKind, File>>;
  onChange: (kind: WorkerDocumentKind, file?: File) => void;
  validate: (file: File) => Promise<import('@smartsite/api-client').DocumentImageQuality>;
  expiries: Partial<Record<WorkerDocumentKind, string>>;
  onExpiryChange: (kind: WorkerDocumentKind, value: string, preserveExisting?: boolean) => void;
  disabled?: boolean;
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs"
            >
              <fieldset disabled={disabled}>
                <SmartDatePicker
                  label={`${tr(`documents.${kind}`)} - ${tr(kind === 'HEALTH_CERTIFICATE' ? 'documents.submittedIssuedOn' : 'documents.submittedExpiresOn')}`}
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
                label={tr(`documents.${kind}`)}
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
  } | null>(null);

  const allSections = ['IDENTITY', ...documentKinds];
  const [sectionChoices, setSectionChoices] = useState<Record<string, boolean>>({});
  const pendingSections = new Set(
    profile.data?.documents
      .filter((d) => d.status === 'PENDING' || d.status === 'REJECTED')
      .map((d) => d.kind),
  );
  const expandedSections = allSections.filter(
    (id) =>
      sectionChoices[id] ??
      (id === 'IDENTITY'
        ? !!profile.data?.identityImages.length &&
          profile.data.submissionStatus === 'PENDING_REVIEW'
        : pendingSections.has(id as WorkerDocumentKind)),
  );

  const toggleSection = (id: string) => {
    setSectionChoices((prev) => ({ ...prev, [id]: !expandedSections.includes(id) }));
  };

  const toggleAll = () => {
    const shouldCollapse = expandedSections.length > 0;
    setSectionChoices(
      Object.fromEntries(
        allSections.map((id) => [id, !shouldCollapse]),
      ),
    );
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
    <section className="space-y-5 rounded-2xl border border-slate-200/90 bg-white p-3 sm:p-6 shadow-xs">
      {!preview && refreshNotice}
      {/* Double-Bezel Worker Profile Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 via-white to-slate-50/40 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#041D2E] via-slate-800 to-slate-900 text-white flex items-center justify-center font-black text-lg shadow-sm ring-2 ring-slate-100 border border-slate-700/50 shrink-0">
              {data.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="text-base sm:text-lg font-black text-[#041D2E] tracking-tight truncate">
                  {data.displayName}
                </h3>
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200/80 shrink-0">
                  {data.externalId}
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-500">
                {tr('common.workforce_operations')} · {tr('documents.personnelRecord')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
            <WorkerDocumentStatusTags profile={data} />
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

        {/* Executive Information Grid */}
        <div className="grid grid-cols-3 gap-2.5 pt-3 border-t border-slate-200/60">
          <div className="px-3 py-2 rounded-xl bg-slate-50/80 border border-slate-200/70 shadow-2xs">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {tr('documents.nationalId')}
            </p>
            <p className="font-mono text-xs font-bold text-slate-800 truncate mt-0.5">
              {data.nationalId ?? '—'}
            </p>
          </div>

          <div className="px-3 py-2 rounded-xl bg-slate-50/80 border border-slate-200/70 shadow-2xs">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {tr('documents.phoneNumber')}
            </p>
            <p className="font-mono text-xs font-bold text-slate-800 truncate mt-0.5">
              {data.phoneNumber ?? '—'}
            </p>
          </div>

          <div className="px-3 py-2 rounded-xl bg-slate-50/80 border border-slate-200/70 shadow-2xs">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {tr('documents.gender')}
            </p>
            <p className="text-xs font-bold text-slate-800 truncate mt-0.5">
              {data.gender ? tr(`documents.${data.gender}`) : '—'}
            </p>
          </div>

          <div className="col-span-3 px-3 py-2 rounded-xl bg-slate-50/80 border border-slate-200/70 shadow-2xs">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {tr('documents.address')}
            </p>
            <p
              className="text-xs font-bold text-slate-800 mt-0.5"
              title={data.address ?? undefined}
            >
              {data.address ?? '—'}
            </p>
          </div>
        </div>

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
      <div className="flex items-center justify-between pt-1">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#F66B17]" />
          <span>{tr('documents.complianceChecklist')}</span>
        </h4>
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
      </div>

      {/* Accordion 1: Căn cước công dân (Mặt trước & Mặt sau) */}
      <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden transition-all">
        <button
          type="button"
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

        {expandedSections.includes('IDENTITY') && (
          <div className="p-4 sm:p-5 border-t border-slate-100 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {(['FRONT', 'BACK'] as const).map((side) => {
                const image = data.identityImages.find((i) => i.side === side);
                return (
                  <div
                    key={side}
                    className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <p className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
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
                                setPreview({ url: URL.createObjectURL(blob), type: blob.type });
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

      {/* Accordions: 3 Safety Documents */}
      <div className="space-y-3">
        {documentKinds.map((kind) => {
          const docs = data.documents.filter((d) => d.kind === kind);
          const current = docs.filter((d) => d.status === 'PENDING' || d.status === 'APPROVED');
          const latest = [...docs]
            .filter((doc) => doc.status !== 'SUPERSEDED')
            .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
          if (latest?.status === 'REJECTED') current.unshift(latest);
          const history = docs.filter((doc) => !current.some((item) => item.id === doc.id));
          const currentDoc = current[0];
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
                className="space-y-3 rounded-2xl border border-slate-200/90 bg-slate-50/50 p-4 sm:p-5 shadow-2xs hover:bg-white hover:border-slate-300 transition-all"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-extrabold text-slate-900 break-words">
                      {doc.originalName}
                    </span>
                    <span className="font-mono text-[11px] font-bold text-slate-400">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 space-y-0.5">
                    <span className="font-bold text-slate-500">{tr('documents.issuedOn')}: </span>
                    <span className="font-semibold text-slate-800">{doc.issuedOn ?? '—'}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 space-y-0.5">
                    <span className="font-bold text-slate-500">{tr('documents.expiresOn')}: </span>
                    <span className="font-semibold text-slate-800">{doc.expiresOn ?? '—'}</span>
                  </div>
                </div>

                {/* Review note if any */}
                {doc.reviewNote && (
                  <div className="bg-white p-3 rounded-xl border border-slate-200/80 text-xs text-slate-700 space-y-1">
                    <p className="font-bold text-slate-500">{tr('documents.note')}:</p>
                    <p className="italic">{doc.reviewNote}</p>
                  </div>
                )}

                {/* Representative submitted expiry */}
                {doc.submittedExpiresOn &&
                  (kind !== 'HEALTH_CERTIFICATE' || doc.submittedIssuedOn) && (
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-800 bg-orange-50 border border-orange-200/80 px-3 py-1 rounded-xl">
                      <IconClock className="w-3.5 h-3.5 text-[#F66B17]" />
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
                        action.isPending || p.analysisBusy || doc.aiAnalysis?.status === 'ANALYZING'
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
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-slate-700 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#F66B17]" />
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

                    {/* Safety Review Component */}
                    {p.canReview && (
                      <ReviewDocument
                        key={`${doc.id}:${doc.version}:${doc.submittedIssuedOn}:${doc.submittedExpiresOn}:${doc.ocr.issuedOn}:${doc.ocr.expiresOn}`}
                        doc={doc}
                        disabled={action.isPending}
                        submit={(input) =>
                          action.mutate(() =>
                            p.client.reviewWorkerDocument(
                              p.token,
                              p.siteId,
                              p.workerId,
                              doc.id,
                              input,
                            ),
                          )
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            );
          };

          return (
            <article
              key={kind}
              className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden transition-all"
            >
              {/* Collapsed Header / Accordion Trigger */}
              <button
                type="button"
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

              {/* Accordion Body (Expanded) */}
              {isOpen && (
                <div className="p-4 sm:p-5 border-t border-slate-100 space-y-4">
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
        maxWidth="xl"
      >
        {preview && (
          <>
            {refreshNotice}
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
      className="space-y-4 rounded-2xl border-2 border-orange-200/90 bg-gradient-to-br from-orange-50/40 to-amber-50/20 p-4 sm:p-5 shadow-2xs"
    >
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-orange-950 border-b border-orange-200/60 pb-2.5">
        <IconShield className="w-4 h-4 text-[#F66B17]" />
        <span>{tr('documents.reviewDecision')}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SmartDatePicker
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
          rows={3}
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
