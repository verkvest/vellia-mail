import { base64ToBytes, bytesToBase64, utf8Encode } from './bytes';
import { decodeCharset } from './charset';
import type { Address } from './types';

export function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const bytes = utf8Encode(value);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 45) {
    const slice = bytes.slice(i, i + 45);
    chunks.push(`=?UTF-8?B?${bytesToBase64(slice)}?=`);
  }
  return chunks.join(' ');
}

export function decodeHeaderWords(value: string): string {
  const joined = value.replace(/\?=\s+=\?/g, '?==?');
  const replaced = joined.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_all, charset: string, encoding: string, text: string) => {
    try {
      if (encoding.toUpperCase() === 'B') return decodeCharset(base64ToBytes(text), charset);
      const qp = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      const bytes = Uint8Array.from(qp, (char) => char.charCodeAt(0) & 0xff);
      return decodeCharset(bytes, charset);
    } catch {
      return _all;
    }
  });
  return replaced;
}

export function formatAddress(address: Address): string {
  if (!address.name.trim()) return address.email;
  if (/^[\x20-\x7e]*$/.test(address.name)) {
    return `"${address.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${address.email}>`;
  }
  return `${encodeHeaderWord(address.name)} <${address.email}>`;
}

export function formatAddressList(addresses: Address[]): string {
  return addresses.map(formatAddress).join(', ');
}

export function parseAddressList(header: string | undefined): Address[] {
  if (!header?.trim()) return [];
  const decoded = decodeHeaderWords(header);
  const parts = splitAddresses(decoded);
  return parts.map(parseOne).filter((item): item is Address => Boolean(item?.email));
}

function splitAddresses(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote = false;
  let angle = 0;
  for (const char of value) {
    if (char === '"') quote = !quote;
    if (!quote && char === '<') angle += 1;
    if (!quote && char === '>') angle = Math.max(0, angle - 1);
    if (char === ',' && !quote && angle === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseOne(part: string): Address | null {
  const trimmed = part.trim();
  const angled = /^(.*)<([^>]+)>$/.exec(trimmed);
  if (angled) {
    const name = (angled[1] ?? '').trim().replace(/^"|"$/g, '').trim();
    return { name: decodeHeaderWords(name), email: (angled[2] ?? '').trim() };
  }
  if (trimmed.includes('@')) return { name: '', email: trimmed.replace(/^mailto:/i, '') };
  return null;
}

export function headerMap(raw: string): Map<string, string> {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ');
  const map = new Map<string, string>();
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    const prev = map.get(key);
    map.set(key, prev ? `${prev}, ${value}` : value);
  }
  return map;
}
