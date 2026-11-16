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

  if (failed) return <p role="alert">{unavailable}</p>;
  if (!url) return <p role="status">{loading}</p>;
  return <img className="max-h-96 max-w-full rounded-lg object-contain" src={url} alt={label} />;
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
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        onClick={() => setRequestedLoad(open ? undefined : () => load)}
      >
        {toggleLabel}
      </Button>
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
