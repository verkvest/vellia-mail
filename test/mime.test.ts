import { describe, expect, it } from 'vitest';
import { bytesToBase64, utf8Encode } from '../src/mail/bytes';
import { decodeCharset } from '../src/mail/charset';
import { decodeHeaderWords, formatAddress, parseAddressList } from '../src/mail/header';
import { buildMime } from '../src/mail/mime/build';
import { parseMime } from '../src/mail/mime/parse';

describe('MIME', () => {
  it('decodes encoded-words, windows-1251 and a mixed message', () => {
    expect(decodeHeaderWords('=?UTF-8?B?0J/RgNC40LLQtdGC?=')).toBe('Привет');
    expect(decodeHeaderWords('=?UTF-8?Q?Caf=C3=A9?=')).toBe('Café');
    expect(decodeHeaderWords('=?UTF-8?B?0JfQsA==?= =?UTF-8?B?0LLRgtGA0LA=?=')).toBe('Завтра');
    const hi = decodeCharset(Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), 'windows-1251');
    expect(hi).toBe('Привет');
    expect(decodeCharset(Uint8Array.from([0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4]), 'koi8-r')).toBe('Привет');

    const raw = [
      'From: =?UTF-8?B?0JzQsNGA0LjRjw==?= <maria@example.com>',
      'To: "Vellia" <hola@vellia.test>, cocina@vellia.test',
      'Cc: cuentas@verkvest.example',
      'Subject: =?UTF-8?B?0KHRh9GR0YI=?=',
      'Message-ID: <f1@example.com>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="bnd"',
      '',
      '--bnd',
      'Content-Type: text/plain; charset=windows-1251',
      'Content-Transfer-Encoding: base64',
      '',
      bytesToBase64(Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])),
      '',
      '--bnd',
      'Content-Type: application/pdf; name="factura.pdf"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="factura.pdf"',
      '',
      bytesToBase64(utf8Encode('pdf')),
      '',
      '--bnd--',
      '',
    ].join('\r\n');
    const parsed = parseMime(utf8Encode(raw));
    expect(parsed.from).toEqual({ name: 'Мария', email: 'maria@example.com' });
    expect(parsed.to.map((item) => item.email)).toEqual(['hola@vellia.test', 'cocina@vellia.test']);
    expect(parsed.cc[0]?.email).toBe('cuentas@verkvest.example');
    expect(parsed.subject).toBe('Счёт');
    expect(parsed.text).toBe('Привет');
    expect(parsed.attachments[0]?.filename).toBe('factura.pdf');
    expect(parsed.messageId).toBe('<f1@example.com>');
  });

  it('round-trips a built message with an attachment', () => {
    const built = buildMime({
      from: { name: 'Александр', email: 'hola@vellia.test' },
      to: [{ name: 'María', email: 'maria@example.com' }],
      cc: [],
      bcc: [],
      subject: 'Бронь',
      text: 'Стол ждёт.',
      attachments: [{ filename: 'план.txt', contentType: 'text/plain', contentBase64: bytesToBase64(utf8Encode('терраса')) }],
      inReplyTo: '<a@b>',
      references: '<a@b>',
    });
    const parsed = parseMime(built);
    expect(parsed.subject).toBe('Бронь');
    expect(parsed.text).toContain('Стол ждёт.');
    expect(parsed.from.name).toBe('Александр');
    expect(parsed.attachments[0]?.filename).toContain('план.txt');
    expect(formatAddress({ name: 'Vellia', email: 'hola@vellia.test' })).toBe('"Vellia" <hola@vellia.test>');
    expect(parseAddressList('Bare <bare@example.com>')[0]?.email).toBe('bare@example.com');
  });
});
