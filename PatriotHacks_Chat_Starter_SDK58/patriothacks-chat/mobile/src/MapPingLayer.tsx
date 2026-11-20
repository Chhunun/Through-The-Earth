import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import type { MapPoint } from '@patriot/protocol';
import type { MapPing } from '../../shared/mapPings';

function Pulse({ ping, x, y }: { ping: MapPing; x: number; y: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  const color = ping.emergency ? '#fb7185' : '#22d3ee';
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }));
    animation.start();
    return () => { animation.stop(); progress.setValue(0); };
  }, [progress]);
  return <View pointerEvents="none" style={{ position: 'absolute', left: x, top: y }}>
    <Animated.View style={{ position: 'absolute', left: -24, top: -24, width: 48, height: 48,
      borderRadius: 24, borderWidth: 2, borderColor: color,
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
      transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.25, 2.5] }) }] }} />
    <View style={{ position: 'absolute', left: -6, top: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: color, borderWidth: 2, borderColor: '#fff' }} />
    <Text numberOfLines={1} style={{ position: 'absolute', left: 10, top: -12, maxWidth: 150,
      paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, color, backgroundColor: '#020617', fontWeight: 'bold', fontSize: 12 }}>
      {ping.emergency ? 'SOS · ' : ''}{ping.name}
    </Text>
  </View>;
}
export default function MapPingLayer({ pings, center, originLatitude, scale, width, height }: {
  pings: MapPing[]; center?: MapPoint; originLatitude: number; scale: number; width: number; height: number;
}) {
  if (!center) return null;
  const longitudeMeters = 111320 * Math.cos(originLatitude * Math.PI / 180);
  return <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
    {pings.map((ping) => {
      const x = width / 2 + (ping.point.longitude - center.longitude) * longitudeMeters * scale;
      const y = height / 2 - (ping.point.latitude - center.latitude) * 111320 * scale;
      if (x < -80 || y < -80 || x > width + 80 || y > height + 80) return null;
      return <Pulse key={ping.id} ping={ping} x={x} y={y} />;
    })}
  </View>;
}
