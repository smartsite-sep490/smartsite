import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
export function QrScannerView({
  onScan,
  disabled = false,
}: {
  onScan: (token: string) => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    callback = useRef(onScan);
  const [active, setActive] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    callback.current = onScan;
  }, [onScan]);
  useEffect(() => {
    if (!active || disabled || !video.current) return;
    let cancelled = false;
    const scanner = new QrScanner(
      video.current,
      (result) => {
        if (!cancelled) {
          scanner.stop();
          setActive(false);
          callback.current(result.data);
        }
      },
      { preferredCamera: 'environment', highlightScanRegion: true, maxScansPerSecond: 5 },
    );
    void scanner.start().catch(() => {
      if (!cancelled) {
        setError('Không mở được camera. Thử đọc ảnh QR hoặc dùng máy quét/nhập token.');
        setActive(false);
      }
    });
    return () => {
      cancelled = true;
      scanner.destroy();
    };
  }, [active, disabled]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className="rounded-lg border px-3 py-2"
          onClick={() => {
            setError('');
            setActive((v) => !v);
          }}
        >
          {active ? 'Dừng quét' : 'Quét QR bằng camera'}
        </button>
        <label className="rounded-lg border px-3 py-2">
          Đọc ảnh QR
          <input
            aria-label="Tải ảnh QR để quét"
            type="file"
            accept="image/*"
            disabled={disabled}
            className="ml-2 max-w-48"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (!file) return;
              setError('');
              void QrScanner.scanImage(file, { returnDetailedScanResult: true })
                .then((r) => callback.current(r.data))
                .catch(() => setError('Không đọc được QR trong ảnh.'));
            }}
          />
        </label>
      </div>
      <video
        ref={video}
        hidden={!active}
        playsInline
        muted
        className="max-h-64 w-full rounded-xl bg-black"
      />
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
