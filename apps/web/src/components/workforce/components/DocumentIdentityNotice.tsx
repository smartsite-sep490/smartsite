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
      className="rounded-2xl border border-amber-300/90 bg-amber-50/80 p-3.5 sm:p-4 text-xs text-amber-900 shadow-2xs space-y-1.5"
    >
      <div className="flex items-center gap-2 font-bold text-amber-950">
        <IconAlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
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
