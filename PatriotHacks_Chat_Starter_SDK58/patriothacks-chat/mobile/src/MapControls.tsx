import { memo } from 'react';
import term from './terminal-colors.json';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mapDistance, mapRulerStep } from './mapScale';

type Props = {
  width: number;
  scale: number;
  zoom: (scale: number) => void;
  heading?: number;
};

export default memo(function MapControls({ width, scale, zoom, heading }: Props) {
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
          <Text className="font-mono" style={styles.scaleLabel}>{mapDistance(step)}</Text>
          <View style={[styles.scaleLine, { width: barWidth }]}>
            <View style={[styles.scaleCap, { left: 0 }]} />
            <View style={[styles.scaleCap, { right: 0 }]} />
          </View>
        </View>
        <View accessible accessibilityLabel={heading === undefined ? 'Compass heading unavailable' : 'Heading ' + Math.round(heading) + ' degrees'}
          style={styles.compass}>
          <Text className="font-mono" style={styles.direction}>▲</Text>
          <View style={{ alignItems: 'center', transform: [{ rotate: -(heading ?? 0) + 'deg' }] }}>
            <Text className="font-mono" style={styles.north}>N</Text>
            <View style={styles.compassRow}>
              <Text className="font-mono" style={styles.direction}>W</Text>
              <Text className="font-mono" style={styles.needle}>↑</Text>
              <Text className="font-mono" style={styles.direction}>E</Text>
            </View>
            <Text className="font-mono" style={styles.direction}>S</Text>
          </View>
          <Text className="font-mono" style={styles.direction}>{heading === undefined ? '—' : Math.round(heading) + '°'}</Text>
        </View>
      </View>
      <View style={styles.zoom}>
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" disabled={scale >= 16}
          style={[styles.button, scale >= 16 && styles.disabled]}
          onPress={() => zoom(Math.min(16, scale * 2))}>
          <Text className="font-mono" style={styles.symbol}>+</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" disabled={scale <= 0.125}
          style={[styles.button, scale <= 0.125 && styles.disabled]}
          onPress={() => zoom(Math.max(0.125, scale / 2))}>
          <Text className="font-mono" style={styles.symbol}>−</Text>
        </Pressable>
      </View>
    </>
  );
});

const styles = StyleSheet.create({
  scale: { position: 'absolute', left: 10, bottom: 10, padding: 7, borderRadius: 2,
    borderWidth: 1, borderColor: term.line, backgroundColor: term.panel },
  scaleLabel: { color: term.text, fontSize: 10, marginBottom: 3 },
  scaleLine: { height: 6, borderBottomWidth: 2, borderBottomColor: term.text },
  scaleCap: { position: 'absolute', bottom: -2, height: 6, width: 2, backgroundColor: term.text },
  compass: { position: 'absolute', right: 10, top: 10, width: 62, paddingVertical: 4,
    borderRadius: 30, borderWidth: 1, borderColor: term.line, backgroundColor: term.panel, alignItems: 'center' },
  compassRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  north: { color: '#fb7185', fontSize: 11, fontWeight: '700' },
  direction: { color: term.dim, fontSize: 10 },
  needle: { color: '#fb7185', fontSize: 20, lineHeight: 24 },
  zoom: { position: 'absolute', right: 8, bottom: 8, backgroundColor: term.field,
    borderRadius: 2, borderWidth: 1, borderColor: term.line, overflow: 'hidden' },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
  symbol: { color: term.text, fontSize: 26, lineHeight: 30 },
  divider: { height: 1, backgroundColor: term.line },
});
