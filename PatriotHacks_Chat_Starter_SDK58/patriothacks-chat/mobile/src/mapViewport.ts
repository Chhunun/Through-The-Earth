import type { MapPoint } from '@patriot/protocol';
export type Viewport = { center: MapPoint; scale: number };
export type ScreenPoint = { x: number; y: number };
export function gestureViewport(start: Viewport, anchor: ScreenPoint, finger: ScreenPoint,
  ratio: number, width: number, height: number, longitudeMeters: number): Viewport {
  const scale = Math.max(0.125, Math.min(16, start.scale * ratio));
  const longitude = start.center.longitude + (anchor.x - width / 2) / (longitudeMeters * start.scale)
    - (finger.x - width / 2) / (longitudeMeters * scale);
  const latitude = start.center.latitude - (anchor.y - height / 2) / (111320 * start.scale)
    + (finger.y - height / 2) / (111320 * scale);
  return { center: { latitude: Math.max(-89.9999, Math.min(89.9999, latitude)),
    longitude: Math.max(-180, Math.min(180, longitude)) }, scale };
}
