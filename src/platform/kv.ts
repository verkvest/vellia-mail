import { normalizeState } from '../mail/mailbox';
import type { MailboxState } from '../mail/types';

export interface KvStore {
  load(): Promise<MailboxState | null>;
  save(state: MailboxState): Promise<void>;
}

const KEY = 'vellia-mail-mailbox';

interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): WebStorage | null {
  const candidate = (globalThis as { localStorage?: WebStorage }).localStorage;
  return candidate ?? null;
}

export const kv: KvStore = {
  async load() {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    try {
      return normalizeState(JSON.parse(raw) as MailboxState);
    } catch {
      return null;
    }
  },
  async save(state) {
    storage()?.setItem(KEY, JSON.stringify(state));
  },
};
