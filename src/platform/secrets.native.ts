import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from './secrets';

const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

function safeKey(key: string): string {
  return `vellia.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export const secrets: SecretStore = {
  async get(key) {
    return SecureStore.getItemAsync(safeKey(key), options);
  },
  async set(key, value) {
    await SecureStore.setItemAsync(safeKey(key), value, options);
  },
  async delete(key) {
    await SecureStore.deleteItemAsync(safeKey(key), options);
  },
};

export const secretsArePersistent = true;
