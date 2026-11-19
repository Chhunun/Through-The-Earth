import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mapDistance, mapRulerStep } from './mapScale';

type Props = {
  width: number;
  scale: number;
  zoom: (scale: number) => void;
  heading?: number;
};

export default function MapControls({ width, scale, zoom, heading }: Props) {
  // Choose a readable distance whose on-screen length fits beside the zoom buttons.
  const maxLength = Math.max(30, Math.min(125, width - 100));
  let step = mapRulerStep(scale);
  while (step * scale > maxLength) step /= 2;
  const barWidth = step * scale;

  return (
    <>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View accessible accessibilityLabel={'Scale bar represents ' + mapDistance(step)}
          style={styles.scale}>
          <Text style={styles.scaleLabel}>{mapDistance(step)}</Text>
          <View style={[styles.scaleLine, { width: barWidth }]}>
            <View style={[styles.scaleCap, { left: 0 }]} />
            <View style={[styles.scaleCap, { right: 0 }]} />
          </View>
        </View>
        <View accessible accessibilityLabel={heading === undefined ? 'Compass heading unavailable' : 'Heading ' + Math.round(heading) + ' degrees'}
          style={styles.compass}>
          <Text style={styles.direction}>▲</Text>
          <View style={{ alignItems: 'center', transform: [{ rotate: -(heading ?? 0) + 'deg' }] }}>
            <Text style={styles.north}>N</Text>
            <View style={styles.compassRow}>
              <Text style={styles.direction}>W</Text>
              <Text style={styles.needle}>↑</Text>
              <Text style={styles.direction}>E</Text>
            </View>
            <Text style={styles.direction}>S</Text>
          </View>
          <Text style={styles.direction}>{heading === undefined ? '—' : Math.round(heading) + '°'}</Text>
        </View>
      </View>
      <View style={styles.zoom}>
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" disabled={scale >= 16}
          style={[styles.button, scale >= 16 && styles.disabled]}
          onPress={() => zoom(Math.min(16, scale * 2))}>
          <Text style={styles.symbol}>+</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" disabled={scale <= 0.125}
          style={[styles.button, scale <= 0.125 && styles.disabled]}
          onPress={() => zoom(Math.max(0.125, scale / 2))}>
          <Text style={styles.symbol}>−</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scale: { position: 'absolute', left: 10, bottom: 10, padding: 7, borderRadius: 4,
    backgroundColor: '#e2e8f0' },
  scaleLabel: { color: '#0f172a', fontSize: 10, marginBottom: 3 },
  scaleLine: { height: 6, borderBottomWidth: 2, borderBottomColor: '#0f172a' },
  scaleCap: { position: 'absolute', bottom: -2, height: 6, width: 2, backgroundColor: '#0f172a' },
  compass: { position: 'absolute', right: 10, top: 10, width: 62, paddingVertical: 4,
    borderRadius: 30, borderWidth: 1, borderColor: '#475569', backgroundColor: '#0f172a', alignItems: 'center' },
  compassRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  north: { color: '#fb7185', fontSize: 11, fontWeight: '700' },
  direction: { color: '#cbd5e1', fontSize: 10 },
  needle: { color: '#fb7185', fontSize: 20, lineHeight: 24 },
  zoom: { position: 'absolute', right: 8, bottom: 8, backgroundColor: '#1e293b',
    borderRadius: 10, borderWidth: 1, borderColor: '#64748b', overflow: 'hidden' },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
  symbol: { color: '#f8fafc', fontSize: 26, lineHeight: 30 },
  divider: { height: 1, backgroundColor: '#475569' },
});
