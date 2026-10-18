import { translate as tr } from '../../i18n';
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
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
import { Choice, Field, Hint } from '../../features/shared/ui';

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheetCard}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <IconUserPlus size={20} color={colors.primary} />
              </View>
              <View>
                <Text style={styles.title}>{t('workforce.createTitle')}</Text>
                <Text style={styles.subtitle}>
                  {scope.contractorName} · {scope.siteName}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={10}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {/* Field: Full Name */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('workforce.fullName')}</Text>
              <TextInput
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
            <Text style={styles.hintText}>{t('documents.hint')}</Text>
            <View pointerEvents={command.isPending ? 'none' : 'auto'}>
              {documentKinds.map((kind) => (
                <View key={kind} style={styles.fieldGroup}>
                  <Text style={styles.label}>{t(`documents.${kind}`)}</Text>
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
                    onChange={(selected) =>
                      setFiles((previous) => ({ ...previous, [kind]: selected }))
                    }
                  />
                </View>
              ))}
            </View>
            {pendingAccount && <Text style={styles.hintText}>{t('documents.accountPending')}</Text>}
            {/* Hint Box */}
            <View style={styles.hintBox}>
              <Text style={styles.hintText}>{t('documents.accountHint')}</Text>
            </View>

            {/* Error Message */}
            {Boolean(localError || command.error) && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>
                  {localError ??
                    (command.error instanceof Error
                      ? command.error.message
                      : t('common.unexpectedError'))}
                </Text>
              </View>
            )}

            {/* Buttons Row */}
            <View style={styles.actionsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
                style={styles.cancelBtn}
                onPress={onClose}
              >
                <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('workforce.createAccount')}
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
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 30, 54, 0.45)',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF2F6',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  body: {
    paddingBottom: 10,
  },
  fieldGroup: {
    marginBottom: 14,
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
    color: '#92400E',
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
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  submitBtn: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
