import { io } from 'socket.io-client';
import { events, type Ack, type Challenge, type Room } from '@patriot/protocol';
import { sosEvent, type SosType } from '../../shared/sosTypes';
import { proveIdentity, publicKey } from './crypto';

export async function sendLevelSos(id: string, type: SosType, room: Room | undefined, expectedKey: string): Promise<void> {
  if (await publicKey() !== expectedKey) throw new Error('Account changed. Open SOS again.');
  const url = process.env.EXPO_PUBLIC_RELAY_URL;
  if (!url) throw new Error('Set EXPO_PUBLIC_RELAY_URL in mobile/.env');
  const socket = io(url, { auth: { publicKey: expectedKey }, autoConnect: false, reconnection: false });
  return new Promise<void>((resolve, reject) => {
    let done = false;
    function finish(error?: Error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.disconnect();
      if (error) reject(error); else resolve();
    }
    const timer = setTimeout(() => finish(new Error('SOS connection timed out. Delivery could not be confirmed.')), 15000);
    socket.on('connect_error', (error) => finish(error));
    socket.on('disconnect', () => finish(new Error('Relay disconnected. SOS delivery could not be confirmed.')));
    socket.on(events.challenge, async (challenge: Challenge) => {
      try {
        if (await publicKey() !== expectedKey) throw new Error('Account changed. Open SOS again.');
        const proof = await proveIdentity(challenge);
        if (done) return;
        const auth: Ack = await socket.timeout(5000).emitWithAck(events.authenticate, proof);
        if (!auth.ok) throw new Error(auth.error);
        if (await publicKey() !== expectedKey) throw new Error('Account changed. Open SOS again.');
        if (done) return;
        const ack: Ack = await socket.timeout(5000).emitWithAck(sosEvent, { id, type, room });
        if (!ack.ok) throw new Error(ack.error);
        finish();
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
    socket.connect();
  });
}
