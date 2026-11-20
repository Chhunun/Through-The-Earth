import type { MapPlace, MapPoint } from '@patriot/protocol';
export type ScreenPlace = { place: MapPlace; x: number; y: number };
export function pointOnMap(x: number, y: number, center: MapPoint, width: number, height: number, longitudeMeters: number, scale: number): MapPoint {
  return { longitude: center.longitude + (x - width / 2) / (longitudeMeters * scale),
    latitude: center.latitude - (y - height / 2) / (111320 * scale) };
}
// Group touching marker footprints at the current zoom. Sorting keeps stack order stable.
export function stackMapPlaces(input: ScreenPlace[]): ScreenPlace[][] {
  const items = [...input].sort((a, b) => a.place.id.localeCompare(b.place.id));
  const parent = items.map((_, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const cells = new Map<string, number[]>();
  items.forEach((item, i) => {
    const x = Math.floor(item.x / 40), y = Math.floor(item.y / 40);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of cells.get((x + dx) + ':' + (y + dy)) ?? []) {
        if (Math.abs(item.x - items[j].x) < 40 && Math.abs(item.y - items[j].y) < 38) parent[root(i)] = root(j);
      }
    }
    const key = x + ':' + y;
    cells.set(key, [...(cells.get(key) ?? []), i]);
  });
  const groups = new Map<number, ScreenPlace[]>();
  items.forEach((item, i) => { const key = root(i); groups.set(key, [...(groups.get(key) ?? []), item]); });
  return [...groups.values()];
}
