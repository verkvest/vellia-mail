import { Platform } from 'react-native';
import { gmailToPulled, pullGmail, GmailApi, type GmailTokens } from '../mail/gmail/api';
import { ImapClient } from '../mail/imap/client';
import { buildMime, mimeToBase64Url } from '../mail/mime/build';
import { dropPending, mergePulled } from '../mail/merge';
import { addLocalSent, sanitizeMailbox, upsertAccount } from '../mail/mailbox';
import { noticeBody, planNotices } from '../mail/notify';
import { pullImapAccount, searchImap } from '../mail/pull';
import { publicError } from '../mail/redact';
import { SmtpClient } from '../mail/smtp/client';
import type { Account, ImapConfig, MailboxState, MailMessage, OutgoingMail, PendingOp } from '../mail/types';
import { createId, localMessageId } from '../mail/types';
import { openSocket } from '../platform/socket';
import { secrets } from '../platform/secrets';

export interface ImapDraft {
  email: string;
  displayName: string;
  password: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
}

export interface SyncOutcome {
  state: MailboxState;
  freshCount: number;
  note: string;
}

let chain: Promise<unknown> = Promise.resolve();

export function withMailboxLock<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

async function connectImap(config: ImapConfig): Promise<ImapClient> {
  const socket = await openSocket(config.imapHost, config.imapPort, config.imapTls);
  const client = new ImapClient(socket);
  await client.ready();
  return client;
}

async function connectSmtp(config: ImapConfig): Promise<SmtpClient> {
  const socket = await openSocket(config.smtpHost, config.smtpPort, config.smtpTls);
  return new SmtpClient(socket);
}

export async function probeImap(draft: ImapDraft): Promise<void> {
  const config = draftConfig(draft);
  const imap = await connectImap(config);
  try {
    await imap.login(config.username, draft.password);
    await imap.listMailboxes();
    await imap.logout();
  } catch (error) {
    imap.logout().catch(() => undefined);
    throw new Error(`IMAP: ${publicError(error)}`);
  }
  const smtp = await connectSmtp(config);
  try {
    await smtp.greet();
    await smtp.ehlo();
    await smtp.authPlain(config.username, draft.password);
    await smtp.quit();
  } catch (error) {
    smtp.quit().catch(() => undefined);
    throw new Error(`SMTP: ${publicError(error)}`);
  }
}

export async function rememberImapPassword(accountId: string, password: string): Promise<void> {
  await secrets.set(`imap.${accountId}`, password);
}

export async function rememberGmail(accountId: string, tokens: GmailTokens): Promise<void> {
  await secrets.set(`gmail.${accountId}.access`, tokens.accessToken);
  await secrets.set(`gmail.${accountId}.meta`, JSON.stringify({ expiresAt: tokens.expiresAt, clientId: tokens.clientId }));
  if (tokens.refreshToken) await secrets.set(`gmail.${accountId}.refresh`, tokens.refreshToken);
}

export async function forgetAccountSecrets(accountId: string): Promise<void> {
  await secrets.delete(`imap.${accountId}`);
  await secrets.delete(`gmail.${accountId}.access`);
  await secrets.delete(`gmail.${accountId}.meta`);
  await secrets.delete(`gmail.${accountId}.refresh`);
}

export async function syncAll(state: MailboxState, notify: boolean): Promise<SyncOutcome> {
  let next = state;
  const previous = new Set(state.messages.map((message) => `${message.accountId}:${message.remoteId}`));
  const errors: string[] = [];
  let freshCount = 0;
  const notices: { remoteId: string; unread: boolean; from: string; subject: string; accountEmail: string }[] = [];

  for (const account of state.accounts) {
    if (account.kind === 'demo') continue;
    try {
      const result = account.kind === 'gmail' ? await syncGmail(next, account) : await syncImap(next, account);
      freshCount += result.fresh.length;
      for (const message of result.fresh) {
        notices.push({
          remoteId: `${account.id}:${message.remoteId}`,
          unread: message.unread,
          from: message.from.name || message.from.email,
          subject: message.subject,
          accountEmail: account.email,
        });
      }
      next = result.state;
    } catch (error) {
      errors.push(`${account.email}: ${publicError(error)}`);
    }
  }

  next = sanitizeMailbox({
    ...next,
    settings: {
      ...next.settings,
      lastSyncAt: Date.now(),
      lastSyncError: errors[0],
    },
  });
  if (notify && freshCount > 0) {
    const body = noticeBody(planNotices(previous, notices), next.settings.locale);
    await notifyMail(body, next.messages.filter((message) => message.unread && message.folder.toUpperCase() === 'INBOX').length);
  }
  const note = errors.length ? errors.join('\n') : freshCount ? String(freshCount) : '';
  return { state: next, freshCount, note };
}

