import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { parseChatProfile, rooms, type ChatProfile, type Room } from '@patriot/protocol';

type Props = {
  profile?: ChatProfile;
  online: boolean;
  save: (profile: ChatProfile) => Promise<void>;
  close: () => void;
};

export default function ProfileEditor({ profile, online, save, close }: Props) {
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
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <View className="gap-2">
      <TextInput accessibilityLabel="Display name" placeholder="Display name" placeholderTextColor="#a1a1aa"
        autoCapitalize="words" maxLength={40} value={name} onChangeText={setName}
        className="rounded-lg bg-zinc-800 p-3 text-white" />
      <Text className="text-zinc-300">Home level</Text>
      <View className="flex-row flex-wrap gap-2">
        {rooms.map((option) => (
          <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: level === option }}
            className={level === option ? 'rounded-md bg-sky-800 p-2' : 'rounded-md bg-zinc-800 p-2'}
            onPress={() => setLevel(option)}>
            <Text className="text-white">{option}</Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row gap-2">
        <Pressable accessibilityRole="button" disabled={busy || !online || !name.trim() || !level}
          className="rounded-md bg-sky-800 p-2 disabled:opacity-50" onPress={submit}>
          <Text className="font-semibold text-white">Save profile</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} className="p-2" onPress={close}>
          <Text className="text-white">Cancel</Text>
        </Pressable>
      </View>
      {error ? <Text className="text-rose-300">{error}</Text> : null}
    </View>
  );
}
