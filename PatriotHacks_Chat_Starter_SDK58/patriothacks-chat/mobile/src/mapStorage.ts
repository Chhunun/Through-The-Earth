import { openDatabaseAsync } from 'expo-sqlite';
import { isWalkPath, type WalkPath } from '@patriot/protocol';

async function database() {
  const db = await openDatabaseAsync('patriot-map.db');
  await db.execAsync('CREATE TABLE IF NOT EXISTS paths (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
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
