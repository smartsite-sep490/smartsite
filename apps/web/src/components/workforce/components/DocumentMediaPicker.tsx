import { useEffect, useId, useRef, useState } from 'react';
import type { DocumentImageQuality } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../../i18n';
import { localizedError } from '../../../i18n/messages';

/** Web selects existing files; mobile owns camera capture. */
export function DocumentMediaPicker({
  label,
  file,
  onSelect,
  validate,
  disabled = false,
  allowPdf = true,
  referenceNationalId,
  hideHeader = false,
  fieldError,
  inputId,
}: {
  label: string;
  file?: File;
  onSelect: (file: File) => void | Promise<void>;
  validate: (file: File) => Promise<void | DocumentImageQuality>;
  referenceNationalId?: string;
  disabled?: boolean;
  allowPdf?: boolean;
  hideHeader?: boolean;
  fieldError?: string;
  inputId?: string;
}) {
  useTranslation();
  const [pending, setPending] = useState(false);
  const [check, setCheck] = useState<DocumentImageQuality>();
  const [error, setError] = useState('');
  const generatedId = useId();
  const controlId = inputId ?? generatedId;
  const visibleError = error || fieldError;
  const preview = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!file?.type.startsWith('image/') || !preview.current) return;
    const url = URL.createObjectURL(file);
    preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const select = async (candidate: File) => {
    setPending(true);
    setError('');
    try {
      if (
        !['image/jpeg', 'image/png', ...(allowPdf ? ['application/pdf'] : [])].includes(
          candidate.type,
        ) ||
        candidate.size > 5 * 1024 * 1024 ||
        !candidate.size
      )
        throw new Error(tr('documents.invalidFile'));
      const result = await validate(candidate);
      setCheck(result || undefined);
      await onSelect(candidate);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('documents.IMAGE_INVALID'));
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      aria-busy={pending}
      className={
        hideHeader
          ? 'space-y-2'
          : `group relative min-w-0 rounded-2xl border p-4 transition-colors ${
              visibleError
                ? 'border-red-300 bg-red-50/30'
                : file
                  ? 'border-orange-200 bg-white'
                  : 'border-slate-200 bg-white'
            }`
      }
    >
      {/* Header with Title & Status Badge */}
      {!hideHeader && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-slate-800">
            <span>{label}</span>
          </p>

          {file ? (
            <span className="shrink-0 rounded-lg bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700">
              1/1
            </span>
          ) : pending ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 text-[11px] font-bold">
              {tr('documents.checking')}
            </span>
          ) : null}
        </div>
      )}

      {/* Upload Zone */}
      <div className="space-y-2">
        <label
          className={`relative flex min-h-28 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-5 text-center transition-colors focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-100 ${disabled || pending ? 'cursor-wait opacity-60' : 'cursor-pointer hover:border-orange-400 hover:bg-orange-50/40'}`}
        >
          <input
            id={controlId}
            aria-invalid={!!visibleError || undefined}
            aria-describedby={visibleError ? `${controlId}-error` : undefined}
            aria-label={label}
            type="file"
            accept={allowPdf ? 'image/jpeg,image/png,application/pdf' : 'image/jpeg,image/png'}
            disabled={disabled || pending}
            className="sr-only"
            onChange={(e) => {
              const candidate = e.target.files?.[0];
              e.target.value = '';
              if (candidate) void select(candidate);
            }}
          />
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-orange-100 bg-orange-50 text-xl font-medium text-orange-600"
          >
            ↑
          </span>
          <span className="text-xs font-semibold text-slate-700">
            {tr(
              pending
                ? 'documents.checkingSupport'
                : file
                  ? 'documents.replaceFile'
                  : 'documents.selectFile',
            )}
          </span>
          <span className="text-[11px] leading-4 text-slate-500">
            {tr(allowPdf ? 'documents.documentFileHint' : 'documents.imageFileHint')}
          </span>
        </label>

        {/* File Accepted Notice */}
        {file && (
          <p className="min-w-0 break-words rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 [overflow-wrap:anywhere]">
            {file.name}
          </p>
        )}

        {file && check && (
          <div role="status" className="space-y-1 text-xs text-amber-900">
            {check.status !== 'ACCEPTED' && <p>{tr('documents.' + check.reason)}</p>}
            {!!check.ocr?.nationalIds?.some(
              (id) => referenceNationalId && id !== referenceNationalId,
            ) && <p>{tr('documents.identityMismatch')}</p>}
          </div>
        )}
        {/* Image Preview Thumbnail */}
        {file?.type.startsWith('image/') && (
          <div className="mt-2 flex max-h-36 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2">
            <img
              ref={preview}
              alt={label}
              className="max-h-32 max-w-full rounded-lg object-contain"
            />
          </div>
        )}

        {/* Status indicator */}
        {pending && (
          <p
            role="status"
            className="text-xs font-semibold text-blue-700 flex items-center gap-1.5"
          >
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
            <span>{tr('documents.checking')}</span>
          </p>
        )}

        {/* Error Notice */}
        {visibleError && (
          <p
            id={`${controlId}-error`}
            role="alert"
            className="text-xs font-bold text-red-700 bg-red-100/70 px-2.5 py-1.5 rounded-lg border border-red-200"
          >
            {error ? localizedError(error) : fieldError}
          </p>
        )}
      </div>
    </div>
  );
}
