import { openDatabaseAsync } from 'expo-sqlite';
import { isWalkPath, type WalkPath } from '@patriot/protocol';

async function database() {
  const db = await openDatabaseAsync('patriot-map.db');
  await db.execAsync('CREATE TABLE IF NOT EXISTS paths (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  await db.execAsync('CREATE TABLE IF NOT EXISTS map_outbox (owner TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (owner, id))');
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
