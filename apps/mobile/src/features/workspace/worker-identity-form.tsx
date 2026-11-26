import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeUploadFile, WorkerComplianceResponse } from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { useCommand } from '../shared/data';
import { Button, Choice, ErrorNotice, Field, Hint } from '../shared/ui';
import { EvidenceButton, SingleDocumentAttachment } from '../shared/uploads';
import { useWorkspace } from './workspace-context';

const sides = ['FRONT', 'BACK'] as const;
const genders = ['MALE', 'FEMALE', 'OTHER'] as const;

export function WorkerIdentityForm({
  profile,
  onBusyChange,
}: {
  profile: WorkerComplianceResponse;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const { client, token, scope } = useWorkspace();
  const [nationalId, setNationalId] = useState(profile.nationalId ?? '');
  const [phoneNumber, setPhoneNumber] = useState(profile.phoneNumber ?? '');
  const [address, setAddress] = useState(profile.address ?? '');
  const [gender, setGender] = useState<WorkerComplianceResponse['gender']>(profile.gender);
  const [version, setVersion] = useState(profile.identityVersion ?? 0);
  const [files, setFiles] = useState<Partial<Record<(typeof sides)[number], NativeUploadFile>>>({});
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(0);
  const save = useCommand();
  const busy = save.isPending || picking > 0;
  const stale = (profile.identityVersion ?? 0) > version;
  const ready =
    /^\d{12}$/.test(nationalId.trim()) &&
    /^\+?\d{9,15}$/.test(phoneNumber.trim()) &&
    !!address.trim() &&
    !!gender &&
    sides.every(
      (side) => files[side] || profile.identityImages.some((image) => image.side === side),
    );

  return (
    <View style={styles.fields}>
      <Hint>{t('onboarding.identityHelp')}</Hint>
      <Field
        label={t('documents.nationalId')}
        value={nationalId}
        onChangeText={setNationalId}
        maxLength={12}
        keyboardType="number-pad"
        editable={!busy}
      />
      <Field
        label={t('documents.phoneNumber')}
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        maxLength={16}
        keyboardType="phone-pad"
        editable={!busy}
      />
      <Choice
        label={t('documents.gender')}
        value={gender ?? ''}
        options={genders.map((value) => ({ value, label: t('documents.' + value) }))}
        onChange={(value) => setGender(genders.find((option) => option === value) ?? null)}
        disabled={busy}
      />
      <Field
        label={t('documents.address')}
        value={address}
        onChangeText={setAddress}
        maxLength={1000}
        multiline
        editable={!busy}
      />
      {sides.map((side) => {
        const existing = profile.identityImages.find((image) => image.side === side);
        return (
          <SingleDocumentAttachment
            key={side}
            identity
            label={t('documents.' + side)}
            file={files[side]}
            savedName={existing?.originalName}
            savedPreview={
              existing && (
                <EvidenceButton
                  label={t('documents.view')}
                  mediaType={existing.mediaType}
                  load={() =>
                    client.workerIdentityImageFile(
                      token,
                      scope.siteId,
                      profile.workerId,
                      existing.id,
                    )
                  }
                />
              )
            }
            onChange={(file) => setFiles((current) => ({ ...current, [side]: file }))}
            disabled={busy}
            onPickingChange={(pending) => {
              setPicking((count) => count + (pending ? 1 : -1));
              onBusyChange?.(pending);
            }}
          />
        );
      })}
      {!ready && <Hint>{t('onboarding.identityMissing')}</Hint>}
      {stale && <Hint>{t('documents.profileChanged')}</Hint>}
      <ErrorNotice error={save.error} />
      {saved && <Hint>{t('onboarding.identitySaved')}</Hint>}
      <Button
        label={t(save.isPending ? 'common.saving' : 'onboarding.saveIdentity')}
        disabled={busy || stale || !ready}
        onPress={() => {
          onBusyChange?.(true);
          save.mutate(
            async () => {
              if (!gender || !ready || stale) return;
              setSaved(false);
              const result = await client.updateMyWorkerIdentity(
                token,
                scope.siteId,
                {
                  expectedVersion: version,
                  nationalId: nationalId.trim(),
                  phoneNumber: phoneNumber.trim(),
                  address: address.trim(),
                  gender,
                },
                files,
              );
              setVersion(result.version);
              setFiles({});
              setSaved(true);
            },
            { onSettled: () => onBusyChange?.(false) },
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ fields: { gap: 12 } });
