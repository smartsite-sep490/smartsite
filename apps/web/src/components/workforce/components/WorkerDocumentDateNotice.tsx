import { useTranslation } from 'react-i18next';
import type { WorkerDocumentDateCheck } from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';

export function WorkerDocumentDateNotice({ check }: { check: WorkerDocumentDateCheck }) {
  useTranslation();
  const label = {
    MATCH: 'documents.dateMatch',
    MISMATCH: 'documents.dateMismatch',
    UNAVAILABLE: 'documents.dateUnavailable',
    NO_REFERENCE: 'documents.dateNoReference',
  }[check.status];
  const date = (value: string | null) =>
    value?.split('-').reverse().join('/') ?? tr('documents.notDetermined');
  return (
    <div
      role="status"
      className={`space-y-1 rounded-xl border p-3 text-xs ${check.status === 'MATCH' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
    >
      <p className="font-semibold">{tr(label)}</p>
      <p>
        {tr('documents.dateDeclared')}: {date(check.submittedDate)} · {tr('documents.dateDetected')}
        : {date(check.detectedDate)}
      </p>
    </div>
  );
}
