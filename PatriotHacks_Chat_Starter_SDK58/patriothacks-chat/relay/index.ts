import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { Server } from 'socket.io';
import nacl from 'tweetnacl';
import { events, isEnvelope, isPublicKey, isRoom, roomEvents, type Ack, type Envelope, type Room, type RoomMessage } from '@patriot/protocol';

const app = express();
app.get('/health', (_request, response) => response.json({ ok: true }));
const server = createServer(app);
const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });
const pending = new Map<string, Map<string, Envelope>>();
const roomHistory = new Map<Room, RoomMessage[]>();
const relayKeys = nacl.box.keyPair();
const room = (key: string) => 'identity:' + key;

io.use((socket, next) => {
  const key = socket.handshake.auth.publicKey;
  if (!isPublicKey(key)) return next(new Error('Invalid public key'));
  socket.data.publicKey = key;
  next();
});

io.on('connection', (socket) => {
  const key: string = socket.data.publicKey;
  const token = randomBytes(32);
  const nonce = randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(token, nonce, Buffer.from(key, 'base64'), relayKeys.secretKey);
  let authenticated = false;
  const deadline = setTimeout(() => socket.disconnect(true), 10_000);
  socket.on('disconnect', () => clearTimeout(deadline));
  socket.emit(events.challenge, {
    publicKey: Buffer.from(relayKeys.publicKey).toString('base64'),
    nonce: nonce.toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  });

  socket.once(events.authenticate, async (proof: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function' || typeof proof !== 'string' || !isPublicKey(proof)
      || !timingSafeEqual(token, Buffer.from(proof, 'base64'))) {
      if (typeof reply === 'function') reply({ ok: false, error: 'Identity verification failed' });
      socket.disconnect(true);
      return;
    }
    clearTimeout(deadline);
    await socket.join([room(key), "room-readers"]);
    authenticated = true;
    reply({ ok: true });
    for (const message of pending.get(key)?.values() ?? []) socket.emit(events.receive, message);
  });

  socket.on(events.send, (message: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated || !isEnvelope(message) || message.from !== key) {
      reply({ ok: false, error: 'Invalid message or session' });
      return;
    }
    const mailbox = pending.get(message.to) ?? new Map<string, Envelope>();
    const deliveryId = message.from + ':' + message.id;
    const queued = mailbox.get(deliveryId);
    if (queued && JSON.stringify(queued) !== JSON.stringify(message)) {
      reply({ ok: false, error: 'Message ID already used' });
      return;
    }
    if (!queued && (mailbox.size >= 100 || (!pending.has(message.to) && pending.size >= 500))) {
      reply({ ok: false, error: 'Relay queue is full' });
      return;
    }
    mailbox.set(deliveryId, message);
    pending.set(message.to, mailbox);
    io.to(room(message.to)).emit(events.receive, message);
    reply({ ok: true });
  });

  socket.on(roomEvents.history, (requested: unknown, reply: (result: RoomMessage[]) => void) => {
    if (authenticated && isRoom(requested) && typeof reply === 'function') {
      reply(roomHistory.get(requested) ?? []);
    }
  });

  socket.on(roomEvents.send, (requested: unknown, body: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated || !isRoom(requested) || typeof body !== 'string'
      || body.length > 2000 || !body.trim()) {
      reply({ ok: false, error: 'Invalid room message' });
      return;
    }
    const message = { id: randomUUID(), room: requested, from: key, text: body.trim() };
    const history = roomHistory.get(requested) ?? [];
    roomHistory.set(requested, [...history.slice(-99), message]);
    io.to('room-readers').emit(roomEvents.message, message);
    reply({ ok: true });
  });

  socket.on(events.received, (from: unknown, id: unknown) => {
    if (!authenticated || !isPublicKey(from) || typeof id !== 'string') return;
    const mailbox = pending.get(key);
    mailbox?.delete(from + ':' + id);
    if (mailbox?.size === 0) pending.delete(key);
  });
});

server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  console.log('PatriotHacks relay listening on', server.address());
});
