import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  healthCertificateExpiry,
  isWorkerDocumentDate,
  type ReviewWorkerDocumentCommand,
  type SmartSiteManagementClient,
  type WorkerComplianceResponse,
  type WorkerDocumentKind,
  type WorkerDocumentResponse,
} from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { SmartDatePicker } from '../../ui';
import { SmartNativeSelect } from '../../ui/SmartNativeSelect';
import {
  DocumentAttachmentInput,
  DocumentFilePreview,
  documentButton,
  documentField,
  documentPrimaryButton,
} from './DocumentAttachmentInput';
import { WorkerDocumentAnalysisNotice } from './WorkerDocumentAnalysisNotice';
import { WorkerDocumentStatusTags } from './WorkerDocumentStatusTags';
import { WorkerIdentityForm } from './WorkerIdentityForm';
import { documentKinds } from './worker-document-files';

interface Props {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  workerId: string;
  scope: string;
  canUpload?: boolean;
  canReview?: boolean;
  canEditIdentity?: boolean;
  section?: 'documents' | 'identity';
}

function sortDocuments(documents: WorkerDocumentResponse[], kind: WorkerDocumentKind) {
  return documents
    .filter((doc) => doc.kind === kind)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
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
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: key });
    void cache.invalidateQueries({ queryKey: ['worker-document-queue'] });
    void cache.invalidateQueries({ queryKey: ['worker-roster'] });
    void cache.invalidateQueries({ queryKey: ['worker-intake-drafts'] });
  };
  if (profile.isPending) return <p role="status">{tr('common.loading')}</p>;
  if (!profile.data || profile.isError) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
      >
        {userErrorMessage(profile.error)}{' '}
        <button className={documentButton} type="button" onClick={() => void profile.refetch()}>
          {tr('documents.refresh')}
        </button>
      </div>
    );
  }

  const data = profile.data;
  const identity = (
    <WorkerIdentityForm {...p} profile={data} editable={p.canEditIdentity} onSaved={refresh} />
  );
  if (p.section === 'identity') return identity;

  if (p.canReview) return <SafetyDocumentPanel {...p} profile={data} refresh={refresh} />;

  return (
    <section className="min-w-0 space-y-4">
      {!p.section && (
        <>
          <header>
            <h2 className="text-lg font-bold text-slate-900">{data.displayName}</h2>
            <WorkerDocumentStatusTags profile={data} workerCode={data.externalId} />
          </header>
          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer font-semibold text-slate-900">
              {tr('documents.personalDetails')}
            </summary>
            <div className="mt-3">{identity}</div>
          </details>
        </>
      )}
      <CertificateWorkspace {...p} profile={data} refresh={refresh} />
    </section>
  );
}

