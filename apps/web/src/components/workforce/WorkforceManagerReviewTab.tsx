import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { PillButton } from './WorkforceSharedUI';

export function WorkforceManagerReviewTab({ apiUrl, siteId, token }: { apiUrl: string, siteId: string, token: string }) {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<'change' | 'swap' | 'absence'>('change');
  
  const { data: changes, isLoading: changesLoading } = useQuery({ queryKey: ['change', siteId], queryFn: () => new SmartSiteManagementClient(apiUrl).listShiftChangeRequests(token, siteId, { limit: 100 }) });
  const { data: swaps, isLoading: swapsLoading } = useQuery({ queryKey: ['swap', siteId], queryFn: () => new SmartSiteManagementClient(apiUrl).listShiftSwapRequests(token, siteId, { limit: 100 }) });
  const { data: absences, isLoading: absencesLoading } = useQuery({ queryKey: ['absence', siteId], queryFn: () => new SmartSiteManagementClient(apiUrl).listAbsenceRequests(token, siteId, { limit: 100 }) });
  const { data: workers } = useQuery({ queryKey: ['workers', siteId], queryFn: () => new SmartSiteManagementClient(apiUrl).listWorkers(token, siteId, { limit: 100 }) });
  const { data: shifts } = useQuery({ queryKey: ['shifts', siteId], queryFn: () => new SmartSiteManagementClient(apiUrl).listShifts(token, siteId, { limit: 100 }) });

  const getWorkerName = (id: string) => workers?.items.find(w => w.id === id)?.displayName || `Worker (${id.slice(0, 6)})`;
  const getShiftName = (id: string) => shifts?.items.find(s => s.id === id)?.name || `Shift (${id.slice(0, 6)})`;

  const approveChange = useMutation({
    mutationFn: (id: string) => new SmartSiteManagementClient(apiUrl).approveShiftChangeRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change'] });
      queryClient.invalidateQueries({ queryKey: ['shift-change-requests'] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules'] });
    }
  });
  const rejectChange = useMutation({
    mutationFn: (id: string) => new SmartSiteManagementClient(apiUrl).rejectShiftChangeRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change'] });
      queryClient.invalidateQueries({ queryKey: ['shift-change-requests'] });
    }
  });

  const approveSwap = useMutation({
    mutationFn: (id: string) => new SmartSiteManagementClient(apiUrl).approveShiftSwapRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap'] });
      queryClient.invalidateQueries({ queryKey: ['swap-requests'] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules'] });
    }
  });
  const rejectSwap = useMutation({
    mutationFn: (id: string) => new SmartSiteManagementClient(apiUrl).rejectShiftSwapRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['swap'] });
      queryClient.invalidateQueries({ queryKey: ['swap-requests'] });
    }
  });

  const approveAbsence = useMutation({
    mutationFn: (id: string) => new SmartSiteManagementClient(apiUrl).approveAbsenceRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence'] });
      queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
      queryClient.invalidateQueries({ queryKey: ['worker-schedules'] });
    }
  });
  const rejectAbsence = useMutation({
    mutationFn: (id: string) => new SmartSiteManagementClient(apiUrl).rejectAbsenceRequest(token, siteId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence'] });
      queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
    }
  });

  const isLoading = (subTab === 'change' && changesLoading) || (subTab === 'swap' && swapsLoading) || (subTab === 'absence' && absencesLoading);

  return (
    <div className="space-y-8">
      <div className="flex gap-2">
        <button onClick={() => setSubTab('change')} className={`px-4 py-2 rounded-full text-sm font-bold transition-all duration-300 ${subTab === 'change' ? 'bg-[#0A1118] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Shift Changes</button>
        <button onClick={() => setSubTab('swap')} className={`px-4 py-2 rounded-full text-sm font-bold transition-all duration-300 ${subTab === 'swap' ? 'bg-[#0A1118] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Shift Swaps</button>
        <button onClick={() => setSubTab('absence')} className={`px-4 py-2 rounded-full text-sm font-bold transition-all duration-300 ${subTab === 'absence' ? 'bg-[#0A1118] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Absences</button>
      </div>

      <div className="space-y-4">
        {isLoading && <div className="text-slate-500 animate-pulse">Loading requests...</div>}
        
        {subTab === 'change' && changes?.items.length === 0 && <div className="text-slate-400">No shift change requests found.</div>}
        {subTab === 'change' && changes?.items.map(req => (
          <div key={req.id} className="flex items-center justify-between p-6 bg-white border border-slate-200 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
            <div>
              <div className="flex gap-2 items-center mb-1">
                <span className="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded uppercase tracking-wider text-slate-600">{req.status}</span>
                <span className="text-sm font-medium text-slate-500">{getWorkerName(req.workerId)} (To: {getShiftName(req.toShiftId)})</span>
              </div>
              <p className="text-slate-900 font-medium">{req.reason || 'No reason provided'}</p>
            </div>
            {req.status === 'PENDING_MANAGER' && (
              <div className="flex gap-2">
                <PillButton onClick={() => rejectChange.mutate(req.id)} disabled={rejectChange.isPending} variant="danger">Reject</PillButton>
                <PillButton onClick={() => approveChange.mutate(req.id)} disabled={approveChange.isPending} variant="success">Approve</PillButton>
              </div>
            )}
          </div>
        ))}

        {subTab === 'swap' && swaps?.items.length === 0 && <div className="text-slate-400">No shift swap requests found.</div>}
        {subTab === 'swap' && swaps?.items.map(req => (
          <div key={req.id} className="flex items-center justify-between p-6 bg-white border border-slate-200 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
            <div>
              <div className="flex gap-2 items-center mb-1">
                <span className="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded uppercase tracking-wider text-slate-600">{req.status}</span>
                <span className="text-sm font-medium text-slate-500">{getWorkerName(req.requesterWorkerId)} → {getWorkerName(req.coworkerWorkerId)}</span>
              </div>
              <p className="text-slate-900 font-medium">{req.reason || 'No reason provided'}</p>
            </div>
            {req.status === 'PENDING_MANAGER' && (
              <div className="flex gap-2">
                <PillButton onClick={() => rejectSwap.mutate(req.id)} disabled={rejectSwap.isPending} variant="danger">Reject</PillButton>
                <PillButton onClick={() => approveSwap.mutate(req.id)} disabled={approveSwap.isPending} variant="success">Approve</PillButton>
              </div>
            )}
          </div>
        ))}

        {subTab === 'absence' && absences?.items.length === 0 && <div className="text-slate-400">No absence requests found.</div>}
        {subTab === 'absence' && absences?.items.map(req => (
          <div key={req.id} className="flex items-center justify-between p-6 bg-white border border-slate-200 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
            <div>
              <div className="flex gap-2 items-center mb-1">
                <span className="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded uppercase tracking-wider text-slate-600">{req.status}</span>
                <span className="text-sm font-medium text-slate-500">{getWorkerName(req.workerId)}</span>
                {req.replacementWorkerId && <span className="text-xs text-slate-400">(Replacement: {getWorkerName(req.replacementWorkerId)})</span>}
                {req.isUnderstaffed && <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">Understaffed Risk</span>}
              </div>
              <p className="text-slate-900 font-medium">{req.reason || 'No reason provided'}</p>
            </div>
            {req.status === 'PENDING_MANAGER' && (
              <div className="flex gap-2">
                <PillButton onClick={() => rejectAbsence.mutate(req.id)} disabled={rejectAbsence.isPending} variant="danger">Reject</PillButton>
                <PillButton onClick={() => approveAbsence.mutate(req.id)} disabled={approveAbsence.isPending} variant="success">Approve</PillButton>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
