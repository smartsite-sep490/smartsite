import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation, uiLanguage } from '../../i18n';
import { colors } from '../../theme/colors';
import { API_URL } from '../auth/auth-context';
import { useWorkspace } from './workspace-context';
import { Button, ErrorNotice } from '../shared/ui';

type Installation = { id: string; secret: string; enabled: boolean };
type PushState = {
  reason: string | null;
  active: boolean;
  enabled: boolean;
  busy: boolean;
  error: unknown;
  enable: () => void;
  disable: () => void;
};
const PushContext = createContext<PushState | null>(null);
const storageKey = () =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, API_URL).then(
    (value) => `smartsite.mobile.push.${value}`,
  );
async function loadInstallation(): Promise<Installation> {
  const key = await storageKey(),
    stored = await SecureStore.getItemAsync(key);
  if (stored) {
    try {
      const value = JSON.parse(stored) as Installation;
      if (
        /^[a-f0-9-]{36}$/.test(value.id) &&
        /^[a-f0-9]{64}$/.test(value.secret) &&
        typeof value.enabled === 'boolean'
      )
        return value;
    } catch {
      /* Ignore an unusable local installation record. */
    }
  }
  const installation = {
    id: Crypto.randomUUID(),
    secret: (Crypto.randomUUID() + Crypto.randomUUID()).replaceAll('-', ''),
    enabled: false,
  };
  await SecureStore.setItemAsync(key, JSON.stringify(installation));
  return installation;
}
const projectId =
  Constants.easConfig?.projectId ??
  Constants.expoConfig?.extra?.eas?.projectId ??
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
const nativeReason =
  Constants.executionEnvironment === 'storeClient'
    ? 'push.expoGo'
    : !['ios', 'android'].includes(Platform.OS)
      ? 'push.nativeOnly'
      : typeof projectId !== 'string' || !projectId
        ? 'push.projectRequired'
        : null;

export function MobilePushProvider({
  children,
  onOpenNotifications,
}: PropsWithChildren<{ onOpenNotifications: () => void }>) {
  const { client, token, user, queryKey } = useWorkspace();
  const cache = useQueryClient();
  const [installation, setInstallation] = useState<Installation | null>(null);
  const callback = useRef(onOpenNotifications);
  useEffect(() => {
    callback.current = onOpenNotifications;
  }, [onOpenNotifications]);
  const settings = useQuery({
    queryKey: [...queryKey, 'push-settings'],
    queryFn: () => client.mobilePushSettings(token),
    enabled: !nativeReason,
  });
  const command = useMutation({
    mutationFn: (operation: () => Promise<void>) => operation(),
    retry: false,
    onSuccess: () => cache.invalidateQueries({ queryKey: [...queryKey, 'push-settings'] }),
  });
  useEffect(() => {
    if (nativeReason) return;
    let active = true;
    void loadInstallation()
      .then((value) => {
        if (active) setInstallation(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const persist = async (value: Installation) => {
    await SecureStore.setItemAsync(await storageKey(), JSON.stringify(value));
    setInstallation(value);
  };
  const register = async (ask: boolean) => {
    if (nativeReason || !installation || !settings.data?.enabled)
      throw new Error('Remote push is not available for this app');
    const notifications = await import('expo-notifications');
    if (Platform.OS === 'android')
      await notifications.setNotificationChannelAsync('smartsite', {
        name: 'SmartSite',
        importance: notifications.AndroidImportance.HIGH,
      });
    let permission = await notifications.getPermissionsAsync();
    if (!permission.granted && ask && permission.canAskAgain)
      permission = await notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
    const allowed =
      permission.granted ||
      permission.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!allowed) {
      if (installation.enabled) {
        await client.removeMobilePush(token, installation.id, {
          installationSecret: installation.secret,
        });
        await persist({ ...installation, enabled: false });
      }
      if (ask) throw new Error('Notification permission has not been granted');
      return;
    }
    const expoToken = await notifications.getExpoPushTokenAsync({ projectId });
    await client.registerMobilePush(token, installation.id, {
      installationSecret: installation.secret,
      expoPushToken: expoToken.data,
      platform: Platform.OS as 'ios' | 'android',
      language: uiLanguage(),
    });
    if (!installation.enabled) await persist({ ...installation, enabled: true });
  };
  const registerRef = useRef(register);
  useEffect(() => {
    registerRef.current = register;
  });
  useEffect(() => {
    if (nativeReason || !installation?.enabled || !settings.data?.enabled) return;
    let cancelled = false;
    const refresh = () => {
      if (!cancelled)
        void registerRef
          .current(false)
          .then(() => cache.invalidateQueries({ queryKey: [...queryKey, 'push-settings'] }))
          .catch(() => {});
    };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [
    client,
    token,
    user.id,
    installation?.id,
    installation?.enabled,
    settings.data?.enabled,
    cache,
    queryKey,
  ]);
  useEffect(() => {
    if (nativeReason) return;
    let disposed = false,
      cleanup: (() => void) | undefined;
    void import('expo-notifications')
      .then((notifications) => {
        if (disposed) return;
        notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });
        const handle = (response: import('expo-notifications').NotificationResponse) => {
          if (response.notification.request.content.data?.kind === 'smartsite-notification') {
            callback.current();
            notifications.clearLastNotificationResponse();
          }
        };
        const listener = notifications.addNotificationResponseReceivedListener(handle);
        cleanup = () => listener.remove();
        const last = notifications.getLastNotificationResponse();
        if (last) handle(last);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [user.id]);
  const active =
    !!installation?.enabled &&
    !!settings.data?.devices.some((device) => device.id === installation.id && device.active);
  return (
    <PushContext.Provider
      value={{
        reason: nativeReason,
        active,
        enabled: !!settings.data?.enabled && !!installation,
        busy: command.isPending,
        error: command.error ?? settings.error,
        enable: () => command.mutate(() => registerRef.current(true)),
        disable: () =>
          command.mutate(async () => {
            if (!installation) return;
            await client.removeMobilePush(token, installation.id, {
              installationSecret: installation.secret,
            });
            await persist({ ...installation, enabled: false });
          }),
      }}
    >
      {children}
    </PushContext.Provider>
  );
}
export function MobilePushCard() {
  const { t } = useTranslation(),
    push = useContext(PushContext);
  if (!push) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('push.title')}</Text>
      <Text style={styles.hint}>
        {t(
          push.reason ??
            (push.active ? 'push.active' : push.enabled ? 'push.hint' : 'push.notConfigured'),
        )}
      </Text>
      {!push.reason && (
        <>
          <ErrorNotice error={push.error} />
          <Button
            secondary
            label={t(push.active ? 'push.disable' : 'push.enable')}
            disabled={push.busy || !push.enabled}
            onPress={push.active ? push.disable : push.enable}
          />
          <Button
            secondary
            label={t('push.systemSettings')}
            onPress={() => void Linking.openSettings()}
          />
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
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
  hint: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
});