function CertificateWorkspace(
  p: Props & { profile: WorkerComplianceResponse; refresh: () => void },
) {
  const { profile } = p;
  const [opened, setOpened] = useState<WorkerDocumentKind>();
  const preview = useDocumentPreview(p);
  const [outcome, setOutcome] = useState<'saved' | 'sent'>();

  const send = useMutation({
    mutationFn: async () => {
      const result = await p.client.sendWorkerDocumentsBatch(
        p.token,
        p.siteId,
        profile.contractorId!,
        [{ id: p.workerId, version: profile.version ?? 0 }],
      );
      if (result.items[0]?.status !== 'SUCCEEDED') {
        const reason = result.items[0]?.error?.code;
        throw new Error(tr(reason === 'CONFLICT' ? 'errors.conflict' : 'workerIntake.sendInvalid'));
      }
    },
    onSuccess: () => {
      setOutcome('sent');
      p.refresh();
    },
    onError: p.refresh,
  });

  const required = profile.draftSafetyCardRequired ?? profile.safetyCardRequired ?? true;
  const canSubmit = profile.canSubmit ?? profile.documents.some((doc) => doc.status === 'DRAFT');
  return (
    <div className="min-w-0 space-y-3">
      {p.canUpload && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-slate-700">
            {tr('workerIntake.certificates')}
          </div>
          <button
            className={documentPrimaryButton}
            type="button"
            disabled={!canSubmit || !profile.contractorId || send.isPending}
            onClick={() => {
              setOutcome(undefined);
              send.mutate();
            }}
          >
            {tr('workerIntake.send')}
          </button>
        </div>
      )}
      {outcome && (
        <p role="status" className="text-sm font-medium text-emerald-800">
          {tr(outcome === 'sent' ? 'documents.saved' : 'workerIntake.savedDraft')}
        </p>
      )}
      {send.isError && (
        <p role="alert" className="text-sm text-red-700">
          {userErrorMessage(send.error)}
        </p>
      )}
      {preview.isError && (
        <p role="alert" className="text-sm text-red-700">
          {userErrorMessage(preview.error)}
        </p>
      )}
      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {documentKinds.map((kind) => {
          const documents = sortDocuments(profile.documents, kind);
          const approved = documents.find((doc) => doc.status === 'APPROVED');
          const current =
            documents.find(
              (doc) =>
                ['DRAFT', 'PENDING', 'REJECTED'].includes(doc.status) &&
                (doc.status !== 'REJECTED' || !approved || doc.uploadedAt >= approved.uploadedAt),
            ) ?? approved;
          const status =
            current?.status ?? (kind === 'SAFETY_CARD' && !required ? 'notRequired' : 'noFile');
          const history = documents.filter((doc) => doc.id !== current?.id);
          return (
            <div key={kind} className="space-y-2 p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {tr('documents.' + kind)}
                  </h3>
                  {current?.originalName && (
                    <p className="break-all text-xs text-slate-600">{current.originalName}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusClass(status)}>{tr('documents.' + status)}</span>
                  {current && (
                    <button
                      className={documentButton}
                      type="button"
                      disabled={preview.isPending}
                      aria-label={tr('workerIntake.viewAttachment', {
                        name: tr('documents.' + kind),
                      })}
                      onClick={() => preview.mutate(current)}
                    >
                      {tr('documents.view')}
                    </button>
                  )}
                  {p.canUpload && (
                    <button
                      className={documentButton}
                      type="button"
                      aria-expanded={opened === kind}
                      aria-label={tr(
                        current ? 'workerIntake.replaceAttachment' : 'workerIntake.addAttachment',
                        { name: tr('documents.' + kind) },
                      )}
                      onClick={() => setOpened((last) => (last === kind ? undefined : kind))}
                    >
                      {tr(
                        current
                          ? 'workerIntake.replaceFile'
                          : kind === 'SAFETY_CARD' && !required
                            ? 'workerIntake.editRequirement'
                            : 'workerIntake.attachFile',
                      )}
                    </button>
                  )}
                </div>
              </div>
              {approved?.expiresOn && (
                <p className="text-xs text-slate-600">
                  {tr('documents.expiresOn')}: {approved.expiresOn}
                </p>
              )}
              {current?.status === 'REJECTED' && current.reviewNote && (
                <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                  {tr('workerIntake.returnReason', { reason: current.reviewNote })}
                </p>
              )}
              {p.canUpload && current?.status === 'DRAFT' && (
                <DraftAnalysis key={current.id + ':' + current.version} {...p} doc={current} />
              )}
              {p.canUpload && opened === kind && (
                <CertificateDraftForm
                  key={kind}
                  {...p}
                  kind={kind}
                  current={current}
                  onSaved={() => {
                    setOpened(undefined);
                    setOutcome('saved');
                    p.refresh();
                  }}
                  onClose={() => setOpened(undefined)}
                />
              )}
              <DocumentHistory documents={history} preview={preview} />
            </div>
          );
        })}
      </div>
      {preview.data && <DocumentFilePreview {...preview.data} onClose={preview.reset} />}
    </div>
  );
}

function useDocumentPreview(p: Props) {
  return useMutation({
    mutationFn: async (doc: WorkerDocumentResponse) => ({
      blob: await p.client.workerDocumentFile(p.token, p.siteId, p.workerId, doc.id),
      type: doc.mediaType,
      title: doc.originalName,
    }),
  });
}

