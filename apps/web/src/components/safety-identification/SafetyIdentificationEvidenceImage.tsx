import { useEffect, useState } from 'react';
import { Button } from '../ui';

function ApprovedImage({
  load,
  label,
  loading,
  unavailable,
}: {
  load: (signal: AbortSignal) => Promise<{ blob: Blob; validUntil: number | null }>;
  label: string;
  loading: string;
  unavailable: string;
}) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function release() {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
    }
    void load(controller.signal)
      .then(({ blob, validUntil }) => {
        if (controller.signal.aborted) return;
        const remaining = validUntil === null ? 0 : validUntil - performance.now();
        if (!Number.isFinite(remaining) || remaining <= 0) {
          setFailed(true);
          return;
        }
        timer = setTimeout(() => {
          release();
          setUrl(undefined);
          setFailed(true);
        }, remaining);
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
      release();
    };
  }, [load]);

  if (failed) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs font-medium text-amber-900"
      >
        {unavailable}
      </p>
    );
  }
  if (!url) {
    return (
      <p
        role="status"
        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600"
      >
        {loading}
      </p>
    );
  }
  return (
    <div className="flex justify-center rounded-xl border border-slate-200 bg-slate-950/95 p-2.5">
      <img className="max-h-96 max-w-full rounded-lg object-contain" src={url} alt={label} />
    </div>
  );
}

export function SafetyIdentificationEvidenceImage({
  load,
  vietnamese,
  number,
}: {
  load: (signal: AbortSignal) => Promise<{ blob: Blob; validUntil: number | null }>;
  vietnamese: boolean;
  number: number;
}) {
  const [requestedLoad, setRequestedLoad] = useState<typeof load>();
  const open = requestedLoad !== undefined;
  const label = vietnamese ? `Ảnh bằng chứng ${number}` : `Evidence image ${number}`;
  const toggleLabel = open ? (vietnamese ? 'Đóng ảnh' : 'Close image') : label;
  return (
    <div className="space-y-2.5">
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => setRequestedLoad(open ? undefined : () => load)}
        >
          {toggleLabel}
        </Button>
      </div>
      {requestedLoad && (
        <ApprovedImage
          load={requestedLoad}
          label={label}
          loading={vietnamese ? 'Đang tải ảnh…' : 'Loading image…'}
          unavailable={vietnamese ? 'Ảnh hiện không khả dụng.' : 'This image is unavailable.'}
        />
      )}
    </div>
  );
}
