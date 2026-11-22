import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  SmartSiteManagementClient,
  SubmitWorkerDocumentsCommand,
  WorkerComplianceResponse,
  WorkerDocumentCheckResponse,
  WorkerDocumentKind,
} from '@smartsite/api-client';
import { healthCertificateExpiry, isWorkerDocumentDate } from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { SmartDatePicker } from '../../ui';
import { DocumentMediaPicker } from './DocumentMediaPicker';
import { documentKinds } from './worker-document-files';
import { IconChevronDown } from '../../icons';

const fieldClass =
  'block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[var(--action-primary)] focus:outline-none focus:ring-2 focus:ring-orange-100';

export function WorkerDocumentBundleForm({
  client,
  token,
  siteId,
  profile,
  onSubmitted,
}: {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  profile: WorkerComplianceResponse;
  onSubmitted: () => void;
}) {
  useTranslation();
  const [baseVersion, setBaseVersion] = useState(profile.version ?? 0);
  const [required, setRequired] = useState(profile.safetyCardRequired ?? true);
  const [files, setFiles] = useState<Partial<Record<WorkerDocumentKind | 'FRONT' | 'BACK', File>>>(
    {},
  );
  const [dates, setDates] = useState<Partial<Record<WorkerDocumentKind, string>>>({});
  const [checks, setChecks] = useState<
    Partial<Record<WorkerDocumentKind, WorkerDocumentCheckResponse>>
  >({});
  const [identity, setIdentity] = useState({
    nationalId: profile.nationalId ?? '',
    phoneNumber: profile.phoneNumber ?? '',
    gender: profile.gender,
    address: profile.address ?? '',
  }); 
  const [identityChanged, setIdentityChanged] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const requestId = useRef(crypto.randomUUID());
  const changed = () => {
    requestId.current = crypto.randomUUID();
  };
  const submit = useMutation({
    retry: false,
    mutationFn: () => {
      const documents: SubmitWorkerDocumentsCommand['documents'] = {};
      for (const kind of documentKinds) {
        if (!files[kind]) continue;
        const date = dates[kind];
        if (!isWorkerDocumentDate(date)) throw new Error(tr('documents.dateRequiredHint'));
        documents[kind] =
          kind === 'HEALTH_CERTIFICATE'
            ? { submittedIssuedOn: date }
            : { submittedExpiresOn: date };
      }
      let identityInput: SubmitWorkerDocumentsCommand['identity'];
      if (identityChanged) {
        if (!identity.gender) throw new Error(tr('documents.required'));
        identityInput = { ...identity, gender: identity.gender };
      }
      return client.submitWorkerDocuments(
        token,
        siteId,
        profile.workerId,
        {
          requestId: requestId.current,
          expectedVersion: baseVersion,
          safetyCardRequired: required,
          documents,
          ...(identityInput ? { identity: identityInput } : {}),
        },
        files,
      );
    },
    onSuccess: (result) => {
      setBaseVersion(result.version);
      setFiles({});
      setChecks({});
      setDates({});
      setIdentityChanged(false);
      changed();
      onSubmitted();
    },
  });
  return (
    <form
      className="space-y-4 rounded-2xl border border-slate-200/90 bg-slate-50/60 p-4 sm:p-5 shadow-2xs transition-all"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <div
        className={`flex items-center justify-between cursor-pointer select-none ${
          expanded ? 'border-b border-slate-200/60 pb-3' : ''
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        <h3 className="font-extrabold text-sm text-[#041D2E]">{tr('documents.bundleTitle')}</h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={tr('documents.bundleTitle')}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition-all shadow-2xs active:scale-[0.98] cursor-pointer select-none"
        >
          <span>{expanded ? tr('common.collapse') : tr('common.expand')}</span>
          <IconChevronDown
            className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>
      {expanded && (
        <>
          {(profile.version ?? 0) > baseVersion && (
        <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {tr('documents.profileChanged')}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setBaseVersion(profile.version ?? 0);
              setRequired(profile.safetyCardRequired ?? true);
              setFiles({});
              setDates({});
              setChecks({});
              setIdentity({
                nationalId: profile.nationalId ?? '',
                phoneNumber: profile.phoneNumber ?? '',
                gender: profile.gender,
                address: profile.address ?? '',
              });
              setIdentityChanged(false);
              changed();
            }}
          >
            {tr('documents.reloadDraft')}
          </button>
        </p>
      )}
      <fieldset disabled={submit.isPending} className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
          <label htmlFor="bundle-safety-card-select" className="text-xs font-bold text-slate-700">
            {tr('documents.safetyCardRequired')}
          </label>
          <select
            id="bundle-safety-card-select"
            aria-label={tr('documents.safetyCardRequired')}
            className="w-full sm:w-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 focus:border-[#F66B17] focus:outline-none cursor-pointer"
            value={String(required)}
            onChange={(event) => {
              setRequired(event.target.value === 'true');
              changed();
            }}
          >
            <option value="true">{tr('documents.cardRequired')}</option>
            <option value="false">{tr('documents.cardNotRequired')}</option>
          </select>
        </div>
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer font-semibold text-sm">
            {tr('documents.identityBothSides')}
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(['nationalId', 'phoneNumber', 'address'] as const).map((field) => (
              <label key={field} className="space-y-1 text-sm">
                <span>{tr('documents.' + field)}</span>
                <input
                  className={fieldClass}
                  value={identity[field]}
                  maxLength={field === 'nationalId' ? 12 : field === 'phoneNumber' ? 16 : 1000}
                  onChange={(event) => {
                    setIdentity((previous) => ({ ...previous, [field]: event.target.value }));
                    setIdentityChanged(true);
                    changed();
                  }}
                />
              </label>
            ))}
            <label className="space-y-1 text-sm">
              <span>{tr('documents.gender')}</span>
              <select
                className={fieldClass}
                value={identity.gender ?? ''}
                onChange={(event) => {
                  setIdentity((previous) => ({
                    ...previous,
                    gender: event.target.value as typeof identity.gender,
                  }));
                  setIdentityChanged(true);
                  changed();
                }}
              >
                <option value="" disabled>
                  —
                </option>
                {(['MALE', 'FEMALE', 'OTHER'] as const).map((gender) => (
                  <option key={gender} value={gender}>
                    {tr('documents.' + gender)}
                  </option>
                ))}
              </select>
            </label>
            {(['FRONT', 'BACK'] as const).map((side) => (
              <DocumentMediaPicker
                key={side}
                label={tr('documents.' + side)}
                allowPdf={false}
                referenceNationalId={identity.nationalId}
                file={files[side]}
                validate={async (file) => {
                  return client.checkDocumentImageQuality(
                    token,
                    siteId,
                    profile.contractorId!,
                    file,
                  );
                }}
                onSelect={(file) => {
                  setFiles((previous) => ({ ...previous, [side]: file }));
                  changed();
                }}
              />
            ))}
          </div>
        </details>
        <div className="grid gap-4 lg:grid-cols-3">
          {documentKinds.map((kind) => {
            const check = checks[kind];
            const detected = check?.dateCheck.detectedDate;
            const date = dates[kind] ?? '';
            const latest = profile.documents
              .filter((doc) => doc.kind === kind && doc.status !== 'SUPERSEDED')
              .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
            const needsFile =
              (kind !== 'SAFETY_CARD' || required) &&
              profile.missingKinds.includes(kind) &&
              !profile.documents.some((doc) => doc.kind === kind && doc.status === 'PENDING') &&
              !files[kind];
            return (
              <section
                key={kind}
                className="space-y-2.5 rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-1.5 border-b border-slate-100 pb-2">
                    <h4 className="font-extrabold text-xs text-slate-900 truncate">
                      {tr('documents.' + kind)}
                      {kind === 'SAFETY_CARD' && !required ? ' (' + tr('documents.optional') + ')' : ''}
                    </h4>
                    {needsFile && (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 shrink-0">
                        {tr('documents.fileRequired')}
                      </span>
                    )}
                  </div>
                  {latest?.status === 'REJECTED' && (
                    <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">
                      {tr('documents.REJECTED')}: {latest.reviewNote}
                    </p>
                  )}
                  <SmartDatePicker
                    label={tr(
                      kind === 'HEALTH_CERTIFICATE'
                        ? 'documents.declaredIssuedOn'
                        : 'documents.declaredExpiresOn',
                    )}
                    value={date}
                    fieldRequired={!!files[kind]}
                    disablePast={false}
                    onChange={(value) => {
                      setDates((previous) => ({ ...previous, [kind]: value }));
                      changed();
                    }}
                  />
                  <DocumentMediaPicker
                    label={tr('documents.' + kind)}
                    file={files[kind]}
                    hideHeader
                    validate={async (file) => {
                      const result = await client.checkWorkerDocumentDates(
                        token,
                        siteId,
                        profile.workerId,
                        kind,
                        file,
                        {},
                      );
                      setChecks((previous) => ({ ...previous, [kind]: result }));
                      if (result.dateCheck.detectedDate)
                        setDates((previous) => ({
                          ...previous,
                          [kind]: previous[kind] || result.dateCheck.detectedDate!,
                        }));
                    }}
                    onSelect={(file) => {
                      setFiles((previous) => ({ ...previous, [kind]: file }));
                      changed();
                    }}
                  />
                </div>
                {files[kind] && !isWorkerDocumentDate(date) && (
                  <p role="alert" className="text-xs text-red-700">
                    {tr('documents.dateRequiredHint')}
                  </p>
                )}
                {check && (
                  <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900" role="status">
                    {tr('documents.dateDetected')}: {detected ?? tr('documents.notDetermined')}
                    {detected && date && detected !== date && <p>{tr('documents.dateMismatch')}</p>}
                    {!!check.ocr?.nationalIds?.some(
                      (id) => identity.nationalId && id !== identity.nationalId,
                    ) && <p>{tr('documents.identityMismatch')}</p>}
                    {check.quality.status !== 'ACCEPTED' && (
                      <p>{tr('documents.' + check.quality.reason)}</p>
                    )}
                  </div>
                )}
                {kind === 'HEALTH_CERTIFICATE' && date && (
                  <p className="text-xs text-slate-600">
                    {tr('documents.expiresOn')}: {healthCertificateExpiry(date)}
                  </p>
                )}
                {date &&
                  (kind !== 'HEALTH_CERTIFICATE' ? date : (healthCertificateExpiry(date) ?? '')) <
                    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
                      new Date(),
                    ) && (
                    <p className="text-xs font-semibold text-amber-900">
                      {tr('documents.expiredWarning')}
                    </p>
                  )}
                {files[kind] && (
                  <button
                    type="button"
                    className="text-xs underline text-slate-600"
                    onClick={() => {
                      setFiles((previous) => {
                        const next = { ...previous };
                        delete next[kind];
                        return next;
                      });
                      setChecks((previous) => {
                        const next = { ...previous };
                        delete next[kind];
                        return next;
                      });
                      changed();
                    }}
                  >
                    {tr('documents.removeSelection')}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </fieldset>
      {submit.isError && (
        <p role="alert" className="text-sm text-red-700">
          {userErrorMessage(submit.error)}
        </p>
      )}
      <button
        type="submit"
        disabled={
          submit.isPending ||
          (!Object.keys(files).length &&
            !identityChanged &&
            required === (profile.safetyCardRequired ?? true))
        }
        className="rounded-xl bg-[#F66B17] hover:bg-[#e05d0e] px-5 py-2.5 text-xs font-bold text-white shadow-2xs hover:shadow-xs active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {tr(submit.isPending ? 'common.saving' : 'documents.sendBundle')}
      </button>
    </>
  )}
</form>
  );
}
