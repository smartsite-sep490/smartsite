import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, WorkerScheduleResponse } from '@smartsite/api-client';
import { DoubleBezelCard, PillButton, Modal } from './WorkforceSharedUI';

export function WorkforceScheduleTab({ apiUrl, siteId, token }: { apiUrl: string, siteId: string, token: string }) {
  const queryClient = useQueryClient();
  const [selectedSchedule, setSelectedSchedule] = useState<WorkerScheduleResponse | null>(null);
  const [modalType, setModalType] = useState<'swap' | 'change' | 'absence' | null>(null);

  const { data: schedules, isLoading: schedLoading, isError: schedError } = useQuery({
    queryKey: ['worker-schedules', siteId],
    queryFn: () => new SmartSiteManagementClient(apiUrl).listWorkerSchedules(token, siteId, { limit: 100 })
  });
  const { data: shifts } = useQuery({
    queryKey: ['shifts', siteId],
    queryFn: () => new SmartSiteManagementClient(apiUrl).listShifts(token, siteId, { limit: 100 })
  });
  const { data: coworkers } = useQuery({
    queryKey: ['coworkers', siteId],
    queryFn: () => new SmartSiteManagementClient(apiUrl).listCoworkers(token, siteId, { limit: 100 })
  });

  const { data: workers } = useQuery({
    queryKey: ['workers', siteId],
    queryFn: () => new SmartSiteManagementClient(apiUrl).listWorkers(token, siteId, { limit: 100 })
  });

  const { data: swapRequests } = useQuery({
    queryKey: ['swap-requests', siteId],
    queryFn: () => new SmartSiteManagementClient(apiUrl).listShiftSwapRequests(token, siteId, { limit: 100 })
  });

  const { data: changeRequests } = useQuery({
    queryKey: ['shift-change-requests', siteId],
    queryFn: () => new SmartSiteManagementClient(apiUrl).listShiftChangeRequests(token, siteId, { limit: 100 })
  });

  const { data: absenceRequests } = useQuery({
    queryKey: ['absence-requests', siteId],
    queryFn: () => new SmartSiteManagementClient(apiUrl).listAbsenceRequests(token, siteId, { limit: 100 })
  });

  const createSwap = useMutation({
    mutationFn: (data: { requesterWorkerScheduleId: string, coworkerWorkerScheduleId: string, reason: string }) =>
      new SmartSiteManagementClient(apiUrl).createShiftSwapRequest(token, siteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worker-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['swap-requests'] });
      queryClient.invalidateQueries({ queryKey: ['swap'] });
      setModalType(null);
    }
  });

  const createChange = useMutation({
    mutationFn: (data: { workerScheduleId: string, toShiftId: string, reason: string }) =>
      new SmartSiteManagementClient(apiUrl).createShiftChangeRequest(token, siteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worker-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['change'] });
      queryClient.invalidateQueries({ queryKey: ['shift-change-requests'] });
      setModalType(null);
    }
  });

  const createAbsence = useMutation({
    mutationFn: (data: { workerScheduleId: string, replacementWorkerId?: string, reason: string }) =>
      new SmartSiteManagementClient(apiUrl).createAbsenceRequest(token, siteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worker-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['absence'] });
      queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
      setModalType(null);
    }
  });

  const confirmSwap = useMutation({
    mutationFn: (requestId: string) =>
      new SmartSiteManagementClient(apiUrl).confirmShiftSwapRequest(token, siteId, requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-requests'] });
      queryClient.invalidateQueries({ queryKey: ['swap'] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules'] });
    }
  });

  const handleOpenModal = (type: 'swap' | 'change' | 'absence', schedule: WorkerScheduleResponse) => {
    setSelectedSchedule(schedule);
    setModalType(type);
  };

  const getWorkerName = (workerId: string) => {
    const w = workers?.items.find(item => item.id === workerId) || coworkers?.items.find(item => item.id === workerId);
    return w ? w.displayName : `Worker (${workerId.slice(0, 6)})`;
  };

  const eligibleSwapSchedules = schedules?.items.filter(s => s.id !== selectedSchedule?.id) || [];

  return (
    <div className="space-y-12">
      
      {/* COWORKER INBOX */}
      {swapRequests?.items.some(req => req.status === 'PENDING_COWORKER') && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold tracking-tight text-amber-600 flex items-center gap-2">
            Action Required: Shift Swaps
          </h2>
          <div className="grid gap-4">
            {swapRequests.items.filter(r => r.status === 'PENDING_COWORKER').map(req => (
              <DoubleBezelCard key={req.id} className="bg-amber-50/50 ring-amber-100">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-slate-900 mb-1">Swap Request from {getWorkerName(req.requesterWorkerId)}</h3>
                    <p className="text-slate-600 text-sm">They want to swap a shift with you. Reason: {req.reason || 'None'}</p>
                  </div>
                  <div className="flex gap-2">
                    <PillButton onClick={() => confirmSwap.mutate(req.id)} disabled={confirmSwap.isPending} variant="success">
                      Accept Swap
                    </PillButton>
                  </div>
                </div>
              </DoubleBezelCard>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Assigned Shifts</h2>
      
      {schedLoading && <div className="text-slate-500 animate-pulse">Loading schedules...</div>}
      {schedError && <div className="text-red-500">Failed to load schedules. Please try again.</div>}
      
      {!schedLoading && !schedError && !schedules?.items.length ? (
        <DoubleBezelCard>
          <div className="text-slate-400 text-sm">No schedules found.</div>
        </DoubleBezelCard>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {schedules?.items.map(sched => {
            const shift = shifts?.items.find(s => s.id === sched.shiftId);
            const workerName = getWorkerName(sched.workerId);
            return (
              <DoubleBezelCard key={sched.id}>
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded text-slate-500">{sched.workDate}</span>
                  <div className={`w-2 h-2 rounded-full ${sched.isActive ? 'bg-emerald-400' : 'bg-slate-300'}`} title={sched.isActive ? 'Active' : 'Inactive'} />
                </div>
                <h3 className="font-bold text-lg text-slate-900">{shift?.name || 'Unknown Shift'}</h3>
                <p className="text-xs text-slate-400 font-medium mb-1">{workerName}</p>
                <p className="text-slate-500 text-sm mt-1 mb-6">{shift?.startsAt} - {shift?.endsAt}</p>
                <div className="space-y-2">
                  <PillButton onClick={() => handleOpenModal('swap', sched)} variant="secondary">Request Swap</PillButton>
                  <PillButton onClick={() => handleOpenModal('change', sched)} variant="secondary">Request Change</PillButton>
                  <PillButton onClick={() => handleOpenModal('absence', sched)} variant="danger">Request Absence</PillButton>
                </div>
              </DoubleBezelCard>
            );
          })}
        </div>
      )}
      </div>

      {/* REQUEST HISTORY & STATUS */}
      {((changeRequests?.items.length ?? 0) > 0 || (swapRequests?.items.length ?? 0) > 0 || (absenceRequests?.items.length ?? 0) > 0) && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Request History & Status</h2>
          <div className="space-y-3">
            {changeRequests?.items.map(req => (
              <DoubleBezelCard key={req.id}>
                <div className="flex justify-between items-center text-sm">
                  <div>
                    <span className="font-semibold text-slate-800">Shift Change Request</span>
                    <p className="text-slate-500 text-xs mt-0.5">{req.reason}</p>
                  </div>
                  <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-bold uppercase">{req.status}</span>
                </div>
              </DoubleBezelCard>
            ))}
            {swapRequests?.items.map(req => (
              <DoubleBezelCard key={req.id}>
                <div className="flex justify-between items-center text-sm">
                  <div>
                    <span className="font-semibold text-slate-800">Shift Swap Request ({getWorkerName(req.requesterWorkerId)} ↔ {getWorkerName(req.coworkerWorkerId)})</span>
                    <p className="text-slate-500 text-xs mt-0.5">{req.reason}</p>
                  </div>
                  <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-bold uppercase">{req.status}</span>
                </div>
              </DoubleBezelCard>
            ))}
            {absenceRequests?.items.map(req => (
              <DoubleBezelCard key={req.id}>
                <div className="flex justify-between items-center text-sm">
                  <div>
                    <span className="font-semibold text-slate-800">Absence Request</span>
                    <p className="text-slate-500 text-xs mt-0.5">{req.reason}</p>
                  </div>
                  <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-bold uppercase">{req.status}</span>
                </div>
              </DoubleBezelCard>
            ))}
          </div>
        </div>
      )}

      {/* SWAP MODAL */}
      <Modal isOpen={modalType === 'swap'} onClose={() => setModalType(null)} title="Request Shift Swap">
        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          createSwap.mutate({
            requesterWorkerScheduleId: selectedSchedule!.id,
            coworkerWorkerScheduleId: fd.get('coworkerWorkerScheduleId') as string,
            reason: fd.get('reason') as string
          });
        }} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Select Coworker Schedule</label>
            <select name="coworkerWorkerScheduleId" required className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-[#0A1118]">
              <option value="">-- Select Target Schedule --</option>
              {eligibleSwapSchedules.map(s => {
                const shift = shifts?.items.find(item => item.id === s.shiftId);
                const name = getWorkerName(s.workerId);
                return (
                  <option key={s.id} value={s.id}>
                    {s.workDate} - {name} ({shift?.name || 'Shift'})
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Reason</label>
            <textarea name="reason" required className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-[#0A1118]" />
          </div>
          <div className="pt-4">
            <PillButton type="submit" disabled={createSwap.isPending}>
              {createSwap.isPending ? 'Submitting...' : 'Submit Swap Request'}
            </PillButton>
            {createSwap.isError && <p className="text-red-500 text-sm mt-2">{createSwap.error?.message || 'Failed to submit request.'}</p>}
          </div>
        </form>
      </Modal>

      {/* CHANGE MODAL */}
      <Modal isOpen={modalType === 'change'} onClose={() => setModalType(null)} title="Request Shift Change">
        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          createChange.mutate({
            workerScheduleId: selectedSchedule!.id,
            toShiftId: fd.get('toShiftId') as string,
            reason: fd.get('reason') as string
          });
        }} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Select New Shift</label>
            <select name="toShiftId" required className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-[#0A1118]">
              <option value="">-- Choose Shift --</option>
              {shifts?.items.map(s => <option key={s.id} value={s.id}>{s.name} ({s.startsAt} - {s.endsAt})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Reason</label>
            <textarea name="reason" required className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-[#0A1118]" />
          </div>
          <div className="pt-4">
            <PillButton type="submit" disabled={createChange.isPending}>
              {createChange.isPending ? 'Submitting...' : 'Submit Change Request'}
            </PillButton>
            {createChange.isError && <p className="text-red-500 text-sm mt-2">{createChange.error?.message || 'Failed to submit request.'}</p>}
          </div>
        </form>
      </Modal>

      {/* ABSENCE MODAL */}
      <Modal isOpen={modalType === 'absence'} onClose={() => setModalType(null)} title="Request Absence">
        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const repId = fd.get('replacementWorkerId') as string;
          createAbsence.mutate({
            workerScheduleId: selectedSchedule!.id,
            replacementWorkerId: repId || undefined,
            reason: fd.get('reason') as string
          });
        }} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Reason</label>
            <textarea name="reason" required className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-[#0A1118]" />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Replacement Coworker (Optional)</label>
            <select name="replacementWorkerId" className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-[#0A1118]">
              <option value="">-- None --</option>
              {(workers?.items || coworkers?.items || []).map(c => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">Contractor Representatives can suggest a replacement worker.</p>
          </div>
          <div className="pt-4">
            <PillButton type="submit" disabled={createAbsence.isPending} variant="danger">
              {createAbsence.isPending ? 'Submitting...' : 'Submit Absence Request'}
            </PillButton>
            {createAbsence.isError && <p className="text-red-500 text-sm mt-2">{createAbsence.error?.message || 'Failed to submit request.'}</p>}
          </div>
        </form>
      </Modal>
    </div>
  );
}
