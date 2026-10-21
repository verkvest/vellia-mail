export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const memory = new Map<string, string>();

/** Browser preview keeps secrets in memory only, for the current tab. */
export const secrets: SecretStore = {
  async get(key) {
    return memory.get(key) ?? null;
  },
  async set(key, value) {
    memory.set(key, value);
  },
  async delete(key) {
    memory.delete(key);
  },
};

export const secretsArePersistent = false;
