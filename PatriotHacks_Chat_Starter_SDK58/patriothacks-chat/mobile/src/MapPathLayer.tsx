import { memo, useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import type { MapPoint, WalkPath } from '@patriot/protocol';
import type { MergedWalkSegment } from './mergeWalkPaths';

type Props = {
  segments: MergedWalkSegment[];
  draft?: WalkPath;
  highlight?: WalkPath;
  center?: MapPoint;
  width: number;
  height: number;
  scale: number;
};

const Drawing = memo(function Drawing({ data, color, strokeWidth }: {
  data: string; color: string; strokeWidth: number;
}) {
  return <Path d={data} fill="none" stroke={color} strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" />;
});

export default memo(function MapPathLayer({ segments, draft, highlight, center, width, height, scale }: Props) {
  // Coordinates stay relative to a fixed origin. Moving the camera changes
  // only the SVG viewBox instead of rebuilding every native line view.
  const origin = segments[0]?.from ?? draft?.points[0];
  const latitude = origin?.latitude ?? 0;
  const longitude = origin?.longitude ?? 0;
  const longitudeMeters = 111320 * Math.cos(latitude * Math.PI / 180);
  const recorded = useMemo(() => {
    const normal: string[] = [];
    const repeated: string[] = [];
    const project = (point: MapPoint) =>
      ((point.longitude - longitude) * longitudeMeters).toFixed(2) + ',' +
      (-(point.latitude - latitude) * 111320).toFixed(2);
    for (const segment of segments) {
      (segment.recordings > 1 ? repeated : normal).push('M' + project(segment.from) + 'L' + project(segment.to));
    }
    return { normal: normal.join(''), repeated: repeated.join('') };
  }, [segments, latitude, longitude, longitudeMeters]);
  const live = useMemo(() => draft?.points.map((point, index) =>
    (index ? 'L' : 'M') + ((point.longitude - longitude) * longitudeMeters).toFixed(2) + ',' +
    (-(point.latitude - latitude) * 111320).toFixed(2)).join('') ?? '',
  [draft, latitude, longitude, longitudeMeters]);
  const selected = useMemo(() => highlight?.points.map((point, index) =>
    (index ? 'L' : 'M') + ((point.longitude - longitude) * longitudeMeters).toFixed(2) + ',' +
    (-(point.latitude - latitude) * 111320).toFixed(2)).join('') ?? '',
  [highlight, latitude, longitude, longitudeMeters]);
  if (!center || !origin) return null;
  const x = (center.longitude - longitude) * longitudeMeters;
  const y = -(center.latitude - latitude) * 111320;
  const viewWidth = width / scale;
  const viewHeight = height / scale;
  return <Svg pointerEvents="none" width={width} height={height}
    style={{ position: 'absolute', left: 0, top: 0 }}
    viewBox={`${x - viewWidth / 2} ${y - viewHeight / 2} ${viewWidth} ${viewHeight}`}>
    <Drawing data={recorded.normal} color="#9ca3af" strokeWidth={3 / scale} />
    <Drawing data={recorded.repeated} color="#d1d5db" strokeWidth={3 / scale} />
    <Drawing data={selected} color="#fbbf24" strokeWidth={5 / scale} />
    <Drawing data={live} color="#38bdf8" strokeWidth={3 / scale} />
  </Svg>;
});
