import ReportCharts from './ReportCharts';
import term from './terminal-colors.json';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { parseLevelReport, profileLabel, type ChatProfiles, reportQuestions, type LevelReport, type LevelReportView } from '@patriot/protocol';

type Props = {
  online: boolean;
  ownKey: string;
  profiles: ChatProfiles;
  load: (report?: LevelReport) => Promise<LevelReportView>;
};

export default function Announcements({ online, ownKey, profiles, load }: Props) {
  const [view, setView] = useState<LevelReportView>();
  const [answers, setAnswers] = useState<LevelReport['answers']>({});
  const [temperature, setTemperature] = useState('');
  const [busy, setBusy] = useState(false);
  const [visibleReports, setVisibleReports] = useState(5);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!online) return;
    let active = true;
    setBusy(true);
    setStatus('');
    load().then((result) => {
      if (!active) return;
      setView(result);
      setAnswers(result.own.answers);
      setTemperature(result.own.temperatureF?.toString() ?? '');
    }).catch(() => {
      if (active) setStatus('Could not load reports. Check that the updated relay is running.');
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [online, load]);

  async function update(submit: boolean) {
    setBusy(true);
    setStatus('');
    try {
      const result = await load(submit ? parseLevelReport(answers, temperature) : undefined);
      setView(result);
      if (submit) setStatus('Report saved. It appears under Submitted reports.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16 }}
      keyboardShouldPersistTaps="handled">
      <Text className="font-mono text-xl font-semibold text-term-text">Level conditions</Text>
      <Text className="font-mono text-term-dim">
        Share what you observed. Tap a selected answer again to clear it. Submitting replaces your previous report for this level.
      </Text>
      {view ? <ReportCharts summary={view.summary} /> : null}
      <View className="gap-2">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text className="font-mono text-lg font-semibold text-term-text">Submitted reports</Text>
          <Pressable accessibilityRole="button" disabled={!online || busy} onPress={() => update(false)}
            className="rounded-sm bg-term-field border border-term-line p-2 disabled:opacity-50">
            <Text className="font-mono text-term-text">Refresh reports</Text>
          </Pressable>
        </View>
        <Text className="font-mono text-term-muted">Reports are visible with your profile and public chat ID.</Text>
        {view && view.recent.length === 0 ? <Text className="font-mono text-term-dim">No reports for this level yet.</Text> : null}
        {view?.recent.slice(0, visibleReports).map((report) => (
          <View key={report.reporter} className="gap-1 rounded-sm bg-term-field border border-term-line p-3">
            <Text className="font-mono font-semibold text-term-text">{profiles[report.reporter] ? profileLabel(profiles[report.reporter]) : report.reporter === ownKey ? 'You' : 'Reporter'}</Text>
            <Text selectable className="font-mono text-xs text-term-dim">{report.reporter}</Text>
            <Text className="font-mono text-xs text-term-muted">{new Date(report.submittedAt).toLocaleString()}</Text>
            {reportQuestions.map(({ id, label }) => report.answers[id]
              ? <Text key={id} className="font-mono text-term-text">{label} · {report.answers[id]}</Text>
              : null)}
            {report.temperatureF !== undefined
              ? <Text className="font-mono text-term-text">Measured temperature · {report.temperatureF} °F</Text>
              : null}
          </View>
        ))}
        {view && view.recent.length > visibleReports ? (
          <Pressable accessibilityRole="button" onPress={() => setVisibleReports((count) => count + 5)}
            className="self-start rounded-sm bg-term-field border border-term-line p-2">
            <Text className="font-mono text-term-text">Show more reports</Text>
          </Pressable>
        ) : null}
      </View>
      <Text className="font-mono text-lg font-semibold text-term-text">Your report</Text>
      {reportQuestions.map(({ id, label, choices }) => (
        <View key={id} className="gap-2">
          <Text className="font-mono font-semibold text-term-text">{label}</Text>
          <View className="flex-row flex-wrap gap-2">
            {choices.map((choice) => {
              const selected = answers[id] === choice;
              return (
                <Pressable key={choice} accessibilityRole="button" accessibilityState={{ selected }}
                  disabled={busy}
                  className={selected ? 'rounded-sm bg-term-active border border-term-text px-3 py-2' : 'rounded-sm bg-term-field border border-term-line px-3 py-2'}
                  onPress={() => setAnswers((current) => {
                    const next = { ...current };
                    if (next[id] === choice) delete next[id];
                    else next[id] = choice;
                    return next;
                  })}>
                  <Text className="font-mono text-term-text">{choice}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <TextInput accessibilityLabel="Measured temperature in Fahrenheit" placeholder="Measured temperature (°F, optional)"
        placeholderTextColor={term.muted} keyboardType="numbers-and-punctuation" editable={!busy}
        className="font-mono rounded-sm bg-term-field border border-term-line p-3 text-term-text" value={temperature} onChangeText={setTemperature} />
      {view ? <Text className="font-mono text-term-dim">
        {view.summary.reports} reports
      </Text> : null}
      <View className="flex-row flex-wrap gap-2">
        <Pressable accessibilityRole="button" disabled={!online || busy} onPress={() => update(true)}
          className="rounded-sm bg-term-active border border-term-text p-3 disabled:opacity-50">
          <Text className="font-mono font-semibold text-term-text">Submit report</Text>
        </Pressable>
      </View>
      {status ? <Text accessibilityLiveRegion="polite" className="font-mono text-term-text">{status}</Text> : null}
    </ScrollView>
  );
}
