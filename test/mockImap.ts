import net from 'node:net';
import { ImapClient, type SocketLike } from '../src/mail/imap/client';

function asBuffer(chunk: Buffer | string): Buffer {
  return typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
}

const RAW_A = [
  'From: Maria Lopez <maria@example.com>',
  'To: hola@vellia.test',
  'Subject: Reserva terraza',
  'Date: Tue, 20 Oct 2026 18:04:00 +0200',
  'Message-ID: <res-1@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: 8bit',
  '',
  'Hola, mesa para 4 el sábado.',
  '',
].join('\r\n');

const RAW_B = [
  'From: =?UTF-8?B?0JjQstCw0L0=?= <ivan@example.com>',
  'To: hola@vellia.test',
  'Subject: =?UTF-8?B?0JfQsNCy0YLRgNCw?=',
  'Date: Wed, 21 Oct 2026 09:00:00 +0200',
  'Message-ID: <turno@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Не выйду на смену.',
  '',
].join('\r\n');

function envelope(subject: string, name: string, mailbox: string, host: string, id: string): string {
  return `("${name === 'Maria Lopez' ? 'Tue, 20 Oct 2026 18:04:00 +0200' : 'Wed, 21 Oct 2026 09:00:00 +0200'}" "${subject}" (("${name}" NIL "${mailbox}" "${host}")) NIL NIL (("Vellia" NIL "hola" "vellia.test")) NIL NIL NIL "${id}")`;
}

export function adaptSocket(socket: net.Socket): SocketLike {
  return {
    write(data) {
      socket.write(Buffer.from(data));
    },
    onData(cb) {
      socket.on('data', (chunk) => cb(new Uint8Array(asBuffer(chunk))));
    },
    onClose(cb) {
      socket.on('close', () => cb());
    },
    onError(cb) {
      socket.on('error', (error) => cb(error));
    },
    end() {
      socket.end();
    },
  };
}

