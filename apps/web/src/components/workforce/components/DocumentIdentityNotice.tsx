import { useTranslation } from 'react-i18next';
import type { WorkerDocumentIdentityCheck } from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';
import { IconCheck, IconAlertTriangle } from '../../icons';

export function DocumentIdentityNotice({
  check,
  reference,
}: {
  check?: WorkerDocumentIdentityCheck;
  reference: string | null;
}) {
  useTranslation();
  if (!check) return null;

  if (check.status === 'MATCH') {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-xs font-bold shadow-2xs">
        <IconCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span>{tr('documents.identityMatch')}</span>
      </div>
    );
  }

  if (check.status !== 'MISMATCH') return null;

  return (
    <div
      role="alert"
      className="min-w-0 space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900 [overflow-wrap:anywhere]"
    >
      <div className="flex items-start gap-2 font-semibold text-amber-950">
        <IconAlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-600" />
        <p>{tr('documents.identityMismatch')}</p>
      </div>
      <p className="font-semibold text-amber-900">
        {tr('documents.identityValues', {
          expected: reference ?? '—',
          detected: check.detectedNationalIds.join(', '),
        })}
      </p>
    </div>
  );
}
