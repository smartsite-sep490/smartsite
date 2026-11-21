import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import {
  isWorkerDocumentDate,
  healthCertificateExpiry,
  type NativeUploadFile,
  type DocumentImageQuality,
  type SubmitWorkerDocumentsCommand,
  type WorkerComplianceResponse,
  type WorkerDocumentCheckResponse,
  type WorkerDocumentKind,
} from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { useCommand, useRequestId, localDate } from '../shared/data';
import { Button, Choice, Disclosure, ErrorNotice, Hint } from '../shared/ui';
import { CalendarDateField } from '../shared/calendar-date-field';
import { Attachments } from '../shared/uploads';

const kinds: readonly WorkerDocumentKind[] = [
  'SAFETY_CARD',
  'HEALTH_CERTIFICATE',
  'PERSONAL_INSURANCE',
];

export function WorkerDocumentBundleForm({
  profile,
  onSubmitted,
}: {
  profile: WorkerComplianceResponse;
  onSubmitted: () => void;
}) {
  const { t } = useTranslation();
  const { client, token, scope } = useWorkspace();
  const command = useCommand();
  const requestId = useRequestId();
  const [baseVersion, setBaseVersion] = useState(profile.version ?? 0);
  const [required, setRequired] = useState(profile.safetyCardRequired === false ? 'false' : 'true');
  const [files, setFiles] = useState<
    Partial<Record<WorkerDocumentKind | 'FRONT' | 'BACK', NativeUploadFile[]>>
  >({});
  const [dates, setDates] = useState<Partial<Record<WorkerDocumentKind, string>>>({});
  const [identityChecks, setIdentityChecks] = useState<
    Partial<Record<'FRONT' | 'BACK', DocumentImageQuality>>
  >({});
  const [checks, setChecks] = useState<
    Partial<Record<WorkerDocumentKind, WorkerDocumentCheckResponse>>
  >({});
  const [identity, setIdentity] = useState({
    nationalId: profile.nationalId ?? '',
    phoneNumber: profile.phoneNumber ?? '',
    gender: profile.gender,
    address: profile.address ?? '',
  });
  const [identityChanged, setIdentityChanged] = useState(false);
  return (
    <View style={{ gap: 16 }} pointerEvents={command.isPending ? 'none' : 'auto'}>
      {(profile.version ?? 0) > baseVersion && (
        <View style={{ gap: 8 }}>
          <Hint>{t('documents.profileChanged')}</Hint>
          <Button
            label={t('documents.reloadDraft')}
            secondary
            onPress={() => {
              setBaseVersion(profile.version ?? 0);
              setRequired(profile.safetyCardRequired === false ? 'false' : 'true');
              setFiles({});
              setDates({});
              setChecks({});
              setIdentityChecks({});
              setIdentityChanged(false);
              setIdentity({
                nationalId: profile.nationalId ?? '',
                phoneNumber: profile.phoneNumber ?? '',
                gender: profile.gender,
                address: profile.address ?? '',
              });
            }}
          />
        </View>
      )}
      <Choice
        label={t('documents.safetyCardRequired')}
        value={required}
        onChange={setRequired}
        options={[
          { value: 'true', label: t('documents.cardRequired') },
          { value: 'false', label: t('documents.cardNotRequired') },
        ]}
      />
      <Disclosure title={t('documents.identityHeading')}>
        {(['nationalId', 'phoneNumber', 'address'] as const).map((field) => (
          <View key={field} style={{ gap: 6 }}>
            <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
              {t('documents.' + field)}
            </Text>
            <TextInput
              accessibilityLabel={t('documents.' + field)}
              value={identity[field]}
              editable={!command.isPending}
              maxLength={field === 'nationalId' ? 12 : field === 'phoneNumber' ? 16 : 1000}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 12,
                color: colors.textPrimary,
              }}
              onChangeText={(value) => {
                setIdentity((previous) => ({ ...previous, [field]: value }));
                setIdentityChanged(true);
              }}
            />
          </View>
        ))}
        <Choice
          label={t('documents.gender')}
          value={identity.gender ?? ''}
          onChange={(value) => {
            setIdentity((previous) => ({ ...previous, gender: value as typeof identity.gender }));
            setIdentityChanged(true);
          }}
          options={(['MALE', 'FEMALE', 'OTHER'] as const).map((value) => ({
            value,
            label: t('documents.' + value),
          }))}
        />
        {(['FRONT', 'BACK'] as const).map((side) => (
          <View key={side} style={{ gap: 6 }}>
            <Text>{t('documents.' + side)}</Text>
            <Attachments
              files={files[side] ?? []}
              maxFiles={1}
              allowPdf={false}
              disabled={command.isPending}
              validateFile={async (file) => {
                const result = await client.checkDocumentImageQuality(
                  token,
                  scope.siteId,
                  profile.contractorId!,
                  file,
                );
                setIdentityChecks((previous) => ({ ...previous, [side]: result }));
              }}
              onChange={(value) => setFiles((previous) => ({ ...previous, [side]: value }))}
            />
            {identityChecks[side] && (
              <Hint>
                {identityChecks[side]?.status !== 'ACCEPTED'
                  ? t('documents.' + identityChecks[side]?.reason)
                  : ''}
                {identityChecks[side]?.ocr?.nationalIds?.some(
                  (id) => identity.nationalId && id !== identity.nationalId,
                )
                  ? ' · ' + t('documents.identityMismatch')
                  : ''}
              </Hint>
            )}
          </View>
        ))}
      </Disclosure>
      {kinds.map((kind) => {
        const latest = profile.documents
          .filter((doc) => doc.kind === kind && doc.status !== 'SUPERSEDED')
          .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
        return (
          <Disclosure
            key={kind}
            title={
              t('documents.' + kind) +
              (kind === 'SAFETY_CARD' && required === 'false'
                ? ' (' + t('documents.optional') + ')'
                : '')
            }
          >
            {(kind !== 'SAFETY_CARD' || required === 'true') &&
              profile.missingKinds.includes(kind) &&
              !profile.documents.some((doc) => doc.kind === kind && doc.status === 'PENDING') &&
              !files[kind]?.length && <Hint>{t('documents.fileRequired')}</Hint>}
            {latest?.status === 'REJECTED' && (
              <Hint>
                {t('documents.REJECTED')}: {latest?.reviewNote}
              </Hint>
            )}
            <CalendarDateField
              label={t(
                kind === 'HEALTH_CERTIFICATE'
                  ? 'documents.declaredIssuedOn'
                  : 'documents.declaredExpiresOn',
              )}
              value={dates[kind] ?? ''}
              onChange={(value) => setDates((previous) => ({ ...previous, [kind]: value }))}
            />
            <Attachments
              files={files[kind] ?? []}
              maxFiles={1}
              disabled={command.isPending}
              validateFile={async (file) => {
                const result = await client.checkWorkerDocumentDates(
                  token,
                  scope.siteId,
                  profile.workerId,
                  kind,
                  file,
                  {},
                );
                setChecks((previous) => ({ ...previous, [kind]: result }));
                if (result.dateCheck.detectedDate)
                  setDates((previous) => ({
                    ...previous,
                    [kind]: previous[kind] || result.dateCheck.detectedDate!,
                  }));
              }}
              onChange={(value) => setFiles((previous) => ({ ...previous, [kind]: value }))}
            />
            {!!files[kind]?.length && !isWorkerDocumentDate(dates[kind]) && (
              <Hint>{t('documents.dateRequiredHint')}</Hint>
            )}
            {checks[kind] && (
              <Hint>
                {t('documents.dateDetected')}:{' '}
                {checks[kind]?.dateCheck.detectedDate ?? t('documents.notDetermined')}
                {checks[kind]?.quality.status !== 'ACCEPTED'
                  ? ' · ' + t('documents.' + checks[kind]?.quality.reason)
                  : ''}
                {checks[kind]?.ocr?.nationalIds?.some(
                  (id) => identity.nationalId && id !== identity.nationalId,
                )
                  ? ' · ' + t('documents.identityMismatch')
                  : ''}
                {dates[kind] &&
                checks[kind]?.dateCheck.detectedDate &&
                dates[kind] !== checks[kind]?.dateCheck.detectedDate
                  ? ' · ' + t('documents.dateMismatch')
                  : ''}
              </Hint>
            )}
            {kind === 'HEALTH_CERTIFICATE' && dates[kind] && (
              <Hint>
                {t('documents.expiresOn')}: {healthCertificateExpiry(dates[kind])}
              </Hint>
            )}
            {dates[kind] &&
              (kind === 'HEALTH_CERTIFICATE'
                ? (healthCertificateExpiry(dates[kind]) ?? '')
                : dates[kind]!) < localDate(new Date(), 'Asia/Ho_Chi_Minh') && (
                <Hint>{t('documents.expiredWarning')}</Hint>
              )}
          </Disclosure>
        );
      })}
      <ErrorNotice error={command.error} />
      <Button
        label={t('documents.sendBundle')}
        disabled={
          command.isPending ||
          (!Object.values(files).some((value) => value?.length) &&
            !identityChanged &&
            (required === 'true') === (profile.safetyCardRequired ?? true))
        }
        onPress={() =>
          command.mutate(async () => {
            const documents: SubmitWorkerDocumentsCommand['documents'] = {};
            const selected: Partial<
              Record<WorkerDocumentKind | 'FRONT' | 'BACK', NativeUploadFile>
            > = {};
            for (const [key, value] of Object.entries(files))
              if (value?.[0]) selected[key as keyof typeof selected] = value[0];
            for (const kind of kinds)
              if (selected[kind]) {
                if (!isWorkerDocumentDate(dates[kind]))
                  throw new Error(t('documents.dateRequiredHint'));
                documents[kind] =
                  kind === 'HEALTH_CERTIFICATE'
                    ? { submittedIssuedOn: dates[kind] }
                    : { submittedExpiresOn: dates[kind] };
              }
            let identityInput: SubmitWorkerDocumentsCommand['identity'];
            if (identityChanged) {
              if (!identity.gender) throw new Error(t('documents.required'));
              identityInput = { ...identity, gender: identity.gender };
            }
            const value = {
              expectedVersion: baseVersion,
              safetyCardRequired: required === 'true',
              documents,
              ...(identityInput ? { identity: identityInput } : {}),
            };
            await client.submitWorkerDocuments(
              token,
              scope.siteId,
              profile.workerId,
              { ...value, requestId: requestId({ value, selected }) },
              selected,
            );
            onSubmitted();
          })
        }
      />
    </View>
  );
}
