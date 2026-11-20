import type { MapPathState } from '@patriot/protocol';
import { mapPlaceEvents, isMapPlace, isMapPoint, type MapPlaceSnapshot } from '@patriot/protocol';
import { readMap, storeMapPath, readMapPathState, removeMapPath, readMapPlaces, storeMapPlace, removeMapPlace, moveMapPlace } from './mapStore.js';
import { profiles, storeProfile } from './profiles.js';
import { validateReport, saveReport, readReports, incidentSnapshot, severeReports, levelTemperatures } from './reports.js';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { Server } from 'socket.io';
import nacl from 'tweetnacl';
import { events, isEnvelope, isPublicKey, isRoom, incidentEvent, levelPresenceEvent, levelTemperatureEvent, severeReportsEvent, parseChatProfile, type LevelPresence, mapEvents, isWalkPath, type WalkPath, profileEvents, reportEvents, roomEvents, type LevelReportResult, type Ack, type Envelope, type Room, type RoomMessage } from '@patriot/protocol';

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

const activeAccounts = new Map<string, number>();

function publishPresence() {
  const counts: LevelPresence = { 'Upper Level': 0, 'Middle Level': 0, 'Lower Levels': 0 };
  for (const key of activeAccounts.keys()) {
    const level = profiles[key]?.level;
    if (level) counts[level]++;
  }
  io.to('room-readers').emit(levelPresenceEvent, counts);
}

