import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  healthCertificateExpiry,
  isWorkerDocumentDate,
  type SmartSiteManagementClient,
  type WorkerDocumentKind,
  type WorkerDocumentDateCheck,
  type UploadWorkerDocumentCommand,
} from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { DocumentMediaPicker } from './DocumentMediaPicker';

export function WorkerDocumentDateNotice({ check }: { check: WorkerDocumentDateCheck }) {
  useTranslation();
  const label = {
    MATCH: 'documents.dateMatch',
    MISMATCH: 'documents.dateMismatch',
    UNAVAILABLE: 'documents.dateUnavailable',
    NO_REFERENCE: 'documents.dateNoReference',
  }[check.status];
  const date = (value: string | null) =>
    value?.split('-').reverse().join('/') ?? tr('documents.notDetermined');
  return (
    <div
      role="status"
      className={`space-y-1 rounded-xl border p-3 text-xs ${check.status === 'MATCH' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
    >
      <p className="font-semibold">{tr(label)}</p>
      <p>
        {tr('documents.dateDeclared')}: {date(check.submittedDate)} · {tr('documents.dateDetected')}
        : {date(check.detectedDate)}
      </p>
    </div>
  );
}

export function WorkerCertificateSubmission({
  client,
  token,
  siteId,
  workerId,
  kind,
  disabled,
  requireDate = true,
  onSubmit,
}: {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  workerId: string;
  kind: WorkerDocumentKind;
  disabled: boolean;
  requireDate?: boolean;
  onSubmit: (file: File, dates: UploadWorkerDocumentCommand) => Promise<unknown>;
}) {
  useTranslation();
  const [date, setDate] = useState('');
  const [dateEdited, setDateEdited] = useState(false);
  const [file, setFile] = useState<File>();
  const health = kind === 'HEALTH_CERTIFICATE';
  const dates = (value: string): UploadWorkerDocumentCommand =>
    !value ? {} : health ? { submittedIssuedOn: value } : { submittedExpiresOn: value };
  const check = useMutation({
    mutationFn: async ({ file, date }: { file: File; date: string }) => {
      if (date && !isWorkerDocumentDate(date)) throw new Error(tr('documents.dateRequiredHint'));
      const result = await client.checkWorkerDocumentDates(
        token,
        siteId,
        workerId,
        kind,
        file,
        dates(date),
      );
      if (result.quality.status !== 'ACCEPTED')
        throw new Error(tr(`documents.${result.quality.reason}`));
      return result;
    },
    onSuccess: (result, variables) => {
      if (!variables.date) setDate(result.dateCheck.detectedDate ?? '');
    },
  });
  const busy = disabled || check.isPending;
  const checked =
    check.isSuccess &&
    (check.variables.date || check.data.dateCheck.detectedDate || '') === date &&
    check.variables.file === file;
  const valid = !date || isWorkerDocumentDate(date);
  const canSubmit = checked && valid && (!requireDate || isWorkerDocumentDate(date));
  const [submitError, setSubmitError] = useState<unknown>(null);
  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-bold">{tr('documents.ocrDateHint')}</p>
      <label className="block space-y-1 text-xs font-semibold">
        <span>
          {tr(`documents.${kind}`)} -{' '}
          {tr(health ? 'documents.declaredIssuedOn' : 'documents.declaredExpiresOn')}
        </span>
        <input
          type="date"
          required={requireDate}
          value={date}
          disabled={busy}
          onChange={(e) => {
            setDate(e.target.value);
            setDateEdited(!!e.target.value);
          }}
          className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2"
        />
      </label>
      {health && (
        <p className="text-xs text-slate-600">
          {tr('documents.healthExpiryRule')}{' '}
          {healthCertificateExpiry(date) ?? tr('documents.notDetermined')}
        </p>
      )}
      <DocumentMediaPicker
        label={`${tr('documents.upload')} — ${tr(`documents.${kind}`)}`}
        file={file}
        disabled={busy || !valid}
        validate={async (candidate) => {
          await check.mutateAsync({ file: candidate, date: dateEdited ? date : '' });
        }}
        onSelect={setFile}
      />
      {check.isPending && (
        <p role="status" className="text-xs">
          {tr('documents.checkingDates')}
        </p>
      )}
      {checked && check.data && (
        <WorkerDocumentDateNotice
          check={{
            ...check.data.dateCheck,
            submittedDate: date || null,
            status: date
              ? check.data.dateCheck.detectedDate
                ? date === check.data.dateCheck.detectedDate
                  ? 'MATCH'
                  : 'MISMATCH'
                : 'UNAVAILABLE'
              : 'NO_REFERENCE',
          }}
        />
      )}
      {file && !checked && !check.isPending && (
        <p className="text-xs text-amber-800">{tr('documents.dateChanged')}</p>
      )}
      {check.isError && (
        <p role="alert" className="text-xs text-red-700">
          {userErrorMessage(check.error)}
        </p>
      )}
      {submitError != null && (
        <p role="alert" className="text-xs text-red-700">
          {userErrorMessage(submitError)}
        </p>
      )}
      {file && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !valid}
            className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50"
            onClick={() => void check.mutateAsync({ file, date }).catch(() => {})}
          >
            {tr('documents.dateRecheck')}
          </button>
          <button
            type="button"
            disabled={busy || !canSubmit}
            className="rounded-lg bg-[#071A2B] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            onClick={() => {
              if (!file || !canSubmit || busy) return;
              setSubmitError(null);
              void onSubmit(file, dates(date))
                .then(() => {
                  setFile(undefined);
                  setDate('');
                  setDateEdited(false);
                  check.reset();
                })
                .catch(setSubmitError);
            }}
          >
            {tr('documents.submitForReview')}
          </button>
        </div>
      )}
    </div>
  );
}
