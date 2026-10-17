import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from '../../i18n/ppe-locale';
import { PpeDialog } from './PpeDialog';
import { ZonePpeSetupPanel, type ZonePpeSetupPanelProps } from './ZonePpeSetupPanel';
import { getZonePpeScopeKey } from './zone-ppe-scope';

/** Owns closing the Zone form; authorization/scope changes still unmount it. */
export function ZonePpeSetupDialog(props: ZonePpeSetupPanelProps) {
  const queryClient = useQueryClient();
  if (!props.canReadZones && !props.canManageZones && !props.canManageRegions) {
    return null;
  }
  return <ScopedZonePpeSetupDialog key={getZonePpeScopeKey(queryClient, props)} {...props} />;
}

function ScopedZonePpeSetupDialog(props: ZonePpeSetupPanelProps) {
  const { t } = useLocale();
  const [draft, setDraft] = useState({ dirty: false, saving: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (draft.saving) return;
    if (draft.dirty) setConfirmDiscard(true);
    else props.onClose();
  };
  return (
    <PpeDialog
      open
      wide
      title={t('zoneSetup.dialog.title')}
      description={t('zoneSetup.dialog.description', { siteName: props.siteName })}
      onClose={requestClose}
      closeDisabled={draft.saving}
    >
      <ZonePpeSetupPanel {...props} embedded onClose={requestClose} onDraftStateChange={setDraft} />
      <PpeDialog
        open={confirmDiscard}
        title={t('zoneSetup.dialog.discardTitle')}
        description={t('zoneSetup.dialog.discardDescription')}
        onClose={() => setConfirmDiscard(false)}
      >
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => setConfirmDiscard(false)}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"
          >
            {t('zoneSetup.dialog.keepEditing')}
          </button>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            {t('zoneSetup.dialog.discardChanges')}
          </button>
        </div>
      </PpeDialog>
    </PpeDialog>
  );
}
