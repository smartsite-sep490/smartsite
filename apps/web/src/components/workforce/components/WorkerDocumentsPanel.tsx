import { WorkerDocumentStatusTags } from './WorkerDocumentStatusTags';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  SmartSiteManagementClient,
  WorkerDocumentKind,
  WorkerDocumentResponse,
} from '@smartsite/api-client';
import { healthCertificateExpiry } from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { DocumentMediaPicker } from './DocumentMediaPicker';
import { DocumentIdentityNotice } from './DocumentIdentityNotice';
import {
  WorkerCertificateSubmission,
  WorkerDocumentDateNotice,
} from './WorkerCertificateSubmission';
import { documentKinds } from './worker-document-files';
import {
  IconEye,
  IconRefresh,
  IconCheck,
  IconX,
  IconClock,
  IconShield,
  IconAlertTriangle,
  IconUser,
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
}: {
  files: Partial<Record<WorkerDocumentKind, File>>;
  onChange: (kind: WorkerDocumentKind, file?: File) => void;
  validate: (file: File) => Promise<void>;
  expiries: Partial<Record<WorkerDocumentKind, string>>;
  onExpiryChange: (kind: WorkerDocumentKind, value: string) => void;
  disabled?: boolean;
}) {
  useTranslation();
  return (
    <div className="space-y-4 sm:col-span-2">
      <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-3.5 shadow-2xs">
        <p className="text-xs font-medium text-slate-600 flex items-center gap-2">
          <IconShield className="w-4 h-4 text-[#F66B17] shrink-0" />
          <span>{tr('documents.fileHint')}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {documentKinds.map((kind) => (
          <div
            key={kind}
            className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs"
          >
            <label className="block text-xs font-bold text-slate-700 space-y-1">
              <span>
                {tr(`documents.${kind}`)} -{' '}
                {tr(
                  kind === 'HEALTH_CERTIFICATE'
                    ? 'documents.submittedIssuedOn'
                    : 'documents.submittedExpiresOn',
                )}
              </span>
              <input
                className={fieldClass}
                type="date"
                value={expiries[kind] ?? ''}
                disabled={disabled}
                onChange={(event) => onExpiryChange(kind, event.target.value)}
              />
            </label>
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
              validate={validate}
              onSelect={(file) => onChange(kind, file)}
            />
          </div>
        ))}
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
  canSubmitDocuments?: boolean;
  canReview?: boolean;
}

export function WorkerDocumentsPanel(p: Props) {
  useTranslation();
  const canUploadCertificates = p.canUpload || p.canSubmitDocuments;
  const cache = useQueryClient();
  const key = ['worker-documents', p.scope, p.siteId, p.workerId];

  const profile = useQuery({
    queryKey: key,
    queryFn: () => p.client.workerCompliance(p.token, p.siteId, p.workerId),
  });

  const [preview, setPreview] = useState<{ url: string; type: string } | null>(null);

  const allSections = ['IDENTITY', ...documentKinds];
  const [sectionChoices, setSectionChoices] = useState<Record<string, boolean>>({});
  const pendingSections = new Set(
    profile.data?.documents.filter((d) => d.status === 'PENDING').map((d) => d.kind),
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
    setSectionChoices(
      Object.fromEntries(
        allSections.map((id) => [id, expandedSections.length !== allSections.length]),
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

  if (profile.isError) {
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

  // Check identity mismatch on front or back
  const identityMismatch = data.identityImages.some(
    (img) => img.identityCheck?.status === 'MISMATCH',
  );
  const identityUploadedCount = data.identityImages.length;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6 shadow-xs">
      {/* Compact Worker Profile Summary */}
      <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 to-slate-100/40 p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#041D2E] text-white flex items-center justify-center font-black text-base shadow-xs shrink-0">
              {data.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-[#041D2E] tracking-tight truncate">
                  {data.displayName}
                </h3>
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-200/80 text-slate-700 shrink-0">
                  {data.externalId}
                </span>
              </div>
              <p className="font-mono text-xs font-semibold text-slate-500 mt-0.5">
                {tr('documents.nationalId')}: {data.nationalId ?? '—'} ·{' '}
                {tr('documents.phoneNumber')}: {data.phoneNumber ?? '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <WorkerDocumentStatusTags profile={data} />

            {/* Quick Expand / Collapse All Toggle */}
            <button
              type="button"
              onClick={toggleAll}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-600 transition-all shadow-2xs cursor-pointer select-none"
            >
              {expandedSections.length === allSections.length
                ? tr('documents.collapseAll')
                : tr('documents.expandAll')}
            </button>
          </div>
        </div>

        {p.canSubmitDocuments && (
          <p className="text-xs text-slate-600">{tr('documents.renewalHint')}</p>
        )}
        {/* Read-only warning for workers */}
        {!canUploadCertificates && !p.canReview && data.status !== 'ACTIVE' && (
          <p
            role="status"
            className="text-xs font-semibold text-amber-800 bg-amber-50/80 border border-amber-200 rounded-xl p-2.5 leading-relaxed"
          >
            {tr('documents.readOnly')}
          </p>
        )}

        {/* Additional profile details in compact line */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-1 border-t border-slate-200/60">
          <span>
            {tr('documents.gender')}:{' '}
            <strong className="text-slate-700">
              {data.gender ? tr(`documents.${data.gender}`) : '—'}
            </strong>
          </span>
          <span>·</span>
          <span className="truncate max-w-md">
            {tr('documents.address')}:{' '}
            <strong className="text-slate-700">{data.address ?? '—'}</strong>
          </span>
        </div>

        {/* Expiring alert */}
        {!p.canReview && data.expiringKinds.length > 0 && (
          <div
            role="status"
            className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800 shadow-2xs"
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

      {/* Accordion 1: Căn cước công dân (Mặt trước & Mặt sau) */}
      <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden transition-all">
        <button
          type="button"
          onClick={() => toggleSection('IDENTITY')}
          className="w-full flex items-center justify-between gap-3 p-3.5 sm:p-4 bg-slate-50/70 hover:bg-slate-100/70 text-left cursor-pointer transition-colors select-none"
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <IconUser className="w-4 h-4 text-[#F66B17] shrink-0" />
            <span className="font-extrabold text-sm text-slate-800 truncate">
              {tr('documents.identityBothSides')}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap justify-end">
            {/* Identity Mismatch Warning Pill */}
            {identityMismatch && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs whitespace-nowrap">
                <IconAlertTriangle className="w-3 h-3 text-amber-700 shrink-0" />
                <span>{tr('documents.identityMismatchShort')}</span>
              </span>
            )}

            {/* Status Pill */}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold border whitespace-nowrap ${
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
                    ) : p.canUpload && data.contractorId ? (
                      <DocumentMediaPicker
                        label={tr(`documents.${side}`)}
                        allowPdf={false}
                        disabled={action.isPending}
                        validate={async (file) => {
                          const result = await p.client.checkDocumentImageQuality(
                            p.token,
                            p.siteId,
                            data.contractorId!,
                            file,
                          );
                          if (result.status !== 'ACCEPTED')
                            throw new Error(tr(`documents.${result.reason}`));
                        }}
                        onSelect={(file) =>
                          action
                            .mutateAsync(() =>
                              p.client.uploadWorkerIdentityImage(
                                p.token,
                                p.siteId,
                                p.workerId,
                                side,
                                file,
                              ),
                            )
                            .then(() => {})
                        }
                      />
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
          const history = docs.filter((d) => d.status !== 'PENDING' && d.status !== 'APPROVED');
          const currentDoc = current[0];

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
                    <span className="text-sm font-extrabold text-slate-900 truncate">
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
                        setPreview({ url: URL.createObjectURL(blob), type: blob.type });
                      })
                    }
                  >
                    <IconEye className="w-3.5 h-3.5 text-slate-500" />
                    <span>{tr('documents.view')}</span>
                  </button>
                </div>

                {/* Pending controls: Expiry editor, OCR hint, Safety review */}
                {doc.status === 'PENDING' && (
                  <div className="space-y-3 pt-3 border-t border-slate-200/70">
                    {canUploadCertificates && (
                      <SubmittedExpiryEditor
                        key={`${doc.id}:${doc.version}`}
                        doc={doc}
                        disabled={action.isPending}
                        save={(value) =>
                          action.mutate(() =>
                            p.client.updateWorkerDocumentExpiry(
                              p.token,
                              p.siteId,
                              p.workerId,
                              doc.id,
                              {
                                expectedVersion: doc.version,
                                ...(kind === 'HEALTH_CERTIFICATE'
                                  ? { submittedIssuedOn: value }
                                  : { submittedExpiresOn: value }),
                              },
                            ),
                          )
                        }
                      />
                    )}

                    {/* OCR suggestion box */}
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
                className="w-full flex items-center justify-between gap-3 p-3.5 sm:p-4 bg-slate-50/70 hover:bg-slate-100/70 text-left cursor-pointer transition-colors select-none"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <IconShield className="w-4 h-4 text-[#F66B17] shrink-0" />
                  <span className="font-extrabold text-sm text-slate-900 truncate">
                    {tr(`documents.${kind}`)}
                  </span>
                </div>

                {/* Status & Warning Pills on the Outside */}
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap justify-end">
                  {/* Warning Pill for Identity Mismatch */}
                  {hasMismatch && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs whitespace-nowrap">
                      <IconAlertTriangle className="w-3 h-3 text-amber-700 shrink-0" />
                      <span>{tr('documents.identityMismatchShort')}</span>
                    </span>
                  )}

                  {/* Warning Pill for Expiring */}
                  {isExpiring && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs whitespace-nowrap">
                      <IconClock className="w-3 h-3 text-amber-600 shrink-0" />
                      <span>{tr('common.expiring_soon')}</span>
                    </span>
                  )}

                  {/* Document Approval / Pending / Missing Status Badge */}
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold border whitespace-nowrap ${
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
                      {currentDoc ? tr(`documents.${currentDoc.status}`) : tr('documents.missing')}
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

                  {/* Upload replacement */}
                  {canUploadCertificates && (p.canSubmitDocuments || data.contractorId) && (
                    <WorkerCertificateSubmission
                      client={p.client}
                      token={p.token}
                      siteId={p.siteId}
                      workerId={p.workerId}
                      kind={kind}
                      requireDate={!!p.canSubmitDocuments}
                      disabled={action.isPending}
                      onSubmit={(file, dates) =>
                        action.mutateAsync(() =>
                          p.client.uploadWorkerDocument(
                            p.token,
                            p.siteId,
                            p.workerId,
                            kind,
                            file,
                            dates,
                          ),
                        )
                      }
                    />
                  )}

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

      {/* Modal Dialog for View Original */}
      {preview && (
        <div
          role="dialog"
          aria-label={tr('documents.view')}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2">
                <IconEye className="w-4 h-4 text-[#F66B17]" />
                <span className="font-extrabold text-sm text-slate-900">
                  {tr('documents.view')}
                </span>
              </div>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setPreview(null)}
              >
                <IconX className="w-3.5 h-3.5 text-slate-500" />
                <span>{tr('documents.close')}</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 overflow-auto flex items-center justify-center bg-slate-100/50 min-h-[300px]">
              {preview.type === 'application/pdf' ? (
                <iframe
                  src={preview.url}
                  title={tr('documents.view')}
                  className="h-[600px] w-full rounded-xl border border-slate-200 bg-white"
                />
              ) : (
                <img
                  src={preview.url}
                  alt={tr('documents.view')}
                  className="max-h-[700px] max-w-full rounded-xl border border-slate-200 object-contain bg-white shadow-xs"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SubmittedExpiryEditor({
  doc,
  disabled,
  save,
}: {
  doc: WorkerDocumentResponse;
  disabled: boolean;
  save: (value: string | null) => void;
}) {
  const health = doc.kind === 'HEALTH_CERTIFICATE';
  const original = (health ? doc.submittedIssuedOn : doc.submittedExpiresOn) ?? '';
  const [value, setValue] = useState(original);
  return (
    <fieldset
      disabled={disabled}
      className="space-y-2 rounded-xl border border-orange-200/80 bg-orange-50/30 p-3.5"
    >
      <label className="block text-xs font-bold text-slate-700 space-y-1">
        <span>{tr(health ? 'documents.submittedIssuedOn' : 'documents.submittedExpiresOn')}</span>
        <input
          className={fieldClass}
          type="date"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <p className="text-[11px] text-slate-500">
        {tr(health ? 'documents.healthExpiryRule' : 'documents.submittedExpiryHint')}{' '}
        {health ? (healthCertificateExpiry(value) ?? '') : ''}
      </p>
      <button
        type="button"
        className={secondaryButtonClass}
        disabled={disabled || value === original}
        onClick={() => save(value || null)}
      >
        <span>{tr('documents.saveSubmittedExpiry')}</span>
      </button>
    </fieldset>
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
        <label className="block text-xs font-bold text-slate-700 space-y-1">
          <span>{tr('documents.issuedOn')}</span>
          <input
            className={fieldClass}
            type="date"
            value={issuedOn}
            onChange={(e) => {
              setIssuedOn(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <label className="block text-xs font-bold text-slate-700 space-y-1">
          <span>{tr('documents.expiresOn')}</span>
          <input
            className={fieldClass}
            type="date"
            value={expiresOn}
            readOnly={health}
            onChange={(e) => {
              setExpiresOn(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
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
