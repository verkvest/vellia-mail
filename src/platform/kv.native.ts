import * as SQLite from 'expo-sqlite';
import { normalizeState, sanitizeMailbox } from '../mail/mailbox';
import type { MailboxState } from '../mail/types';
import type { KvStore } from './kv';

let opening: Promise<SQLite.SQLiteDatabase> | null = null;

function database(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) {
    opening = (async () => {
      const db = await SQLite.openDatabaseAsync('vellia-mail.db');
      await db.execAsync('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
      return db;
    })();
  }
  return opening;
}

export const kv: KvStore = {
  async load() {
    const db = await database();
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'mailbox');
    if (!row?.value) return null;
    try {
      return normalizeState(JSON.parse(row.value) as MailboxState);
    } catch {
      return null;
    }
  },
  async save(state) {
    const clean = sanitizeMailbox(state);
    const db = await database();
    await db.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'mailbox',
      JSON.stringify(clean),
    );
  },
};
