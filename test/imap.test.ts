import { describe, expect, it } from 'vitest';
import { ImapStreamParser } from '../src/mail/imap/parser';
import { pullImapAccount, searchImap } from '../src/mail/pull';
import { encodeMUTF7, decodeMUTF7 } from '../src/mail/mutf7';
import { withMockImap } from './mockImap';

describe('IMAP parser', () => {
  it('reads a literal split across packets', () => {
    const parser = new ImapStreamParser();
    parser.pushText('* 1 FETCH (BODY[] {5}\r\n');
    expect(parser.next()).toBeNull();
    parser.pushText('Hello)\r\n');
    const line = parser.next();
    expect(line?.tag).toBe('*');
    const list = line?.tokens.find((token) => token.kind === 'list');
    expect(list?.kind).toBe('list');
    const literal = list?.kind === 'list' ? list.value.find((token) => token.kind === 'literal') : undefined;
    expect(literal?.kind).toBe('literal');
    if (literal?.kind === 'literal') expect(new TextDecoder().decode(literal.value)).toBe('Hello');
  });

  it('decodes modified UTF-7 mailbox names from RFC 3501', () => {
    expect(decodeMUTF7('~peter/mail/&U,BTFw-/&ZeVnLIqe-')).toBe('~peter/mail/台北/日本語');
    expect(encodeMUTF7('~peter/mail/台北/日本語')).toBe('~peter/mail/&U,BTFw-/&ZeVnLIqe-');
    expect(encodeMUTF7('INBOX')).toBe('INBOX');
    expect(decodeMUTF7('&-')).toBe('&');
    expect(decodeMUTF7(encodeMUTF7('Отправленные'))).toBe('Отправленные');
  });
});

describe('IMAP client against a mock server', () => {
  it('rejects a bad login without echoing the password', async () => {
    await withMockImap(async (client) => {
      await client.ready();
      await expect(client.login('owner@mail.ru', 'wrong-pass')).rejects.toThrow(/AUTHENTICATIONFAILED/);
    });
  });

  it('lists, fetches, searches and appends', async () => {
    await withMockImap(async (client) => {
      await client.ready();
      await client.login('owner@mail.ru', 'app-pass');
      const boxes = await client.listMailboxes();
      expect(boxes.map((box) => box.name)).toEqual(['INBOX', 'Sent']);
      expect(boxes[1]?.flags).toContain('\\Sent');
      const pulled = await pullImapAccount(client, 25);
      expect(pulled.sentMailbox).toBe('Sent');
      expect(pulled.messages).toHaveLength(2);
      const reserva = pulled.messages.find((item) => item.remoteId === '10');
      expect(reserva?.subject).toBe('Reserva terraza');
      expect(reserva?.from.email).toBe('maria@example.com');
      expect(reserva?.text).toContain('sábado');
      expect(reserva?.unread).toBe(true);
      const ivan = pulled.messages.find((item) => item.remoteId === '11');
      expect(ivan?.subject).toBe('Завтра');
      expect(ivan?.from.name).toBe('Иван');
      expect(ivan?.unread).toBe(false);
      const found = await searchImap(client, 'INBOX', 'mesa', 10);
      expect(found.map((item) => item.remoteId)).toEqual(['10']);
      await client.append('Sent', new TextEncoder().encode('From: a@b\r\n\r\nHola\r\n'));
      await client.logout();
    });
  });

  it('authenticates with XOAUTH2', async () => {
    await withMockImap(async (client) => {
      await client.ready();
      await client.authenticateXoauth2('owner@mail.ru', 'good-token');
      const boxes = await client.listMailboxes();
      expect(boxes[0]?.name).toBe('INBOX');
    });
  });
});
