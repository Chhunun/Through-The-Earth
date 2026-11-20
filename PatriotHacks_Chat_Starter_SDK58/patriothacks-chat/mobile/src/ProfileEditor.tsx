import { useState } from 'react';
import term from './terminal-colors.json';
import { Pressable, Text, TextInput, View } from 'react-native';
import { parseChatProfile, rooms, type ChatProfile, type Room } from '@patriot/protocol';

type Props = {
  profile?: ChatProfile;
  online: boolean;
  save: (profile: ChatProfile) => Promise<void>;
  close?: () => void;
  submitLabel?: string;
};

export default function ProfileEditor({ profile, online, save, close, submitLabel = 'Save profile' }: Props) {
  const [name, setName] = useState(profile?.name ?? '');
  const [level, setLevel] = useState<Room | undefined>(profile?.level);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next = parseChatProfile({ name, level });
    if (!next || busy || !online) return;
    setBusy(true);
    setError('');
    try {
      await save(next);
      close?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <View className="gap-2">
      <TextInput accessibilityLabel="Display name" placeholder="Display name" placeholderTextColor={term.muted}
        autoCapitalize="words" maxLength={40} value={name} onChangeText={setName}
        className="font-mono rounded-sm bg-term-field border border-term-line p-3 text-term-text" />
      <Text className="font-mono text-term-dim">Home level</Text>
      <View className="flex-row flex-wrap gap-2">
        {rooms.map((option) => (
          <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: level === option }}
            className={level === option ? 'rounded-sm bg-term-active border border-term-text p-2' : 'rounded-sm bg-term-field border border-term-line p-2'}
            onPress={() => setLevel(option)}>
            <Text className="font-mono text-term-text">{option}</Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row gap-2">
        <Pressable accessibilityRole="button" disabled={busy || !online || !name.trim() || !level}
          className="rounded-sm bg-term-active border border-term-text p-2 disabled:opacity-50" onPress={submit}>
          <Text className="font-mono font-semibold text-term-text">{busy ? 'Saving…' : submitLabel}</Text>
        </Pressable>
        {close ? <Pressable accessibilityRole="button" disabled={busy} className="p-2" onPress={close}>
          <Text className="font-mono text-term-text">Cancel</Text>
        </Pressable> : null}
      </View>
      {error ? <Text className="font-mono text-rose-300">{error}</Text> : null}
    </View>
  );
}
