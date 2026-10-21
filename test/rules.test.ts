import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/mail/demo';
import { applyFilterRules, messageFilterInput } from '../src/mail/filters';
import { mergePulled, queuePending, reapplyPending } from '../src/mail/merge';
import { removeAccount, sanitizeMailbox } from '../src/mail/mailbox';
import { appendSignature, firstName, placeSignature, renderTemplate } from '../src/mail/templates';
import { noticeBody, planNotices } from '../src/mail/notify';
import { redact } from '../src/mail/redact';
import { replySubject } from '../src/mail/quote';
import { GmailApi, gmailToPulled, type HttpClient } from '../src/mail/gmail/api';

describe('filter rules', () => {
  const state = createDemoState();

  it('sorts booking mail into a label and colours it', () => {
    const message = state.messages.find((item) => item.remoteId === '2');
    if (!message) throw new Error('missing');
    const result = applyFilterRules(messageFilterInput(message, 'hola@vellia.test'), state.rules, {
      unread: true,
      flagged: false,
      labelIds: [],
    });
    expect(result.labelIds).toContain('label_bookings');
    expect(result.color).toBe('#3E5C76');
    expect(result.matchedRuleIds).toEqual(['rule_booking']);
  });

  it('flags invoices and stops when a later rule is disabled', () => {
    const message = state.messages.find((item) => item.subject.includes('Factura'));
    if (!message) throw new Error('missing');
    const result = applyFilterRules(messageFilterInput(message, 'hola@vellia.test'), state.rules, {
      unread: true,
      flagged: false,
      labelIds: [],
    });
    expect(result.labelIds).toEqual(['label_bills']);
    expect(result.flagged).toBe(true);
    expect(result.remoteFlag).toBe(true);
    expect(result.unread).toBe(true);
  });

  it('matches any or all, ignores empty and disabled rules', () => {
    const input = { from: 'a@b.c', to: '', cc: '', subject: 'Hola factura', body: '', accountEmail: 'me@vellia.test' };
    const all = applyFilterRules(input, [{
      id: 'r', name: 'both', enabled: true, order: 1, match: 'all',
      conditions: [{ field: 'subject', op: 'contains', value: 'hola' }, { field: 'subject', op: 'contains', value: 'missing' }],
      actions: [{ type: 'markRead' }],
    }], { unread: true, flagged: false, labelIds: [] });
    expect(all.unread).toBe(true);
    const any = applyFilterRules(input, [{
      id: 'r2', name: 'one', enabled: true, order: 1, match: 'any',
      conditions: [{ field: 'account', op: 'equals', value: 'me@vellia.test' }, { field: 'from', op: 'startsWith', value: 'zzz' }],
      actions: [{ type: 'markRead' }, { type: 'stop' }],
    }, {
      id: 'r3', name: 'later', enabled: true, order: 2, match: 'all',
      conditions: [{ field: 'subject', op: 'endsWith', value: 'factura' }],
      actions: [{ type: 'flag' }],
    }], { unread: true, flagged: false, labelIds: [] });
    expect(any.unread).toBe(false);
    expect(any.remoteMarkRead).toBe(true);
    expect(any.flagged).toBe(false);
    const disabled = applyFilterRules(input, [{
      id: 'off', name: 'off', enabled: false, order: 1, match: 'all',
      conditions: [{ field: 'subject', op: 'contains', value: 'hola' }],
      actions: [{ type: 'markRead' }],
    }], { unread: true, flagged: false, labelIds: [] });
    expect(disabled.matchedRuleIds).toEqual([]);
  });
});

