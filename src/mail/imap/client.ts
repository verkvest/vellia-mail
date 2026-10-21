import { bytesToBase64, utf8Decode, utf8Encode } from '../bytes';
import { decodeHeaderWords } from '../header';
import { decodeMUTF7, imapAtom, quoteMailbox } from '../mutf7';
import type { Address } from '../types';
import { ImapStreamParser, type ImapResponse, type ImapToken } from './parser';

export interface SocketLike {
  write(data: Uint8Array): void;
  onData(cb: (chunk: Uint8Array) => void): void;
  onClose(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
  end(): void;
}

export class ImapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImapError';
  }
}

export interface ImapMailbox {
  name: string;
  delimiter: string;
  flags: string[];
}

export interface FetchMeta {
  uid: number;
  flags: string[];
  internalDate?: string;
  size?: number;
  envelope?: Envelope;
  raw?: Uint8Array;
}

export interface Envelope {
  date?: string;
  subject: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  messageId?: string;
  inReplyTo?: string;
}

interface Pending {
  tag: string;
  untagged: ImapResponse[];
  resolve: (lines: ImapResponse[]) => void;
  reject: (error: Error) => void;
  onContinue?: () => void;
  timer: ReturnType<typeof setTimeout>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class ImapClient {
  private parser = new ImapStreamParser();
  private pending: Pending | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private tagNumber = 0;
  private dead = false;
  private greeted = false;
  private greetingWaiters: { resolve: (text: string) => void; reject: (error: Error) => void }[] = [];

  constructor(private socket: SocketLike) {
    socket.onData((chunk) => {
      this.parser.push(chunk);
      this.pump();
    });
    socket.onError((error) => this.fail(error));
    socket.onClose(() => this.fail(new ImapError('Соединение закрыто')));
  }

  ready(): Promise<string> {
    if (this.greeted) return Promise.resolve('ok');
    return new Promise((resolve, reject) => this.greetingWaiters.push({ resolve, reject }));
  }

  async login(username: string, password: string): Promise<void> {
    await this.command(`LOGIN ${imapAtom(username)} ${imapAtom(password)}`);
  }

  async authenticateXoauth2(username: string, accessToken: string): Promise<void> {
    const raw = `user=${username}\u0001auth=Bearer ${accessToken}\u0001\u0001`;
    const token = bytesToBase64(utf8Encode(raw));
    await this.command('AUTHENTICATE XOAUTH2', {
      onContinue: () => this.socket.write(utf8Encode(`${token}\r\n`)),
    });
  }

  async listMailboxes(): Promise<ImapMailbox[]> {
    const lines = await this.command('LIST "" "*"');
    return lines.filter((line) => line.tag === '*' && atomAt(line.tokens, 0) === 'LIST').map((line) => {
      const flags = line.tokens[1]?.kind === 'list' ? line.tokens[1].value.map(tokenText).filter((item): item is string => Boolean(item)) : [];
      const delimiter = tokenText(line.tokens[2]) ?? '/';
      const rawName = tokenText(line.tokens[3]) ?? 'INBOX';
      return { name: decodeMUTF7(rawName), delimiter, flags };
    });
  }

  async select(mailbox: string): Promise<{ exists: number; uidValidity?: number }> {
    const lines = await this.command(`SELECT ${quoteMailbox(mailbox)}`);
    let exists = 0;
    let uidValidity: number | undefined;
    for (const line of lines) {
      if (line.tag !== '*') continue;
      if (atomAt(line.tokens, 1) === 'EXISTS') exists = Number(atomAt(line.tokens, 0)) || 0;
      const code = line.tokens.map(tokenText).find((item) => item?.startsWith('[UIDVALIDITY'));
      const match = /UIDVALIDITY\s+(\d+)/.exec(code ?? '');
      if (match) uidValidity = Number(match[1]);
    }
    return uidValidity ? { exists, uidValidity } : { exists };
  }

  async uidSearch(criteria: string): Promise<number[]> {
    const lines = await this.command(`UID SEARCH ${criteria}`);
    const search = lines.find((line) => line.tag === '*' && atomAt(line.tokens, 0) === 'SEARCH');
    if (!search) return [];
    return search.tokens.slice(1).map(tokenText).map((item) => Number(item)).filter((item) => Number.isFinite(item));
  }

  async uidFetch(uids: number[], items: string): Promise<FetchMeta[]> {
    if (!uids.length) return [];
    const lines = await this.command(`UID FETCH ${uids.join(',')} (${items})`);
    return lines.filter((line) => line.tag === '*' && line.tokens.some((token) => tokenText(token) === 'FETCH')).map(parseFetch).filter((item): item is FetchMeta => Boolean(item));
  }

  async uidStore(uids: number[], op: '+FLAGS.SILENT' | '-FLAGS.SILENT', flag: '\\Seen' | '\\Flagged'): Promise<void> {
    if (!uids.length) return;
    await this.command(`UID STORE ${uids.join(',')} ${op} (${flag})`);
  }

  async append(mailbox: string, message: Uint8Array, flags = '\\Seen'): Promise<void> {
    await this.command(`APPEND ${quoteMailbox(mailbox)} (${flags}) {${message.length}}`, {
      onContinue: () => this.socket.write(message),
    });
  }

  async logout(): Promise<void> {
    try {
      await this.command('LOGOUT');
    } catch {
      // The server often closes the socket together with the reply.
    }
    this.socket.end();
  }

  private command(text: string, opts?: { onContinue?: () => void }): Promise<ImapResponse[]> {
    const run = () => this.exec(text, opts);
    const next = this.tail.then(run, run);
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }

  private exec(text: string, opts?: { onContinue?: () => void }): Promise<ImapResponse[]> {
    return new Promise((resolve, reject) => {
      if (this.dead) {
        reject(new ImapError('Соединение закрыто'));
        return;
      }
      this.tagNumber += 1;
      const tag = `A${String(this.tagNumber).padStart(4, '0')}`;
      const timer = setTimeout(() => {
        if (this.pending?.tag === tag) {
          this.pending = null;
          reject(new ImapError('Сервер IMAP не ответил вовремя'));
        }
      }, 25000);
      this.pending = {
        tag,
        untagged: [],
        resolve,
        reject,
        onContinue: opts?.onContinue,
        timer,
      };
      this.socket.write(utf8Encode(`${tag} ${text}\r\n`));
    });
  }

  private pump() {
    for (;;) {
      let message: ImapResponse | null;
      try {
        message = this.parser.next();
      } catch (error) {
        this.fail(error instanceof Error ? error : new ImapError(String(error)));
        return;
      }
      if (!message) return;
      if (!this.greeted && message.tag === '*') {
        this.greeted = true;
        const text = message.tokens.map(tokenText).filter(Boolean).join(' ');
        const waiters = this.greetingWaiters;
        this.greetingWaiters = [];
        waiters.forEach((waiter) => waiter.resolve(text));
        continue;
      }
      if (!this.pending) continue;
      if (message.tag === '+') {
        try {
          this.pending.onContinue?.();
        } catch (error) {
          this.settle(this.pending, error instanceof Error ? error : new ImapError(String(error)));
        }
        continue;
      }
      if (message.tag === '*') {
        this.pending.untagged.push(message);
        continue;
      }
      if (message.tag === this.pending.tag) {
        const status = atomAt(message.tokens, 0);
        const info = message.tokens.slice(1).map(tokenText).filter(Boolean).join(' ') || status || 'IMAP error';
        if (status === 'OK') this.settle(this.pending, null, this.pending.untagged.concat(message));
        else this.settle(this.pending, new ImapError(info));
      }
    }
  }

  private settle(pending: Pending, error: Error | null, value?: ImapResponse[]) {
    if (this.pending !== pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    if (error) pending.reject(error);
    else pending.resolve(value ?? []);
  }

  private fail(error: Error) {
    if (this.dead) return;
    this.dead = true;
    if (this.pending) this.settle(this.pending, error);
    const waiters = this.greetingWaiters;
    this.greetingWaiters = [];
    waiters.forEach((waiter) => waiter.reject(error));
  }
}

function atomAt(tokens: ImapToken[], index: number): string | undefined {
  return tokenText(tokens[index]);
}

function tokenText(token: ImapToken | undefined): string | undefined {
  if (!token || token.kind === 'nil') return undefined;
  if (token.kind === 'atom' || token.kind === 'string') return token.value;
  if (token.kind === 'literal') return utf8Decode(token.value);
  return undefined;
}

function parseFetch(line: ImapResponse): FetchMeta | null {
  const fetch = line.tokens.find((token) => token.kind === 'list');
  if (!fetch || fetch.kind !== 'list') return null;
  const items = fetch.value;
  let uid = 0;
  const flags: string[] = [];
  let internalDate: string | undefined;
  let size: number | undefined;
  let envelope: Envelope | undefined;
  let raw: Uint8Array | undefined;
  for (let i = 0; i < items.length; i += 1) {
    let key = tokenText(items[i]) ?? '';
    if (key === 'BODY' && items[i + 1] && tokenText(items[i + 1])?.startsWith('[')) {
      key = `BODY${tokenText(items[++i]) ?? ''}`;
      const maybePartial = tokenText(items[i + 1]);
      if (maybePartial?.startsWith('<')) key += maybePartial, i += 1;
    }
    const value = items[++i];
    if (key === 'UID') uid = Number(tokenText(value));
    if (key === 'FLAGS' && value?.kind === 'list') flags.push(...value.value.map(tokenText).filter((item): item is string => Boolean(item)));
    if (key === 'INTERNALDATE') internalDate = tokenText(value);
    if (key === 'RFC822.SIZE') size = Number(tokenText(value));
    if (key === 'ENVELOPE' && value?.kind === 'list') envelope = parseEnvelope(value.value);
    if (key.startsWith('BODY[') && value?.kind === 'literal') raw = value.value;
    if (key.startsWith('BODY[') && value?.kind === 'string') raw = utf8Encode(value.value);
  }
  if (!uid) return null;
  return { uid, flags, internalDate, size, envelope, raw };
}

function parseEnvelope(tokens: ImapToken[]): Envelope {
  const date = nstring(tokens[0]);
  const subject = decodeHeaderWords(nstring(tokens[1]) ?? '');
  const from = addressList(tokens[2]);
  const to = addressList(tokens[5]);
  const cc = addressList(tokens[6]);
  const inReplyTo = nstring(tokens[8]);
  const messageId = nstring(tokens[9]);
  return {
    date,
    subject,
    from,
    to,
    cc,
    messageId,
    inReplyTo,
  };
}

function nstring(token: ImapToken | undefined): string | undefined {
  return tokenText(token);
}

function addressList(token: ImapToken | undefined): Address[] {
  if (!token || token.kind !== 'list') return [];
  return token.value.map((item) => {
    if (item.kind !== 'list') return null;
    const name = decodeHeaderWords(nstring(item.value[0]) ?? '');
    const mailbox = nstring(item.value[2]);
    const host = nstring(item.value[3]);
    if (!mailbox || !host) return null;
    return { name, email: `${mailbox}@${host}` };
  }).filter((item): item is Address => Boolean(item));
}

export function parseImapDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/.exec(value.trim());
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  const month = MONTHS.indexOf(match[2] ?? '');
  if (month < 0) return undefined;
  const utc = Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]));
  const tz = match[7] ?? '+0000';
  const sign = tz.startsWith('-') ? -1 : 1;
  const offset = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))) * 60000;
  return utc - offset;
}

export function sentMailboxName(mailboxes: ImapMailbox[]): string | undefined {
  return mailboxes.find((box) => box.flags.some((flag) => flag.toLowerCase() === '\\sent'))?.name
    ?? mailboxes.find((box) => /sent|отправлен/i.test(box.name))?.name;
}
