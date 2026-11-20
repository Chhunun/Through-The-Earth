import { isMapPlace, isMapPlaceSnapshot, type MapPlace, type MapPlaceSnapshot, type MapPoint } from '@patriot/protocol';
import { openDatabaseAsync } from 'expo-sqlite';
import { isWalkPath, type WalkPath } from '@patriot/protocol';

async function database() {
  const db = await openDatabaseAsync('patriot-map.db');
  await db.execAsync('CREATE TABLE IF NOT EXISTS paths (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  await db.execAsync('CREATE TABLE IF NOT EXISTS map_outbox (owner TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (owner, id))');
  await db.execAsync('CREATE TABLE IF NOT EXISTS private_places (owner TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,id)); CREATE TABLE IF NOT EXISTS shared_places_cache (slot INTEGER PRIMARY KEY, body TEXT NOT NULL)');
  return db;
}
export async function loadMap() {
  const db = await database();
  const rows = await db.getAllAsync<{ body: string }>('SELECT body FROM paths ORDER BY rowid');
  return rows.flatMap(({ body }) => {
    try { const path: unknown = JSON.parse(body); return isWalkPath(path) ? [path] : []; }
    catch { return []; }
  });
}
export async function saveMapPath(path: WalkPath) {
  const db = await database();
  await db.runAsync('INSERT OR IGNORE INTO paths VALUES (?, ?)', path.id, JSON.stringify(path));
}


// Only explicit Share path actions enter this queue. Cached maps never do.
export async function queueMapShare(owner: string, path: WalkPath) {
  const db = await database();
  await db.runAsync('INSERT OR IGNORE INTO map_outbox (owner, id, body) VALUES (?, ?, ?)', owner, path.id, JSON.stringify(path));
}
export async function pendingMapShares(owner: string): Promise<WalkPath[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ body: string }>('SELECT body FROM map_outbox WHERE owner = ? ORDER BY rowid', owner);
  return rows.map(({ body }) => {
    const path: unknown = JSON.parse(body);
    if (!isWalkPath(path)) throw new Error('Invalid queued path');
    return path;
  });
}
export async function finishMapShare(owner: string, id: string) {
  const db = await database();
  await db.runAsync('DELETE FROM map_outbox WHERE owner = ? AND id = ?', owner, id);
}

export async function loadPrivatePlaces(owner: string): Promise<MapPlace[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ body: string }>('SELECT body FROM private_places WHERE owner=? ORDER BY rowid', owner);
  return rows.flatMap(({ body }) => {
    try { const p: unknown = JSON.parse(body); return isMapPlace(p) && p.kind === 'personal' ? [p] : []; }
    catch { return []; }
  });
}
export async function savePrivatePlace(owner: string, place: MapPlace) {
  const db = await database();
  await db.runAsync('INSERT OR REPLACE INTO private_places VALUES (?, ?, ?)', owner, place.id, JSON.stringify(place));
}
export async function removePrivatePlace(owner: string, id: string) {
  const db = await database();
  await db.runAsync('DELETE FROM private_places WHERE owner=? AND id=?', owner, id);
}
export async function loadSharedPlaces(): Promise<MapPlaceSnapshot | undefined> {
  const db = await database();
  const row = await db.getFirstAsync<{ body: string }>('SELECT body FROM shared_places_cache WHERE slot=1');
  try { const value: unknown = row ? JSON.parse(row.body) : undefined; return isMapPlaceSnapshot(value) ? value : undefined; }
  catch { return undefined; }
}
export async function cacheSharedPlaces(snapshot: MapPlaceSnapshot) {
  const db = await database();
  await db.runAsync('INSERT OR REPLACE INTO shared_places_cache VALUES (1, ?)', JSON.stringify(snapshot));
}

export async function movePrivatePlace(owner: string, place: MapPlace, point: MapPoint) {
  const db = await database();
  const result = await db.runAsync('UPDATE private_places SET body=? WHERE owner=? AND id=?',
    JSON.stringify({ ...place, point }), owner, place.id);
  if (!result.changes) throw new Error('This private pin was removed.');
}
