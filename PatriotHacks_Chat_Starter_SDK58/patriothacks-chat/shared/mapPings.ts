import { isRoom, type Room, type MapPoint } from '@patriot/protocol';
export const pingLifetimeMs = 60_000;
export const mapPingEvents = { watch: 'map:ping:watch', send: 'map:ping:send', stop: 'map:ping:stop', update: 'map:ping:update', snapshot: 'map:ping:snapshot' };
export interface MapPing {
  id: string; from: string; name: string; level: Room; point: MapPoint;
  emergency: boolean; live?: boolean; simulated?: boolean; accuracy: number; sentAt: number; expiresAt: number;
}
export type PingSnapshot = { level: Room; revision: number; pings: MapPing[] };
export function validPingPoint(value: unknown): value is MapPoint {
  if (!value || typeof value !== 'object') return false;
  const p = value as MapPoint;
  return Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180;
}
export function isPingSnapshot(value: unknown): value is PingSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as PingSnapshot;
  return isRoom(s.level) && Number.isSafeInteger(s.revision) && s.revision >= 0
    && Array.isArray(s.pings) && s.pings.length <= 1000 && s.pings.every((p) => p && typeof p.id === 'string'
      && typeof p.from === 'string' && typeof p.name === 'string' && p.name.length <= 40 && p.level === s.level
      && validPingPoint(p.point) && (p.live === undefined || typeof p.live === 'boolean') && typeof p.emergency === 'boolean' && (p.simulated === undefined || typeof p.simulated === 'boolean') && Number.isFinite(p.accuracy) && p.accuracy >= 0
      && Number.isSafeInteger(p.sentAt) && p.expiresAt === p.sentAt + pingLifetimeMs);
}

export function canUseMapTesting(name: unknown): boolean {
  return typeof name === 'string' && ['test', 'tester'].includes(name.trim().toLowerCase());
}
