import { io } from 'socket.io-client';
import { events, mapEvents, isWalkPath, type Ack, type Challenge, type WalkPath } from '@patriot/protocol';
import { proveIdentity, publicKey } from './crypto';

export async function mapConnection(
  onPaths: (paths: WalkPath[]) => void,
  onStatus: (online: boolean, error?: string) => void,
) {
  const key = await publicKey();
  const url = process.env.EXPO_PUBLIC_RELAY_URL;
  if (!url) throw new Error('Set EXPO_PUBLIC_RELAY_URL in mobile/.env');
  let ready = false;
  const socket = io(url, { auth: { publicKey: key }, autoConnect: false });
  socket.on('disconnect', () => { ready = false; onStatus(false); });
  socket.on('connect_error', (error) => onStatus(false, error.message));
  socket.on(mapEvents.path, (path: unknown) => {
    if (isWalkPath(path)) onPaths([path]);
  });
  socket.on(events.challenge, async (challenge: Challenge) => {
    const connection = socket.id;
    try {
      const proof = await proveIdentity(challenge);
      if (socket.id !== connection) return;
      const ack: Ack = await socket.timeout(5000).emitWithAck(events.authenticate, proof);
      if (!ack.ok) throw new Error(ack.error);
      const paths: unknown[] = await socket.timeout(5000).emitWithAck(mapEvents.read);
      if (socket.id !== connection) return;
      ready = true;
      onPaths(paths.filter(isWalkPath));
      onStatus(true);
    } catch (error) {
      if (socket.id === connection) onStatus(false, String(error));
    }
  });
  socket.connect();
  return {
    close() { socket.removeAllListeners(); socket.disconnect(); },
    async contribute(path: WalkPath) {
      if (!ready) throw new Error('Relay offline. Your walk remains on this device. Retry sharing when connected.');
      const ack: Ack = await socket.timeout(5000).emitWithAck(mapEvents.contribute, path);
      if (!ack.ok) throw new Error(ack.error);
    },
  };
}
