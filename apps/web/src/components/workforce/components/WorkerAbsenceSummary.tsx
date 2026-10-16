import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../../i18n';
import { WORKFORCE_POLL_INTERVAL_MS } from '../constants/workforce.constants';

export function WorkerAbsenceSummary({
  apiUrl,
  token,
  siteId,
  workerId,
  sessionScope,
  fromDate,
  toDate,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  workerId?: string;
  sessionScope: string;
  fromDate?: string;
  toDate?: string;
}) {
  useTranslation();
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const absence = useQuery({
    queryKey: ['worker-absence-count', apiUrl, sessionScope, siteId, workerId, fromDate, toDate],
    enabled: !!workerId && !!token,
    queryFn: () =>
      client.attendanceDays(token, siteId, {
        workerId,
        fromDate,
        toDate,
        status: 'ABSENT',
        limit: 1,
      }),
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    retry: false,
  });
  return (
    <section
      aria-label={tr('worker_absence.title')}
      className="w-full min-w-[220px] rounded-2xl border border-rose-200 bg-white p-4 shadow-sm sm:w-[240px]"
    >
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
        {tr('worker_absence.title')}
      </h2>
      {absence.isError ? (
        <div role="alert" className="mt-2 text-xs text-rose-700">
          {tr('worker_absence.unavailable')}{' '}
          <button
            type="button"
            className="underline focus-visible:outline-2 focus-visible:outline-blue-600"
            onClick={() => void absence.refetch()}
          >
            {tr('common.retry')}
          </button>
        </div>
      ) : !workerId || absence.isPending ? (
        <p role="status" className="mt-2 text-xs text-slate-500">
          {tr('common.loading')}
        </p>
      ) : (
        <p className="mt-1 text-2xl font-black text-rose-700">
          {absence.data.total}{' '}
          <span className="text-xs font-medium">{tr('worker_absence.days')}</span>
        </p>
      )}
    </section>
  );
}
