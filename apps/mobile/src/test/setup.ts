import { vi } from 'vitest';

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }));

const memoryStore = new Map<string, string>();

Object.assign(globalThis, {
  __DEV__: true,
  IS_REACT_ACT_ENVIRONMENT: true,
});

vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => memoryStore.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    memoryStore.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    memoryStore.delete(key);
  }),
}));
