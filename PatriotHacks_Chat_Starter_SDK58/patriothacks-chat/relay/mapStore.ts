import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { isWalkPath, type Ack, type WalkPath, type SharedMapPlace, type MapPlaceSnapshot, type MapPoint } from '@patriot/protocol';

// Fail startup on database errors rather than silently replacing saved maps.
const db = new DatabaseSync(process.env.PATRIOT_MAP_DATABASE ?? fileURLToPath(new URL('./maps.sqlite', import.meta.url)));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS map_paths (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
// Upgrade existing databases without losing shared walks.
if (!db.prepare('PRAGMA table_info(map_paths)').all().some((row) => row.name === 'removed')) {
  db.exec('ALTER TABLE map_paths ADD COLUMN removed INTEGER NOT NULL DEFAULT 0');
}
const find = db.prepare('SELECT body, removed FROM map_paths WHERE id = ?');
const insert = db.prepare('INSERT INTO map_paths (id, body) VALUES (?, ?)');
const count = db.prepare('SELECT COUNT(*) AS total FROM map_paths WHERE removed=0');

export function readMap(): WalkPath[] {
  return db.prepare('SELECT body FROM map_paths WHERE removed=0 ORDER BY rowid').all().map((row) => {
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
    if (existing?.removed) result = { ok: false, error: 'PATH_REMOVED' };
    else if (existing) result = existing.body === body ? { ok: true } : { ok: false, error: 'Path ID already used' };
    else if (Number(count.get()?.total) >= 1000 || Number(db.prepare('SELECT COUNT(*) AS n FROM map_paths').get()?.n) >= 10000) result = { ok: false, error: 'The shared map has reached its path limit.' };
    else { insert.run(path.id, body); result = { ok: true }; }
    db.exec('COMMIT');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}


db.exec('CREATE TABLE IF NOT EXISTS map_places (id TEXT PRIMARY KEY, body TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS map_place_revision (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL); INSERT OR IGNORE INTO map_place_revision VALUES (1, 0)');
export function readMapPlaces(): MapPlaceSnapshot {
  return {
    revision: Number(db.prepare('SELECT revision FROM map_place_revision WHERE singleton=1').get()?.revision),
    places: db.prepare('SELECT body FROM map_places WHERE removed=0 ORDER BY rowid').all().map((row) => JSON.parse(String(row.body))),
  };
}
export function storeMapPlace(place: SharedMapPlace): Ack {
  const previous = db.prepare('SELECT body, removed FROM map_places WHERE id=?').get(place.id);
  if (previous) {
    // A retry must never resurrect a removed passage block.
    const saved: SharedMapPlace = JSON.parse(String(previous.body));
    return previous.removed ? { ok: false, error: 'This marker was already removed.' }
      : saved.kind === place.kind && saved.level === place.level && saved.label === place.label
        && saved.point.latitude === place.point.latitude && saved.point.longitude === place.point.longitude
        && saved.blackout === place.blackout ? { ok: true } : { ok: false, error: 'Marker ID already used.' };
  }
  if (Number(db.prepare('SELECT COUNT(*) AS n FROM map_places WHERE removed=0').get()?.n) >= 1000
    || Number(db.prepare('SELECT COUNT(*) AS n FROM map_places').get()?.n) >= 10000) {
    return { ok: false, error: 'Shared marker limit reached.' };
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO map_places (id, body) VALUES (?, ?)').run(place.id, JSON.stringify(place));
    db.exec('UPDATE map_place_revision SET revision=revision+1 WHERE singleton=1; COMMIT');
    return { ok: true };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function removeMapPlace(id: string): Ack {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare('UPDATE map_places SET removed=1 WHERE id=? AND removed=0').run(id);
    if (result.changes) db.exec('UPDATE map_place_revision SET revision=revision+1 WHERE singleton=1');
    db.exec('COMMIT');
    return { ok: true };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function moveMapPlace(id: string, from: MapPoint, to: MapPoint): Ack {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT body FROM map_places WHERE id=? AND removed=0').get(id);
    let result: Ack;
    if (!row) result = { ok: false, error: 'This marker was removed. Refresh the map.' };
    else {
      const place: SharedMapPlace = JSON.parse(String(row.body));
      if (place.point.latitude !== from.latitude || place.point.longitude !== from.longitude) {
        result = place.point.latitude === to.latitude && place.point.longitude === to.longitude
          ? { ok: true } : { ok: false, error: 'Someone already moved this marker. Try again from its new location.' };
      } else {
        place.point = to;
        db.prepare('UPDATE map_places SET body=? WHERE id=? AND removed=0').run(JSON.stringify(place), id);
        db.exec('UPDATE map_place_revision SET revision=revision+1 WHERE singleton=1');
        result = { ok: true };
      }
    }
    db.exec('COMMIT');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function readMapPathState() {
  return { paths: readMap(), deletedIds: db.prepare('SELECT id FROM map_paths WHERE removed=1 ORDER BY rowid').all().map((row) => String(row.id)) };
}
export function removeMapPath(id: string, level: string | undefined): Ack {
  if (!level) return { ok: false, error: 'Set your profile level before deleting shared paths.' };
  const row = db.prepare('SELECT body FROM map_paths WHERE id=?').get(id);
  if (!row) return { ok: false, error: 'Shared path not found.' };
  const path: WalkPath = JSON.parse(String(row.body));
  if (path.level !== level) return { ok: false, error: 'Only residents of this level can delete its shared paths.' };
  db.prepare('UPDATE map_paths SET removed=1 WHERE id=?').run(id);
  return { ok: true };
}
