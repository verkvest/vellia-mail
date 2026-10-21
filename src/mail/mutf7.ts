import { base64ToBytes, bytesToBase64 } from './bytes';

function encodeUtf16Be(units: number[]): Uint8Array {
  const bytes = new Uint8Array(units.length * 2);
  units.forEach((unit, index) => {
    bytes[index * 2] = (unit >> 8) & 0xff;
    bytes[index * 2 + 1] = unit & 0xff;
  });
  return bytes;
}

function pushCodePoint(units: number[], codePoint: number) {
  if (codePoint > 0xffff) {
    const value = codePoint - 0x10000;
    units.push(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
  } else {
    units.push(codePoint);
  }
}

/** IMAP modified UTF-7 (RFC 3501) for mailbox names. */
export function encodeMUTF7(input: string): string {
  let out = '';
  let pending: number[] = [];
  const flush = () => {
    if (!pending.length) return;
    const b64 = bytesToBase64(encodeUtf16Be(pending)).replace(/\//g, ',').replace(/=+$/g, '');
    out += `&${b64}-`;
    pending = [];
  };
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e && char !== '&') {
      flush();
      out += char;
    } else if (char === '&') {
      flush();
      out += '&-';
    } else {
      pushCodePoint(pending, code);
    }
  }
  flush();
  return out;
}

export function decodeMUTF7(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] !== '&') {
      out += input[i];
      continue;
    }
    const end = input.indexOf('-', i);
    if (end < 0) {
      out += input.slice(i);
      break;
    }
    const chunk = input.slice(i + 1, end);
    i = end;
    if (!chunk) {
      out += '&';
      continue;
    }
    const bytes = base64ToBytes(chunk.replace(/,/g, '/'));
    for (let p = 0; p + 1 < bytes.length; p += 2) {
      const unit = ((bytes[p] ?? 0) << 8) | (bytes[p + 1] ?? 0);
      out += String.fromCharCode(unit);
    }
  }
  return out;
}

export function quoteMailbox(name: string): string {
  const encoded = encodeMUTF7(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${encoded}"`;
}

export function imapAtom(value: string): string {
  if (/^[\x21-\x7e]+$/.test(value) && !/["\\(){%*\]]/.test(value)) return value;
  if (/[^\x00-\x7f]/.test(value) || /[\r\n\0]/.test(value)) {
    throw new Error('Значение нужно передать литералом IMAP');
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
