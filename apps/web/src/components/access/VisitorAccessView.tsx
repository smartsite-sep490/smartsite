import React, { useState } from 'react';
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconKey,
  IconShield,
  IconUser,
  IconUsers,
  IconX,
} from '../icons';

export interface VisitorRecord {
  id: string;
  visitorName: string;
  visitorCompany: string;
  nationalId: string;
  hostName: string;
  siteId: string;
  targetZone: string;
  purpose: string;
  scheduledDate: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  checkInStatus: 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'CHECKED_OUT';
  checkInTime?: string;
  checkOutTime?: string;
  qrToken: string;
}

export interface VisitorAccessViewProps {
  apiUrl: string;
  siteId: string;
  siteName?: string;
}

export function VisitorAccessView({ apiUrl, siteId, siteName = 'Construction Site' }: VisitorAccessViewProps) {
  // Visitor registry list
  const [visitors, setVisitors] = useState<VisitorRecord[]>([
    {
      id: 'vis-001',
      visitorName: 'Tran Minh Duc',
      visitorCompany: 'EcoTech Green Auditors',
      nationalId: '079201004921',
      hostName: 'Nguyen Le Khoa (Site Manager)',
      siteId,
      targetZone: 'Zone A — Office & Ground',
      purpose: 'ISO 14001 Environmental Audit',
      scheduledDate: new Date().toISOString().slice(0, 10),
      approvalStatus: 'APPROVED',
      checkInStatus: 'NOT_CHECKED_IN',
      qrToken: 'QR-VIS-ECOTECH-001-TOKEN',
    },
    {
      id: 'vis-002',
      visitorName: 'Le Thi Mai',
      visitorCompany: 'VinaConcrete Material Inspection',
      nationalId: '001202008842',
      hostName: 'Tran Van Bao (Safety Officer)',
      siteId,
      targetZone: 'Zone B — Foundation Pouring',
      purpose: 'Slump test & concrete specimen review',
      scheduledDate: new Date().toISOString().slice(0, 10),
      approvalStatus: 'PENDING',
      checkInStatus: 'NOT_CHECKED_IN',
      qrToken: 'QR-VIS-VINACONCRETE-002-TOKEN',
    },
  ]);

  // New visitor registration form modal
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [visitorName, setVisitorName] = useState('');
  const [visitorCompany, setVisitorCompany] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [hostName, setHostName] = useState('');
  const [targetZone, setTargetZone] = useState('Zone A — Common Access');
  const [purpose, setPurpose] = useState('');

  // Active QR Inspection Badge modal
  const [inspectQrVisitor, setInspectQrVisitor] = useState<VisitorRecord | null>(null);

  // Security Desk QR Scanner / Manual Validator state
  const [scannedQrCode, setScannedQrCode] = useState('');
  const [scanResult, setScanResult] = useState<{
    tone: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  // Register visitor
  const handleRegisterVisitor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitorName.trim() || !hostName.trim()) return;

    const newVisitor: VisitorRecord = {
      id: `vis-${Date.now()}`,
      visitorName: visitorName.trim(),
      visitorCompany: visitorCompany.trim() || 'Independent Visitor',
      nationalId: nationalId.trim(),
      hostName: hostName.trim(),
      siteId,
      targetZone,
      purpose: purpose.trim() || 'Site Inspection',
      scheduledDate: new Date().toISOString().slice(0, 10),
      approvalStatus: 'PENDING',
      checkInStatus: 'NOT_CHECKED_IN',
      qrToken: `QR-VIS-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
    };

    setVisitors((prev) => [newVisitor, ...prev]);
    setRegisterModalOpen(false);
    setVisitorName('');
    setVisitorCompany('');
    setNationalId('');
    setHostName('');
    setPurpose('');
  };

  // Site Manager approval
  const handleApprove = (id: string, approve: boolean) => {
    setVisitors((prev) =>
      prev.map((v) =>
        v.id === id ? { ...v, approvalStatus: approve ? 'APPROVED' : 'REJECTED' } : v,
      ),
    );
  };

  // Security Officer QR Check-in / Check-out
  const handleVerifyQr = (direction: 'IN' | 'OUT') => {
    if (!scannedQrCode.trim()) return;
    const match = visitors.find((v) => v.qrToken === scannedQrCode.trim());

    if (!match) {
      setScanResult({
        tone: 'error',
        message: 'Invalid Visitor QR token or token not found for this site.',
      });
      return;
    }

    if (match.approvalStatus !== 'APPROVED') {
      setScanResult({
        tone: 'error',
        message: `Visitor "${match.visitorName}" registration is ${match.approvalStatus} and cannot check in.`,
      });
      return;
    }

    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setVisitors((prev) =>
      prev.map((v) => {
        if (v.id === match.id) {
          return {
            ...v,
            checkInStatus: direction === 'IN' ? 'CHECKED_IN' : 'CHECKED_OUT',
            checkInTime: direction === 'IN' ? nowTime : v.checkInTime,
            checkOutTime: direction === 'OUT' ? nowTime : v.checkOutTime,
          };
        }
        return v;
      }),
    );

    setScanResult({
      tone: 'success',
      message: `Cleared ${direction === 'IN' ? 'CHECK-IN' : 'CHECK-OUT'} for ${match.visitorName} (${match.visitorCompany}). Zone: ${match.targetZone}.`,
    });
    setScannedQrCode('');
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Notice: QR ONLY - NO WEBCAM */}
      <section className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50/70 p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <IconKey className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-blue-950">MF04 — Visitor Access Control (QR Only)</h3>
            <p className="text-xs text-blue-700">
              Visitor passes are strictly managed through dynamic QR credentials. Face recognition or webcam capture is never used for visitors.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setRegisterModalOpen(true)}
          className="rounded-xl bg-[#F66B17] px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#e05b0d]"
        >
          + Register New Visitor
        </button>
      </section>

      {/* Security Officer QR Desk Terminal for Visitors */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h3 className="font-bold text-slate-900">Security Desk Visitor QR Check-in Terminal</h3>
        <p className="text-xs text-slate-500">
          Enter or scan visitor QR token to verify Host approval and register gate entry/exit.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Scan or paste Visitor QR token (e.g. QR-VIS-ECOTECH-001-TOKEN)"
            value={scannedQrCode}
            onChange={(e) => setScannedQrCode(e.target.value)}
            className="flex-1 min-w-[280px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#F66B17] focus:outline-none"
          />

          <button
            type="button"
            disabled={!scannedQrCode.trim()}
            onClick={() => handleVerifyQr('IN')}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Check IN Visitor
          </button>

          <button
            type="button"
            disabled={!scannedQrCode.trim()}
            onClick={() => handleVerifyQr('OUT')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Check OUT Visitor
          </button>
        </div>

        {scanResult && (
          <div
            className={`mt-3 rounded-lg p-3 text-xs font-medium ${
              scanResult.tone === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {scanResult.tone === 'success' ? '✓ ' : '⚠️ '}
            {scanResult.message}
          </div>
        )}
      </section>

      {/* Visitor Registrations Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <IconUsers className="h-4 w-4 text-slate-500" />
            <h3 className="font-bold text-slate-900">Today's Visitor Passes & Approvals</h3>
          </div>
          <span className="text-xs text-slate-500">{visitors.length} visitors registered</span>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Visitor</th>
                <th className="px-3 py-2.5">Company / Org</th>
                <th className="px-3 py-2.5">Host</th>
                <th className="px-3 py-2.5">Zone & Purpose</th>
                <th className="px-3 py-2.5">Approval</th>
                <th className="px-3 py-2.5">Check-in Status</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visitors.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50/80">
                  <td className="px-3 py-2.5">
                    <span className="block font-bold text-slate-900">{v.visitorName}</span>
                    <span className="block text-[11px] font-mono text-slate-500">{v.nationalId}</span>
                  </td>
                  <td className="px-3 py-2.5 font-medium">{v.visitorCompany}</td>
                  <td className="px-3 py-2.5 text-slate-600">{v.hostName}</td>
                  <td className="px-3 py-2.5">
                    <span className="block font-semibold text-slate-800">{v.targetZone}</span>
                    <span className="block text-[11px] text-slate-500">{v.purpose}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                        v.approvalStatus === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-700'
                          : v.approvalStatus === 'REJECTED'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {v.approvalStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                        v.checkInStatus === 'CHECKED_IN'
                          ? 'bg-emerald-100 text-emerald-800'
                          : v.checkInStatus === 'CHECKED_OUT'
                          ? 'bg-slate-100 text-slate-700'
                          : 'bg-slate-50 text-slate-500'
                      }`}
                    >
                      {v.checkInStatus === 'CHECKED_IN'
                        ? `IN (${v.checkInTime})`
                        : v.checkInStatus === 'CHECKED_OUT'
                        ? `OUT (${v.checkOutTime})`
                        : 'NOT PRESENT'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right space-x-1">
                    {v.approvalStatus === 'PENDING' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApprove(v.id, true)}
                          className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApprove(v.id, false)}
                          className="rounded bg-red-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-red-700"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setScannedQrCode(v.qrToken);
                        setInspectQrVisitor(v);
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      View QR Pass
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* View QR Pass Modal */}
      {inspectQrVisitor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setInspectQrVisitor(null)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-[#F66B17]">
              <IconKey className="h-6 w-6" />
            </div>

            <h3 className="mt-3 text-lg font-bold text-slate-900">{inspectQrVisitor.visitorName}</h3>
            <p className="text-xs text-slate-500">{inspectQrVisitor.visitorCompany}</p>

            {/* QR Mock graphic box */}
            <div className="mx-auto my-4 flex h-48 w-48 flex-col items-center justify-center rounded-2xl border-2 border-slate-900 bg-slate-50 p-4 shadow-inner">
              <div className="grid grid-cols-6 gap-1">
                {Array.from({ length: 36 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-4 w-4 rounded-xs ${
                      (i * 7 + 3) % 4 === 0 || (i > 0 && i < 4) || (i > 30 && i < 35)
                        ? 'bg-slate-900'
                        : 'bg-white border border-slate-200'
                    }`}
                  />
                ))}
              </div>
              <p className="mt-3 font-mono text-[10px] text-slate-600">{inspectQrVisitor.qrToken}</p>
            </div>

            <p className="text-[11px] text-slate-500">
              Authorized for: <span className="font-semibold text-slate-800">{inspectQrVisitor.targetZone}</span>
            </p>
            <p className="text-[10px] text-amber-700">
              Valid for {inspectQrVisitor.scheduledDate} only. QR does not include biometric data.
            </p>

            <button
              type="button"
              onClick={() => setInspectQrVisitor(null)}
              className="mt-5 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800"
            >
              Close Pass
            </button>
          </div>
        </div>
      )}

      {/* Register Visitor Modal */}
      {registerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900">Register Construction Site Visitor</h3>
              <button
                type="button"
                onClick={() => setRegisterModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRegisterVisitor} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Visitor Full Name *</label>
                <input
                  required
                  type="text"
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  placeholder="e.g. Nguyen Van B"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#F66B17] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Company / Organization</label>
                <input
                  type="text"
                  value={visitorCompany}
                  onChange={(e) => setVisitorCompany(e.target.value)}
                  placeholder="e.g. ABC Concrete Testing Ltd"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#F66B17] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">National ID / Passport</label>
                <input
                  type="text"
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  placeholder="e.g. 079201004921"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-[#F66B17] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Internal Host (Site Staff) *</label>
                <input
                  required
                  type="text"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="e.g. Tran Van Bao (Safety Officer)"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#F66B17] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Target Zone</label>
                <select
                  value={targetZone}
                  onChange={(e) => setTargetZone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#F66B17] focus:outline-none"
                >
                  <option value="Zone A — Office & Ground">Zone A — Office & Ground</option>
                  <option value="Zone B — Foundation Pouring">Zone B — Foundation Pouring</option>
                  <option value="Zone C — Tower Crane Perimeter">Zone C — Tower Crane Perimeter</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Purpose of Visit</label>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g. Safety audit, concrete inspection"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#F66B17] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setRegisterModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#F66B17] px-5 py-2 text-xs font-bold text-white hover:bg-[#e05b0d]"
                >
                  Submit Registration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
