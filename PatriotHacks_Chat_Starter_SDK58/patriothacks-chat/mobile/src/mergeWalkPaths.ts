import type { MapPoint, WalkPath } from '@patriot/protocol';

type XY = { x: number; y: number };
type Piece = { a: XY; b: XY; mid: XY; dx: number; dy: number; path: string };
export type MergedWalkSegment = { id: string; from: MapPoint; to: MapPoint; recordings: number };

// Treat tracks within about 6.5 ft as observations of the same corridor.
// Keep a recorded line as the representative instead of inventing a new route.
const tolerance = 2;
const pieceLength = 2;
const minimumAlignment = Math.cos(25 * Math.PI / 180);

export function mergeWalkPaths(paths: readonly WalkPath[]): MergedWalkSegment[] {
  const unique = [...new Map(paths.map((path) => [path.id, path])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
  const origin = unique.find((path) => path.points.length)?.points[0];
  if (!origin) return [];
  const longitudeMeters = 111320 * Math.cos(origin.latitude * Math.PI / 180);
  if (Math.abs(longitudeMeters) < 1) return [];
  const project = (point: MapPoint): XY => ({
    x: (point.longitude - origin.longitude) * longitudeMeters,
    y: (point.latitude - origin.latitude) * 111320,
  });
  const unproject = (point: XY): MapPoint => ({
    latitude: origin.latitude + point.y / 111320,
    longitude: origin.longitude + point.x / longitudeMeters,
  });
  const pieces: Piece[] = [];
  const buckets = new Map<string, number[]>();
  for (const path of unique) {
    for (let index = 1; index < path.points.length; index++) {
      const a = project(path.points[index - 1]);
      const b = project(path.points[index]);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      // Ignore duplicate fixes and large jumps that could bridge separate corridors.
      if (length < 0.05 || length > 50) continue;
      const count = Math.ceil(length / pieceLength);
      for (let part = 0; part < count; part++) {
        const start = { x: a.x + (b.x - a.x) * part / count, y: a.y + (b.y - a.y) * part / count };
        const end = { x: a.x + (b.x - a.x) * (part + 1) / count, y: a.y + (b.y - a.y) * (part + 1) / count };
        const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        const piece: Piece = { a: start, b: end, mid, dx: (b.x - a.x) / length, dy: (b.y - a.y) / length, path: path.id };
        const cell = Math.floor(mid.x / tolerance) + ':' + Math.floor(mid.y / tolerance);
        const entries = buckets.get(cell) ?? [];
        entries.push(pieces.length);
        buckets.set(cell, entries);
        pieces.push(piece);
      }
    }
  }
  function neighbors(piece: Piece) {
    const found: number[] = [];
    const x = Math.floor(piece.mid.x / tolerance);
    const y = Math.floor(piece.mid.y / tolerance);
    for (let i = x - 1; i <= x + 1; i++) {
      for (let j = y - 1; j <= y + 1; j++) {
        for (const index of buckets.get(i + ':' + j) ?? []) {
          const other = pieces[index];
          if (Math.hypot(piece.mid.x - other.mid.x, piece.mid.y - other.mid.y) <= tolerance
            && Math.abs(piece.dx * other.dx + piece.dy * other.dy) >= minimumAlignment) found.push(index);
        }
      }
    }
    return found;
  }
  const ranked = pieces.map((piece, index) => {
    const nearby = neighbors(piece);
    return { index, nearby, recordings: new Set(nearby.map((other) => pieces[other].path)).size };
  }).sort((a, b) => b.recordings - a.recordings || a.index - b.index);
  const hidden = new Set<number>();
  const result: MergedWalkSegment[] = [];
  for (const { index, nearby, recordings } of ranked) {
    if (hidden.has(index)) continue;
    const piece = pieces[index];
    result.push({ id: 'merged:' + index, from: unproject(piece.a), to: unproject(piece.b), recordings });
    // Remove alternative parallel lines, but retain adjoining pieces from this
    // recording so its route stays continuous. Crossing branches remain visible.
    for (const other of nearby) {
      if (pieces[other].path !== piece.path) hidden.add(other);
    }
  }
  return result;
}