export async function withMockImap(run: (client: ImapClient) => Promise<void>): Promise<void> {
  const server = net.createServer((socket) => speakImap(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const socket = net.connect({ host: '127.0.0.1', port: address.port });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  const client = new ImapClient(adaptSocket(socket));
  try {
    await run(client);
  } finally {
    socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function speakImap(socket: net.Socket) {
  socket.write('* OK Vellia mock IMAP ready\r\n');
  let buffer = Buffer.alloc(0);
  let authed = false;
  let literal: { tag: string; rest: string; left: number; chunks: Buffer[] } | null = null;
  let xoauthTag: string | null = null;

  const onLine = (line: string) => {
    if (xoauthTag) {
      const tag = xoauthTag;
      xoauthTag = null;
      const decoded = Buffer.from(line, 'base64').toString('utf8');
      if (decoded.includes('user=owner@mail.ru') && decoded.includes('auth=Bearer good-token')) {
        authed = true;
        socket.write(`${tag} OK AUTHENTICATE completed\r\n`);
      } else socket.write(`${tag} NO [AUTHENTICATIONFAILED] bad token\r\n`);
      return;
    }
    const match = /^(\S+) ([\s\S]*)$/.exec(line);
    if (!match) return;
    const tag = match[1] ?? '';
    const command = match[2] ?? '';
    const literalMatch = /\{(\d+)\}\s*$/.exec(command);
    if (literalMatch) {
      literal = { tag, rest: command, left: Number(literalMatch[1]), chunks: [] };
      socket.write('+ go\r\n');
      return;
    }
    handle(tag, command, null);
  };

  const handle = (tag: string, command: string, appended: Buffer | null) => {
    const upper = command.toUpperCase();
    if (upper.startsWith('LOGIN ')) {
      const ok = /owner@mail\.ru/.test(command) && /app-pass/.test(command);
      if (!ok) {
        socket.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        return;
      }
      authed = true;
      socket.write(`${tag} OK LOGIN completed\r\n`);
      return;
    }
    if (upper.startsWith('AUTHENTICATE XOAUTH2')) {
      xoauthTag = tag;
      socket.write('+ \r\n');
      return;
    }
    if (!authed) {
      socket.write(`${tag} NO not authenticated\r\n`);
      return;
    }
    if (upper.startsWith('LIST ')) {
      socket.write('* LIST (\\HasNoChildren) "/" INBOX\r\n');
      socket.write('* LIST (\\Sent) "/" Sent\r\n');
      socket.write(`${tag} OK LIST completed\r\n`);
      return;
    }
    if (upper.startsWith('SELECT ')) {
      if (/sent/i.test(command)) {
        socket.write('* 0 EXISTS\r\n');
        socket.write('* OK [UIDVALIDITY 2] UIDs valid\r\n');
      } else {
        socket.write('* 2 EXISTS\r\n');
        socket.write('* OK [UIDVALIDITY 1] UIDs valid\r\n');
      }
      socket.write(`${tag} OK [READ-WRITE] SELECT completed\r\n`);
      return;
    }
    if (upper.startsWith('UID SEARCH')) {
      if (/sent/i.test(command)) socket.write('* SEARCH\r\n');
      else if (upper.includes('TEXT')) socket.write('* SEARCH 10\r\n');
      else socket.write('* SEARCH 10 11\r\n');
      socket.write(`${tag} OK SEARCH completed\r\n`);
      return;
    }
    if (upper.startsWith('UID FETCH')) {
      const wantBody = upper.includes('BODY');
      const uids = (command.match(/\d+/g) ?? []).map(Number).filter((n) => n === 10 || n === 11);
      for (const uid of uids) {
        const raw = uid === 10 ? RAW_A : RAW_B;
        const bytes = Buffer.from(raw);
        if (wantBody) {
          socket.write(`* ${uid === 10 ? 1 : 2} FETCH (UID ${uid} BODY[] {${bytes.length}}\r\n`);
          socket.write(bytes);
          socket.write(')\r\n');
        } else if (uid === 10) {
          socket.write(`* 1 FETCH (UID 10 FLAGS () INTERNALDATE "20-Oct-2026 16:04:00 +0000" RFC822.SIZE ${bytes.length} ENVELOPE ${envelope('Reserva terraza', 'Maria Lopez', 'maria', 'example.com', '<res-1@example.com>')})\r\n`);
        } else {
          socket.write(`* 2 FETCH (UID 11 FLAGS (\\Seen) INTERNALDATE "21-Oct-2026 07:00:00 +0000" RFC822.SIZE ${bytes.length} ENVELOPE ${envelope('=?UTF-8?B?0JfQsNCy0YLRgNCw?=', 'Ivan', 'ivan', 'example.com', '<turno@example.com>')})\r\n`);
        }
      }
      socket.write(`${tag} OK FETCH completed\r\n`);
      return;
    }
    if (upper.startsWith('UID STORE')) {
      socket.write(`${tag} OK STORE completed\r\n`);
      return;
    }
    if (upper.startsWith('APPEND ')) {
      if (!appended || appended.length < 10) {
        socket.write(`${tag} NO empty append\r\n`);
        return;
      }
      socket.write(`${tag} OK APPEND completed\r\n`);
      return;
    }
    if (upper.startsWith('LOGOUT')) {
      socket.write('* BYE mock closing\r\n');
      socket.write(`${tag} OK LOGOUT completed\r\n`);
      socket.end();
      return;
    }
    socket.write(`${tag} BAD unknown\r\n`);
  };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, asBuffer(chunk)]);
    if (literal) {
      const take = Math.min(literal.left, buffer.length);
      literal.chunks.push(buffer.subarray(0, take));
      buffer = buffer.subarray(take);
      literal.left -= take;
      if (literal.left === 0) {
        const done = literal;
        literal = null;
        const extra = buffer.indexOf('\n');
        if (extra >= 0) buffer = buffer.subarray(extra + 1);
        handle(done.tag, done.rest, Buffer.concat(done.chunks));
      }
      return;
    }
    let nl = buffer.indexOf('\n');
    while (nl >= 0 && !literal) {
      const line = buffer.subarray(0, nl).toString('utf8').replace(/\r$/, '');
      buffer = buffer.subarray(nl + 1);
      onLine(line);
      nl = buffer.indexOf('\n');
    }
  });
}
