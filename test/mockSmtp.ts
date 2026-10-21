import net from 'node:net';
import { SmtpClient, type SmtpSocket } from '../src/mail/smtp/client';

export function adaptSmtp(socket: net.Socket): SmtpSocket {
  return {
    write(data) {
      socket.write(Buffer.from(data));
    },
    onData(cb) {
      socket.on('data', (chunk) => cb(new Uint8Array(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)));
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

export async function withMockSmtp(run: (client: SmtpClient, sent: { raw: string }) => Promise<void>): Promise<void> {
  const sent = { raw: '' };
  const server = net.createServer((socket) => {
    socket.write('220 mock.vellia ESMTP\r\n');
    let buffer = '';
    let dataMode = false;
    let data = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (dataMode) {
        data += buffer;
        buffer = '';
        const end = data.indexOf('\r\n.\r\n');
        if (end >= 0) {
          sent.raw = data.slice(0, end).replace(/^\.\./gm, '.');
          dataMode = false;
          data = '';
          socket.write('250 queued\r\n');
        }
        return;
      }
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) socket.write('250-mock\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (upper.startsWith('AUTH PLAIN ')) {
          const token = line.slice('AUTH PLAIN '.length);
          const decoded = Buffer.from(token, 'base64').toString('utf8');
          if (decoded === '\u0000owner@mail.ru\u0000app-pass') socket.write('235 authenticated\r\n');
          else socket.write('535 denied\r\n');
        } else if (upper.startsWith('MAIL FROM:') || upper.startsWith('RCPT TO:')) socket.write('250 ok\r\n');
        else if (upper === 'DATA') {
          dataMode = true;
          socket.write('354 end with dot\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('500 unknown\r\n');
        nl = buffer.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const socket = net.connect({ host: '127.0.0.1', port: address.port });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  const client = new SmtpClient(adaptSmtp(socket));
  try {
    await run(client, sent);
  } finally {
    socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
