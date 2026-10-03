import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { QrPassResponse } from '@smartsite/contracts';
export function QrPassCard({ pass, onRefresh }: { pass: QrPassResponse; onRefresh: () => void }) {
  const [now, setNow] = useState(Date.now);
  const qrRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((Date.parse(pass.expiresAt) - now) / 1000));
  return (
    <div className="space-y-3 text-center">
      {remaining > 0 ? (
        <div className="mx-auto w-fit rounded-xl border bg-white p-3">
          <QRCodeSVG
            ref={qrRef}
            xmlns="http://www.w3.org/2000/svg"
            value={pass.token}
            size={240}
            marginSize={4}
            title="SmartSite access QR"
          />
        </div>
      ) : (
        <p role="status">QR hết hạn. Lấy mã mới để tiếp tục.</p>
      )}
      <p>
        Còn {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
      </p>
      <button type="button" className="rounded-lg border px-4 py-2" onClick={onRefresh}>
        Lấy QR mới
      </button>
      {remaining > 0 && (
        <button
          type="button"
          className="ml-2 rounded-lg border px-4 py-2"
          onClick={() => {
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
          }}
        >
          Tải ảnh QR
        </button>
      )}
      <p className="text-xs text-slate-500">
        Sau khi bảo vệ xác nhận, lấy QR mới cho lần quét tiếp theo.
      </p>
      {remaining > 0 && (
        <details className="text-xs">
          <summary>Token cho máy quét hoặc nhập thủ công</summary>
          <p className="break-all select-all font-mono">{pass.token}</p>
        </details>
      )}
    </div>
  );
}
