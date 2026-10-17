import { useLayoutEffect, useRef, useState } from 'react';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { useLocale } from '../../i18n/ppe-locale';
import { PpeDialog } from '../ppe/PpeDialog';
import { CameraDiscardBanner } from './CameraDialogPrimitives';
import { CameraRegistrationForm } from './CameraRegistrationForm';

export interface CameraRegistrationDialogProps {
  open: boolean;
  onClose: () => void;
  apiUrl: string;
  token: string | null;
  sessionScope: string | null;
  credentialId: number;
  siteId: string | null;
  siteName: string;
  canManageCamera: boolean;
  client?: SmartSiteManagementClient;
  onCreated?: (camera: CameraResponse) => void;
  onUnauthorized?: () => void;
}

/**
 * Accessible rounded dialog wrapper around CameraRegistrationForm.
 * Manages dirty-draft confirmation for Escape, backdrop, and Close dialog triggers,
 * while preventing dismissal during active mutation submissions.
 */
export function CameraRegistrationDialog({
  open,
  onClose,
  apiUrl,
  token,
  sessionScope,
  credentialId,
  siteId,
  siteName,
  canManageCamera,
  client,
  onCreated,
  onUnauthorized,
}: CameraRegistrationDialogProps) {
  const { t } = useLocale();
  const [draftState, setDraftState] = useState<{ dirty: boolean; saving: boolean }>({
    dirty: false,
    saving: false,
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!confirmDiscard && lastFocusedRef.current) {
      const elementToFocus = lastFocusedRef.current;
      lastFocusedRef.current = null;
      if (elementToFocus.isConnected) {
        elementToFocus.focus();
      }
    }
  }, [confirmDiscard]);

  const handleAttemptClose = () => {
    if (draftState.saving || confirmDiscard) return;
    if (draftState.dirty) {
      if (document.activeElement instanceof HTMLElement) {
        lastFocusedRef.current = document.activeElement;
      }
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    onClose();
  };

  return (
    <PpeDialog
      open={open}
      onClose={handleAttemptClose}
      title={t('ppe.admin.registerCamera')}
      description={t('cameraSetup.register.dialogDescription')}
      closeDisabled={draftState.saving}
    >
      <div className="min-w-0 space-y-4">
        {confirmDiscard && (
          <CameraDiscardBanner
            disabled={draftState.saving}
            onKeepEditing={() => {
              if (draftState.saving) return;
              setConfirmDiscard(false);
            }}
            onDiscardChanges={() => {
              if (draftState.saving) return;
              setConfirmDiscard(false);
              onClose();
            }}
          />
        )}

        <fieldset disabled={confirmDiscard} className="contents m-0 border-0 p-0 min-w-0">
          <CameraRegistrationForm
            apiUrl={apiUrl}
            token={token}
            sessionScope={sessionScope}
            credentialId={credentialId}
            siteId={siteId}
            siteName={siteName}
            canManageCamera={canManageCamera}
            client={client}
            onCreated={onCreated}
            onUnauthorized={onUnauthorized}
            onCancelRequest={handleAttemptClose}
            onCancel={() => {
              setConfirmDiscard(false);
              onClose();
            }}
            onDraftStateChange={setDraftState}
          />
        </fieldset>
      </div>
    </PpeDialog>
  );
}
