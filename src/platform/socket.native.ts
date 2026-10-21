import TcpSocket from 'react-native-tcp-socket';
import type { SocketLike } from '../mail/imap/client';

interface NativeSocket {
  on(event: 'data', cb: (data: Uint8Array | string) => void): void;
  on(event: 'error', cb: (error: Error) => void): void;
  on(event: 'close', cb: () => void): void;
  write(data: Uint8Array | string): void;
  destroy(): void;
}

export function openSocket(host: string, port: number, tls: boolean): Promise<SocketLike> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = TcpSocket.createConnection(
      { host, port, tls, tlsCheckValidity: true, connectTimeout: 15000 },
      () => {
        settled = true;
        resolve(adapt(socket as unknown as NativeSocket));
      },
    );
    socket.on('error', (error: Error) => {
      if (!settled) reject(error);
    });
  });
}

function adapt(socket: NativeSocket): SocketLike {
  return {
    write(data) {
      socket.write(data);
    },
    onData(cb) {
      socket.on('data', (data) => {
        if (typeof data === 'string') cb(new TextEncoder().encode(data));
        else cb(data instanceof Uint8Array ? data : new Uint8Array(data));
      });
    },
    onClose(cb) {
      socket.on('close', () => cb());
    },
    onError(cb) {
      socket.on('error', cb);
    },
    end() {
      socket.destroy();
    },
  };
}
