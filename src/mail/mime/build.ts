import { bytesToBase64, utf8Encode } from '../bytes';
import { encodeHeaderWord, formatAddressList } from '../header';
import type { OutgoingMail } from '../types';

function qpEncode(value: string): string {
  const bytes = utf8Encode(value);
  let line = '';
  const lines: string[] = [];
  const push = (chunk: string) => {
    if (line.length + chunk.length > 73) {
      lines.push(`${line}=`);
      line = '';
    }
    line += chunk;
  };
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    if (byte === 61 || byte < 32 || byte > 126 || byte === 63 || byte === 95) {
      push(`=${byte.toString(16).toUpperCase().padStart(2, '0')}`);
    } else {
      push(char);
    }
  }
  if (line) lines.push(line);
  return lines.join('\r\n');
}

function wrapBase64(value: string): string {
  return value.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/,'');
}

export function buildMime(mail: OutgoingMail): Uint8Array {
  const boundary = `vellia_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  const headers = [
    `From: ${formatAddressList([mail.from])}`,
    `To: ${formatAddressList(mail.to)}`,
    mail.cc.length ? `Cc: ${formatAddressList(mail.cc)}` : '',
    mail.bcc.length ? `Bcc: ${formatAddressList(mail.bcc)}` : '',
    `Subject: ${encodeHeaderWord(mail.subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    mail.inReplyTo ? `In-Reply-To: ${mail.inReplyTo}` : '',
    mail.references ? `References: ${mail.references}` : '',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean);
  const textPart = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    qpEncode(mail.text),
  ].join('\r\n');
  const files = mail.attachments.map((file) => {
    const safeName = encodeHeaderWord(file.filename);
    return [
      `--${boundary}`,
      `Content-Type: ${file.contentType || 'application/octet-stream'}; name="${safeName.replace(/"/g, '')}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${safeName.replace(/"/g, '')}"`,
      '',
      wrapBase64(file.contentBase64.replace(/[\r\n\s]/g, '')),
    ].join('\r\n');
  });
  const raw = `${headers.join('\r\n')}\r\n\r\n${[textPart, ...files, `--${boundary}--`, ''].join('\r\n')}`;
  return utf8Encode(raw);
}

export function mimeToBase64Url(raw: Uint8Array): string {
  return bytesToBase64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
