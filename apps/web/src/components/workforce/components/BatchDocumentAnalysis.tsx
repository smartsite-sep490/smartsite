import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SmartSiteManagementClient, WorkerDocumentResponse } from '@smartsite/api-client';
import { Sparkle } from '@phosphor-icons/react';
import { translate as tr } from '../../../i18n';
import { documentButton } from './DocumentAttachmentInput';
import { WorkerDocumentAnalysisNotice } from './WorkerDocumentAnalysisNotice';

const summaries = {
  attention: ['workerIntake.aiAttentionCount', 'bg-red-50 text-red-800'],
  insufficient: ['workerIntake.aiInsufficientCount', 'bg-amber-50 text-amber-900'],
  unavailable: ['workerIntake.aiUnavailableCount', 'bg-slate-100 text-slate-700'],
  clear: ['workerIntake.aiClearCount', 'bg-emerald-50 text-emerald-800'],
} as const;

function analysisOutcome(analysis: WorkerDocumentResponse['aiAnalysis']): keyof typeof summaries {
  if (!analysis || analysis.status === 'UNAVAILABLE') return 'unavailable';
  if (analysis.status === 'ANALYZING') return 'insufficient';
  if (
    analysis.kindMismatch ||
    analysis.dateCheck.status === 'MISMATCH' ||
    analysis.startDateCheck?.status === 'MISMATCH' ||
    analysis.validity === 'EXPIRED' ||
    analysis.validity === 'NOT_YET_VALID'
  ) {
    return 'attention';
  }
  return analysis.detectedKind &&
    analysis.dateCheck.status === 'MATCH' &&
    (!analysis.startDateCheck || analysis.startDateCheck.status === 'MATCH') &&
    analysis.validity === 'CURRENT'
    ? 'clear'
    : 'insufficient';
}

type SelectedWorker = { id: string; name: string };
type CertificateResult = Pick<WorkerDocumentResponse, 'id' | 'kind' | 'aiAnalysis'>;
const unavailable = { status: 'UNAVAILABLE' } as const;

export function BatchDocumentAnalysis(p: {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  workers: SelectedWorker[];
  disabled?: boolean;
}) {
  useTranslation();
  const cache = useQueryClient();
  const scan = useMutation({
    mutationFn: async (selected: SelectedWorker[]) => {
      const counts = { attention: 0, insufficient: 0, unavailable: 0, clear: 0 };
      const workers: (SelectedWorker & { certificates: CertificateResult[] | null })[] = [];
      for (const worker of selected) {
        const workerId = worker.id;
        try {
          const profile = await p.client.workerCompliance(p.token, p.siteId, workerId);
          const drafts = profile.documents.filter(({ status }) => status === 'DRAFT');
          const results = new Map<string, WorkerDocumentResponse['aiAnalysis']>();
          const analyzedIds = new Set<string>();
          for (const doc of drafts) {
            if (doc.aiAnalysis?.status === 'COMPLETE' || doc.aiAnalysis?.status === 'ANALYZING') {
              results.set(doc.id, doc.aiAnalysis);
              continue;
            }
            try {
              await p.client.analyzeWorkerDocument(p.token, p.siteId, workerId, doc.id);
              analyzedIds.add(doc.id);
            } catch {
              results.set(doc.id, unavailable);
            }
          }
          if (analyzedIds.size) {
            try {
              const updated = await p.client.workerCompliance(p.token, p.siteId, workerId);
              for (const doc of updated.documents) {
                if (analyzedIds.has(doc.id)) results.set(doc.id, doc.aiAnalysis);
              }
            } catch {
              for (const id of analyzedIds) results.set(id, unavailable);
            }
          }
          const certificates = drafts.map(({ id, kind }) => ({
            id,
            kind,
            aiAnalysis: results.get(id) ?? unavailable,
          }));
          for (const { aiAnalysis } of certificates) counts[analysisOutcome(aiAnalysis)]++;
          workers.push({ ...worker, certificates });
        } catch {
          counts.unavailable++;
          workers.push({ ...worker, certificates: null });
        }
      }
      return { counts, workers };
    },
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: ['worker-documents'] });
      void cache.invalidateQueries({ queryKey: ['worker-document-queue'] });
    },
  });
  const result = scan.data;
  const outcomes = (Object.keys(summaries) as (keyof typeof summaries)[]).filter(
    (outcome) => result?.counts[outcome],
  );

  return (
    <>
      <button
        type="button"
        className={documentButton + ' gap-1.5 whitespace-nowrap'}
        disabled={p.disabled || !p.workers.length || scan.isPending}
        onClick={() => scan.mutate(p.workers)}
      >
        <Sparkle aria-hidden="true" size={16} weight="bold" className="text-orange-700" />
        {tr(scan.isPending ? 'documents.aiAnalyzing' : 'documents.aiAnalysis')}
      </button>
      {result && (
        <section
          aria-label={tr('workerIntake.aiViewResults')}
          className="w-full min-w-0 space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <div role="status" className="flex flex-wrap gap-1.5 text-xs font-medium text-slate-600">
            {outcomes.length
              ? outcomes.map((outcome) => {
                  const [key, color] = summaries[outcome];
                  return (
                    <span key={outcome} className={`rounded-full px-2 py-1 ${color}`}>
                      {tr(key, { count: result.counts[outcome] })}
                    </span>
                  );
                })
              : tr('workerIntake.aiNothingToScan')}
          </div>
          {!!outcomes.length && (
            <details className="text-sm text-slate-800">
              <summary className="cursor-pointer font-semibold text-orange-800">
                {tr('workerIntake.aiViewResults')}
              </summary>
              <ul className="mt-2 space-y-3">
                {result.workers.map(({ id, name, certificates }) => (
                  <li key={id} className="min-w-0 space-y-1.5 break-words">
                    <h3 className="font-semibold">{name}</h3>
                    {certificates?.length ? (
                      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {certificates.map((doc) => (
                          <li key={doc.id} className="min-w-0 space-y-1">
                            <h4 className="text-xs font-medium">{tr('documents.' + doc.kind)}</h4>
                            <WorkerDocumentAnalysisNotice
                              analysis={doc.aiAnalysis}
                              kind={doc.kind}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-600">
                        {tr(
                          certificates ? 'workerIntake.aiNothingToScan' : 'documents.aiUnavailable',
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