describe('templates', () => {
  const when = new Date('2026-10-21T16:05:00Z');

  it('fills Russian, Spanish and English placeholders in Madrid time', () => {
    const body = 'Hola {имя}, {fecha} a las {hora}. Tema: {asunto}. De {мояпочта}.';
    const rendered = renderTemplate(body, {
      name: 'María',
      subject: 'Mesa',
      myEmail: 'hola@vellia.test',
      date: when,
      locale: 'es',
      timeZone: 'Europe/Madrid',
    });
    expect(rendered).toContain('Hola María');
    expect(rendered).toContain('21 de octubre de 2026');
    expect(rendered).toContain('18:05');
    expect(rendered).toContain('Tema: Mesa');
    expect(rendered).toContain('hola@vellia.test');
    expect(renderTemplate('{неизвестно}', {})).toBe('{неизвестно}');
    expect(renderTemplate('{имя}', { name: '  ' })).toBe('{имя}');
    expect(firstName('María López', 'a@b.c')).toBe('María');
    expect(firstName('', 'maria@example.com')).toBe('maria');
  });

  it('appends a signature once', () => {
    const once = appendSignature('Hola', 'Vellia', true);
    expect(once).toBe('Hola\n\n-- \nVellia');
    expect(appendSignature(once, 'Vellia', true)).toBe(once);
    expect(appendSignature('Hola', 'Vellia', false)).toBe('Hola');
  });

  it('places a signature before the quoted reply', () => {
    const text = 'Hola\n\nMaría написал(а):\n> Mesa';
    expect(placeSignature(text, 'Vellia', true)).toBe('Hola\n\n-- \nVellia\n\nMaría написал(а):\n> Mesa');
    expect(placeSignature('Hola', 'Vellia', false)).toBe('Hola');
  });
});

describe('mailbox merge and secrets', () => {
  it('applies filters to new mail and keeps a local read if the server is behind', () => {
    const state = createDemoState();
    const account = state.accounts[0];
    if (!account) throw new Error('no account');
    const report = mergePulled(state, account, [{
      remoteId: '99',
      folder: 'INBOX',
      from: { name: 'Booking.com', email: 'noreply@booking.com' },
      to: [],
      cc: [],
      subject: 'Reservation 99',
      date: Date.UTC(2026, 9, 21, 12),
      snippet: 'new',
      unread: true,
      flagged: false,
      hasAttachments: false,
      text: 'booked',
      attachments: [],
      bodyLoaded: true,
    }]);
    const fresh = report.fresh[0];
    expect(fresh?.labelIds).toContain('label_bookings');
    expect(fresh?.color).toBe('#3E5C76');
    let next = report.state;
    const message = next.messages.find((item) => item.remoteId === '99');
    if (!message) throw new Error('missing fresh');
    next = queuePending({ ...next, messages: next.messages.map((item) => item.id === message.id ? { ...item, unread: false } : item) }, { ...message, unread: false }, 'read');
    const again = mergePulled(next, account, [{
      remoteId: '99',
      folder: 'INBOX',
      from: message.from,
      to: [],
      cc: [],
      subject: 'Reservation 99',
      date: message.date,
      snippet: 'new',
      unread: true,
      flagged: false,
      hasAttachments: false,
      text: 'booked',
      attachments: [],
      bodyLoaded: true,
    }]);
    expect(again.state.messages.find((item) => item.remoteId === '99')?.unread).toBe(false);
    expect(reapplyPending({ ...message, unread: true }, next.pending).unread).toBe(false);
  });

  it('refuses to persist passwords or tokens and removes an account locally', () => {
    const state = createDemoState();
    expect(() => sanitizeMailbox(state)).not.toThrow();
    expect(() => sanitizeMailbox({ ...state, settings: { ...state.settings, relayUrl: 'https://relay.example' } })).not.toThrow();
    const poisoned = { ...state, accounts: [{ ...state.accounts[0]!, password: 'secret' } as never] };
    expect(() => sanitizeMailbox(poisoned)).toThrow(/password/);
    const removed = removeAccount(state, 'demo');
    expect(removed.accounts).toHaveLength(0);
    expect(removed.messages).toHaveLength(0);
    expect(removed.signatures.demo).toBeUndefined();
  });

  it('redacts protocol secrets', () => {
    const dirty = 'A1 LOGIN owner@mail.ru app-pass\r\nAUTH PLAIN AGFwcA==\r\nAuthorization: Bearer ya29.secret';
    const clean = redact(dirty);
    expect(clean).not.toContain('app-pass');
    expect(clean).not.toContain('ya29.secret');
    expect(clean).toContain('owner@mail.ru');
  });
});

