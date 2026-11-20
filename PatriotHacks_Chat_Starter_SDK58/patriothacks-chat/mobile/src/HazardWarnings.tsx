import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  hazardKinds, hazardLabels, parseWarningRequest, rooms, warningActiveMinutes, warningNoteLimit,
  type HazardKind, type HazardWarning, type Room, type WarningRequest, type WarningSnapshot,
} from '@patriot/protocol';
import { clearWarning, raiseWarning } from './chat';
import term from './terminal-colors.json';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Warning actions for any screen. They go through the chat screen's open relay session.
// Confirm adds your report to someone else's warning; Clear mine withdraws only yours.
export function useWarningActions() {
  const [busy, setBusy] = useState(false);
  async function update(warning: HazardWarning, mine: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (mine) await clearWarning(warning.level, warning.kind);
      else await raiseWarning({ level: warning.level, kind: warning.kind, note: '' });
    } catch (cause) {
      Alert.alert('Warning not updated', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return {
    busy,
    raise: raiseWarning,
    confirm: (warning: HazardWarning) => { void update(warning, false); },
    clear: (warning: HazardWarning) => { void update(warning, true); },
  };
}

// The warning system's entry point. Amber like the other alerts.
export function RaiseWarningButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Raise a warning about an air cutout or bad water"
               disabled={disabled} onPress={onPress}
               className="self-start rounded-sm border border-amber-500 bg-amber-950 px-3 py-2 disabled:opacity-50">
      <Text className="font-mono font-semibold text-amber-100">⚠ Raise warning</Text>
    </Pressable>
  );
}

type BannerProps = {
  warnings: WarningSnapshot;
  ownKey: string;
  online: boolean;
  // The resident's home level, marked "your level" in the list.
  homeLevel?: Room;
  // Leave both out for a read-only banner.
  confirm?: (warning: HazardWarning) => void;
  clear?: (warning: HazardWarning) => void;
  busy?: boolean;
};