function DocumentHistory(p: {
  documents: WorkerDocumentResponse[];
  preview: ReturnType<typeof useDocumentPreview>;
}) {
  if (p.documents.length === 0) return null;
  return (
    <details className="text-xs text-slate-600">
      <summary className="cursor-pointer font-medium">{tr('documents.history')}</summary>
      <ul className="mt-2 space-y-1">
        {p.documents.map((doc) => (
          <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="break-all">
              {doc.originalName} · {tr('documents.' + doc.status)}
              {doc.expiresOn && ' · ' + doc.expiresOn}
            </span>
            <button
              className={documentButton}
              type="button"
              onClick={() => p.preview.mutate(doc)}
              disabled={p.preview.isPending}
            >
              {tr('documents.view')}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function statusClass(status: string) {
  const color =
    status === 'APPROVED'
      ? 'bg-emerald-50 text-emerald-800'
      : status === 'REJECTED'
        ? 'bg-rose-50 text-rose-800'
        : status === 'PENDING'
          ? 'bg-amber-50 text-amber-900'
          : 'bg-slate-100 text-slate-700';
  return 'rounded-md px-2 py-1 text-xs font-medium ' + color;
}

function DraftAnalysis(
  p: Props & {
    doc: WorkerDocumentResponse;
    refresh: () => void;
  },
) {
  const run = useMutation({
    mutationFn: () => p.client.analyzeWorkerDocument(p.token, p.siteId, p.workerId, p.doc.id),
    onSettled: p.refresh,
  });
  const analysis = run.isPending
    ? { status: 'ANALYZING' as const }
    : run.isError
      ? { status: 'UNAVAILABLE' as const }
      : p.doc.aiAnalysis;
  return (
    <WorkerDocumentAnalysisNotice analysis={analysis} kind={p.doc.kind}>
      {(!analysis || analysis.status === 'UNAVAILABLE') && (
        <button className={documentButton + ' ml-auto'} type="button" onClick={() => run.mutate()}>
          {tr(analysis ? 'documents.aiRetry' : 'documents.aiRun')}
        </button>
      )}
    </WorkerDocumentAnalysisNotice>
  );
}

function issueDateLabel(kind: WorkerDocumentKind) {
  if (kind === 'HEALTH_CERTIFICATE') return tr('documents.examinationOn');
  if (kind === 'PERSONAL_INSURANCE') return tr('documents.coverageStartsOn');
  return tr('documents.cardIssuedOn');
}

function CertificateDraftForm(
  p: Props & {
    profile: WorkerComplianceResponse;
    kind: WorkerDocumentKind;
    current?: WorkerDocumentResponse;
    onSaved: () => void;
    onClose: () => void;
  },
) {
  const health = p.kind === 'HEALTH_CERTIFICATE';
  const [baseVersion] = useState(p.profile.version ?? 0);
  const [required, setRequired] = useState(
    p.profile.draftSafetyCardRequired ?? p.profile.safetyCardRequired ?? true,
  );
  const [file, setFile] = useState<File>();
  const currentDraft = p.current?.status === 'DRAFT' ? p.current : undefined;
  const [issuedOn, setIssuedOn] = useState(currentDraft?.submittedIssuedOn ?? '');
  const [expiresOn, setExpiresOn] = useState(currentDraft?.submittedExpiresOn ?? '');
  const requestId = useRef(crypto.randomUUID());
  const setChanged = () => {
    requestId.current = crypto.randomUUID();
  };
  const changeRequirement = p.kind === 'SAFETY_CARD';
  const datesAreValid = health
    ? isWorkerDocumentDate(issuedOn)
    : isWorkerDocumentDate(expiresOn) &&
      (!issuedOn || (isWorkerDocumentDate(issuedOn) && issuedOn <= expiresOn));
  const canSave = changeRequirement && !required ? true : !!(file || currentDraft) && datesAreValid;
  const save = useMutation({
    mutationFn: () =>
      p.client.submitWorkerDocuments(
        p.token,
        p.siteId,
        p.workerId,
        {
          requestId: requestId.current,
          expectedVersion: baseVersion,
          safetyCardRequired: required,
          documents: {
            ...((required || !changeRequirement) && {
              [p.kind]: {
                ...(issuedOn && { submittedIssuedOn: issuedOn }),
                ...(!health && { submittedExpiresOn: expiresOn }),
              },
            }),
          },
        },
        file && (required || !changeRequirement) ? { [p.kind]: file } : {},
      ),
    onSuccess: p.onSaved,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) save.mutate();
      }}
      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <fieldset className="space-y-3" disabled={save.isPending}>
        {changeRequirement && (
          <label className="grid gap-1 text-sm font-medium">
            {tr('documents.safetyCardRequired')}
            <SmartNativeSelect
              value={String(required)}
              className={documentField}
              onChange={(event) => {
                setRequired(event.target.value === 'true');
                setChanged();
              }}
            >
              <option value="true">{tr('documents.cardRequired')}</option>
              <option value="false">{tr('documents.cardNotRequired')}</option>
            </SmartNativeSelect>
          </label>
        )}
        {(required || !changeRequirement) && (
          <>
            <DocumentAttachmentInput
              label={tr('documents.' + p.kind)}
              file={file}
              savedName={currentDraft?.originalName}
              onChange={(nextFile) => {
                setFile(nextFile);
                setChanged();
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <SmartDatePicker
                className={documentField}
                label={health ? tr('documents.submittedIssuedOn') : issueDateLabel(p.kind)}
                value={issuedOn}
                disablePast={false}
                onChange={(value) => {
                  setIssuedOn(value);
                  setChanged();
                }}
              />
              {!health && (
                <SmartDatePicker
                  className={documentField}
                  label={tr('documents.submittedExpiresOn')}
                  value={expiresOn}
                  disablePast={false}
                  onChange={(value) => {
                    setExpiresOn(value);
                    setChanged();
                  }}
                />
              )}
            </div>
            {!health && issuedOn && expiresOn && !datesAreValid && (
              <p className="text-sm text-amber-900">{tr('documents.reviewDatesInvalid')}</p>
            )}
          </>
        )}
        {save.isError && (
          <p role="alert" className="text-sm text-red-700">
            {userErrorMessage(save.error)}
          </p>
        )}
        <div className="flex gap-2">
          <button className={documentPrimaryButton} type="submit" disabled={!canSave}>
            {tr('workerIntake.save')}
          </button>
          <button className={documentButton} type="button" onClick={p.onClose}>
            {tr('common.cancel')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function SafetyDocumentPanel(
  p: Props & { profile: WorkerComplianceResponse; refresh: () => void },
) {
  const [section, setSection] = useState<WorkerDocumentKind>();
  const [openedOriginal, setOpenedOriginal] = useState('');
  const { profile } = p;
  const requiredKinds =
    profile.safetyCardRequired === false
      ? documentKinds.filter((kind) => kind !== 'SAFETY_CARD')
      : documentKinds;
  const submitted = profile.documents.filter(
    (doc) => doc.status !== 'DRAFT' && doc.status !== 'SUPERSEDED',
  );
  const isPending = (kind: WorkerDocumentKind) =>
    submitted.some((doc) => doc.kind === kind && doc.status === 'PENDING');
  const selected =
    section ??
    requiredKinds.find(isPending) ??
    documentKinds.find(isPending) ??
    requiredKinds.find((kind) => submitted.some((doc) => doc.kind === kind)) ??
    requiredKinds[0]!;
  const documents = sortDocuments(profile.documents, selected).filter(
    (doc) => doc.status !== 'DRAFT',
  );
  const current =
    documents.find((doc) => doc.status === 'PENDING') ??
    documents.find((doc) => doc.status !== 'SUPERSEDED');
  const history = documents.filter((doc) => doc.id !== current?.id);
  const preview = useDocumentPreview(p);
  const review = useMutation({
    mutationFn: ({ id, choice }: { id: string; choice: ReviewWorkerDocumentCommand }) =>
      p.client.reviewWorkerDocument(p.token, p.siteId, p.workerId, id, choice),
    onSuccess: p.refresh,
  });
  return (
    <section className="min-w-0 space-y-3">
      <header>
        <h2 className="text-lg font-bold text-slate-900">{profile.displayName}</h2>
        <WorkerDocumentStatusTags profile={profile} workerCode={profile.externalId} />
      </header>
      <p className="text-sm font-medium text-slate-700">
        {tr('documents.requiredSubmissionCount', {
          submitted: requiredKinds.filter((kind) => submitted.some((doc) => doc.kind === kind))
            .length,
          total: requiredKinds.length,
        })}
      </p>
      <div
        role="group"
        aria-label={tr('documents.complianceChecklist')}
        className="grid gap-2 sm:grid-cols-3"
      >
        {documentKinds.map((kind) => (
          <button
            key={kind}
            className={
              documentButton +
              ' flex-wrap gap-x-2 text-left' +
              (selected === kind ? ' border-orange-500 bg-orange-50 text-orange-900' : '')
            }
            type="button"
            aria-pressed={selected === kind}
            onClick={() => {
              setSection(kind);
              review.reset();
              preview.reset();
            }}
          >
            {tr('documents.' + kind)}
            {!requiredKinds.includes(kind) && (
              <span className={statusClass('optional')}>{tr('documents.notRequired')}</span>
            )}
          </button>
        ))}
      </div>
      {current ? (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="break-all text-sm font-semibold">{current.originalName}</span>
            <button
              type="button"
              className={documentButton}
              disabled={preview.isPending}
              onClick={() =>
                preview.mutate(current, { onSuccess: () => setOpenedOriginal(current.id) })
              }
            >
              {tr('documents.view')}
            </button>
          </div>
          {current.status === 'PENDING' ? (
            <ReviewDocument
              key={current.id + ':' + current.version}
              doc={current}
              disabled={review.isPending}
              opened={openedOriginal === current.id}
              submit={(choice) => review.mutate({ id: current.id, choice })}
            />
          ) : (
            <p className={statusClass(current.status)}>{tr('documents.' + current.status)}</p>
          )}
          {!!current.reviewNote && <p className="text-sm">{current.reviewNote}</p>}
        </div>
      ) : requiredKinds.includes(selected) ? (
        <p className="text-sm text-slate-600">
          {tr('documents.requiredFileMissing', { name: tr('documents.' + selected) })}
        </p>
      ) : null}
      <DocumentHistory documents={history} preview={preview} />
      {preview.isError && (
        <p role="alert" className="text-sm text-red-700">
          {userErrorMessage(preview.error)}
        </p>
      )}
      {review.isError && (
        <p role="alert" className="text-sm text-red-700">
          {userErrorMessage(review.error)}
        </p>
      )}
      {review.isSuccess && (
        <p role="status" className="text-sm text-emerald-800">
          {tr('workerIntake.success')}
        </p>
      )}
      <details className="rounded-xl border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          {tr('documents.personalDetails')}
        </summary>
        <div className="mt-3">
          <WorkerIdentityForm {...p} profile={profile} />
        </div>
      </details>
      {preview.data && <DocumentFilePreview {...preview.data} onClose={preview.reset} />}
    </section>
  );
}

function reviewDateLabel(date: string) {
  return isWorkerDocumentDate(date) ? date.split('-').reverse().join('/') : '—';
}

function ReviewDocument(p: {
  doc: WorkerDocumentResponse;
  disabled: boolean;
  opened: boolean;
  submit: (input: ReviewWorkerDocumentCommand) => void;
}) {
  const health = p.doc.kind === 'HEALTH_CERTIFICATE';
  const [dates, setDates] = useState({
    issuedOn: p.doc.submittedIssuedOn ?? '',
    expiresOn: p.doc.submittedExpiresOn ?? '',
  });
  const [editedDates, setEditedDates] = useState<typeof dates>();
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');
  const { issuedOn, expiresOn: declaredExpiry } = editedDates ?? dates;
  const expiresOn = health ? (healthCertificateExpiry(issuedOn) ?? '') : declaredExpiry;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format();
  const missingDates = !isWorkerDocumentDate(issuedOn) || !isWorkerDocumentDate(expiresOn);
  const datesValid = !missingDates && issuedOn <= today && expiresOn >= today;
  const issueLabel = issueDateLabel(p.doc.kind);
  const expiryLabel = tr('documents.expiresOn');
  return (
    <fieldset
      disabled={p.disabled}
      className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <legend className="px-1 text-sm font-semibold">{tr('documents.reviewDecision')}</legend>
      {editedDates ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SmartDatePicker
            className={documentField}
            label={issueLabel}
            value={issuedOn}
            disablePast={false}
            onChange={(value) => setEditedDates({ ...editedDates, issuedOn: value })}
          />
          {health ? (
            <div className="space-y-1 text-sm">
              <div>{expiryLabel}</div>
              <output className="block py-2 font-semibold">{reviewDateLabel(expiresOn)}</output>
            </div>
          ) : (
            <SmartDatePicker
              className={documentField}
              label={expiryLabel}
              value={expiresOn}
              disablePast={false}
              onChange={(value) => setEditedDates({ ...editedDates, expiresOn: value })}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-slate-600">{issueLabel}</dt>
              <dd className="font-semibold">{reviewDateLabel(issuedOn)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">{expiryLabel}</dt>
              <dd className="font-semibold">{reviewDateLabel(expiresOn)}</dd>
            </div>
          </dl>
          {!returning && (
            <button className={documentButton} type="button" onClick={() => setEditedDates(dates)}>
              {tr('documents.editReviewDates')}
            </button>
          )}
        </div>
      )}
      {!returning && !datesValid && (
        <p className="text-sm text-amber-800">
          {tr(missingDates ? 'documents.reviewDatesRequired' : 'documents.reviewDatesInvalid')}
        </p>
      )}
      {!returning && !editedDates && datesValid && !p.opened && (
        <p className="text-xs text-slate-600">{tr('documents.openOriginalBeforeApproval')}</p>
      )}
      {returning && (
        <label className="grid gap-1 text-sm font-medium">
          {tr('documents.returnNote')}
          <textarea
            className={documentField}
            value={note}
            maxLength={1000}
            rows={2}
            required
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {editedDates ? (
          <>
            <button
              type="button"
              className={documentPrimaryButton}
              disabled={!datesValid}
              onClick={() => {
                setDates(editedDates);
                setEditedDates(undefined);
              }}
            >
              {tr('common.done')}
            </button>
            <button
              className={documentButton}
              type="button"
              onClick={() => setEditedDates(undefined)}
            >
              {tr('common.cancel')}
            </button>
          </>
        ) : returning ? (
          <>
            <button
              type="button"
              className={documentPrimaryButton}
              disabled={!note.trim()}
              onClick={() =>
                p.submit({
                  expectedVersion: p.doc.version,
                  approve: false,
                  reviewNote: note.trim(),
                })
              }
            >
              {tr('documents.confirmReturn')}
            </button>
            <button className={documentButton} type="button" onClick={() => setReturning(false)}>
              {tr('common.cancel')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={documentPrimaryButton}
              disabled={!p.opened || !datesValid}
              onClick={() =>
                p.submit({
                  expectedVersion: p.doc.version,
                  approve: true,
                  issuedOn,
                  ...(health ? {} : { expiresOn }),
                  reviewNote: '',
                })
              }
            >
              {tr('documents.approve')}
            </button>
            <button className={documentButton} type="button" onClick={() => setReturning(true)}>
              {tr('documents.reject')}
            </button>
          </>
        )}
      </div>
    </fieldset>
  );
}
