import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { IconAlertTriangle, IconCamera, IconX } from '../icons';

export function QrScannerView({
  onScan,
  disabled = false,
}: {
  onScan: (token: string) => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onScan);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');

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
        setError('Unable to access camera. Try uploading a QR image or entering the token manually.');
        setActive(false);
      }
    });
    return () => {
      cancelled = true;
      scanner.destroy();
    };
  }, [active, disabled]);

  return (
    <div className="space-y-3">
      {/* Scanner Controls Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setError('');
            setActive((v) => !v);
          }}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all shadow-xs disabled:opacity-50 ${
            active
              ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
              : 'bg-[#FF7A1A] text-white hover:bg-[#E56A10]'
          }`}
        >
          {active ? (
            <>
              <IconX className="h-4 w-4" />
              <span>Stop Scanner</span>
            </>
          ) : (
            <>
              <IconCamera className="h-4 w-4" />
              <span>Scan with Camera</span>
            </>
          )}
        </button>

        <label
          className={`inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-xs cursor-pointer ${
            disabled ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span>Upload QR Image</span>
          <input
            aria-label="Upload QR image to scan"
            type="file"
            accept="image/*"
            disabled={disabled}
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (!file) return;
              setError('');
              void QrScanner.scanImage(file, { returnDetailedScanResult: true })
                .then((r) => callback.current(r.data))
                .catch(() => setError('No valid QR code found in the image.'));
            }}
          />
        </label>
      </div>

      {/* Video Viewport with Reticle */}
      {active && (
        <div className="relative overflow-hidden rounded-2xl border-2 border-slate-900 bg-black aspect-video max-h-72 w-full flex items-center justify-center shadow-inner">
          <video
            ref={video}
            playsInline
            muted
            className="h-full w-full object-cover"
          />

          {/* Scanner Viewfinder Reticle */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
            <div className="relative h-44 w-44 rounded-xl border border-white/20">
              {/* Corner brackets */}
              <div className="absolute -top-1 -left-1 h-6 w-6 border-t-4 border-l-4 border-[#FF7A1A] rounded-tl-sm" />
              <div className="absolute -top-1 -right-1 h-6 w-6 border-t-4 border-r-4 border-[#FF7A1A] rounded-tr-sm" />
              <div className="absolute -bottom-1 -left-1 h-6 w-6 border-b-4 border-l-4 border-[#FF7A1A] rounded-bl-sm" />
              <div className="absolute -bottom-1 -right-1 h-6 w-6 border-b-4 border-r-4 border-[#FF7A1A] rounded-br-sm" />
              
              {/* Laser line */}
              <div className="absolute inset-x-2 top-1/2 h-0.5 bg-gradient-to-r from-transparent via-[#FF7A1A] to-transparent animate-pulse shadow-[0_0_8px_#FF7A1A]" />
            </div>
            <p className="mt-3 text-[11px] font-medium tracking-wide text-white/90 drop-shadow">
              Align QR code inside the viewfinder
            </p>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
