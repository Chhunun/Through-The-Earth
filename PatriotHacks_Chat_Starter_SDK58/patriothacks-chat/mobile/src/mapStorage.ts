import { isMapPlace, isMapPlaceSnapshot, type MapPlace, type MapPlaceSnapshot, type MapPoint } from '@patriot/protocol';
import { openDatabaseAsync } from 'expo-sqlite';
import { isWalkPath, type WalkPath } from '@patriot/protocol';

async function database() {
  const db = await openDatabaseAsync('patriot-map.db');
  await db.execAsync('CREATE TABLE IF NOT EXISTS paths (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  await db.execAsync('CREATE TABLE IF NOT EXISTS map_outbox (owner TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (owner, id))');
  await db.execAsync('CREATE TABLE IF NOT EXISTS private_places (owner TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,id)); CREATE TABLE IF NOT EXISTS shared_places_cache (slot INTEGER PRIMARY KEY, body TEXT NOT NULL)');
  await db.execAsync('CREATE TABLE IF NOT EXISTS removed_map_paths (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS shared_map_paths (id TEXT PRIMARY KEY)');
  return db;
}
export async function loadMap() {
  const db = await database();
  const rows = await db.getAllAsync<{ body: string }>('SELECT body FROM paths WHERE id NOT IN (SELECT id FROM removed_map_paths) ORDER BY rowid');
  return rows.flatMap(({ body }) => {
    try { const path: unknown = JSON.parse(body); return isWalkPath(path) ? [path] : []; }
    catch { return []; }
  });
}
export async function saveMapPath(path: WalkPath) {
  const db = await database();
  await db.runAsync('INSERT OR IGNORE INTO paths SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM removed_map_paths WHERE id=?)', path.id, JSON.stringify(path), path.id);
}


// Only explicit Share path actions enter this queue. Cached maps never do.
export async function queueMapShare(owner: string, path: WalkPath) {
  const db = await database();
  if (await db.getFirstAsync('SELECT id FROM removed_map_paths WHERE id=?', path.id)) throw new Error('This path was removed from the shared map.');
  await db.runAsync('INSERT OR IGNORE INTO map_outbox (owner, id, body) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM removed_map_paths WHERE id=?)', owner, path.id, JSON.stringify(path), path.id);
}
export async function pendingMapShares(owner: string): Promise<WalkPath[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ body: string }>('SELECT body FROM map_outbox WHERE owner = ? AND id NOT IN (SELECT id FROM removed_map_paths) ORDER BY rowid', owner);
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

export async function loadRemovedPathIds(): Promise<string[]> {
  const db = await database();
  return (await db.getAllAsync<{ id: string }>('SELECT id FROM removed_map_paths')).map((row) => row.id);
}
export async function loadSharedPathIds(): Promise<string[]> {
  const db = await database();
  return (await db.getAllAsync<{ id: string }>('SELECT id FROM shared_map_paths WHERE id NOT IN (SELECT id FROM removed_map_paths)')).map((row) => row.id);
}
export async function cacheSharedPath(path: WalkPath) {
  const db = await database();
  await db.runAsync('INSERT OR IGNORE INTO shared_map_paths SELECT ? WHERE NOT EXISTS (SELECT 1 FROM removed_map_paths WHERE id=?)', path.id, path.id);
  await saveMapPath(path);
}
export async function forgetSharedPaths(ids: string[]) {
  if (!ids.length) return;
  const db = await database();
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    const placeholders = chunk.map(() => '?').join(',');
    // Tombstones first: delayed cache writes and queued sends cannot restore paths.
    await db.runAsync('INSERT OR IGNORE INTO removed_map_paths VALUES ' + chunk.map(() => '(?)').join(','), ...chunk);
    await db.runAsync('DELETE FROM paths WHERE id IN (' + placeholders + ')', ...chunk);
    await db.runAsync('DELETE FROM shared_map_paths WHERE id IN (' + placeholders + ')', ...chunk);
    await db.runAsync('DELETE FROM map_outbox WHERE id IN (' + placeholders + ')', ...chunk);
  }
}
export async function forgetSharedPath(id: string) {
  await forgetSharedPaths([id]);
}
