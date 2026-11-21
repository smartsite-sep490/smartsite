import { vi } from 'vitest';

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }));
vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'storeClient', easConfig: null, expoConfig: null },
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  SafeAreaProvider: 'SafeAreaProvider',
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const memoryStore = new Map<string, string>();

Object.assign(globalThis, {
  __DEV__: true,
  IS_REACT_ACT_ENVIRONMENT: true,
});

vi.mock('expo-crypto', async () => {
  const { createHash, randomUUID } = await import('node:crypto');
  return {
    randomUUID,
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex'),
  };
});
vi.mock('expo-file-system', () => ({ File: vi.fn(), Paths: { cache: 'test-cache' } }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(async () => true), shareAsync: vi.fn() }));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => memoryStore.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    memoryStore.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    memoryStore.delete(key);
  }),
}));
