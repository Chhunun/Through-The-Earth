import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mapDistance, mapRulerStep } from './mapScale';

type Props = {
  width: number;
  height: number;
  scale: number;
  zoom: (scale: number) => void;
  heading?: number;
};

export default function MapControls({ width, height, scale, zoom, heading }: Props) {
  const step = mapRulerStep(scale);
  const spacing = step * scale;
  const left = 46;
  const bottom = 28;
  // Leave room for the compass and zoom controls at the ends of the rulers.
  const horizontal = Math.max(0, width - left - 62);
  const vertical = Math.max(0, height - bottom - 84);
  const xTicks = Array.from({ length: Math.floor(horizontal / spacing) + 1 }, (_, index) => index);
  const yTicks = Array.from({ length: Math.floor(vertical / spacing) + 1 }, (_, index) => index);

  return (
    <>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.horizontal, { left, bottom, width: horizontal }]} />
        <View style={[styles.vertical, { left, bottom, height: vertical }]} />
        {xTicks.map((index) => (
          <View key={'x' + index} style={{ position: 'absolute', left: left + index * spacing, bottom }}>
            <View style={styles.xTick} />
            <Text style={[styles.label, { left: -20, top: 7, width: 52, textAlign: 'center' }]}>
              {mapDistance(index * step)}
            </Text>
          </View>
        ))}
        {yTicks.filter((index) => index > 0).map((index) => (
          <View key={'y' + index} style={{ position: 'absolute', left, bottom: bottom + index * spacing }}>
            <View style={styles.yTick} />
            <Text style={[styles.label, { right: 7, top: -7, width: 42, textAlign: 'right' }]}>
              {mapDistance(index * step)}
            </Text>
          </View>
        ))}
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
  horizontal: { position: 'absolute', height: 1, backgroundColor: '#cbd5e1' },
  vertical: { position: 'absolute', width: 1, backgroundColor: '#cbd5e1' },
  xTick: { position: 'absolute', top: -5, height: 6, width: 1, backgroundColor: '#cbd5e1' },
  yTick: { position: 'absolute', left: 0, height: 1, width: 6, backgroundColor: '#cbd5e1' },
  label: { position: 'absolute', color: '#e2e8f0', fontSize: 9, backgroundColor: '#0f172a' },
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
