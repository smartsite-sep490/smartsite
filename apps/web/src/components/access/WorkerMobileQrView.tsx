import React, { useEffect, useState } from 'react';
import { IconAlertTriangle, IconClock, IconKey, IconX } from '../icons';

export interface WorkerMobileQrViewProps {
  workerName: string;
  workerExternalId: string;
  contractorName: string;
  gateFallbackTriggered?: boolean;
  onClose?: () => void;
}

export function WorkerMobileQrView({
  workerName,
  workerExternalId,
  contractorName,
  gateFallbackTriggered = false,
  onClose,
}: WorkerMobileQrViewProps) {
  // 5-minute countdown for dynamic expiring QR code
  const [secondsRemaining, setSecondsRemaining] = useState(300);
  const [qrToken, setQrToken] = useState(() => `WKR-${workerExternalId}-${Date.now().toString(36).toUpperCase()}`);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          // Regenerate token
          setQrToken(`WKR-${workerExternalId}-${Date.now().toString(36).toUpperCase()}`);
          return 300;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [workerExternalId]);

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const timeFormatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-lg">
      {onClose && (
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-slate-600">
            <IconX className="h-5 w-5" />
          </button>
        </div>
      )}

      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-[#F66B17]">
        <IconKey className="h-6 w-6" />
      </div>

      <h3 className="mt-3 text-lg font-bold text-slate-900">{workerName}</h3>
      <p className="text-xs text-slate-500">
        ID: <span className="font-mono font-semibold">{workerExternalId}</span> · {contractorName}
      </p>

      {/* Gate Desk Fallback Indicator */}
      {!gateFallbackTriggered ? (
        <div className="my-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <IconAlertTriangle className="mx-auto mb-1.5 h-6 w-6 text-amber-600" />
          <p className="font-bold">Face-First Policy Enforced</p>
          <p className="mt-1 text-slate-600">
            QR fallback is hidden until the Security Officer at the gate desk initiates fallback for an inconclusive face scan.
          </p>
        </div>
      ) : (
        <div className="my-4 space-y-3">
          {/* Dynamic QR Graphic */}
          <div className="mx-auto flex h-48 w-48 flex-col items-center justify-center rounded-2xl border-2 border-slate-900 bg-slate-50 p-4 shadow-inner">
            <div className="grid grid-cols-6 gap-1">
              {Array.from({ length: 36 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-4 w-4 rounded-xs ${
                    (i * 5 + 2) % 3 === 0 || (i > 1 && i < 5) || (i > 28 && i < 33)
                      ? 'bg-slate-900'
                      : 'bg-white border border-slate-200'
                  }`}
                />
              ))}
            </div>
            <p className="mt-2.5 font-mono text-[9px] text-slate-500">{qrToken}</p>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700">
            <IconClock className="h-3.5 w-3.5 text-slate-500" />
            <span>Expires in {timeFormatted}</span>
          </div>

          {/* Critical Handoff Warning */}
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-left text-[11px] leading-relaxed text-red-900">
            <strong className="block font-bold">Important Notice:</strong>
            Presenting this dynamic QR does not automatically grant site access. The Security Officer must independently verify your current assignment and contractor status.
          </div>
        </div>
      )}
    </div>
  );
}
