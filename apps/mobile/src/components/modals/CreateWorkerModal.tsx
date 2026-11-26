import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useMutation } from '@tanstack/react-query';
import type {
  NativeUploadFile,
  SaveWorkerOnboardingDraftCommand,
  WorkerDocumentKind,
  WorkerOnboardingDraft,
} from '@smartsite/api-client';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../../features/workspace/workspace-context';
import { useTranslation, uiLanguage } from '../../i18n';
import { IconUserPlus } from '../common/Icons';
import { EvidenceButton, SingleDocumentAttachment } from '../../features/shared/uploads';
import { Button, Choice, ErrorNotice, Field, Hint } from '../../features/shared/ui';
import { CalendarDateField } from '../../features/shared/calendar-date-field';
import { RequestSheet } from '../../features/shared/request-sheet';

interface CreateWorkerModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  draft?: WorkerOnboardingDraft;
}

const documentKinds: WorkerDocumentKind[] = [
  'HEALTH_CERTIFICATE',
  'PERSONAL_INSURANCE',
  'SAFETY_CARD',
];

export function CreateWorkerModal({ visible, onClose, onSuccess, draft }: CreateWorkerModalProps) {
  const { t } = useTranslation();
  const { scope, client, token } = useWorkspace();
  const [draftId, setDraftId] = useState(() => draft?.id ?? randomUUID());
  const [displayName, setDisplayName] = useState(draft?.displayName ?? '');
  const [username, setUsername] = useState(draft?.username ?? '');
  const [email, setEmail] = useState(draft?.email ?? '');
  const [card, setCard] = useState(
    draft?.safetyCardRequired == null ? '' : String(draft.safetyCardRequired),
  );
  const [files, setFiles] = useState<Partial<Record<WorkerDocumentKind, NativeUploadFile>>>({});
  const [dates, setDates] = useState(
    () =>
      Object.fromEntries(
        documentKinds.map((kind) => [
          kind,
          (kind === 'HEALTH_CERTIFICATE'
            ? draft?.documents[kind]?.submittedIssuedOn
            : draft?.documents[kind]?.submittedExpiresOn) ?? '',
        ]),
      ) as Record<WorkerDocumentKind, string>,
  );
  const [startDates, setStartDates] = useState({
    PERSONAL_INSURANCE: draft?.documents.PERSONAL_INSURANCE?.submittedIssuedOn ?? '',
    SAFETY_CARD: draft?.documents.SAFETY_CARD?.submittedIssuedOn ?? '',
  });
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(0);

  const save = useMutation({
    mutationFn: async () => {
      const documents: SaveWorkerOnboardingDraftCommand['documents'] = {};
      for (const kind of documentKinds) {
        const date = dates[kind];
        const start = kind === 'HEALTH_CERTIFICATE' ? date : startDates[kind];
        if (!date && !start && !files[kind] && !draft?.documents[kind]) continue;
        documents[kind] = {
          ...(start && { submittedIssuedOn: start }),
          ...(kind !== 'HEALTH_CERTIFICATE' && date && { submittedExpiresOn: date }),
        };
      }
      return client.saveWorkerOnboardingDraft(
        token,
        scope.siteId,
        scope.contractorId,
        draftId,
        {
          expectedVersion: draft?.version ?? 0,
          displayName: displayName.trim(),
          username: username.trim(),
          email: email.trim().toLowerCase(),
          language: uiLanguage(),
          safetyCardRequired: card ? card === 'true' : null,
          documents,
        },
        files,
      );
    },
    onSuccess: (_item, addAnother: boolean) => {
      onSuccess?.();
      if (!addAnother) {
        onClose();
        return;
      }
      setDraftId(randomUUID());
      setDisplayName('');
      setUsername('');
      setEmail('');
      setCard('');
      setFiles({});
      setDates({ HEALTH_CERTIFICATE: '', SAFETY_CARD: '', PERSONAL_INSURANCE: '' });
      setStartDates({ SAFETY_CARD: '', PERSONAL_INSURANCE: '' });
      setSaved(true);
    },
  });
  const busy = save.isPending || picking > 0;
  const empty =
    !displayName.trim() &&
    !username.trim() &&
    !email.trim() &&
    !card &&
    !Object.values(dates).some(Boolean) &&
    !Object.values(startDates).some(Boolean) &&
    !Object.values(files).some(Boolean);

  return (
    <RequestSheet
      visible={visible}
      onClose={onClose}
      variant="form"
      busy={busy}
      icon={<IconUserPlus size={24} color={colors.primary} />}
      title={t(draft ? 'onboarding.editDraft' : 'onboarding.addWorker')}
      footer={
        <View style={styles.actions}>
          <ErrorNotice error={save.error} />
          {saved && <Hint>{t('onboarding.draftSaved')}</Hint>}
          <Button
            label={t(save.isPending ? 'common.saving' : 'onboarding.saveDraft')}
            disabled={busy || (!draft && empty)}
            onPress={() => save.mutate(false)}
          />
          {!draft && (
            <Button
              secondary
              label={t('onboarding.saveAndAdd')}
              disabled={busy || empty}
              onPress={() => save.mutate(true)}
            />
          )}
        </View>
      }
    >
      <Hint>{t('onboarding.draftHint')}</Hint>
      <Field
        label={t('workforce.fullName')}
        value={displayName}
        onChangeText={setDisplayName}
        editable={!busy}
        autoCapitalize="words"
      />
      <Field
        label={t('workforce.username')}
        value={username}
        onChangeText={setUsername}
        editable={!busy}
        autoCorrect={false}
      />
      <Field
        label={t('accountEmail.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        editable={!busy}
      />
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
      <Hint>{t('onboarding.documentLimits')}</Hint>
      {documentKinds.map((kind) => {
        const previous = draft?.documents[kind];
        if (
          kind === 'SAFETY_CARD' &&
          card === 'false' &&
          !previous &&
          !files[kind] &&
          !dates[kind] &&
          !startDates[kind]
        )
          return null;
        const dateLabel = t(
          kind === 'HEALTH_CERTIFICATE'
            ? 'documents.declaredIssuedOn'
            : 'documents.declaredExpiresOn',
        );
        const startDateLabel = t(
          kind === 'PERSONAL_INSURANCE' ? 'documents.coverageStartsOn' : 'documents.cardIssuedOn',
        );
        return (
          <View key={kind} style={styles.document}>
            <SingleDocumentAttachment
              label={t('documents.' + kind)}
              file={files[kind]}
              onChange={(file) => setFiles((current) => ({ ...current, [kind]: file }))}
              savedName={previous?.originalName}
              savedPreview={
                draft && previous?.originalName && previous.mediaType ? (
                  <EvidenceButton
                    label={t('documents.view')}
                    mediaType={previous.mediaType}
                    load={() =>
                      client.workerOnboardingDraftFile(
                        token,
                        scope.siteId,
                        scope.contractorId,
                        draft.id,
                        kind,
                      )
                    }
                  />
                ) : undefined
              }
              disabled={busy}
              onPickingChange={(pending) => setPicking((count) => count + (pending ? 1 : -1))}
            />
            {kind !== 'HEALTH_CERTIFICATE' && (
              <>
                <CalendarDateField
                  label={startDateLabel}
                  value={startDates[kind]}
                  onChange={(date) => setStartDates((current) => ({ ...current, [kind]: date }))}
                  disabled={busy}
                />
                {!!startDates[kind] && (
                  <Button
                    secondary
                    label={t('onboarding.clearStartDate', { label: startDateLabel })}
                    onPress={() => setStartDates((current) => ({ ...current, [kind]: '' }))}
                    disabled={busy}
                  />
                )}
              </>
            )}
            <CalendarDateField
              label={dateLabel}
              value={dates[kind]}
              onChange={(date) => setDates((current) => ({ ...current, [kind]: date }))}
              disabled={busy}
            />
            {dates[kind] && (
              <Button
                secondary
                label={t('onboarding.clearDate', { label: t('documents.' + kind) })}
                onPress={() => setDates((current) => ({ ...current, [kind]: '' }))}
                disabled={busy}
              />
            )}
          </View>
        );
      })}
    </RequestSheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
  document: { gap: 10, borderTopWidth: 1, borderColor: colors.border, paddingVertical: 9 },
});
