import { translate as tr } from '../../i18n';
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../../features/workspace/workspace-context';
import {
  useCommand,
  useRequestId,
  required,
  validDates,
  localDate,
} from '../../features/shared/data';
import { useTranslation, uiLanguage } from '../../i18n';
import { IconUserPlus } from '../common/Icons';
import type {
  NativeUploadFile,
  DocumentImageQuality,
  WorkerDocumentKind,
  ContractorWorkerAccountResponse,
} from '@smartsite/api-client';
import { healthCertificateExpiry } from '@smartsite/api-client';
import { Attachments } from '../../features/shared/uploads';
import { documentKinds } from '../../features/contractor/worker-documents';
import { Choice, Disclosure, Hint } from '../../features/shared/ui';
import { CalendarDateField } from '../../features/shared/calendar-date-field';

import { RequestSheet } from '../../features/shared/request-sheet';
import { FormSection } from '../../features/shared/form-section';

interface CreateWorkerModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CreateWorkerModal({ visible, onClose, onSuccess }: CreateWorkerModalProps) {
  const { t } = useTranslation();
  const { scope, client, token } = useWorkspace();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER' | ''>('');
  const [address, setAddress] = useState('');
  const [identityFiles, setIdentityFiles] = useState<
    Partial<Record<'FRONT' | 'BACK', NativeUploadFile[]>>
  >({});
  const [files, setFiles] = useState<Partial<Record<WorkerDocumentKind, NativeUploadFile[]>>>({});
  const [expiries, setExpiries] = useState<Partial<Record<WorkerDocumentKind, string>>>({});
  const [identityChecks, setIdentityChecks] = useState<
    Partial<Record<'FRONT' | 'BACK', DocumentImageQuality>>
  >({});
  const [checks, setChecks] = useState<Partial<Record<WorkerDocumentKind, DocumentImageQuality>>>(
    {},
  );
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  const [pendingAccount, setPendingAccount] = useState<ContractorWorkerAccountResponse | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const command = useCommand();
  const requestId = useRequestId();
  const [safetyCardRequired, setSafetyCardRequired] = useState('');
  const validateImage = async (file: NativeUploadFile) => {
    const result = await client.checkDocumentImageQuality(
      token,
      scope.siteId,
      scope.contractorId,
      file,
    );
    return result;
  };

