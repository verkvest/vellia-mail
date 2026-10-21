export interface MailNotice {
  accountEmail: string;
  from: string;
  subject: string;
  unreadCount: number;
}

export function planNotices(previousRemoteIds: Set<string>, incoming: { remoteId: string; unread: boolean; from: string; subject: string; accountEmail: string }[]): MailNotice[] {
  return incoming
    .filter((item) => item.unread && !previousRemoteIds.has(item.remoteId))
    .map((item) => ({
      accountEmail: item.accountEmail,
      from: item.from,
      subject: item.subject || '(без темы)',
      unreadCount: 1,
    }));
}

export function noticeBody(notices: MailNotice[], locale: 'ru' | 'es' | 'en'): string {
  if (!notices.length) return '';
  const first = notices[0];
  if (!first) return '';
  if (notices.length === 1) return `${first.from}: ${first.subject}`;
  if (locale === 'es') return `${first.from}: ${first.subject} (+${notices.length - 1})`;
  if (locale === 'en') return `${first.from}: ${first.subject} (+${notices.length - 1})`;
  return `${first.from}: ${first.subject} (+${notices.length - 1})`;
}
