import { Text, View } from 'react-native';
import type { LevelTemperature } from '@patriot/protocol';

const coldF = 40;
const hotF = 120;
const colors = ['#7db5da', '#8ad6d1', '#b9e3d7', '#e7efc6', '#fff3ac', '#ffe29b', '#ffcb8c', '#f5a47e'];

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
      className="gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2">
      <View className="flex-row flex-wrap items-center justify-between gap-1">
        <Text className="text-xs font-semibold text-slate-100">Temperature</Text>
        <Text className="text-xs text-slate-200">{label}{measured && !online ? ' · Last received' : ''}</Text>
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
          borderColor: '#020617',
          backgroundColor: '#ffffff',
        }} /> : null}
      </View>
      <View className="flex-row justify-between">
        <Text className="text-[10px] text-slate-400">{coldF} °F</Text>
        <Text className="text-[10px] text-slate-400">80 °F</Text>
        <Text className="text-[10px] text-slate-400">{hotF} °F</Text>
      </View>
    </View>
  );
}
