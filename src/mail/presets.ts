export interface ServerPreset {
  id: 'mailru' | 'listru' | 'gmail-imap' | 'custom';
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
}

export const SERVER_PRESETS: Record<Exclude<ServerPreset['id'], 'custom'>, ServerPreset> = {
  mailru: {
    id: 'mailru',
    imapHost: 'imap.mail.ru',
    imapPort: 993,
    imapTls: true,
    smtpHost: 'smtp.mail.ru',
    smtpPort: 465,
    smtpTls: true,
  },
  listru: {
    id: 'listru',
    imapHost: 'imap.mail.ru',
    imapPort: 993,
    imapTls: true,
    smtpHost: 'smtp.mail.ru',
    smtpPort: 465,
    smtpTls: true,
  },
  'gmail-imap': {
    id: 'gmail-imap',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapTls: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpTls: true,
  },
};

export function presetFor(id: ServerPreset['id']): ServerPreset {
  if (id === 'custom') {
    return { id: 'custom', imapHost: '', imapPort: 993, imapTls: true, smtpHost: '', smtpPort: 465, smtpTls: true };
  }
  return SERVER_PRESETS[id];
}
