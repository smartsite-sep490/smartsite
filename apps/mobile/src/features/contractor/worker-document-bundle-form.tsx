import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  healthCertificateExpiry,
  isWorkerDocumentDate,
  type NativeUploadFile,
  type SubmitWorkerDocumentsCommand,
  type WorkerComplianceResponse,
  type WorkerDocumentKind,
} from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { CalendarDateField } from '../shared/calendar-date-field';
import { useCommand, useRequestId } from '../shared/data';
import { Button, Choice, ErrorNotice, Hint } from '../shared/ui';
import { EvidenceButton, SingleDocumentAttachment } from '../shared/uploads';

const allKinds: WorkerDocumentKind[] = ['HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE', 'SAFETY_CARD'];

export function WorkerDocumentBundleForm({
  profile,
  kind: selectedKind,
  onSaved,
  onBusyChange,
}: {
  profile: WorkerComplianceResponse;
  kind?: WorkerDocumentKind;
  onSaved: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const { client, token, scope } = useWorkspace();
  const [expectedVersion] = useState(profile.version ?? 0);
  const [initialCard] = useState(
    profile.draftSafetyCardRequired ?? profile.safetyCardRequired ?? true,
  );
  const [card, setCard] = useState(String(initialCard));
  const drafts = Object.fromEntries(
    profile.documents.filter((doc) => doc.status === 'DRAFT').map((doc) => [doc.kind, doc]),
  );
  const [files, setFiles] = useState<Partial<Record<WorkerDocumentKind, NativeUploadFile>>>({});
  const [dates, setDates] = useState(
    () =>
      Object.fromEntries(
        allKinds.map((kind) => [
          kind,
          (kind === 'HEALTH_CERTIFICATE'
            ? drafts[kind]?.submittedIssuedOn
            : drafts[kind]?.submittedExpiresOn) ?? '',
        ]),
      ) as Record<WorkerDocumentKind, string>,
  );
  const [startDates, setStartDates] = useState({
    PERSONAL_INSURANCE: drafts.PERSONAL_INSURANCE?.submittedIssuedOn ?? '',
    SAFETY_CARD: drafts.SAFETY_CARD?.submittedIssuedOn ?? '',
  });
  const save = useCommand();
  const [picking, setPicking] = useState(0);
  const busy = save.isPending || picking > 0;
  const requestId = useRequestId();
  const kinds = selectedKind ? [selectedKind] : allKinds;
  const changedKinds = kinds.filter(
    (kind) =>
      (kind !== 'SAFETY_CARD' || card === 'true' || kind === selectedKind) &&
      (files[kind] ||
        (drafts[kind] &&
          (kind === 'HEALTH_CERTIFICATE'
            ? dates[kind] !== (drafts[kind].submittedIssuedOn ?? '')
            : dates[kind] !== (drafts[kind].submittedExpiresOn ?? '') ||
              startDates[kind] !== (drafts[kind].submittedIssuedOn ?? '')))),
  );
  const stale = expectedVersion !== (profile.version ?? 0);
  const invalid = changedKinds.some(
    (kind) =>
      !isWorkerDocumentDate(dates[kind]) ||
      (kind !== 'HEALTH_CERTIFICATE' &&
        !!startDates[kind] &&
        (!isWorkerDocumentDate(startDates[kind]) || startDates[kind] > dates[kind])),
  );
  const changed = changedKinds.length > 0 || (card === 'true') !== initialCard;

  return (
    <View style={styles.form}>
      {!selectedKind && (
        <Choice
          label={t('documents.safetyCardRequired')}
          value={card}
          options={[
            { value: 'true', label: t('documents.cardRequired') },
            { value: 'false', label: t('documents.cardNotRequired') },
          ]}
          onChange={setCard}
          disabled={busy}
        />
      )}
      <Hint>{t('onboarding.documentLimits')}</Hint>
      {kinds.map((kind) => {
        const draft = drafts[kind];
        const date = dates[kind];
        return (
          <View
            style={[
              styles.document,
              kind === 'SAFETY_CARD' && card === 'false' && kind !== selectedKind && styles.hidden,
            ]}
            key={kind}
          >
            <SingleDocumentAttachment
              label={t('documents.' + kind)}
              file={files[kind]}
              onChange={(file) => setFiles((current) => ({ ...current, [kind]: file }))}
              savedName={draft?.originalName}
              savedPreview={
                draft && (
                  <EvidenceButton
                    label={t('documents.view')}
                    mediaType={draft.mediaType}
                    load={() =>
                      client.workerDocumentFile(token, scope.siteId, profile.workerId, draft.id)
                    }
                  />
                )
              }
              disabled={busy}
              onPickingChange={(pending) => {
                setPicking((count) => count + (pending ? 1 : -1));
                onBusyChange(pending);
              }}
            />
            {(files[kind] || draft) && kind !== 'HEALTH_CERTIFICATE' && (
              <CalendarDateField
                label={t(
                  kind === 'PERSONAL_INSURANCE'
                    ? 'documents.coverageStartsOn'
                    : 'documents.cardIssuedOn',
                )}
                value={startDates[kind]}
                onChange={(next) => setStartDates((current) => ({ ...current, [kind]: next }))}
                disabled={busy}
              />
            )}
            {(files[kind] || draft) && (
              <CalendarDateField
                label={t(
                  kind === 'HEALTH_CERTIFICATE'
                    ? 'documents.declaredIssuedOn'
                    : 'documents.declaredExpiresOn',
                )}
                value={date}
                onChange={(next) => setDates((current) => ({ ...current, [kind]: next }))}
                disabled={busy}
              />
            )}
            {!!date && kind === 'HEALTH_CERTIFICATE' && (
              <Hint>
                {t('documents.expiresOn')}: {healthCertificateExpiry(date)}
              </Hint>
            )}
          </View>
        );
      })}
      {stale && <Hint>{t('documents.profileChanged')}</Hint>}
      {invalid && <Hint>{t('documents.dateRequiredHint')}</Hint>}
      <ErrorNotice error={save.error} />
      <Button
        label={t(save.isPending ? 'common.saving' : 'onboarding.saveDocumentDraft')}
        disabled={busy || stale || invalid || !changed}
        onPress={() => {
          onBusyChange(true);
          save.mutate(
            async () => {
              const documents: SubmitWorkerDocumentsCommand['documents'] = {};
              const selected: Partial<Record<WorkerDocumentKind, NativeUploadFile>> = {};
              for (const kind of changedKinds) {
                documents[kind] =
                  kind === 'HEALTH_CERTIFICATE'
                    ? { submittedIssuedOn: dates[kind] }
                    : {
                        ...(startDates[kind] && { submittedIssuedOn: startDates[kind] }),
                        submittedExpiresOn: dates[kind],
                      };
                if (files[kind]) selected[kind] = files[kind];
              }
              const input = { expectedVersion, documents, safetyCardRequired: card === 'true' };
              await client.submitWorkerDocuments(
                token,
                scope.siteId,
                profile.workerId,
                {
                  ...input,
                  requestId: requestId({ input, selected }),
                },
                selected,
              );
              onSaved();
            },
            { onSettled: () => onBusyChange(false) },
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  document: { gap: 10, borderTopWidth: 1, borderColor: colors.border, paddingVertical: 9 },
  hidden: { display: 'none' },
});
