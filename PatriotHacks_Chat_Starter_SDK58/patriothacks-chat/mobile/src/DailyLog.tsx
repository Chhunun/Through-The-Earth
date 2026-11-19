import { useEffect, useState } from 'react';
import term from './terminal-colors.json';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { dailyLogDay, dailyLogDayLabel, dailyLogNotesLimit, dailyLogQuestions, type DailyLogAnswers, type DailyLogEntry } from '@patriot/protocol';
import { dailyLog, saveDailyLog } from './storage';

// A private daily record of sleep, mood, body health and food. Entries are stored on this
// device for the signed-in account and are never sent to the relay.
export default function DailyLog({ ownKey }: { ownKey: string }) {
  const [today] = useState(dailyLogDay);
  const [entries, setEntries] = useState<DailyLogEntry[]>([]);
  const [answers, setAnswers] = useState<DailyLogAnswers>({});
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    dailyLog(ownKey).then((list) => {
      if (!active) return;
      setEntries(list);
      const saved = list.find((entry) => entry.day === today);
      if (saved) {
        setAnswers(saved.answers);
        setNotes(saved.notes);
      }
    }).catch(() => {
      if (active) setStatus('Could not load your daily log.');
    }).finally(() => {
      if (active) setLoaded(true);
    });
    return () => { active = false; };
  }, [ownKey, today]);

  async function save() {
    if (!Object.keys(answers).length && !notes.trim()) {
      setStatus('Answer at least one question or add a note.');
      return;
    }
    const entry: DailyLogEntry = { day: today, answers, notes: notes.trim(), savedAt: Date.now() };
    setBusy(true);
    setStatus('');
    try {
      await saveDailyLog(ownKey, entry);
      setEntries((list) => [entry, ...list.filter((item) => item.day !== today)]);
      setStatus('Saved for ' + dailyLogDayLabel(today) + '.');
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const pastDays = entries.filter((entry) => entry.day !== today).slice(0, 14);

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16 }}
      keyboardShouldPersistTaps="handled">
      <Text className="font-mono text-xl font-semibold text-term-text">Daily log · {dailyLogDayLabel(today)}</Text>
      <Text className="font-mono text-term-dim">
        Only you can see this. It is saved on this device and is never sent to the relay. Tap a selected answer again to clear it.
      </Text>
      {dailyLogQuestions.map(({ id, label, choices }) => (
        <View key={id} className="gap-2">
          <Text className="font-mono font-semibold text-term-text">{label}</Text>
          <View className="flex-row flex-wrap gap-2">
            {choices.map((choice) => {
              const selected = answers[id] === choice;
              return (
                <Pressable key={choice} accessibilityRole="button" accessibilityState={{ selected }}
                  disabled={busy || !loaded}
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
      <TextInput accessibilityLabel="Notes" placeholder="Notes: what you ate, symptoms, anything else (optional)"
        placeholderTextColor={term.muted} multiline maxLength={dailyLogNotesLimit} editable={!busy && loaded}
        className="font-mono min-h-20 rounded-sm bg-term-field border border-term-line p-3 text-term-text" value={notes} onChangeText={setNotes} />
      <Pressable accessibilityRole="button" disabled={busy || !loaded} onPress={save}
        className="self-start rounded-sm bg-term-active border border-term-text p-3 disabled:opacity-50">
        <Text className="font-mono font-semibold text-term-text">{busy ? 'Saving…' : 'Save today'}</Text>
      </Pressable>
      {status ? <Text accessibilityLiveRegion="polite" className="font-mono text-term-text">{status}</Text> : null}
      <Text className="font-mono text-lg font-semibold text-term-text">Past days</Text>
      {loaded && !pastDays.length ? <Text className="font-mono text-term-muted">No earlier entries yet.</Text> : null}
      {pastDays.map((entry) => (
        <View key={entry.day} className="gap-1 rounded-sm bg-term-field border border-term-line p-3">
          <Text className="font-mono font-semibold text-term-text">{dailyLogDayLabel(entry.day)}</Text>
          {dailyLogQuestions.map(({ id, label }) => entry.answers[id]
            ? <Text key={id} className="font-mono text-term-text">{label} · {entry.answers[id]}</Text>
            : null)}
          {entry.notes ? <Text className="font-mono text-term-dim">{entry.notes}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}
