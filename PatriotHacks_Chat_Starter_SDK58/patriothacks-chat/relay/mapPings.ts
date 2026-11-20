import type { Server, Socket } from 'socket.io';
import { isRoom, type Room, type ChatProfile, type Ack } from '@patriot/protocol';
import { mapPingEvents, pingLifetimeMs, validPingPoint, canUseMapTesting, type MapPing, type PingSnapshot } from '../shared/mapPings.js';

const pings = new Map<string, MapPing>();
const liveOwners = new Map<string, string>();
const revisions = new Map<Room, number>();
const lastSent = new Map<string, number>();
const channel = (level: Room) => 'map-pings:' + level;
let timer: ReturnType<typeof setInterval> | undefined;

export function registerMapPings(io: Server, socket: Socket, authenticated: () => boolean,
  getProfile: (key: string) => ChatProfile | undefined) {
  function snapshot(level: Room): PingSnapshot {
    return { level, revision: revisions.get(level) ?? 0, pings: [...pings.values()].filter((p) => p.level === level && p.expiresAt > Date.now()) };
  }
  function broadcast(level: Room) {
    revisions.set(level, (revisions.get(level) ?? 0) + 1);
    const value = snapshot(level);
    for (const peer of io.sockets.sockets.values()) {
      if (peer.rooms.has(channel(level)) && getProfile(peer.data.publicKey)) peer.emit(mapPingEvents.snapshot, value);
    }
  }
  if (!timer) {
    timer = setInterval(() => {
      const changed = new Set<Room>();
      for (const [key, ping] of pings) if (ping.expiresAt <= Date.now()) { pings.delete(key); liveOwners.delete(key); changed.add(ping.level); }
      for (const level of changed) broadcast(level);
      for (const [key, time] of lastSent) if (Date.now() - time > pingLifetimeMs) lastSent.delete(key);
    }, 1000);
    timer.unref();
  }
  socket.on(mapPingEvents.watch, async (level: unknown, reply: (result: { ok: true; snapshot: PingSnapshot } | { ok: false; error: string }) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated() || !isRoom(level) || !getProfile(socket.data.publicKey)) {
      reply({ ok: false, error: 'Sign in and choose a valid map level to view location pings.' }); return;
    }
    for (const room of [...socket.rooms]) if (room.startsWith('map-pings:')) await socket.leave(room);
    await socket.join(channel(level));
    if (!socket.connected || !getProfile(socket.data.publicKey)) return;
    reply({ ok: true, snapshot: snapshot(level) });
  });
  socket.on(mapPingEvents.send, (request: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    const profile = getProfile(socket.data.publicKey);
    const value = request as Partial<MapPing> | null;
    if (!authenticated() || !profile || !value || !isRoom(value.level)
      || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id)
      || !validPingPoint(value.point) || typeof value.emergency !== 'boolean'
      || (value.live !== undefined && typeof value.live !== 'boolean')
      || (value.simulated !== undefined && typeof value.simulated !== 'boolean')
      || (value.simulated === true && !canUseMapTesting(profile.name))
      || typeof value.accuracy !== 'number' || !Number.isFinite(value.accuracy) || value.accuracy < 0 || value.accuracy > 1000) {
      reply({ ok: false, error: 'Invalid ping, location, or level.' }); return;
    }
    const key: string = socket.data.publicKey;
    const previous = pings.get(key);
    if (previous?.id === value.id) { reply({ ok: true }); return; }
    if (Date.now() - (lastSent.get(key) ?? 0) < 5000) { reply({ ok: false, error: 'Wait five seconds before sending another ping.' }); return; }
    if (!previous && pings.size >= 1000) { reply({ ok: false, error: 'The level ping service is full.' }); return; }
    const now = Date.now();
    pings.set(key, { id: value.id, from: key, name: profile.name, level: value.level, live: value.live === true, simulated: value.simulated === true,
      point: { latitude: value.point.latitude, longitude: value.point.longitude }, emergency: value.emergency,
      accuracy: value.accuracy, sentAt: now, expiresAt: now + pingLifetimeMs });
    if (value.live) liveOwners.set(key, socket.id); else liveOwners.delete(key);
    lastSent.set(key, now);
    if (previous && previous.level !== value.level) broadcast(previous.level);
    broadcast(value.level);
    reply({ ok: true });
  });
  socket.on(mapPingEvents.update, (request: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    const key: string = socket.data.publicKey;
    const value = request as Partial<MapPing> | null;
    const previous = pings.get(key);
    if (!authenticated() || !getProfile(key) || !value || !previous || !previous.live
      || previous.id !== value.id || liveOwners.get(key) !== socket.id || previous.expiresAt <= Date.now()
      || !validPingPoint(value.point) || typeof value.accuracy !== 'number'
      || !Number.isFinite(value.accuracy) || value.accuracy < 0 || value.accuracy > 1000
      || (previous.simulated && !canUseMapTesting(getProfile(key)?.name))) {
      reply({ ok: false, error: 'This live ping is no longer active. Tap Ping my location to share again.' }); return;
    }
    if (Date.now() - previous.sentAt < 1000) { reply({ ok: false, error: 'Location updates are too frequent.' }); return; }
    const now = Date.now();
    pings.set(key, { ...previous, point: { latitude: value.point.latitude, longitude: value.point.longitude },
      accuracy: value.accuracy, sentAt: now, expiresAt: now + pingLifetimeMs });
    broadcast(previous.level);
    reply({ ok: true });
  });
  socket.on('disconnect', () => {
    const key: string = socket.data.publicKey;
    if (liveOwners.get(key) !== socket.id) return;
    const previous = pings.get(key);
    liveOwners.delete(key); pings.delete(key);
    if (previous) broadcast(previous.level);
  });
  socket.on(mapPingEvents.stop, (request: unknown, callback?: (ack: Ack) => void) => {
    const reply = typeof request === 'function' ? request as (ack: Ack) => void : callback;
    if (typeof reply !== 'function') return;
    if (!authenticated()) { reply({ ok: false, error: 'Invalid session.' }); return; }
    const previous = pings.get(socket.data.publicKey);
    const id = request && typeof request === 'object' ? (request as { id?: unknown }).id : undefined;
    if (id !== undefined && previous?.id !== id) { reply({ ok: true }); return; }
    liveOwners.delete(socket.data.publicKey);
    pings.delete(socket.data.publicKey);
    if (previous) broadcast(previous.level);
    reply({ ok: true });
  });
}
