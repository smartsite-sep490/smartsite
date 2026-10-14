import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChecklistEvidenceResponse } from '@smartsite/api-client';
import type { WorkflowProps } from './safety-workflow';
import { BlobImage, RequestError, Dialog } from './SafetyWorkflowUi';
export function ChecklistEvidence(
  p: WorkflowProps & { assignmentId: string; evidence: ChecklistEvidenceResponse },
) {
  useTranslation();

  const [zoom, setZoom] = useState(false);
  const query = useQuery({
    queryKey: [
      'safety-workflow',
      p.apiUrl,
      p.scope,
      p.siteId,
      'checklist-file',
      p.assignmentId,
      p.evidence.id,
    ],
    queryFn: ({ signal }) =>
      p.client.getChecklistEvidence(p.token, p.siteId, p.assignmentId, p.evidence.id, { signal }),
    retry: false,
  });
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!query.data) return;
    const next = URL.createObjectURL(query.data);
    if (link.current) link.current.href = next;
    return () => URL.revokeObjectURL(next);
  }, [query.data]);
  const ext =
    p.evidence.mediaType === 'application/pdf'
      ? 'pdf'
      : p.evidence.mediaType === 'image/png'
        ? 'png'
        : 'jpg';
  return (
    <div className="min-w-0 space-y-2">
      {query.isPending && <p className="text-xs">{tr('safety_workspace.loading_evidence')}</p>}
      <RequestError error={query.error} retry={() => void query.refetch()} />
      {query.data && (
        <>
          {ext !== 'pdf' && (
            <div>
              <BlobImage blob={query.data} alt={tr('safety_workspace.checklist_evidence')} />
              <button
                type="button"
                className="mt-2 text-sm font-semibold underline"
                onClick={() => setZoom(true)}
              >
                {tr('safety_workspace.enlarge_image')}
              </button>
            </div>
          )}
          <a
            className="inline-block text-sm font-semibold text-[var(--accent)] underline"
            ref={link}
            download={'checklist-evidence.' + ext}
          >
            {tr('safety_workspace.download_value1_value2_kib', {
              value1: ext.toUpperCase(),
              value2: (p.evidence.size / 1024).toFixed(1),
            })}
          </a>
        </>
      )}
      {zoom && query.data && (
        <Dialog title={tr('safety_workspace.checklist_evidence')} onClose={() => setZoom(false)}>
          <BlobImage blob={query.data} alt={tr('safety_workspace.checklist_evidence_enlarged')} />
        </Dialog>
      )}
    </div>
  );
}
