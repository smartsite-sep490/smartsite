import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import type { SmartSiteManagementClient, WorkerComplianceResponse } from '@smartsite/api-client';
import { translate as tr } from '../../i18n';
import { userErrorMessage } from '../../i18n/messages';

export function WorkerDocumentQuickScan({
  client,
  token,
  siteId,
  profiles,
  onUpdated,
  onActiveChange,
  disabled = false,
}: {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  profiles: WorkerComplianceResponse[];
  onUpdated: () => void;
  onActiveChange?: (workerId: string | null) => void;
  disabled?: boolean;
}) {
  const stop = useRef(false);
  const mounted = useRef(true);
  const [progress, setProgress] = useState({
    done: 0,
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  const work = profiles.flatMap((profile) =>
    profile.documents
      .filter(
        (doc) =>
          doc.status === 'PENDING' &&
          doc.aiAnalysis?.status !== 'COMPLETE' &&
          doc.aiAnalysis?.status !== 'ANALYZING',
      )
      .map((doc) => ({ workerId: profile.workerId, id: doc.id })),
  );
  const scan = useMutation({
    retry: false,
    mutationFn: async () => {
      stop.current = false;
      const counters = { done: 0, total: work.length, success: 0, failed: 0, skipped: 0 };
      setProgress({ ...counters });
      for (const item of work) {
        if (stop.current) break;
        if (mounted.current) onActiveChange?.(item.workerId);
        try {
          await client.analyzeWorkerDocument(token, siteId, item.workerId, item.id);
          const updated = await client.workerCompliance(token, siteId, item.workerId);
          if (
            updated.documents.find((doc) => doc.id === item.id)?.aiAnalysis?.status === 'COMPLETE'
          )
            counters.success++;
          else counters.failed++;
        } catch (error) {
          if (error instanceof ApiError && (error.status === 409 || error.status === 404))
            counters.skipped++;
          else counters.failed++;
          if (
            error instanceof ApiError &&
            (error.status === 401 ||
              error.status === 403 ||
              error.code === 'timeout' ||
              error.code === 'network')
          )
            stop.current = true;
        }
        counters.done++;
        if (mounted.current) {
          setProgress({ ...counters });
          onActiveChange?.(null);
          onUpdated();
        }
      }
    },
  });
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-700">
        {tr('documents.scanSelection', { profiles: profiles.length, documents: work.length })}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || !work.length || scan.isPending}
          onClick={() => scan.mutate()}
          className="rounded-xl bg-[var(--action-primary)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--action-primary-hover)] disabled:opacity-50"
        >
          {tr('documents.quickScan')}
        </button>
        {scan.isPending && (
          <button
            type="button"
            onClick={() => {
              stop.current = true;
            }}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
          >
            {tr('documents.stopScan')}
          </button>
        )}
      </div>
      {progress.total > 0 && (
        <div role="status" aria-live="polite" className="space-y-1 text-xs text-slate-600">
          <progress
            className="w-full accent-orange-500"
            max={progress.total}
            value={progress.done}
          />
          <p>{tr('documents.scanProgress', { ...progress })}</p>
        </div>
      )}
      {scan.isError && (
        <p role="alert" className="text-sm text-red-700">
          {userErrorMessage(scan.error)}
        </p>
      )}
    </div>
  );
}

export function WorkerDocumentAiStatus({
  profile,
  running = false,
}: {
  profile: WorkerComplianceResponse;
  running?: boolean;
}) {
  const summary = profile.aiSummary;
  const status =
    summary?.status === 'ATTENTION'
      ? 'ATTENTION'
      : running
        ? 'ANALYZING'
        : (summary?.status ?? 'NOT_SCANNED');
  const tone =
    status === 'ATTENTION'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : status === 'NO_DISCREPANCY'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span
      className={
        'inline-flex flex-wrap gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ' + tone
      }
    >
      {tr('documents.aiStatus.' + status)}
      {!!summary?.unresolved && (
        <span>· {tr('documents.scanUnresolved', { count: summary.unresolved })}</span>
      )}
    </span>
  );
}
