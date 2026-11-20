import { isMapPoint, type MapPoint } from '@patriot/protocol';
import { pointOnMap } from './mapMarkerLayout';
export type DropFrame = { x: number; y: number; width: number; height: number;
  center: MapPoint; longitudeMeters: number; scale: number };
export function blockPlacementPoint(drop: { x: number; y: number } | undefined, frame: DropFrame | undefined,
  position: MapPoint | undefined, stale: boolean): MapPoint {
  if (!drop) {
    if (!position || stale) throw new Error('Wait for a fresh location fix before marking a passage at your location.');
    return { latitude: position.latitude, longitude: position.longitude };
  }
  if (!frame || Math.abs(frame.longitudeMeters) < 1) throw new Error('Allow location access or open an existing map before dragging a block.');
  const x = drop.x - frame.x, y = drop.y - frame.y;
  if (x < 0 || y < 0 || x > frame.width || y > frame.height) throw new Error('Drop the passage marker inside the map.');
  const point = pointOnMap(x, y, frame.center, frame.width, frame.height, frame.longitudeMeters, frame.scale);
  if (!isMapPoint(point)) throw new Error('This point is outside the supported map area.');
  return point;
}
