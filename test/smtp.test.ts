import { describe, expect, it } from 'vitest';
import { buildMime } from '../src/mail/mime/build';
import { withMockSmtp } from './mockSmtp';

describe('SMTP client', () => {
  it('sends a message and dot-stuffs a leading dot', async () => {
    await withMockSmtp(async (client, sent) => {
      await client.greet();
      await client.ehlo();
      await client.authPlain('owner@mail.ru', 'app-pass');
      const raw = new TextDecoder().decode(buildMime({
        from: { name: 'Vellia', email: 'hola@vellia.test' },
        to: [{ name: 'María', email: 'maria@example.com' }],
        cc: [],
        bcc: [],
        subject: 'Mesa confirmada',
        text: 'Hola María.\n.esta línea no debe romperse',
        attachments: [{ filename: 'nota.txt', contentType: 'text/plain', contentBase64: Buffer.from('hola').toString('base64') }],
      }));
      await client.send({ from: 'hola@vellia.test', to: ['maria@example.com'], data: raw });
      expect(sent.raw).toContain('Subject:');
      expect(sent.raw).toContain('.esta');
      expect(sent.raw).not.toContain('\r\n..esta');
      expect(sent.raw).toContain('nota.txt');
      await client.quit();
    });
  });

  it('rejects a bad password', async () => {
    await withMockSmtp(async (client) => {
      await client.greet();
      await client.ehlo();
      await expect(client.authPlain('owner@mail.ru', 'nope')).rejects.toThrow(/535/);
    });
  });
});
