import type { Server, Socket } from 'socket.io';
import { isRoom, type Room, type ChatProfile, type Ack } from '@patriot/protocol';
import { mapPingEvents, pingLifetimeMs, validPingPoint, type MapPing, type PingSnapshot } from '../shared/mapPings.js';

const pings = new Map<string, MapPing>();
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
      if (peer.rooms.has(channel(level)) && getProfile(peer.data.publicKey)?.level === level) peer.emit(mapPingEvents.snapshot, value);
    }
  }
  if (!timer) {
    timer = setInterval(() => {
      const changed = new Set<Room>();
      for (const [key, ping] of pings) if (ping.expiresAt <= Date.now()) { pings.delete(key); changed.add(ping.level); }
      for (const level of changed) broadcast(level);
      for (const [key, time] of lastSent) if (Date.now() - time > pingLifetimeMs) lastSent.delete(key);
    }, 1000);
    timer.unref();
  }
  socket.on(mapPingEvents.watch, async (level: unknown, reply: (result: { ok: true; snapshot: PingSnapshot } | { ok: false; error: string }) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated() || !isRoom(level) || getProfile(socket.data.publicKey)?.level !== level) {
      reply({ ok: false, error: 'Location pings are only available on your profile level.' }); return;
    }
    for (const room of [...socket.rooms]) if (room.startsWith('map-pings:')) await socket.leave(room);
    await socket.join(channel(level));
    if (!socket.connected || getProfile(socket.data.publicKey)?.level !== level) return;
    reply({ ok: true, snapshot: snapshot(level) });
  });
  socket.on(mapPingEvents.send, (request: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    const profile = getProfile(socket.data.publicKey);
    const value = request as Partial<MapPing> | null;
    if (!authenticated() || !profile || !value || value.level !== profile.level
      || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id)
      || !validPingPoint(value.point) || typeof value.emergency !== 'boolean'
      || typeof value.accuracy !== 'number' || !Number.isFinite(value.accuracy) || value.accuracy < 0 || value.accuracy > 1000) {
      reply({ ok: false, error: 'Invalid ping, location, or level.' }); return;
    }
    const key: string = socket.data.publicKey;
    const previous = pings.get(key);
    if (previous?.id === value.id) { reply({ ok: true }); return; }
    if (Date.now() - (lastSent.get(key) ?? 0) < 5000) { reply({ ok: false, error: 'Wait five seconds before sending another ping.' }); return; }
    if (!previous && pings.size >= 1000) { reply({ ok: false, error: 'The level ping service is full.' }); return; }
    const now = Date.now();
    pings.set(key, { id: value.id, from: key, name: profile.name, level: profile.level,
      point: { latitude: value.point.latitude, longitude: value.point.longitude }, emergency: value.emergency,
      accuracy: value.accuracy, sentAt: now, expiresAt: now + pingLifetimeMs });
    lastSent.set(key, now);
    if (previous && previous.level !== profile.level) broadcast(previous.level);
    broadcast(profile.level);
    reply({ ok: true });
  });
  socket.on(mapPingEvents.stop, (reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    if (!authenticated()) { reply({ ok: false, error: 'Invalid session.' }); return; }
    const previous = pings.get(socket.data.publicKey);
    pings.delete(socket.data.publicKey);
    if (previous) broadcast(previous.level);
    reply({ ok: true });
  });
}
