import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconChevronRight } from '../../components/common/Icons';
import { useTranslation, uiLanguage } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { Button, ErrorNotice, Field } from '../shared/ui';
import { RequestSheet } from '../shared/request-sheet';
import { useCommand } from '../shared/data';
import { useEmailCooldown } from './use-email-cooldown';

export function AccountEmailCard({ settingsRow = false }: { settingsRow?: boolean }) {
  const { t } = useTranslation();
  const { client, token, user } = useWorkspace();
  const compact = settingsRow;
  const verified = !!user.email && !!user.emailVerifiedAt;
  const statusKey = verified
    ? 'accountEmail.verified'
    : user.email
      ? 'accountEmail.notVerified'
      : 'accountEmail.notAddedShort';
  const actionKey = !user.email
    ? 'accountEmail.addEmail'
    : verified
      ? 'accountEmail.changeEmail'
      : 'accountEmail.verifyAction';
  const [mode, setMode] = useState<'VERIFY' | 'CHANGE' | null>(null);
  const [email, setEmail] = useState(''),
    [currentPassword, setCurrentPassword] = useState(''),
    [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const command = useCommand(),
    cooldown = useEmailCooldown();
  const open = (next: 'VERIFY' | 'CHANGE') => {
    command.reset();
    setEmail(user.email ?? '');
    setCurrentPassword('');
    setCode('');
    setNotice('');
    setMode(next);
  };
  return (
    <View style={settingsRow ? undefined : styles.card}>
      {compact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(actionKey)}
          accessibilityHint={`${user.email ?? t('accountEmail.notAdded')}, ${t(statusKey)}`}
          onPress={() => open(user.email && !verified ? 'VERIFY' : 'CHANGE')}
          style={({ pressed }) => [styles.settingsRow, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.emailIcon}>
            <Text style={styles.atSign}>@</Text>
          </View>
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {t('accountEmail.title')}
            </Text>
            <Text numberOfLines={1} style={styles.rowSubtitle}>
              {user.email ?? t('accountEmail.addEmail')}
            </Text>
          </View>
          <View style={[styles.statusBadge, verified ? styles.verifiedBadge : styles.pendingBadge]}>
            <Text
              numberOfLines={1}
              style={[styles.statusLabel, { color: verified ? '#065F46' : '#C2410C' }]}
            >
              {t(statusKey)}
            </Text>
          </View>
          <IconChevronRight size={16} color="#CBD5E1" />
        </Pressable>
      ) : (
        <View style={styles.body}>
          <Text style={styles.title}>{t('accountEmail.title')}</Text>
          <Text style={styles.value}>{user.email ?? t('accountEmail.notAdded')}</Text>
          {user.email && (
            <Text style={[styles.caption, user.emailVerifiedAt ? styles.verified : styles.pending]}>
              {t(user.emailVerifiedAt ? 'accountEmail.verified' : 'accountEmail.notVerified')}
            </Text>
          )}
          <Text style={styles.caption}>{t('accountEmail.profileHint')}</Text>
          {!!notice && !mode && (
            <Text accessibilityLiveRegion="polite" style={styles.verified}>
              {notice}
            </Text>
          )}
          {user.email && !user.emailVerifiedAt && (
            <Button
              secondary
              label={t('accountEmail.verifyAction')}
              onPress={() => open('VERIFY')}
            />
          )}
          <Button
            secondary
            label={t(user.email ? 'accountEmail.changeEmail' : 'accountEmail.addEmail')}
            onPress={() => open('CHANGE')}
          />
        </View>
      )}
      {mode && (
        <RequestSheet
          visible
          variant="compact"
          title={t(
            mode === 'VERIFY'
              ? 'accountEmail.verifyAction'
              : user.email
                ? 'accountEmail.changeEmail'
                : 'accountEmail.addEmail',
          )}
          onClose={() => {
            if (!command.isPending) {
              setMode(null);
              setCurrentPassword('');
              setCode('');
            }
          }}
          busy={command.isPending}
          footer={
            <View style={styles.actions}>
              <ErrorNotice error={command.error} />
              <Button
                label={t(
                  mode === 'CHANGE' ? 'accountEmail.saveEmail' : 'accountEmail.verifyAction',
                )}
                disabled={
                  command.isPending ||
                  (mode === 'CHANGE'
                    ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !currentPassword
                    : !/^\d{6}$/.test(code))
                }
                onPress={() =>
                  command.mutate(async () => {
                    if (mode === 'CHANGE') {
                      await client.setAccountEmail(token, {
                        email: email.trim().toLowerCase(),
                        currentPassword,
                        language: uiLanguage(),
                      });
                      setCurrentPassword('');
                      setCode('');
                      setMode('VERIFY');
                      setNotice(t('accountEmail.queued'));
                      cooldown.start();
                    } else {
                      await client.verifyAccountEmail(token, { code });
                      setCode('');
                      setMode(null);
                      setNotice(t('accountEmail.verifySuccess'));
                    }
                  })
                }
              />
            </View>
          }
        >
          {mode === 'CHANGE' ? (
            <>
              <Text style={styles.caption}>{t('accountEmail.changeHint')}</Text>
              <Field
                label={t('accountEmail.email')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoComplete="email"
                autoCorrect={false}
              />
              <Field
                label={t('profile.currentPassword')}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
              />
            </>
          ) : (
            <>
              <Text style={styles.value}>{email || user.email}</Text>
              <Text style={styles.caption}>{t('accountEmail.verifyHint')}</Text>
              {notice && (
                <Text accessibilityLiveRegion="polite" style={styles.caption}>
                  {notice}
                </Text>
              )}
              <Field
                label={t('accountEmail.code')}
                value={code}
                onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                maxLength={6}
              />
              <Button
                secondary
                label={
                  cooldown.remaining
                    ? t('accountEmail.resendIn', { seconds: cooldown.remaining })
                    : t('accountEmail.resend')
                }
                disabled={command.isPending || cooldown.remaining > 0}
                onPress={() =>
                  command.mutate(async () => {
                    await client.resendEmailVerification(token, uiLanguage());
                    cooldown.start();
                    setNotice(t('accountEmail.queued'));
                  })
                }
              />
              <Button
                secondary
                label={t('accountEmail.changeEmail')}
                disabled={command.isPending}
                onPress={() => open('CHANGE')}
              />
            </>
          )}
        </RequestSheet>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  settingsRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  emailIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  atSign: { color: '#2563EB', fontSize: 20, fontWeight: '600' },
  rowCopy: { flex: 1, minWidth: 0, gap: 3, marginRight: 8 },
  rowTitle: { fontSize: 14.5, fontWeight: '600', color: '#0F1E36' },
  rowSubtitle: { fontSize: 12, color: colors.textMuted },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginRight: 8,
  },
  verifiedBadge: { backgroundColor: '#EDFAF2' },
  pendingBadge: { backgroundColor: '#FFF7ED' },
  statusLabel: { fontSize: 11, fontWeight: '700' },
  body: { gap: 10 },
  card: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
    marginBottom: 16,
  },
  title: { fontSize: 15, lineHeight: 23, fontWeight: '700', color: colors.textPrimary },
  value: { fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  caption: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  verified: { fontSize: 12, lineHeight: 19, color: colors.successText },
  pending: { color: colors.warningText },
  actions: { gap: 8 },
});