  const handleCreate = async () => {
    try {
      setLocalError(null);
      for (const kind of documentKinds)
        if (files[kind]?.[0]) validDates(expiries[kind] ?? '', expiries[kind] ?? '');
      const name = required(displayName, t('workforce.fullName'));
      const user = required(username, t('workforce.username'));
      const recipient = required(email, t('accountEmail.email')).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
        throw new Error(t('accountEmail.invalidEmail'));
      if (
        !/^[0-9]{12}$/.test(nationalId) ||
        !/^\+?[0-9]{9,15}$/.test(phoneNumber) ||
        !gender ||
        !address.trim() ||
        !identityFiles.FRONT?.[0] ||
        !identityFiles.BACK?.[0] ||
        !safetyCardRequired ||
        documentKinds.some(
          (kind) => (kind !== 'SAFETY_CARD' || safetyCardRequired === 'true') && !files[kind]?.[0],
        )
      )
        throw new Error(t('documents.required'));
      await command.mutateAsync(async () => {
        const account =
          pendingAccount ??
          (await client.createContractorWorkerAccount(token, scope.contractorId, {
            siteId: scope.siteId,
            displayName: name,
            username: user,
            email: recipient,
            language: uiLanguage(),
            nationalId,
            phoneNumber,
            gender,
            address: address.trim(),
          }));
        setPendingAccount(account);
        const current = await client.workerCompliance(token, scope.siteId, account.worker.id);
        const expectedVersion = pendingVersion ?? current.version ?? 0;
        setPendingVersion(expectedVersion);
        const documents: import('@smartsite/api-client').SubmitWorkerDocumentsCommand['documents'] =
          {};
        const selected: Partial<Record<WorkerDocumentKind | 'FRONT' | 'BACK', NativeUploadFile>> =
          {};
        for (const kind of documentKinds)
          if (files[kind]?.[0]) {
            selected[kind] = files[kind]![0];
            documents[kind] =
              kind === 'HEALTH_CERTIFICATE'
                ? { submittedIssuedOn: expiries[kind]! }
                : { submittedExpiresOn: expiries[kind]! };
          }
        for (const side of ['FRONT', 'BACK'] as const) selected[side] = identityFiles[side]![0];
        const input = {
          expectedVersion,
          safetyCardRequired: safetyCardRequired === 'true',
          documents,
        };
        await client.submitWorkerDocuments(
          token,
          scope.siteId,
          account.worker.id,
          { ...input, requestId: requestId({ input, selected }) },
          selected,
        );
      });
      setDisplayName('');
      setUsername('');
      setEmail('');
      setNationalId('');
      setPhoneNumber('');
      setFiles({});
      setChecks({});
      setExpiries({});
      setPendingAccount(null);
      setPendingVersion(null);
      setSafetyCardRequired('');
      setGender('');
      setAddress('');
      setIdentityFiles({});
      setIdentityChecks({});
      onSuccess?.();
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t('common.unexpectedError'));
    }
  };

  return (
    <RequestSheet
      visible={visible}
      variant="form"
      busy={command.isPending}
      onClose={onClose}
      title={t('workforce.createTitle')}
      subtitle={scope.contractorName + ' · ' + scope.siteName}
      icon={<IconUserPlus size={23} color={colors.primary} />}
      footer={
        <View style={styles.footerActions}>
          {Boolean(localError || command.error) && (
            <View style={styles.errorBox}>
              <Text accessibilityRole="alert" style={styles.errorText}>
                {localError ??
                  (command.error instanceof Error
                    ? command.error.message
                    : t('common.unexpectedError'))}
              </Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('documents.sendBundle')}
            accessibilityState={{ disabled: command.isPending, busy: command.isPending }}
            style={[styles.submitBtn, command.isPending && { opacity: 0.7 }]}
            onPress={handleCreate}
            disabled={command.isPending}
          >
            {command.isPending ? (
              <ActivityIndicator size="small" color={colors.textWhite} />
            ) : (
              <Text style={styles.submitBtnText}>{t('documents.sendBundle')}</Text>
            )}
          </Pressable>
        </View>
      }
    >
      <FormSection number="01" title={t('contractorUi.accountInfo')}>
        {/* Field: Full Name */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('workforce.fullName')}</Text>
          <TextInput
            accessibilityLabel={t('workforce.fullName')}
            style={styles.input}
            placeholder={tr('workforce.nameExample')}
            placeholderTextColor={colors.textMuted}
            value={displayName}
            editable={!pendingAccount && !command.isPending}
            onChangeText={(v) => {
              setDisplayName(v);
              if (localError) setLocalError(null);
            }}
            autoCapitalize="words"
          />
        </View>

        {/* Field: Username */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('workforce.username')}</Text>
          <TextInput
            accessibilityLabel={t('workforce.username')}
            style={styles.input}
            placeholder={tr('workforce.usernameExample')}
            placeholderTextColor={colors.textMuted}
            value={username}
            editable={!pendingAccount && !command.isPending}
            onChangeText={(v) => {
              setUsername(v);
              if (localError) setLocalError(null);
            }}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('accountEmail.email')}</Text>
          <TextInput
            accessibilityLabel={t('accountEmail.email')}
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            editable={!pendingAccount && !command.isPending}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
          />
          <Hint>{t('accountEmail.workerCreationHint')}</Hint>
        </View>
      </FormSection>
      <FormSection number="02" title={t('contractorUi.requiredProfile')}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('documents.nationalId')}</Text>
          <TextInput
            accessibilityLabel={t('documents.nationalId')}
            style={styles.input}
            value={nationalId}
            onChangeText={(v) => setNationalId(v.trim())}
            keyboardType="number-pad"
            maxLength={12}
            editable={!pendingAccount && !command.isPending}
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('documents.phoneNumber')}</Text>
          <TextInput
            accessibilityLabel={t('documents.phoneNumber')}
            style={styles.input}
            value={phoneNumber}
            onChangeText={(v) => setPhoneNumber(v.replace(/\s/g, ''))}
            keyboardType="phone-pad"
            maxLength={16}
            editable={!pendingAccount && !command.isPending}
          />
        </View>
        <View pointerEvents={pendingAccount || command.isPending ? 'none' : 'auto'}>
          <Choice
            label={t('documents.gender')}
            value={gender}
            onChange={(v) => setGender(v as typeof gender)}
            options={(['MALE', 'FEMALE', 'OTHER'] as const).map((value) => ({
              value,
              label: t(`documents.${value}`),
            }))}
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t('documents.address')}</Text>
          <TextInput
            accessibilityLabel={t('documents.address')}
            style={styles.input}
            multiline
            maxLength={1000}
            value={address}
            onChangeText={setAddress}
            editable={!pendingAccount && !command.isPending}
          />
        </View>
        <View pointerEvents={pendingAccount || command.isPending ? 'none' : 'auto'}>
          {(['FRONT', 'BACK'] as const).map((side) => (
            <Disclosure
              key={side}
              title={`${t(`documents.${side}`)} · ${identityFiles[side]?.length ?? 0}/1`}
            >
              <Attachments
                files={identityFiles[side] ?? []}
                maxFiles={1}
                allowPdf={false}
                validateFile={async (file) => {
                  const result = await validateImage(file);
                  setIdentityChecks((previous) => ({ ...previous, [side]: result }));
                }}
                onChange={(selected) =>
                  setIdentityFiles((previous) => ({ ...previous, [side]: selected }))
                }
              />
              {identityChecks[side] && (
                <Hint>
                  {identityChecks[side]?.status !== 'ACCEPTED'
                    ? t('documents.' + identityChecks[side]?.reason)
                    : ''}
                  {identityChecks[side]?.ocr?.nationalIds?.some((id) => id !== nationalId)
                    ? ' · ' + t('documents.identityMismatch')
                    : ''}
                </Hint>
              )}
            </Disclosure>
          ))}
        </View>
      </FormSection>
      <FormSection number="03" title={t('documents.title')}>
        <Choice
          label={t('documents.safetyCardRequired')}
          value={safetyCardRequired}
          onChange={setSafetyCardRequired}
          options={[
            { value: 'true', label: t('documents.cardRequired') },
            { value: 'false', label: t('documents.cardNotRequired') },
          ]}
        />
        <Text style={styles.hintText}>{t('documents.hint')}</Text>
        <View pointerEvents={command.isPending ? 'none' : 'auto'}>
          {documentKinds.map((kind) => (
            <Disclosure
              key={kind}
              title={`${t(`documents.${kind}`)} · ${files[kind]?.length ?? 0}/1`}
            >
              <CalendarDateField
                label={t(
                  kind === 'HEALTH_CERTIFICATE'
                    ? 'documents.submittedIssuedOn'
                    : 'documents.submittedExpiresOn',
                )}
                value={expiries[kind] ?? ''}
                disabled={command.isPending}
                onChange={(value) => setExpiries((previous) => ({ ...previous, [kind]: value }))}
              />
              <Hint>
                {t(
                  kind === 'HEALTH_CERTIFICATE'
                    ? 'documents.healthExpiryRule'
                    : 'documents.submittedExpiryHint',
                )}{' '}
                {kind === 'HEALTH_CERTIFICATE'
                  ? (healthCertificateExpiry(expiries[kind]) ?? '')
                  : ''}
              </Hint>
              <Attachments
                files={files[kind] ?? []}
                maxFiles={1}
                validateFile={async (file) => {
                  const result = await validateImage(file);
                  setChecks((previous) => ({ ...previous, [kind]: result }));
                  const detected =
                    kind === 'HEALTH_CERTIFICATE' ? result.ocr?.issuedOn : result.ocr?.expiresOn;
                  if (detected)
                    setExpiries((previous) => ({
                      ...previous,
                      [kind]: previous[kind] || detected,
                    }));
                }}
                onChange={(selected) => setFiles((previous) => ({ ...previous, [kind]: selected }))}
              />
              {kind === 'SAFETY_CARD' && safetyCardRequired === 'false' && (
                <Hint>{t('documents.optional')}</Hint>
              )}
              {expiries[kind] &&
                (kind === 'HEALTH_CERTIFICATE'
                  ? (healthCertificateExpiry(expiries[kind]) ?? '')
                  : expiries[kind]!) < localDate(new Date(), 'Asia/Ho_Chi_Minh') && (
                  <Hint>{t('documents.expiredWarning')}</Hint>
                )}
              {checks[kind] && (
                <Hint>
                  {t('documents.dateDetected')}:{' '}
                  {(kind === 'HEALTH_CERTIFICATE'
                    ? checks[kind]?.ocr?.issuedOn
                    : checks[kind]?.ocr?.expiresOn) ?? t('documents.notDetermined')}
                  {checks[kind]?.status !== 'ACCEPTED'
                    ? ' · ' + t('documents.' + checks[kind]?.reason)
                    : ''}
                  {checks[kind]?.ocr?.nationalIds?.some((id) => id !== nationalId)
                    ? ' · ' + t('documents.identityMismatch')
                    : ''}
                  {expiries[kind] &&
                  (kind === 'HEALTH_CERTIFICATE'
                    ? checks[kind]?.ocr?.issuedOn
                    : checks[kind]?.ocr?.expiresOn) &&
                  expiries[kind] !==
                    (kind === 'HEALTH_CERTIFICATE'
                      ? checks[kind]?.ocr?.issuedOn
                      : checks[kind]?.ocr?.expiresOn)
                    ? ' · ' + t('documents.dateMismatch')
                    : ''}
                </Hint>
              )}
            </Disclosure>
          ))}
        </View>
        {pendingAccount && <Text style={styles.hintText}>{t('documents.accountPending')}</Text>}
        {/* Hint Box */}
        <View style={styles.hintBox}>
          <Text style={styles.hintText}>{t('documents.accountHint')}</Text>
        </View>
      </FormSection>
    </RequestSheet>
  );
}

const styles = StyleSheet.create({
  footerActions: { gap: 10 },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 48,
  },
  hintBox: {
    backgroundColor: colors.warningLightBg,
    borderWidth: 1,
    borderColor: colors.warningBg,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  hintText: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBg,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12,
    color: colors.dangerText,
    lineHeight: 18,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 152,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textWhite,
    textAlign: 'center',
    lineHeight: 22,
    flexShrink: 1,
  },
});
