import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { QrPassResponse } from '@smartsite/contracts';
import { IconCheck, IconClock, IconKey, IconRefresh, IconShield } from '../icons';

export function QrPassCard({ pass, onRefresh }: { pass: QrPassResponse; onRefresh: () => void }) {
  const [now, setNow] = useState(Date.now);
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, Math.ceil((Date.parse(pass.expiresAt) - now) / 1000));
  const isExpiringSoon = remaining > 0 && remaining <= 30;

  const handleCopyToken = () => {
    void navigator.clipboard.writeText(pass.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadSvg = () => {
    if (!qrRef.current) return;
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(qrRef.current)], {
        type: 'image/svg+xml',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'smartsite-access-qr.svg';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50/60 to-white p-6 shadow-sm text-center">
      {/* Pass Status Badge */}
      <div className="mb-4 flex items-center justify-center">
        {remaining > 0 ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
              isExpiringSoon
                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isExpiringSoon ? 'bg-amber-500 animate-ping' : 'bg-emerald-500 animate-pulse'
              }`}
            />
            {isExpiringSoon ? 'Expiring Soon' : 'Active QR Pass'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 border border-rose-200 uppercase tracking-wider">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            Expired
          </span>
        )}
      </div>

      {/* QR Code Container */}
      {remaining > 0 ? (
        <div className="relative mx-auto my-3 w-fit rounded-2xl border-2 border-slate-200/90 bg-white p-4 shadow-sm transition-all hover:border-[#FF7A1A]/40">
          <QRCodeSVG
            ref={qrRef}
            xmlns="http://www.w3.org/2000/svg"
            value={pass.token}
            size={220}
            marginSize={3}
            title="SmartSite access QR"
            className="rounded-lg"
          />
        </div>
      ) : (
        <div className="my-6 rounded-xl border border-dashed border-rose-200 bg-rose-50/50 p-6">
          <IconClock className="mx-auto h-8 w-8 text-rose-400 mb-2" />
          <p role="status" className="text-sm font-semibold text-rose-700">
            QR pass has expired. Generate a new pass to proceed.
          </p>
        </div>
      )}

      {/* Countdown Timer */}
      <div className="my-3">
        <div
          className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-sm font-mono font-bold ${
            remaining === 0
              ? 'bg-slate-100 text-slate-400'
              : isExpiringSoon
                ? 'bg-amber-100/80 text-amber-900 border border-amber-200'
                : 'bg-slate-100 text-slate-700'
          }`}
        >
          <IconClock className="h-4 w-4 text-slate-500" />
          <span>
            Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-xs"
        >
          <IconRefresh className="h-3.5 w-3.5 text-slate-500" />
          <span>Generate New QR</span>
        </button>

        {remaining > 0 && (
          <button
            type="button"
            onClick={handleDownloadSvg}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-xs"
          >
            <svg
              className="h-3.5 w-3.5 text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            <span>Download QR (SVG)</span>
          </button>
        )}
      </div>

      <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
        After security confirmation, refresh for subsequent gate scans.
      </p>

      {/* Token Inspector Details */}
      {remaining > 0 && (
        <details className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-left text-xs transition-all group">
          <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900 select-none flex items-center justify-between">
            <span>Token for barcode scanner or manual entry</span>
            <IconKey className="h-3.5 w-3.5 text-slate-400 group-open:text-[#FF7A1A]" />
          </summary>
          <div className="mt-2.5 space-y-2">
            <p className="break-all select-all font-mono text-[11px] text-slate-800 bg-white p-2.5 rounded-lg border border-slate-200">
              {pass.token}
            </p>
            <button
              type="button"
              onClick={handleCopyToken}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#FF7A1A] hover:underline"
            >
              {copied ? (
                <>
                  <IconCheck className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-emerald-600">Token Copied</span>
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <span>Copy Token String</span>
                </>
              )}
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
