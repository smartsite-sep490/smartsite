import { translate as tr } from '../../i18n';
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../../features/workspace/workspace-context';
import { useCommand, required, validDates } from '../../features/shared/data';
import { useTranslation } from '../../i18n';
import { IconUserPlus } from '../common/Icons';
import type {
  NativeUploadFile,
  WorkerDocumentKind,
  ContractorWorkerAccountResponse,
} from '@smartsite/api-client';
import { healthCertificateExpiry } from '@smartsite/api-client';
import { Attachments } from '../../features/shared/uploads';
import { documentKinds } from '../../features/contractor/worker-documents';
import { Choice, Disclosure, Field, Hint } from '../../features/shared/ui';

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
  const [nationalId, setNationalId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER' | ''>('');
  const [address, setAddress] = useState('');
  const [identityFiles, setIdentityFiles] = useState<
    Partial<Record<'FRONT' | 'BACK', NativeUploadFile[]>>
  >({});
  const [files, setFiles] = useState<Partial<Record<WorkerDocumentKind, NativeUploadFile[]>>>({});
  const [expiries, setExpiries] = useState<Partial<Record<WorkerDocumentKind, string>>>({});
  const [pendingAccount, setPendingAccount] = useState<ContractorWorkerAccountResponse | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const command = useCommand();
  const validateImage = async (file: NativeUploadFile) => {
    const result = await client.checkDocumentImageQuality(
      token,
      scope.siteId,
      scope.contractorId,
      file,
    );
    if (result.status !== 'ACCEPTED') throw new Error(t(`documents.${result.reason}`));
  };

  const handleCreate = async () => {
    try {
      setLocalError(null);
      for (const value of Object.values(expiries)) if (value) validDates(value, value);
      const name = required(displayName, t('workforce.fullName'));
      const user = required(username, t('workforce.username'));
      if (
        !/^[0-9]{12}$/.test(nationalId) ||
        !/^\+?[0-9]{9,15}$/.test(phoneNumber) ||
        !gender ||
        !address.trim() ||
        !identityFiles.FRONT?.[0] ||
        !identityFiles.BACK?.[0] ||
        documentKinds.some((kind) => !files[kind]?.[0])
      )
        throw new Error(t('documents.required'));
      await command.mutateAsync(async () => {
        const account =
          pendingAccount ??
          (await client.createContractorWorkerAccount(token, scope.contractorId, {
            siteId: scope.siteId,
            displayName: name,
            username: user,
            nationalId,
            phoneNumber,
            gender,
            address: address.trim(),
          }));
        setPendingAccount(account);
        for (const side of ['FRONT', 'BACK'] as const)
          await client.uploadWorkerIdentityImage(
            token,
            scope.siteId,
            account.worker.id,
            side,
            identityFiles[side]![0]!,
          );
        for (const kind of documentKinds)
          await client.uploadWorkerDocument(
            token,
            scope.siteId,
            account.worker.id,
            kind,
            files[kind]![0]!,
            expiries[kind]
              ? kind === 'HEALTH_CERTIFICATE'
                ? { submittedIssuedOn: expiries[kind] }
                : { submittedExpiresOn: expiries[kind] }
              : {},
          );
      });
      setDisplayName('');
      setUsername('');
      setNationalId('');
      setPhoneNumber('');
      setFiles({});
      setExpiries({});
      setPendingAccount(null);
      setGender('');
      setAddress('');
      setIdentityFiles({});
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
            accessibilityLabel={t('workforce.createAccount')}
            accessibilityState={{ disabled: command.isPending, busy: command.isPending }}
            style={[styles.submitBtn, command.isPending && { opacity: 0.7 }]}
            onPress={handleCreate}
            disabled={command.isPending}
          >
            {command.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.submitBtnText}>{t('workforce.createAccount')}</Text>
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
            <View key={side} style={styles.fieldGroup}>
              <Text style={styles.label}>{t(`documents.${side}`)}</Text>
              <Attachments
                files={identityFiles[side] ?? []}
                maxFiles={1}
                allowPdf={false}
                validateFile={validateImage}
                onChange={(selected) =>
                  setIdentityFiles((previous) => ({ ...previous, [side]: selected }))
                }
              />
            </View>
          ))}
        </View>
      </FormSection>
      <FormSection number="03" title={t('documents.title')}>
        <Text style={styles.hintText}>{t('documents.hint')}</Text>
        <View pointerEvents={command.isPending ? 'none' : 'auto'}>
          {documentKinds.map((kind) => (
            <Disclosure
              key={kind}
              title={`${t(`documents.${kind}`)} · ${files[kind]?.length ?? 0}/1`}
            >
              <Field
                label={`${t(`documents.${kind}`)} - ${t(kind === 'HEALTH_CERTIFICATE' ? 'documents.submittedIssuedOn' : 'documents.submittedExpiresOn')} (YYYY-MM-DD)`}
                placeholder="YYYY-MM-DD"
                value={expiries[kind] ?? ''}
                maxLength={10}
                editable={!command.isPending}
                onChangeText={(value) =>
                  setExpiries((previous) => ({ ...previous, [kind]: value }))
                }
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
                validateFile={validateImage}
                onChange={(selected) => setFiles((previous) => ({ ...previous, [kind]: selected }))}
              />
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
    backgroundColor: '#F8F9FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 48,
  },
  hintBox: {
    backgroundColor: '#FEF9ED',
    borderWidth: 1,
    borderColor: '#FDECC8',
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
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12,
    color: '#B91C1C',
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
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 22,
    flexShrink: 1,
  },
});
