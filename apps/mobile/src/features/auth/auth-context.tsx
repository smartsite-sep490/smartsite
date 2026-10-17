import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { useQuery, useQueryClient, focusManager } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { MobileSession } from './mobile-session';

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.trim() ?? '';
const credentialKey = Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, API_URL).then(
  (hash) => `smartsite.mobile.refresh.${hash}`,
);
const AuthContext = createContext<MobileSession | null>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const cache = useQueryClient();
  const [session] = useState(
    () =>
      new MobileSession(
        {
          read: async () => SecureStore.getItemAsync(await credentialKey),
          write: async (token) =>
            SecureStore.setItemAsync(await credentialKey, token, {
              keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            }),
          remove: async () => SecureStore.deleteItemAsync(await credentialKey),
        },
        new SmartSiteManagementClient(API_URL),
      ),
  );
  useEffect(() => {
    let epoch = session.getSnapshot().epoch;
    const unsubscribe = session.subscribe(() => {
      if (epoch === session.getSnapshot().epoch) return;
      epoch = session.getSnapshot().epoch;
      void cache.cancelQueries();
      cache.clear();
    });
    const sub = AppState.addEventListener('change', (state) =>
      focusManager.setFocused(state === 'active'),
    );
    return () => {
      unsubscribe();
      sub.remove();
    };
  }, [session, cache]);
  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const session = useContext(AuthContext);
  if (!session) throw new Error('AuthProvider missing');
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const client = useMemo(
    () => new SmartSiteManagementClient(API_URL, session.adapter(snapshot.epoch)),
    [session, snapshot.epoch],
  );
  return { session, ...snapshot, client, token: snapshot.response?.accessToken ?? '' };
}
export function useCurrentUser() {
  const { client, token, epoch } = useAuth();
  return useQuery({
    queryKey: ['mobile', 'me', API_URL, epoch],
    queryFn: () => client.me(token),
    enabled: !!token,
    staleTime: 30000,
  });
}