io.on('connection', (socket) => {
  const key: string = socket.data.publicKey;
  const token = randomBytes(32);
  const nonce = randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(token, nonce, Buffer.from(key, 'base64'), relayKeys.secretKey);
  let authenticated = false;
  const deadline = setTimeout(() => socket.disconnect(true), 10_000);
  socket.on('disconnect', () => {
    clearTimeout(deadline);
    if (!authenticated) return;
    const remaining = (activeAccounts.get(key) ?? 1) - 1;
    if (remaining) activeAccounts.set(key, remaining);
    else activeAccounts.delete(key);
    publishPresence();
  });
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
    if (!socket.connected) return;
    authenticated = true;
    activeAccounts.set(key, (activeAccounts.get(key) ?? 0) + 1);
    reply({ ok: true });
    socket.emit(profileEvents.snapshot, profiles);
    socket.emit(incidentEvent, incidentSnapshot());
    socket.emit(severeReportsEvent, severeReports());
    socket.emit(levelTemperatureEvent, levelTemperatures());
    publishPresence();
    for (const message of pending.get(key)?.values() ?? []) socket.emit(events.receive, message);
  });

  socket.on(mapPlaceEvents.read, (reply: (snapshot: MapPlaceSnapshot) => void) => {
    if (!authenticated || typeof reply !== 'function') return;
    try { reply(readMapPlaces()); } catch (error) { console.error('Read map markers failed', error); }
  });
  socket.on(mapPlaceEvents.add, (value: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated || !isMapPlace(value) || value.kind === 'personal') {
      reply({ ok: false, error: 'Invalid shared marker or session.' }); return;
    }
    const own = value.kind === 'blackout' ? readReports(value.level, key) : undefined;
    if (own && own.summary.reports >= 1000 && !own.recent.some((report) => report.reporter === key)) {
      reply({ ok: false, error: 'This level has reached its report limit.' }); return;
    }
    try {
      const place = { ...value, kind: value.kind, createdAt: Date.now() };
      const result = storeMapPlace(place);
      if (result.ok) {
        if (place.kind === 'blackout' && own) {
          saveReport(place.level, key, { answers: { ...own.own.answers, blackout: place.blackout! },
            ...(own.own.temperatureF !== undefined ? { temperatureF: own.own.temperatureF } : {}) });
          publishIncidents();
          io.to('room-readers').emit(levelTemperatureEvent, levelTemperatures());
        }
        io.to('room-readers').emit(mapPlaceEvents.snapshot, readMapPlaces());
      }
      reply(result);
    } catch (error) { console.error('Save map marker failed', error); reply({ ok: false, error: 'Could not save marker.' }); }
  });
  socket.on(mapPlaceEvents.move, (id: unknown, from: unknown, to: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated || typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || !isMapPoint(from) || !isMapPoint(to)) {
      reply({ ok: false, error: 'Invalid move or session.' }); return;
    }
    try {
      const result = moveMapPlace(id, from, to);
      // Send the current snapshot on conflict too, so the requester can retry safely.
      io.to('room-readers').emit(mapPlaceEvents.snapshot, readMapPlaces());
      reply(result);
    } catch (error) { console.error('Move marker failed', error); reply({ ok: false, error: 'Could not move marker.' }); }
  });

  socket.on(mapPlaceEvents.remove, (id: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated || typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) {
      reply({ ok: false, error: 'Invalid marker or session.' }); return;
    }
    try {
      const result = removeMapPlace(id);
      if (result.ok) io.to('room-readers').emit(mapPlaceEvents.snapshot, readMapPlaces());
      reply(result);
    } catch (error) { console.error('Remove map marker failed', error); reply({ ok: false, error: 'Could not remove marker.' }); }
  });

  socket.on(mapEvents.sync, (reply: (state: MapPathState) => void) => {
    if (!authenticated || typeof reply !== 'function') return;
    try { reply(readMapPathState()); } catch (error) { console.error('Read path state failed', error); }
  });
  socket.on(mapEvents.remove, (id: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated || typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) {
      reply({ ok: false, error: 'Invalid path or session.' }); return;
    }
    try {
      const result = removeMapPath(id, profiles[key]?.level);
      if (result.ok) io.to('room-readers').emit(mapEvents.removed, id);
      reply(result);
    } catch (error) { console.error('Remove path failed', error); reply({ ok: false, error: 'Could not remove path.' }); }
  });

  socket.on(mapEvents.read, (reply: (paths: WalkPath[]) => void) => {
    if (authenticated && typeof reply === 'function') {
      try { reply(readMap()); }
      catch (error) { console.error('Could not read shared map', error); }
    }
  });

  socket.on(mapEvents.contribute, (path: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated || !isWalkPath(path)) {
      reply({ ok: false, error: 'Invalid path or session' });
      return;
    }
    try {
      const result = storeMapPath(path);
      if (result.ok) io.to('room-readers').emit(mapEvents.path, path);
      reply(result);
    } catch (error) {
      console.error('Could not store shared path', error);
      reply({ ok: false, error: 'Could not save path. It will remain queued on your device.' });
    }
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

  socket.on(profileEvents.save, (input: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    const profile = parseChatProfile(input);
    if (!authenticated || !profile) {
      reply({ ok: false, error: 'Enter a display name of 1–40 characters and choose a home level.' });
      return;
    }
    try {
      if (!storeProfile(key, profile)) {
        reply({ ok: false, error: 'The relay has reached its profile limit.' });
        return;
      }
      io.to('room-readers').emit(profileEvents.changed, key, profile);
      publishPresence();
      reply({ ok: true });
    } catch (error) {
      console.error('Could not save profile:', error);
      reply({ ok: false, error: 'The relay could not save your profile.' });
    }
  });

  socket.on(reportEvents.read, (requested: unknown, reply: (result: LevelReportResult) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated || !isRoom(requested)) {
      reply({ ok: false, error: 'Invalid level or session' });
      return;
    }
    reply({ ok: true, view: readReports(requested, key) });
  });

  socket.on(reportEvents.submit, (requested: unknown, value: unknown, reply: (result: LevelReportResult) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated || !isRoom(requested)) {
      reply({ ok: false, error: 'Invalid level or session' });
      return;
    }
    const report = validateReport(value);
    if (!report || !saveReport(requested, key, report)) {
      reply({ ok: false, error: report ? 'This level has reached its report limit.' : 'Invalid report.' });
      return;
    }
    reply({ ok: true, view: readReports(requested, key) });
    publishIncidents();
    io.to('room-readers').emit(levelTemperatureEvent, levelTemperatures());
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

function publishIncidents() {
  io.to('room-readers').emit(incidentEvent, incidentSnapshot());
  io.to('room-readers').emit(severeReportsEvent, severeReports());
}

const incidentTimer = setInterval(publishIncidents, 30_000);
server.on('close', () => clearInterval(incidentTimer));

server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  console.log('PatriotHacks relay listening on', server.address());
});
