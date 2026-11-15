import { io } from 'socket.io-client';
import { events, isEnvelope, type Ack, type Challenge, type Envelope } from '@patriot/protocol';
import { proveIdentity } from './crypto';

export function connectRelay(
  url: string,
  key: string,
  onMessage: (message: Envelope) => Promise<void>,
  onStatus: (online: boolean, error?: string) => void,
) {
  const socket = io(url, { auth: { publicKey: key }, autoConnect: false });
  let authenticated = false;

  socket.on('disconnect', () => {
    authenticated = false;
    onStatus(false);
  });
  socket.on('connect_error', (error) => onStatus(false, error.message));

  socket.on(events.challenge, async (challenge: Challenge) => {
    const connectionId = socket.id;
    try {
      const proof = await proveIdentity(challenge);
      if (socket.id !== connectionId) return;
      const ack: Ack = await socket.timeout(5000).emitWithAck(events.authenticate, proof);
      if (!ack.ok) throw new Error(ack.error);
      if (socket.id !== connectionId) return;
      authenticated = true;
      onStatus(true);
    } catch (error) {
      if (socket.id === connectionId) onStatus(false, String(error));
    }
  });

  socket.on(events.receive, async (message: unknown) => {
    if (!isEnvelope(message) || message.to !== key) return;
    const connectionId = socket.id;
    try {
      await onMessage(message);
      if (socket.connected && socket.id === connectionId) {
        socket.emit(events.received, message.from, message.id);
      }
    } catch (error) {
      console.warn('Could not accept message', String(error));
    }
  });
  socket.connect();

  return {
    close() {
      socket.removeAllListeners();
      socket.disconnect();
    },
    async send(message: Envelope) {
      if (!authenticated || !socket.connected) throw new Error('Relay is offline');
      const ack: Ack = await socket.timeout(5000).emitWithAck(events.send, message);
      if (!ack.ok) throw new Error(ack.error);
    },
  };
}
