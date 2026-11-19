import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { isWalkPath, type Ack, type WalkPath } from '@patriot/protocol';

// Fail startup on database errors rather than silently replacing saved maps.
const db = new DatabaseSync(process.env.PATRIOT_MAP_DATABASE ?? fileURLToPath(new URL('./maps.sqlite', import.meta.url)));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS map_paths (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
const find = db.prepare('SELECT body FROM map_paths WHERE id = ?');
const insert = db.prepare('INSERT INTO map_paths (id, body) VALUES (?, ?)');
const count = db.prepare('SELECT COUNT(*) AS total FROM map_paths');

export function readMap(): WalkPath[] {
  return db.prepare('SELECT body FROM map_paths ORDER BY rowid').all().map((row) => {
    const path: unknown = JSON.parse(String(row.body));
    if (!isWalkPath(path)) throw new Error('Invalid path in map database');
    return path;
  });
}

export function storeMapPath(path: WalkPath): Ack {
  // Normalize fields so retries compare coordinates, not JSON property order.
  const body = JSON.stringify({ id: path.id, level: path.level,
    points: path.points.map(({ latitude, longitude }) => ({ latitude, longitude })) });
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = find.get(path.id);
    let result: Ack;
    if (existing) result = existing.body === body ? { ok: true } : { ok: false, error: 'Path ID already used' };
    else if (Number(count.get()?.total) >= 1000) result = { ok: false, error: 'The shared map has reached its path limit.' };
    else { insert.run(path.id, body); result = { ok: true }; }
    db.exec('COMMIT');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
