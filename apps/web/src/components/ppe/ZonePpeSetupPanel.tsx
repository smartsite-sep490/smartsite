import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IconShield, IconX } from '../icons';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';
import { ZonePpeCreateForm } from './ZonePpeCreateForm';
import { ZonePpeList } from './ZonePpeList';
import { useZonePpeSetupPanel } from './useZonePpeSetupPanel';
import { getOpaqueTokenNonce, getZonePpeScopeKey } from './zone-ppe-scope';
import { registerZonePpeSetupCopy } from './zone-ppe-setup-copy';
import type {
  ZonePpeSetupPanelInternalProps,
  ZonePpeSetupPanelProps,
} from './zone-ppe-setup-types';

export type { ZonePpeSetupPanelProps };

registerZonePpeSetupCopy();

function ZonePpeSetupPanelInternal(props: ZonePpeSetupPanelInternalProps) {
  const {
    apiUrl,
    token,
    sessionScope,
    credentialId,
    siteId,
    siteName,
    canManageZones,
    section = 'all',
    initialCameraId,
    onSelectCamera,
    onClose,
    embedded = false,
    tourUserId = null,
  } = props;

  const {
    t,
    client,
    showZoneSection,
    showRegionSection,
    zonesQuery,
    scopedZones,
    serverTotal,
    isAuthRevoked,
    isTransientNextPageError,
    isInitialError,
    isZonesSettledEmpty,
    zoneCode,
    zoneName,
    selectedPpe,
    codeError,
    nameError,
    ppeError,
    serverError,
    successFeedback,
    isCreatingZone,
    saving,
    zoneCodeInputRef,
    zoneNameInputRef,
    firstPpeInputRef,
    editingZoneId,
    editingZoneName,
    renameValidationError,
    renameServerError,
    renameSuccessFeedback,
    isRenamingZone,
    renameInputRef,
    renameTriggerRefs,
    setRegionDraft,
    handleZoneCodeChange,
    handleZoneNameChange,
    togglePpe,
    handleClearCreateForm,
    handleStartRename,
    handleCancelRename,
    handleEditingZoneNameChange,
    handleSaveRename,
    handleSubmit,
  } = useZonePpeSetupPanel(props);

  return (
    <div
      role="region"
      aria-label={t(section === 'regions' ? 'regionSetup.title' : 'zoneSetup.title')}
      className={`space-y-5 min-w-0 w-full max-w-full ${embedded ? '' : 'rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm'}`}
    >
      {!embedded && (
        <div className="flex items-center justify-between border-b border-slate-200/80 pb-4 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-900 flex-shrink-0">
              <IconShield className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 truncate">
                {t(section === 'regions' ? 'regionSetup.title' : 'zoneSetup.title')}
              </h3>
              <p className="text-xs text-slate-500 truncate mt-0.5">
                {section === 'regions' ? (
                  t('regionSetup.subtitle')
                ) : (
                  <>
                    {t('zoneSetup.subtitlePrefix')}{' '}
                    <span className="font-semibold text-slate-900">{siteName}</span>
                    {t('zoneSetup.subtitleSuffix')}
                  </>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('zoneSetup.closeAria')}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer flex-shrink-0"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}

      {showZoneSection && (
        <ZonePpeCreateForm
          canManageZones={canManageZones}
          zoneCode={zoneCode}
          zoneName={zoneName}
          selectedPpe={selectedPpe}
          codeError={codeError}
          nameError={nameError}
          ppeError={ppeError}
          serverError={serverError}
          successFeedback={successFeedback}
          isCreatingZone={isCreatingZone}
          saving={saving}
          zoneCodeInputRef={zoneCodeInputRef}
          zoneNameInputRef={zoneNameInputRef}
          firstPpeInputRef={firstPpeInputRef}
          t={t}
          onZoneCodeChange={handleZoneCodeChange}
          onZoneNameChange={handleZoneNameChange}
          onTogglePpe={togglePpe}
          onClearCreateForm={handleClearCreateForm}
          onSubmit={handleSubmit}
        />
      )}

      <ZonePpeList
        showZoneSection={showZoneSection}
        canManageZones={canManageZones}
        scopedZones={scopedZones}
        serverTotal={serverTotal}
        isPending={zonesQuery.isPending}
        isFetching={zonesQuery.isFetching}
        isFetchingNextPage={zonesQuery.isFetchingNextPage}
        hasNextPage={Boolean(zonesQuery.hasNextPage)}
        isInitialError={isInitialError}
        isAuthRevoked={isAuthRevoked}
        isTransientNextPageError={isTransientNextPageError}
        isZonesSettledEmpty={isZonesSettledEmpty}
        editingZoneId={editingZoneId}
        editingZoneName={editingZoneName}
        renameValidationError={renameValidationError}
        renameServerError={renameServerError}
        renameSuccessFeedback={renameSuccessFeedback}
        isRenamingZone={isRenamingZone}
        renameInputRef={renameInputRef}
        renameTriggerRefs={renameTriggerRefs}
        t={t}
        onRefetch={() => void zonesQuery.refetch()}
        onFetchNextPage={() => void zonesQuery.fetchNextPage({ cancelRefetch: false })}
        onStartRename={handleStartRename}
        onCancelRename={handleCancelRename}
        onEditingZoneNameChange={handleEditingZoneNameChange}
        onSaveRename={handleSaveRename}
      />

      {showRegionSection && (
        <div className={showZoneSection ? 'border-t border-slate-200/80 pt-4' : ''}>
          {scopedZones.length > 0 ? (
            <ZonePpeCameraRegionPanel
              embedded={section === 'regions'}
              onSelectCamera={onSelectCamera}
              onDraftStateChange={setRegionDraft}
              apiUrl={apiUrl}
              client={client}
              token={token}
              sessionScope={sessionScope}
              credentialId={credentialId}
              siteId={siteId}
              initialCameraId={initialCameraId}
              zones={scopedZones}
              tourUserId={tourUserId}
            />
          ) : isZonesSettledEmpty ? (
            <div
              role="status"
              className="rounded-2xl border border-dashed border-slate-200 bg-[#F8FAFC] p-4 text-center"
            >
              <span className="text-xs text-slate-500">
                {t(
                  section === 'regions'
                    ? 'zoneSetup.regionLink.emptyTaskHint'
                    : canManageZones
                      ? 'zoneSetup.regionLink.emptyHint'
                      : 'zoneSetup.regionLink.emptyReadOnlyHint',
                )}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Keyed wrapper around ZonePpeSetupPanelInternal.
 * Guarantees that credential or site scope changes cleanly reset drafts, active mutations,
 * and pending rename feedback without stale effect-resets.
 */
export function ZonePpeSetupPanel(props: ZonePpeSetupPanelProps) {
  const queryClient = useQueryClient();
  const internalNonce = useMemo(
    () => getOpaqueTokenNonce(queryClient, props.token),
    [queryClient, props.token],
  );
  if (!props.canReadZones && !props.canManageZones && !props.canManageRegions) {
    return null;
  }
  if (props.section === 'regions' && !props.canManageRegions) {
    return null;
  }
  const scopeKey = getZonePpeScopeKey(queryClient, props);
  return <ZonePpeSetupPanelInternal key={scopeKey} {...props} internalNonce={internalNonce} />;
}
