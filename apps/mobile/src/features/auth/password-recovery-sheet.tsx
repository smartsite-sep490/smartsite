import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { useTranslation, uiLanguage } from '../../i18n';
import { colors } from '../../theme/colors';
import { API_URL } from './auth-context';
import { RequestSheet } from '../shared/request-sheet';
import { Button, ErrorNotice, Field } from '../shared/ui';
import { useEmailCooldown } from './use-email-cooldown';

export function PasswordRecoverySheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [client] = useState(() => new SmartSiteManagementClient(API_URL));
  const [phase, setPhase] = useState<'REQUEST' | 'RESET' | 'DONE'>('REQUEST');
  const [identifier, setIdentifier] = useState(''),
    [code, setCode] = useState('');
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const cooldown = useEmailCooldown();
  const command = useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    retry: false,
  });
  const request = () =>
    command.mutate(async () => {
      await client.requestPasswordReset({
        identifier: identifier.trim().toLowerCase(),
        language: uiLanguage(),
      });
      setPhase('RESET');
      cooldown.start();
    });
  return (
    <RequestSheet
      visible
      variant="compact"
      title={t('accountEmail.recoveryTitle')}
      subtitle={t('accountEmail.recoveryHint')}
      onClose={onClose}
      busy={command.isPending}
      footer={
        <View style={styles.actions}>
          <ErrorNotice error={command.error} />
          {phase === 'DONE' ? (
            <Button label={t('common.close')} onPress={onClose} />
          ) : phase === 'REQUEST' ? (
            <Button
              label={t('accountEmail.requestCode')}
              disabled={command.isPending || identifier.trim().length < 3}
              onPress={request}
            />
          ) : (
            <Button
              label={t('accountEmail.resetPassword')}
              disabled={
                command.isPending || !/^\d{6}$/.test(code) || !password || password !== confirmation
              }
              onPress={() =>
                command.mutate(async () => {
                  await client.confirmPasswordReset({
                    identifier: identifier.trim().toLowerCase(),
                    code,
                    password,
                  });
                  setPassword('');
                  setConfirmation('');
                  setCode('');
                  setPhase('DONE');
                })
              }
            />
          )}
        </View>
      }
    >
      {phase === 'REQUEST' ? (
        <Field
          label={t('accountEmail.identifier')}
          value={identifier}
          onChangeText={setIdentifier}
          autoCorrect={false}
        />
      ) : phase === 'RESET' ? (
        <>
          <Text style={styles.notice}>{t('accountEmail.requestAccepted')}</Text>
          <Text style={styles.caption}>{identifier.trim()}</Text>
          <Field
            label={t('accountEmail.code')}
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
          />
          <Field
            label={t('accountEmail.newPassword')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
          />
          <Field
            label={t('accountEmail.confirmPassword')}
            value={confirmation}
            onChangeText={setConfirmation}
            secureTextEntry
          />
          <Text style={styles.caption}>{t('accountEmail.passwordHint')}</Text>
          <Button
            secondary
            label={
              cooldown.remaining
                ? t('accountEmail.resendIn', { seconds: cooldown.remaining })
                : t('accountEmail.resend')
            }
            disabled={command.isPending || cooldown.remaining > 0}
            onPress={request}
          />
          <Button
            secondary
            label={t('accountEmail.changeIdentifier')}
            disabled={command.isPending}
            onPress={() => {
              command.reset();
              setCode('');
              setPassword('');
              setConfirmation('');
              setPhase('REQUEST');
            }}
          />
        </>
      ) : (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {t('accountEmail.resetSuccess')}
        </Text>
      )}
    </RequestSheet>
  );
}
const styles = StyleSheet.create({
  actions: { gap: 8 },
  caption: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  notice: {
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.primaryLight,
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 21,
  },
});
