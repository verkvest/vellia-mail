import { base64ToBytes, bytesToBase64, utf8Encode } from '../bytes';
import { decodeCharset } from '../charset';
import { decodeHeaderWords, headerMap } from '../header';
import { htmlToText, makeSnippet } from '../htmlText';
import type { Address, Attachment } from '../types';
import { parseAddressList } from '../header';

export interface ParsedMime {
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  date?: number;
  text: string;
  html?: string;
  attachments: Attachment[];
  snippet: string;
}

interface MimePart {
  headers: Map<string, string>;
  body: Uint8Array;
  parts: MimePart[];
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function splitHeaderBody(raw: Uint8Array): { header: string; body: Uint8Array } {
  const sep = utf8Encode('\r\n\r\n');
  const alt = utf8Encode('\n\n');
  let at = indexOfBytes(raw, sep);
  let width = 4;
  if (at < 0) {
    at = indexOfBytes(raw, alt);
    width = 2;
  }
  if (at < 0) return { header: decodeLatin(raw), body: new Uint8Array() };
  return { header: decodeLatin(raw.slice(0, at)), body: raw.slice(at + width) };
}

function decodeLatin(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function param(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const match = new RegExp(`${name}\\*=UTF-8''([^;]+)|${name}="([^"]*)"|${name}=([^;\\s]+)`, 'i').exec(header);
  const value = match?.[1] || match?.[2] || match?.[3];
  if (!value) return undefined;
  try {
    return decodeHeaderWords(decodeURIComponent(value.replace(/^"|"$/g, '')));
  } catch {
    return decodeHeaderWords(value);
  }
}

function decodeTransfer(body: Uint8Array, encoding: string | undefined, charset: string | undefined): string {
  const cte = (encoding ?? '7bit').toLowerCase();
  let bytes = body;
  if (cte === 'base64') bytes = base64ToBytes(decodeLatin(body));
  else if (cte === 'quoted-printable') bytes = decodeQuotedPrintable(body);
  return decodeCharset(bytes, charset);
}

function decodeQuotedPrintable(body: Uint8Array): Uint8Array {
  const text = decodeLatin(body).replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '=' && /[0-9A-Fa-f]{2}/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(text.charCodeAt(i) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function parsePart(raw: Uint8Array): MimePart {
  const { header, body } = splitHeaderBody(raw);
  const headers = headerMap(header);
  const contentType = headers.get('content-type') ?? 'text/plain';
  const boundary = param(contentType, 'boundary');
  if (boundary && /^multipart\//i.test(contentType)) {
    const marker = utf8Encode(`--${boundary}`);
    const parts: MimePart[] = [];
    let cursor = indexOfBytes(body, marker);
    while (cursor >= 0) {
      const start = cursor + marker.length;
      if (body[start] === 45 && body[start + 1] === 45) break;
      const next = indexOfBytes(body, marker, start);
      const sliceEnd = next < 0 ? body.length : next;
      let slice = body.slice(start, sliceEnd);
      if (slice[0] === 13 && slice[1] === 10) slice = slice.slice(2);
      else if (slice[0] === 10) slice = slice.slice(1);
      if (slice.length >= 2 && slice[slice.length - 2] === 13 && slice[slice.length - 1] === 10) slice = slice.slice(0, -2);
      else if (slice.length && slice[slice.length - 1] === 10) slice = slice.slice(0, -1);
      if (slice.length) parts.push(parsePart(slice));
      cursor = next;
    }
    return { headers, body, parts };
  }
  return { headers, body, parts: [] };
}

function collect(part: MimePart, into: { texts: string[]; html: string[]; attachments: Attachment[] }, index: { n: number }) {
  const type = part.headers.get('content-type') ?? 'text/plain';
  const disposition = part.headers.get('content-disposition') ?? '';
  const filename = param(disposition, 'filename') || param(type, 'name');
  const charset = param(type, 'charset');
  const encoding = part.headers.get('content-transfer-encoding');
  if (part.parts.length) {
    part.parts.forEach((child) => collect(child, into, index));
    return;
  }
  const isAttachment = /attachment/i.test(disposition) || Boolean(filename && !/^text\/(plain|html)/i.test(type));
  if (isAttachment || (filename && !/^text\//i.test(type))) {
    const bytes = (encoding ?? '').toLowerCase() === 'base64' ? base64ToBytes(decodeLatin(part.body)) : part.body;
    index.n += 1;
    into.attachments.push({
      id: `att_${index.n}`,
      filename: filename || `file-${index.n}`,
      contentType: type.split(';')[0]?.trim() || 'application/octet-stream',
      size: bytes.length,
      contentBase64: bytes.length <= 1_500_000 ? bytesToBase64(bytes) : undefined,
    });
    return;
  }
  if (/text\/html/i.test(type)) into.html.push(decodeTransfer(part.body, encoding, charset));
  else if (/text\/plain/i.test(type) || !type.includes('/')) into.texts.push(decodeTransfer(part.body, encoding, charset));
}

export function parseMime(raw: Uint8Array): ParsedMime {
  const root = parsePart(raw);
  const collected = { texts: [] as string[], html: [] as string[], attachments: [] as Attachment[] };
  collect(root, collected, { n: 0 });
  const headers = root.headers;
  const fromList = parseAddressList(headers.get('from'));
  const text = collected.texts.join('\n').trim();
  const html = collected.html.join('\n').trim();
  const readable = text || (html ? htmlToText(html) : '');
  const dateHeader = headers.get('date');
  const date = dateHeader ? Date.parse(dateHeader) : undefined;
  return {
    from: fromList[0] ?? { name: '', email: '' },
    to: parseAddressList(headers.get('to')),
    cc: parseAddressList(headers.get('cc')),
    subject: decodeHeaderWords(headers.get('subject') ?? ''),
    messageId: headers.get('message-id'),
    inReplyTo: headers.get('in-reply-to'),
    references: headers.get('references'),
    date: date && !Number.isNaN(date) ? date : undefined,
    text: readable,
    html: html || undefined,
    attachments: collected.attachments,
    snippet: makeSnippet(readable),
  };
}