async function syncImap(state: MailboxState, account: Account): Promise<{ state: MailboxState; fresh: MailMessage[] }> {
  if (!account.imap) throw new Error('Нет настроек IMAP');
  const password = await secrets.get(`imap.${account.id}`);
  if (!password) throw new Error('Пароль не найден в Связке ключей');
  const client = await connectImap(account.imap);
  try {
    await client.login(account.imap.username || account.email, password);
    await flushImap(client, state.pending.filter((op) => op.accountId === account.id));
    const pulled = await pullImapAccount(client, 25);
    let accountNext = account;
    if (pulled.sentMailbox && account.imap.sentMailbox !== pulled.sentMailbox) {
      accountNext = { ...account, imap: { ...account.imap, sentMailbox: pulled.sentMailbox } };
      state = upsertAccount(state, accountNext);
    }
    const merged = mergePulled(state, accountNext, pulled.messages);
    await flushFilterFlags(client, merged.remoteReads, merged.remoteFlags);
    const done = state.pending.filter((op) => op.accountId === account.id);
    await client.logout();
    return { state: dropPending(merged.state, done), fresh: merged.fresh };
  } catch (error) {
    client.logout().catch(() => undefined);
    throw error;
  }
}

async function flushImap(client: ImapClient, ops: PendingOp[]): Promise<void> {
  const groups = new Map<string, number[]>();
  const push = (key: string, uid: number) => {
    const list = groups.get(key) ?? [];
    list.push(uid);
    groups.set(key, list);
  };
  for (const op of ops) {
    const uid = Number(op.remoteId);
    if (!Number.isFinite(uid)) continue;
    push(`${op.folder}|${op.op}`, uid);
  }
  for (const [key, uids] of groups) {
    const [folder, op] = key.split('|');
    if (!folder || !op) continue;
    await client.select(folder);
    if (op === 'read') await client.uidStore(uids, '+FLAGS.SILENT', '\\Seen');
    if (op === 'unread') await client.uidStore(uids, '-FLAGS.SILENT', '\\Seen');
    if (op === 'flag') await client.uidStore(uids, '+FLAGS.SILENT', '\\Flagged');
    if (op === 'unflag') await client.uidStore(uids, '-FLAGS.SILENT', '\\Flagged');
  }
}

async function flushFilterFlags(
  client: ImapClient,
  reads: { folder: string; remoteId: string }[],
  flags: { folder: string; remoteId: string }[],
): Promise<void> {
  const byFolder = (items: { folder: string; remoteId: string }[]) => {
    const map = new Map<string, number[]>();
    for (const item of items) {
      const uid = Number(item.remoteId);
      if (!Number.isFinite(uid)) continue;
      const list = map.get(item.folder) ?? [];
      list.push(uid);
      map.set(item.folder, list);
    }
    return map;
  };
  for (const [folder, uids] of byFolder(reads)) {
    await client.select(folder);
    await client.uidStore(uids, '+FLAGS.SILENT', '\\Seen');
  }
  for (const [folder, uids] of byFolder(flags)) {
    await client.select(folder);
    await client.uidStore(uids, '+FLAGS.SILENT', '\\Flagged');
  }
}

async function syncGmail(state: MailboxState, account: Account): Promise<{ state: MailboxState; fresh: MailMessage[] }> {
  const tokens = await loadGmail(account.id);
  if (!tokens) throw new Error('Вход Google не найден. Войдите снова.');
  const api = new GmailApi(fetchHttp(), tokens, (updated) => {
    void rememberGmail(account.id, updated);
  });
  await flushGmail(api, state.pending.filter((op) => op.accountId === account.id));
  const inbox = await pullGmail(api, 'INBOX', 25);
  const sent = await pullGmail(api, 'SENT', 10);
  const first = mergePulled(state, account, inbox);
  const second = mergePulled(first.state, account, sent);
  for (const item of [...first.remoteReads, ...second.remoteReads]) {
    await api.modify(item.remoteId, [], ['UNREAD']).catch(() => undefined);
  }
  for (const item of [...first.remoteFlags, ...second.remoteFlags]) {
    await api.modify(item.remoteId, ['STARRED'], []).catch(() => undefined);
  }
  const done = state.pending.filter((op) => op.accountId === account.id);
  return { state: dropPending(second.state, done), fresh: [...first.fresh, ...second.fresh] };
}

async function flushGmail(api: GmailApi, ops: PendingOp[]): Promise<void> {
  for (const op of ops) {
    if (op.op === 'read') await api.modify(op.remoteId, [], ['UNREAD']);
    if (op.op === 'unread') await api.modify(op.remoteId, ['UNREAD'], []);
    if (op.op === 'flag') await api.modify(op.remoteId, ['STARRED'], []);
    if (op.op === 'unflag') await api.modify(op.remoteId, [], ['STARRED']);
  }
}

