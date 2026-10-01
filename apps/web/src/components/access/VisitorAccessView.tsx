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
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-blue-200/90 bg-gradient-to-r from-blue-50/80 via-white to-blue-50/30 p-5 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 ring-1 ring-blue-500/20">
            <IconKey className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-800">
                MF04 · Dynamic QR Visitor Pass
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600">
                QR Only · No Biometrics
              </span>
            </div>
            <h3 className="mt-1 text-base font-bold text-slate-900">
              Site Visitor Access & Pass Control
            </h3>
            <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
              Visitor passes are provisioned via time-bound dynamic QR tokens with specific zone authorizations. Biometric data collection is strictly prohibited for temporary visitors.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setRegisterModalOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-[#F66B17] px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-orange-500/15 hover:bg-[#e05b0d] hover:shadow-lg transition-all"
        >
          <span>+ Register New Visitor</span>
        </button>
      </section>

      {/* Security Officer QR Desk Terminal for Visitors */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="font-bold text-slate-900 text-sm">
            Security Desk Visitor QR Terminal
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Scan or enter visitor QR token to verify host sponsorship and log gate entry or exit.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[280px]">
            <input
              type="text"
              placeholder="Scan or paste QR Token (e.g. QR-VIS-ECOTECH-001-TOKEN)"
              value={scannedQrCode}
              onChange={(e) => setScannedQrCode(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-mono placeholder:font-sans placeholder:text-slate-400 focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15 transition-all"
            />
          </div>

          <button
            type="button"
            disabled={!scannedQrCode.trim()}
            onClick={() => handleVerifyQr('IN')}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40 transition-all"
          >
            <IconCheck className="h-4 w-4" />
            <span>CHECK IN</span>
          </button>

          <button
            type="button"
            disabled={!scannedQrCode.trim()}
            onClick={() => handleVerifyQr('OUT')}
            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40 transition-all"
          >
            <IconKey className="h-4 w-4" />
            <span>CHECK OUT</span>
          </button>
        </div>

        {scanResult && (
          <div
            className={`rounded-xl p-3.5 text-xs font-semibold flex items-center gap-2 ${
              scanResult.tone === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {scanResult.tone === 'success' ? (
              <IconCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <IconAlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            )}
            <span>{scanResult.message}</span>
          </div>
        )}
      </section>

      {/* Visitor Registrations Table */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <IconUsers className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Daily Site Visitor Registry</h3>
              <p className="text-[11px] text-slate-500">Monitor visitor registrations, host authorizations, and real-time gate movements</p>
            </div>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
            {visitors.length} visitors registered
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3.5 py-3">Visitor Name & ID</th>
                <th className="px-3.5 py-3">Organization / Company</th>
                <th className="px-3.5 py-3">Internal Host</th>
                <th className="px-3.5 py-3">Target Zone & Purpose</th>
                <th className="px-3.5 py-3">Approval</th>
                <th className="px-3.5 py-3">Site Presence</th>
                <th className="px-3.5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visitors.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-3.5 py-3">
                    <span className="block font-bold text-slate-900">{v.visitorName}</span>
                    <span className="block text-[11px] font-mono text-slate-500">{v.nationalId}</span>
                  </td>
                  <td className="px-3.5 py-3 font-semibold text-slate-800">{v.visitorCompany}</td>
                  <td className="px-3.5 py-3 text-slate-600 font-medium">{v.hostName}</td>
                  <td className="px-3.5 py-3">
                    <span className="block font-bold text-slate-800">{v.targetZone}</span>
                    <span className="block text-[11px] text-slate-500">{v.purpose}</span>
                  </td>
                  <td className="px-3.5 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        v.approvalStatus === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-500/20'
                          : v.approvalStatus === 'REJECTED'
                          ? 'bg-red-100 text-red-800 ring-1 ring-red-500/20'
                          : 'bg-amber-100 text-amber-800 ring-1 ring-amber-500/20'
                      }`}
                    >
                      {v.approvalStatus === 'APPROVED' ? 'Approved' : v.approvalStatus === 'REJECTED' ? 'Rejected' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-3.5 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        v.checkInStatus === 'CHECKED_IN'
                          ? 'bg-emerald-100 text-emerald-800'
                          : v.checkInStatus === 'CHECKED_OUT'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {v.checkInStatus === 'CHECKED_IN'
                        ? `IN SITE (${v.checkInTime})`
                        : v.checkInStatus === 'CHECKED_OUT'
                        ? `LEFT SITE (${v.checkOutTime})`
                        : 'NOT PRESENT'}
                    </span>
                  </td>
                  <td className="px-3.5 py-3 text-right space-x-1.5 whitespace-nowrap">
                    {v.approvalStatus === 'PENDING' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApprove(v.id, true)}
                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 shadow-2xs transition-all"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApprove(v.id, false)}
                          className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-700 shadow-2xs transition-all"
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
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 shadow-2xs transition-all"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setInspectQrVisitor(null)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-[#F66B17] shadow-inner ring-1 ring-orange-500/20">
              <IconKey className="h-6 w-6" />
            </div>

            <h3 className="mt-3 text-lg font-bold text-slate-900">{inspectQrVisitor.visitorName}</h3>
            <p className="text-xs font-semibold text-slate-500">{inspectQrVisitor.visitorCompany}</p>

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
              <p className="mt-3 font-mono text-[10px] font-bold text-slate-700">{inspectQrVisitor.qrToken}</p>
            </div>

            <p className="text-xs text-slate-600">
              Authorized Zone: <span className="font-bold text-slate-900">{inspectQrVisitor.targetZone}</span>
            </p>
            <p className="mt-1 text-[11px] text-amber-700 font-medium">
              Valid only for {inspectQrVisitor.scheduledDate}. Temporary pass does not store biometric data.
            </p>

            <button
              type="button"
              onClick={() => setInspectQrVisitor(null)}
              className="mt-5 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800 shadow-sm transition-all"
            >
              Close Pass
            </button>
          </div>
        </div>
      )}

      {/* Register Visitor Modal */}
      {registerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <IconKey className="h-5 w-5 text-[#F66B17]" />
                <h3 className="font-bold text-slate-900">Register Site Visitor</h3>
              </div>
              <button
                type="button"
                onClick={() => setRegisterModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRegisterVisitor} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">Visitor Full Name *</label>
                <input
                  required
                  type="text"
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  placeholder="e.g. Nguyen Van B"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">Organization / Company</label>
                <input
                  type="text"
                  value={visitorCompany}
                  onChange={(e) => setVisitorCompany(e.target.value)}
                  placeholder="e.g. ABC Concrete Testing Ltd"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">National ID / Passport No.</label>
                <input
                  type="text"
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  placeholder="e.g. 079201004921"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs font-mono focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">Internal Host Sponsor *</label>
                <input
                  required
                  type="text"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="e.g. Tran Van Bao (Safety Officer)"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">Authorized Site Zone</label>
                <select
                  value={targetZone}
                  onChange={(e) => setTargetZone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs font-semibold text-slate-800 focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15"
                >
                  <option value="Zone A — Office & Ground">Zone A — Office & Main Gate</option>
                  <option value="Zone B — Foundation Pouring">Zone B — Foundation Pouring Zone</option>
                  <option value="Zone C — Tower Crane Perimeter">Zone C — Tower Crane Perimeter</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">Purpose of Visit</label>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g. Safety inspection, concrete specimen testing"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRegisterModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#F66B17] px-5 py-2 text-xs font-bold text-white hover:bg-[#e05b0d] shadow-sm transition-all"
                >
                  Confirm Registration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
