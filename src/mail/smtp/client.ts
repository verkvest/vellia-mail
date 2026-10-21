import { bytesToBase64, utf8Encode } from '../bytes';

export interface SmtpSocket {
  write(data: Uint8Array): void;
  onData(cb: (chunk: Uint8Array) => void): void;
  onClose(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
  end(): void;
}

export class SmtpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpError';
  }
}

interface Reply {
  code: number;
  text: string;
}

export class SmtpClient {
  private buffer = '';
  private lines: string[] = [];
  private waiter: ((line: string) => void) | null = null;
  private dead = false;
  private failers: ((error: Error) => void)[] = [];

  constructor(private socket: SmtpSocket) {
    socket.onData((chunk) => {
      this.buffer += new TextDecoder().decode(chunk);
      let nl = this.buffer.indexOf('\n');
      while (nl >= 0) {
        const line = this.buffer.slice(0, nl).replace(/\r$/, '');
        this.buffer = this.buffer.slice(nl + 1);
        if (this.waiter) {
          const waiter = this.waiter;
          this.waiter = null;
          waiter(line);
        } else this.lines.push(line);
        nl = this.buffer.indexOf('\n');
      }
    });
    socket.onError((error) => this.fail(error));
    socket.onClose(() => this.fail(new SmtpError('Соединение SMTP закрыто')));
  }

  async greet(): Promise<void> {
    const reply = await this.readReply();
    if (reply.code !== 220) throw new SmtpError(reply.text);
  }

  async ehlo(host = 'vellia-mail'): Promise<void> {
    const reply = await this.command(`EHLO ${host}`);
    if (reply.code !== 250) throw new SmtpError(reply.text);
  }

  async authPlain(username: string, password: string): Promise<void> {
    const token = bytesToBase64(utf8Encode(`\u0000${username}\u0000${password}`));
    const reply = await this.command(`AUTH PLAIN ${token}`);
    if (reply.code === 334) {
      const next = await this.command(token);
      if (next.code !== 235) throw new SmtpError(next.text);
      return;
    }
    if (reply.code !== 235) throw new SmtpError(reply.text || 'SMTP отклонил вход');
  }

  async send(options: { from: string; to: string[]; data: string }): Promise<void> {
    const from = await this.command(`MAIL FROM:<${options.from}>`);
    if (from.code !== 250) throw new SmtpError(from.text);
    for (const recipient of options.to) {
      const rcpt = await this.command(`RCPT TO:<${recipient}>`);
      if (rcpt.code !== 250 && rcpt.code !== 251) throw new SmtpError(rcpt.text);
    }
    const data = await this.command('DATA');
    if (data.code !== 354) throw new SmtpError(data.text);
    const normalized = options.data.replace(/\r?\n/g, '\r\n');
    const stuffed = normalized.replace(/^\./gm, '..');
    const body = stuffed.endsWith('\r\n') ? stuffed : `${stuffed}\r\n`;
    this.socket.write(utf8Encode(`${body}.\r\n`));
    const queued = await this.readReply();
    if (queued.code !== 250) throw new SmtpError(queued.text);
  }

  async quit(): Promise<void> {
    try {
      await this.command('QUIT');
    } catch {
      // ignore
    }
    this.socket.end();
  }

  private async command(line: string): Promise<Reply> {
    this.socket.write(utf8Encode(`${line}\r\n`));
    return this.readReply();
  }

  private async readReply(): Promise<Reply> {
    const collected: string[] = [];
    for (;;) {
      const line = await this.readLine();
      collected.push(line);
      if (/^\d{3} /.test(line)) {
        return { code: Number(line.slice(0, 3)), text: collected.join('\n') };
      }
      if (!/^\d{3}-/.test(line)) throw new SmtpError(line || 'Пустой ответ SMTP');
    }
  }

  private readLine(): Promise<string> {
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.dead) return Promise.reject(new SmtpError('Соединение SMTP закрыто'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new SmtpError('Сервер SMTP не ответил вовремя'));
      }, 25000);
      this.failers.push(reject);
      this.waiter = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
    });
  }

  private fail(error: Error) {
    if (this.dead) return;
    this.dead = true;
    this.failers.forEach((reject) => reject(error));
    this.failers = [];
  }
}
