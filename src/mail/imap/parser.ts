import { utf8Decode, utf8Encode } from '../bytes';

const NEED = Symbol('need');

export type ImapToken =
  | { kind: 'atom'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'literal'; value: Uint8Array }
  | { kind: 'list'; value: ImapToken[] }
  | { kind: 'nil' };

export interface ImapResponse {
  tag: string;
  tokens: ImapToken[];
}

export class ImapStreamParser {
  private buf = new Uint8Array(0);
  private pos = 0;

  push(chunk: Uint8Array) {
    if (this.pos > 65536) {
      this.buf = this.buf.slice(this.pos);
      this.pos = 0;
    }
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf, 0);
    next.set(chunk, this.buf.length);
    this.buf = next;
  }

  pushText(value: string) {
    this.push(utf8Encode(value));
  }

  next(): ImapResponse | null {
    const saved = this.pos;
    try {
      return this.readResponse();
    } catch (error) {
      if (error === NEED) {
        this.pos = saved;
        return null;
      }
      throw error;
    }
  }

  private need(count: number) {
    if (this.pos + count > this.buf.length) throw NEED;
  }

  private peek(): number {
    this.need(1);
    return this.buf[this.pos] ?? 0;
  }

  private readByte(): number {
    this.need(1);
    const value = this.buf[this.pos] ?? 0;
    this.pos += 1;
    return value;
  }

  private readResponse(): ImapResponse {
    if (this.peek() === 43) {
      this.readByte();
      if (this.pos < this.buf.length && this.buf[this.pos] === 32) this.pos += 1;
      const info = this.readUntilCrlf();
      return { tag: '+', tokens: info ? [{ kind: 'atom', value: info }] : [] };
    }
    if (this.peek() === 42) {
      this.readByte();
      this.skipSpaces();
      return { tag: '*', tokens: this.readTokens(null) };
    }
    const tag = this.readAtom();
    this.skipSpaces();
    return { tag, tokens: this.readTokens(null) };
  }

  private readTokens(closer: number | null): ImapToken[] {
    const tokens: ImapToken[] = [];
    for (;;) {
      this.skipSpaces();
      this.need(1);
      const byte = this.peek();
      if (byte === 13 || byte === 10) {
        if (closer !== null) throw new Error('IMAP: список оборвался');
        this.consumeCrlf();
        return tokens;
      }
      if (closer !== null && byte === closer) {
        this.pos += 1;
        return tokens;
      }
      tokens.push(this.readToken());
    }
  }

  private readToken(): ImapToken {
    const byte = this.peek();
    if (byte === 40) return { kind: 'list', value: this.readList() };
    if (byte === 34) return { kind: 'string', value: this.readQuoted() };
    if (byte === 123) return { kind: 'literal', value: this.readLiteral() };
    if (byte === 91) return { kind: 'atom', value: this.readBracket() };
    if (byte === 92) return { kind: 'atom', value: this.readFlag() };
    const atom = this.readAtom();
    if (atom === 'NIL') return { kind: 'nil' };
    return { kind: 'atom', value: atom };
  }

  private readList(): ImapToken[] {
    this.readByte();
    return this.readTokens(41);
  }

  private readQuoted(): string {
    this.readByte();
    let out = '';
    for (;;) {
      const byte = this.readByte();
      if (byte === 92) {
        out += String.fromCharCode(this.readByte());
        continue;
      }
      if (byte === 34) return out;
      out += String.fromCharCode(byte);
    }
  }

  private readLiteral(): Uint8Array {
    this.readByte();
    let digits = '';
    for (;;) {
      const byte = this.readByte();
      if (byte === 125) break;
      digits += String.fromCharCode(byte);
    }
    this.consumeCrlf();
    const size = Number(digits);
    if (!Number.isFinite(size) || size < 0) throw new Error('IMAP: плохой литерал');
    this.need(size);
    const slice = this.buf.slice(this.pos, this.pos + size);
    this.pos += size;
    return slice;
  }

  private readBracket(): string {
    this.readByte();
    let out = '[';
    let depth = 0;
    let quote = false;
    for (;;) {
      const byte = this.readByte();
      const char = String.fromCharCode(byte);
      out += char;
      if (quote) {
        if (byte === 92) out += String.fromCharCode(this.readByte());
        else if (byte === 34) quote = false;
        continue;
      }
      if (byte === 34) quote = true;
      else if (byte === 40) depth += 1;
      else if (byte === 41) depth -= 1;
      else if (byte === 93 && depth <= 0) return out;
    }
  }

  private readFlag(): string {
    this.readByte();
    return `\\${this.readAtom()}`;
  }

  private readAtom(): string {
    let out = '';
    for (;;) {
      if (this.pos >= this.buf.length) throw NEED;
      const byte = this.buf[this.pos] ?? 0;
      if (isAtomStop(byte)) {
        if (!out) throw new Error('IMAP: пустой атом');
        return out;
      }
      this.pos += 1;
      out += String.fromCharCode(byte);
    }
  }

  private skipSpaces() {
    while (this.pos < this.buf.length && this.buf[this.pos] === 32) this.pos += 1;
    if (this.pos >= this.buf.length) throw NEED;
  }

  private consumeCrlf() {
    this.need(1);
    if (this.buf[this.pos] === 13) {
      this.pos += 1;
      this.need(1);
    }
    if (this.buf[this.pos] !== 10) throw new Error('IMAP: ожидался перевод строки');
    this.pos += 1;
  }

  private readUntilCrlf(): string {
    const start = this.pos;
    while (this.pos < this.buf.length && this.buf[this.pos] !== 10) this.pos += 1;
    if (this.pos >= this.buf.length) throw NEED;
    const slice = this.buf.slice(start, this.buf[this.pos - 1] === 13 ? this.pos - 1 : this.pos);
    this.pos += 1;
    return utf8Decode(slice);
  }
}

function isAtomStop(byte: number): boolean {
  return byte <= 32 || byte === 40 || byte === 41 || byte === 123 || byte === 37 || byte === 42 || byte === 34 || byte === 92 || byte === 93 || byte === 91;
}