export async function searchRemote(state: MailboxState, query: string): Promise<MailboxState> {
  let next = state;
  for (const account of state.accounts) {
    if (account.kind === 'imap' && account.imap) {
      const password = await secrets.get(`imap.${account.id}`);
      if (!password) continue;
      const client = await connectImap(account.imap);
      try {
        await client.login(account.imap.username || account.email, password);
        const found = await searchImap(client, 'INBOX', query, 20);
        next = mergePulled(next, account, found).state;
        await client.logout();
      } catch {
        client.logout().catch(() => undefined);
      }
    }
    if (account.kind === 'gmail') {
      try {
        const tokens = await loadGmail(account.id);
        if (!tokens) continue;
        const api = new GmailApi(fetchHttp(), tokens, (updated) => {
          void rememberGmail(account.id, updated);
        });
        const ids = await api.listMessageIds(query, 15);
        const pulled = [];
        for (const id of ids) pulled.push(gmailToPulled(await api.getMessage(id), 'INBOX'));
        next = mergePulled(next, account, pulled).state;
      } catch {
        // One account failing should not hide results from the others.
      }
    }
  }
  return next;
}

export async function deliver(state: MailboxState, account: Account, mail: OutgoingMail): Promise<MailboxState> {
  if (account.kind === 'demo') throw new Error('Демонстрационный ящик не отправляет письма.');
  const raw = buildMime(mail);
  let remoteId = createId('sent');
  if (account.kind === 'gmail') {
    const tokens = await loadGmail(account.id);
    if (!tokens) throw new Error('Вход Google не найден');
    const api = new GmailApi(fetchHttp(), tokens, (updated) => {
      void rememberGmail(account.id, updated);
    });
    const sent = await api.sendRaw(mimeToBase64Url(raw));
    remoteId = sent.id || remoteId;
  } else {
    if (!account.imap) throw new Error('Нет настроек SMTP');
    const password = await secrets.get(`imap.${account.id}`);
    if (!password) throw new Error('Пароль не найден в Связке ключей');
    const smtp = await connectSmtp(account.imap);
    try {
      await smtp.greet();
      await smtp.ehlo();
      await smtp.authPlain(account.imap.username || account.email, password);
      await smtp.send({
        from: account.email,
        to: [...mail.to, ...mail.cc, ...mail.bcc].map((item) => item.email),
        data: new TextDecoder().decode(raw),
      });
      await smtp.quit();
    } catch (error) {
      smtp.quit().catch(() => undefined);
      throw error;
    }
    if (account.imap.sentMailbox) {
      const imap = await connectImap(account.imap);
      try {
        await imap.login(account.imap.username || account.email, password);
        await imap.append(account.imap.sentMailbox, raw);
        await imap.logout();
      } catch {
        imap.logout().catch(() => undefined);
      }
    }
  }
  const stored: MailMessage = {
    id: localMessageId(account.id, 'SENT', remoteId),
    accountId: account.id,
    remoteId,
    folder: 'SENT',
    from: mail.from,
    to: mail.to,
    cc: mail.cc,
    bcc: mail.bcc,
    subject: mail.subject,
    date: Date.now(),
    snippet: mail.text.replace(/\s+/g, ' ').trim().slice(0, 160),
    unread: false,
    flagged: false,
    hasAttachments: mail.attachments.length > 0,
    labelIds: [],
    messageId: undefined,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    text: mail.text,
    attachments: mail.attachments.map((file, index) => ({
      id: `local_${index}`,
      filename: file.filename,
      contentType: file.contentType,
      size: file.contentBase64.length,
      contentBase64: file.contentBase64,
    })),
    bodyLoaded: true,
  };
  return addLocalSent(state, stored);
}

async function loadGmail(accountId: string): Promise<GmailTokens | null> {
  const accessToken = await secrets.get(`gmail.${accountId}.access`);
  const metaRaw = await secrets.get(`gmail.${accountId}.meta`);
  if (!accessToken || !metaRaw) return null;
  const meta = JSON.parse(metaRaw) as { expiresAt: number; clientId: string };
  const refresh = await secrets.get(`gmail.${accountId}.refresh`);
  return {
    accessToken,
    expiresAt: meta.expiresAt,
    clientId: meta.clientId,
    refreshToken: refresh ?? undefined,
  };
}

function fetchHttp() {
  return {
    async request(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
      const response = await fetch(url, { method: init?.method, headers: init?.headers, body: init?.body });
      return { status: response.status, body: await response.text() };
    },
  };
}

function draftConfig(draft: ImapDraft): ImapConfig {
  return {
    username: draft.username.trim() || draft.email.trim(),
    imapHost: draft.imapHost.trim(),
    imapPort: draft.imapPort,
    imapTls: draft.imapTls,
    smtpHost: draft.smtpHost.trim(),
    smtpPort: draft.smtpPort,
    smtpTls: draft.smtpTls,
  };
}

async function notifyMail(body: string, badge: number): Promise<void> {
  if (!body || Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Vellia Mail', body, badge },
      trigger: null,
    });
    await Notifications.setBadgeCountAsync(badge);
  } catch {
    // Notifications are optional. The mailbox itself still updates.
  }
}

export async function registerRelay(relayUrl: string): Promise<void> {
  const url = relayUrl.trim();
  if (!url || Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') return;
    const token = await Notifications.getDevicePushTokenAsync();
    const secret = await secrets.get('relay');
    await fetch(`${url.replace(/\/$/, '')}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ token: token.data, platform: Platform.OS }),
    });
  } catch {
    // The relay is optional. Ignore until the owner runs one.
  }
}
