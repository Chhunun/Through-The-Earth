import { Text, View } from 'react-native';
import term from './terminal-colors.json';
import type { LevelTemperature } from '@patriot/protocol';

const coldF = 40;
const hotF = 120;
const colors = ['#1f7a3a', '#2fa34f', '#4fd16b', '#8be36a', '#d4e157', '#ffd54f', '#ffa040', '#ff6040'];

export default function TemperatureBar({ reading, online }: { reading?: LevelTemperature; online: boolean }) {
  const average = reading?.averageF;
  const count = reading?.count ?? 0;
  const measured = typeof average === 'number';
  const marker = measured ? Math.max(0, Math.min(100, 100 * (average - coldF) / (hotF - coldF))) : 0;
  const label = measured
    ? average.toFixed(1) + ' °F · ' + count + (count === 1 ? ' reading' : ' readings')
    : reading ? 'No temperature reported' : online ? 'Loading temperature…' : 'Temperature unavailable offline';

  return (
    <View accessible accessibilityLabel={'Temperature. ' + label + (measured && !online ? '. Last received' : '')}
      className="gap-1 rounded-sm border border-term-line bg-term-panel px-2.5 py-2">
      <View className="flex-row flex-wrap items-center justify-between gap-1">
        <Text className="font-mono text-xs font-semibold text-term-text">Temperature</Text>
        <Text className="font-mono text-xs text-term-text">{label}{measured && !online ? ' · Last received' : ''}</Text>
      </View>
      <View className="relative h-2.5" style={{ opacity: measured ? 1 : 0.5 }}>
        <View className="h-full flex-row overflow-hidden rounded-full">
          {colors.map((color) => <View key={color} style={{ flex: 1, backgroundColor: color }} />)}
        </View>
        {measured ? <View style={{
          position: 'absolute',
          left: `${marker}%`,
          top: -2,
          width: 4,
          height: 14,
          marginLeft: -2,
          borderRadius: 2,
          borderWidth: 1,
          borderColor: term.bg,
          backgroundColor: term.glow,
        }} /> : null}
      </View>
      <View className="flex-row justify-between">
        <Text className="font-mono text-[10px] text-term-muted">{coldF} °F</Text>
        <Text className="font-mono text-[10px] text-term-muted">80 °F</Text>
        <Text className="font-mono text-[10px] text-term-muted">{hotF} °F</Text>
      </View>
    </View>
  );
}
