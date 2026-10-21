import type { Locale, MailMessage, MailboxState } from './types';

export type BoxFilter =
  | { kind: 'inbox' }
  | { kind: 'unread' }
  | { kind: 'flagged' }
  | { kind: 'label'; id: string }
  | { kind: 'folder'; accountId: string; folder: string };

export function selectMessages(state: MailboxState, box: BoxFilter): MailMessage[] {
  return state.messages
    .filter((message) => {
      if (box.kind === 'inbox') return message.folder.toUpperCase() === 'INBOX';
      if (box.kind === 'unread') return message.unread && message.folder.toUpperCase() !== 'SENT';
      if (box.kind === 'flagged') return message.flagged;
      if (box.kind === 'label') return message.labelIds.includes(box.id);
      return message.accountId === box.accountId && message.folder === box.folder;
    })
    .sort((a, b) => b.date - a.date);
}

export function searchMessages(messages: MailMessage[], query: string): MailMessage[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return messages
    .filter((message) => {
      const haystack = [
        message.subject,
        message.from.name,
        message.from.email,
        message.snippet,
        message.text,
        message.to.map((item) => `${item.name} ${item.email}`).join(' '),
      ].join('\n').toLocaleLowerCase();
      return haystack.includes(needle);
    })
    .sort((a, b) => b.date - a.date);
}

export function unreadInboxCount(state: MailboxState): number {
  return state.messages.filter((message) => message.unread && message.folder.toUpperCase() === 'INBOX').length;
}

const INTL: Record<Locale, string> = { ru: 'ru-RU', es: 'es-ES', en: 'en-GB' };

export function formatWhen(date: number, locale: Locale, now = Date.now()): string {
  const zone = 'Europe/Madrid';
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const current = dayKey.format(date);
  const today = dayKey.format(now);
  const yesterday = dayKey.format(now - 24 * 60 * 60 * 1000);
  if (current === today) {
    return new Intl.DateTimeFormat(INTL[locale], { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(date);
  }
  if (current === yesterday) return locale === 'ru' ? 'вчера' : locale === 'es' ? 'ayer' : 'yesterday';
  return new Intl.DateTimeFormat(INTL[locale], { day: 'numeric', month: 'short', timeZone: zone }).format(date);
}

export function formatFull(date: number, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL[locale], {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(date);
}
