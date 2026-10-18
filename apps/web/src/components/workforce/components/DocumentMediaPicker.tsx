import { useEffect, useRef, useState } from 'react';
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
}: {
  label: string;
  file?: File;
  onSelect: (file: File) => void | Promise<void>;
  validate: (file: File) => Promise<void>;
  disabled?: boolean;
  allowPdf?: boolean;
}) {
  useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
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
      await validate(candidate);
      await onSelect(candidate);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('documents.IMAGE_INVALID'));
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      className={`group relative rounded-2xl border p-4 transition-all duration-200 ${
        error
          ? 'border-red-300 bg-red-50/30'
          : file
            ? 'border-emerald-300 bg-emerald-50/20'
            : 'border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs'
      }`}
    >
      {/* Header with Title & Status Badge */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#F66B17]" />
          <span>{label}</span>
        </p>

        {file ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-bold">
            ✓ {tr('documents.qualityAccepted')}
          </span>
        ) : pending ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 text-[11px] font-bold">
            {tr('documents.checking')}
          </span>
        ) : null}
      </div>

      {/* Upload Zone */}
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-slate-600 cursor-pointer">
          <span className="mb-1.5 block">
            {tr('documents.library')} - {label}
          </span>
          <input
            aria-label={label}
            type="file"
            accept={allowPdf ? 'image/jpeg,image/png,application/pdf' : 'image/jpeg,image/png'}
            disabled={disabled || pending}
            className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3.5 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-orange-50 file:text-[#F66B17] hover:file:bg-orange-100 cursor-pointer rounded-xl border border-slate-200 bg-slate-50/70 p-1.5 focus:outline-none focus:border-[#F66B17] transition-all disabled:opacity-50"
            onChange={(e) => {
              const candidate = e.target.files?.[0];
              e.target.value = '';
              if (candidate) void select(candidate);
            }}
          />
        </label>

        {/* File Accepted Notice */}
        {file && (
          <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5 break-all">
            <span>
              📎 {file.name} - {tr('documents.qualityAccepted')}
            </span>
          </p>
        )}

        {/* Image Preview Thumbnail */}
        {file?.type.startsWith('image/') && (
          <div className="relative mt-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-1.5 flex items-center justify-center max-h-48">
            <img ref={preview} alt={label} className="max-h-44 w-auto rounded-lg object-contain" />
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
        {error && (
          <p
            role="alert"
            className="text-xs font-bold text-red-700 bg-red-100/70 px-2.5 py-1.5 rounded-lg border border-red-200"
          >
            {localizedError(error)}
          </p>
        )}
      </div>
    </div>
  );
}
