import type { SocketLike } from '../mail/imap/client';

export function openSocket(_host: string, _port: number, _tls: boolean): Promise<SocketLike> {
  return Promise.reject(new Error('Почта IMAP открывается в приложении на iPhone. В браузере доступен демонстрационный ящик.'));
}
