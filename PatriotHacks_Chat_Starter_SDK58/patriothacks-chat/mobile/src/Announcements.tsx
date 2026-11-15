import ReportCharts from './ReportCharts';
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
      <Text className="text-xl font-semibold text-white">Level conditions</Text>
      <Text className="text-zinc-300">
        Share what you observed. Tap a selected answer again to clear it. Submitting replaces your previous report for this level.
      </Text>
      {view ? <ReportCharts summary={view.summary} /> : null}
      <View className="gap-2">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text className="text-lg font-semibold text-white">Submitted reports</Text>
          <Pressable accessibilityRole="button" disabled={!online || busy} onPress={() => update(false)}
            className="rounded-lg bg-zinc-800 p-2 disabled:opacity-50">
            <Text className="text-white">Refresh reports</Text>
          </Pressable>
        </View>
        <Text className="text-zinc-400">Reports are visible with your profile and public chat ID.</Text>
        {view && view.recent.length === 0 ? <Text className="text-zinc-300">No reports for this level yet.</Text> : null}
        {view?.recent.slice(0, visibleReports).map((report) => (
          <View key={report.reporter} className="gap-1 rounded-lg bg-zinc-800 p-3">
            <Text className="font-semibold text-white">{profiles[report.reporter] ? profileLabel(profiles[report.reporter]) : report.reporter === ownKey ? 'You' : 'Reporter'}</Text>
            <Text selectable className="text-xs text-zinc-300">{report.reporter}</Text>
            <Text className="text-xs text-zinc-400">{new Date(report.submittedAt).toLocaleString()}</Text>
            {reportQuestions.map(({ id, label }) => report.answers[id]
              ? <Text key={id} className="text-zinc-100">{label} · {report.answers[id]}</Text>
              : null)}
            {report.temperatureF !== undefined
              ? <Text className="text-zinc-100">Measured temperature · {report.temperatureF} °F</Text>
              : null}
          </View>
        ))}
        {view && view.recent.length > visibleReports ? (
          <Pressable accessibilityRole="button" onPress={() => setVisibleReports((count) => count + 5)}
            className="self-start rounded-lg bg-zinc-800 p-2">
            <Text className="text-white">Show more reports</Text>
          </Pressable>
        ) : null}
      </View>
      <Text className="text-lg font-semibold text-white">Your report</Text>
      {reportQuestions.map(({ id, label, choices }) => (
        <View key={id} className="gap-2">
          <Text className="font-semibold text-white">{label}</Text>
          <View className="flex-row flex-wrap gap-2">
            {choices.map((choice) => {
              const selected = answers[id] === choice;
              return (
                <Pressable key={choice} accessibilityRole="button" accessibilityState={{ selected }}
                  disabled={busy}
                  className={selected ? 'rounded-md bg-sky-800 px-3 py-2' : 'rounded-md bg-zinc-800 px-3 py-2'}
                  onPress={() => setAnswers((current) => {
                    const next = { ...current };
                    if (next[id] === choice) delete next[id];
                    else next[id] = choice;
                    return next;
                  })}>
                  <Text className="text-white">{choice}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <TextInput accessibilityLabel="Measured temperature in Fahrenheit" placeholder="Measured temperature (°F, optional)"
        placeholderTextColor="#a1a1aa" keyboardType="numbers-and-punctuation" editable={!busy}
        className="rounded-lg bg-zinc-800 p-3 text-white" value={temperature} onChangeText={setTemperature} />
      {view ? <Text className="text-zinc-300">
        {view.summary.reports} reports
      </Text> : null}
      <View className="flex-row flex-wrap gap-2">
        <Pressable accessibilityRole="button" disabled={!online || busy} onPress={() => update(true)}
          className="rounded-lg bg-sky-800 p-3 disabled:opacity-50">
          <Text className="font-semibold text-white">Submit report</Text>
        </Pressable>
      </View>
      {status ? <Text accessibilityLiveRegion="polite" className="text-zinc-200">{status}</Text> : null}
    </ScrollView>
  );
}
