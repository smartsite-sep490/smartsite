import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { Dialog } from '../../ui/Dialog';
import { validDocumentFile } from './worker-document-files';

export const documentField =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-orange-600 disabled:opacity-60';
export const documentButton =
  'inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-orange-600 disabled:opacity-50';
export const documentPrimaryButton =
  'inline-flex min-h-9 items-center justify-center rounded-lg bg-[#B94305] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#9A3400] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-50';

export function DocumentRequestError({ error, reload }: { error: unknown; reload: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      {userErrorMessage(error)}
      <button type="button" className={documentButton} onClick={reload}>
        {tr('common.retry')}
      </button>
    </div>
  );
}

export function DocumentAttachmentInput(p: {
  label: string;
  file?: File;
  savedName?: string;
  imageOnly?: boolean;
  preview?: boolean;
  onChange: (file: File) => void;
}) {
  useTranslation();
  const id = useId();
  const [invalid, setInvalid] = useState(false);
  const { file, preview } = p;
  const name = file?.name ?? p.savedName;

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{p.label}</p>
          {name && <p className="break-all text-xs text-slate-600">{name}</p>}
        </div>
        <label
          className={
            documentButton +
            ' cursor-pointer focus-within:outline-2 focus-within:outline-orange-600'
          }
        >
          <input
            type="file"
            className="sr-only"
            aria-label={p.label}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? id : undefined}
            accept={p.imageOnly ? 'image/jpeg,image/png' : 'image/jpeg,image/png,application/pdf'}
            onChange={(event) => {
              const candidate = event.target.files?.[0];
              event.target.value = '';
              if (!candidate) return;
              const valid =
                validDocumentFile(candidate) &&
                (!p.imageOnly || candidate.type.startsWith('image/'));
              setInvalid(!valid);
              if (valid) p.onChange(candidate);
            }}
          />
          {tr(name ? 'workerIntake.replaceFile' : 'workerIntake.attachFile')}
        </label>
      </div>
      {invalid && (
        <p id={id} role="alert" className="text-xs text-red-700">
          {tr(p.imageOnly ? 'workerIntake.invalidIdentityFile' : 'documents.invalidFile')}
        </p>
      )}
      {preview && file?.type.startsWith('image/') && (
        <PreviewMedia
          blob={file}
          type={file.type}
          title={p.label}
          className="max-h-40 rounded-lg border border-slate-200 object-contain"
        />
      )}
    </div>
  );
}

export function DocumentFilePreview(p: {
  blob: Blob;
  type: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <Dialog title={p.title} open onClose={p.onClose} maxWidth="4xl">
      <PreviewMedia
        {...p}
        className={
          p.type === 'application/pdf'
            ? 'h-[65vh] w-full rounded-lg'
            : 'mx-auto max-h-[65vh] max-w-full object-contain'
        }
      />
    </Dialog>
  );
}

function PreviewMedia({
  blob,
  type,
  title,
  className,
}: {
  blob: Blob;
  type: string;
  title: string;
  className: string;
}) {
  const media = useRef<HTMLImageElement | HTMLIFrameElement | null>(null);
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    const objectUrl = URL.createObjectURL(blob);
    element.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob, type]);
  return type === 'application/pdf' ? (
    <iframe
      ref={(element) => {
        media.current = element;
      }}
      title={title}
      className={className}
    />
  ) : (
    <img
      ref={(element) => {
        media.current = element;
      }}
      alt={title}
      className={className}
    />
  );
}
