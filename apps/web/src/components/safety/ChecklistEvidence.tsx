import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChecklistEvidenceResponse } from '@smartsite/api-client';
import type { WorkflowProps } from './safety-workflow';
import { BlobImage, RequestError } from './SafetyWorkflowUi';
export function ChecklistEvidence(
  p: WorkflowProps & { assignmentId: string; evidence: ChecklistEvidenceResponse },
) {
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
      {query.isPending && <p className="text-xs">Loading evidence…</p>}
      <RequestError error={query.error} retry={() => void query.refetch()} />
      {query.data && (
        <>
          {ext !== 'pdf' && <BlobImage blob={query.data} alt="Checklist evidence" />}
          <a
            className="inline-block text-sm font-semibold text-[var(--accent)] underline"
            ref={link}
            download={'checklist-evidence.' + ext}
          >
            Download {ext.toUpperCase()} · {(p.evidence.size / 1024).toFixed(1)} KiB
          </a>
        </>
      )}
    </div>
  );
}
