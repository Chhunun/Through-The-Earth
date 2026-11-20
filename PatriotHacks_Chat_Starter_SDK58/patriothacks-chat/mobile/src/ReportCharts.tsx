import { StyleSheet, Text, View } from 'react-native';
import term from './terminal-colors.json';
import { reportPie, reportQuestions, type LevelReportSummary } from '@patriot/protocol';

const diameter = 96;
const radius = diameter / 2;

export default function ReportCharts({ summary }: { summary: LevelReportSummary }) {
  return (
    <View className="gap-3">
      <Text className="font-mono text-lg font-semibold text-term-text">Poll results</Text>
      {summary.reports === 0 ? <Text className="font-mono text-term-dim">No responses for this level yet.</Text> : null}
      {reportQuestions.map(({ id, label, choices }) => {
        const slices = reportPie(summary.counts[id]);
        if (!slices.length) return null;
        return (
          <View key={id} className="gap-2 rounded-sm bg-term-field border border-term-line p-3">
            <Text className="font-mono font-semibold text-term-text">{label}</Text>
            <View className="flex-row items-center gap-3">
              <View style={styles.pie} accessible={false}>
                {slices.flatMap(({ index, start, end, color }) => {
                  const sweep = end - start;
                  const halves = sweep > 180 ? [180, sweep - 180] : [sweep];
                  return halves.map((degrees, half) => (
                    <View key={index + ':' + half} style={[styles.disc, {
                      transform: [{ rotate: (start + half * 180) + 'deg' }],
                    }]}>
                      <View style={styles.clip}>
                        <View style={[styles.disc, { left: -radius,
                          transform: [{ rotate: (degrees - 180) + 'deg' }],
                        }]}>
                          <View style={[styles.half, { backgroundColor: color }]} />
                        </View>
                      </View>
                    </View>
                  ));
                })}
              </View>
              <View className="flex-1 gap-1">
                {slices.map(({ index, color, count, percent }) => (
                  <View key={index} className="flex-row items-center gap-2">
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
                    <Text className="font-mono flex-1 text-term-text">{choices[index]} · {count} ({percent}%)</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        );
      })}
      {summary.temperatureCount ? (
        <Text className="font-mono text-term-dim">
          Average measured temperature · {summary.averageTemperatureF?.toFixed(1)} °F ({summary.temperatureCount} readings)
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pie: { width: diameter, height: diameter, borderRadius: radius, backgroundColor: term.field, borderWidth: 1, borderColor: term.line },
  disc: { position: 'absolute', width: diameter, height: diameter },
  clip: { position: 'absolute', left: radius, width: radius, height: diameter, overflow: 'hidden' },
  half: { position: 'absolute', left: radius, width: radius, height: diameter,
    borderTopRightRadius: radius, borderBottomRightRadius: radius },
});