describe('reply subjects and notices', () => {
  it('does not stack Re: or Fwd:', () => {
    expect(replySubject('Mesa', 'reply')).toBe('Re: Mesa');
    expect(replySubject('Re: Mesa', 'reply')).toBe('Re: Mesa');
    expect(replySubject('Ответ: Mesa', 'reply')).toBe('Ответ: Mesa');
    expect(replySubject('Fwd: Mesa', 'forward')).toBe('Fwd: Mesa');
  });

  it('plans a notice only for new unread mail', () => {
    const notices = planNotices(new Set(['1']), [
      { remoteId: '1', unread: true, from: 'Old', subject: 'old', accountEmail: 'a@b.c' },
      { remoteId: '2', unread: false, from: 'Read', subject: 'read', accountEmail: 'a@b.c' },
      { remoteId: '3', unread: true, from: 'María', subject: 'Mesa', accountEmail: 'hola@vellia.test' },
    ]);
    expect(notices).toHaveLength(1);
    expect(noticeBody(notices, 'ru')).toBe('María: Mesa');
  });
});

describe('Gmail API client', () => {
  it('refreshes once on 401 and maps a message', async () => {
    const calls: string[] = [];
    const http: HttpClient = {
      async request(url, init) {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('oauth2.googleapis.com')) {
          expect(init?.body).toContain('grant_type=refresh_token');
          expect(init?.body).toContain('client_id=ios-client');
          return { status: 200, body: JSON.stringify({ access_token: 'new-access', expires_in: 3600 }) };
        }
        const auth = init?.headers?.Authorization;
        if (auth === 'Bearer old-access') return { status: 401, body: '' };
        if (url.endsWith('/profile')) return { status: 200, body: JSON.stringify({ emailAddress: 'owner@gmail.com' }) };
        if (url.includes('/messages?')) return { status: 200, body: JSON.stringify({ messages: [{ id: 'm1' }] }) };
        if (url.includes('/messages/m1')) {
          return {
            status: 200,
            body: JSON.stringify({
              id: 'm1',
              snippet: 'Mesa para dos',
              labelIds: ['INBOX', 'UNREAD'],
              internalDate: String(Date.UTC(2026, 9, 21, 9)),
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'Ana <ana@example.com>' },
                  { name: 'To', value: 'owner@gmail.com' },
                  { name: 'Subject', value: 'Reserva' },
                  { name: 'Message-ID', value: '<m1@example.com>' },
                ],
                body: { data: Buffer.from('Mesa para dos').toString('base64url'), size: 13 },
              },
            }),
          };
        }
        if (url.endsWith('/messages/send')) {
          expect(init?.body).toContain('raw');
          return { status: 200, body: JSON.stringify({ id: 'sent1' }) };
        }
        return { status: 200, body: '{}' };
      },
    };
    const seen: string[] = [];
    const api = new GmailApi(http, {
      accessToken: 'old-access',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() - 1000,
      clientId: 'ios-client',
    }, (tokens) => seen.push(tokens.accessToken));
    const profile = await api.profile();
    expect(profile.email).toBe('owner@gmail.com');
    expect(seen).toEqual(['new-access']);
    const ids = await api.listMessageIds('in:inbox', 10);
    const full = await api.getMessage(ids[0] ?? '');
    const pulled = gmailToPulled(full, 'INBOX');
    expect(pulled.subject).toBe('Reserva');
    expect(pulled.unread).toBe(true);
    expect(pulled.text).toBe('Mesa para dos');
    expect(pulled.from.email).toBe('ana@example.com');
    await api.sendRaw('abc');
    await api.modify('m1', [], ['UNREAD']);
    expect(calls.some((call) => call.includes('/messages/m1/modify'))).toBe(true);
  });
});