// Active hazard warnings for every level. Shown on every signed-in screen.
// Warnings stay amber (air cutouts in rose) like the other alerts, so they never blend into the green theme.
export function WarningBanner({ warnings, ownKey, online, homeLevel, confirm, clear, busy }: BannerProps) {
  if (!warnings.length) return null;
  return (
    <View accessibilityLiveRegion="polite" className="mx-3 mt-2 gap-1 rounded-sm border border-amber-500 bg-amber-950 px-3 py-2">
      <Text accessibilityRole="header" className="font-mono uppercase tracking-widest font-bold text-amber-100">⚠ Active warnings</Text>
      {!online ? <Text className="font-mono text-xs text-amber-200">Relay offline · Showing last received warnings</Text> : null}
      <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
        {warnings.map((warning) => {
          const mine = warning.reporters.includes(ownKey);
          const count = warning.reporters.length;
          const label = hazardLabels[warning.kind];
          return (
            <View key={warning.level + ':' + warning.kind} className="mb-2 gap-0.5">
              <Text className={warning.kind === 'air'
                  ? 'font-mono uppercase tracking-wider font-bold text-rose-200'
                  : 'font-mono uppercase tracking-wider font-bold text-amber-100'}>
                {warning.level} · {label}{warning.level === homeLevel ? ' · your level' : ''}
              </Text>
              <Text className="font-mono text-xs text-amber-200">
                {count} {count === 1 ? 'resident' : 'residents'}{mine ? ', including you' : ''} · latest {time(warning.latestAt)}
              </Text>
              {warning.note ? <Text className="font-mono text-xs text-amber-100">“{warning.note}”</Text> : null}
              {confirm && clear ? (
                <Pressable accessibilityRole="button" disabled={busy || !online}
                           accessibilityLabel={(mine ? 'Clear your ' : 'Confirm the ') + label + ' warning for ' + warning.level}
                           className="mt-1 self-start rounded-sm border border-amber-500 px-2 py-1 disabled:opacity-50"
                           onPress={() => (mine ? clear : confirm)(warning)}>
                  <Text className="font-mono text-xs font-semibold text-amber-100">{mine ? 'Clear mine' : 'Confirm'}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

type ModalProps = {
  visible: boolean;
  online: boolean;
  // Pre-selected level: the one being viewed, or the resident's home level.
  defaultLevel?: Room;
  submit: (request: WarningRequest) => Promise<void>;
  close: () => void;
};

export function RaiseWarningModal({ visible, online, defaultLevel, submit, close }: ModalProps) {
  const [kind, setKind] = useState<HazardKind>();
  const [level, setLevel] = useState<Room>(defaultLevel ?? rooms[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Start from a clean form every time it opens.
  useEffect(() => {
    if (!visible) return;
    setKind(undefined);
    setLevel(defaultLevel ?? rooms[0]);
    setNote('');
    setError('');
  }, [visible, defaultLevel]);

  async function send() {
    if (!kind || busy) return;
    const request = parseWarningRequest({ level, kind, note });
    if (!request) {
      setError('Keep the location note to ' + warningNoteLimit + ' characters on one line.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submit(request);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) close(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                            style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#000c' }}>
        <View accessibilityViewIsModal className="gap-3 rounded border border-amber-500 bg-term-panel p-5">
          <Text accessibilityRole="header" className="font-mono uppercase tracking-widest text-lg font-bold text-amber-100">⚠ Raise a warning</Text>
          <Text className="font-mono text-xs text-term-dim">
            Every signed-in resident sees it, labelled with the level. It lasts {warningActiveMinutes} minutes unless you clear it or raise it again.
          </Text>
          <Text className="font-mono font-semibold text-term-text">What’s happening?</Text>
          <View className="flex-row flex-wrap gap-2">
            {hazardKinds.map((option) => (
              <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: kind === option }}
                         disabled={busy} onPress={() => setKind(option)}
                         className={kind === option
                           ? 'rounded-sm border border-amber-500 bg-amber-900 px-3 py-2'
                           : 'rounded-sm bg-term-field border border-term-line px-3 py-2'}>
                <Text className={kind === option ? 'font-mono font-semibold text-amber-100' : 'font-mono text-term-text'}>{hazardLabels[option]}</Text>
              </Pressable>
            ))}
          </View>
          <Text className="font-mono font-semibold text-term-text">Which level?</Text>
          <View className="flex-row flex-wrap gap-2">
            {rooms.map((option) => (
              <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: level === option }}
                         disabled={busy} onPress={() => setLevel(option)}
                         className={level === option
                           ? 'rounded-sm bg-term-active border border-term-text px-3 py-2'
                           : 'rounded-sm bg-term-field border border-term-line px-3 py-2'}>
                <Text className="font-mono text-term-text">{option}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput accessibilityLabel="Where on the level (optional)" value={note} onChangeText={setNote}
                     maxLength={warningNoteLimit} editable={!busy} placeholder="Where? e.g. east pump room (optional)"
                     placeholderTextColor={term.muted} className="font-mono rounded-sm bg-term-field border border-term-line p-3 text-term-text" />
          {!online ? <Text className="font-mono text-xs text-amber-200">Relay offline · Warnings need a connection to reach others.</Text> : null}
          {error ? <Text className="font-mono text-rose-300">{error}</Text> : null}
          <View className="flex-row flex-wrap gap-2">
            <Pressable accessibilityRole="button" disabled={!kind || busy || !online} onPress={() => { void send(); }}
                       className="rounded-sm border border-amber-500 bg-amber-900 px-4 py-3 disabled:opacity-50">
              <Text className="font-mono font-semibold text-amber-100">{busy ? 'Sending…' : 'Send warning'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={close}
                       className="rounded-sm bg-term-field border border-term-line px-4 py-3">
              <Text className="font-mono text-term-text">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
