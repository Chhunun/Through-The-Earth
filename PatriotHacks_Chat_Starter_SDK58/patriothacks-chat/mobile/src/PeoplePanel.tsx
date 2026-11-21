import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { rooms, isPublicKey, type ChatProfiles } from '@patriot/protocol';

type Props = {
  visible: boolean;
  person?: string;
  select: (key: string | undefined) => void;
  close: () => void;
  ownKey: string;
  online: boolean;
  onlinePeople?: string[];
  profiles: ChatProfiles;
  direct: (key: string) => void;
};

export default function PeoplePanel(props: Props) {
  const { visible, person, select, close, ownKey, online, onlinePeople, profiles, direct } = props;
  const available = online && onlinePeople !== undefined;
  const members = [...new Set(onlinePeople ?? [])].filter((key) => profiles[key]);
  const name = person ? profiles[person]?.name ?? person.slice(0, 10) + '…' : '';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View className="flex-1 justify-center bg-black/70 p-6">
        <View accessibilityViewIsModal className="rounded-sm border border-term-line bg-term-panel p-4 gap-3" style={{ maxHeight: '80%' }}>
          <View className="flex-row items-center justify-between">
            <Text accessibilityRole="header" className="font-mono font-bold text-term-text">{person ? name : 'People online'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close people" onPress={close} className="p-3">
              <Text className="font-mono text-term-text">×</Text>
            </Pressable>
          </View>
          {person ? <>
            <Text className="font-mono text-term-muted">{profiles[person]?.level ?? 'Profile unavailable'}</Text>
            <Text className="font-mono text-xs text-term-dim">
              {!available ? 'Online status unavailable' : members.includes(person) ? 'Online' : 'Offline'}
            </Text>
            {person !== ownKey && isPublicKey(person) ? <Pressable accessibilityRole="button"
                onPress={() => direct(person)} className="rounded-sm border border-term-text bg-term-active p-3">
              <Text className="font-mono font-semibold text-term-text">Direct message</Text>
            </Pressable> : null}
            <Pressable accessibilityRole="button" onPress={() => select(undefined)} className="p-3">
              <Text className="font-mono text-term-muted">View online people</Text>
            </Pressable>
          </> : !available ? <Text className="font-mono text-term-muted">
            {online ? 'Waiting for online members. Make sure the updated relay is running.' : 'Relay offline · Online members unavailable.'}
          </Text> : <ScrollView>
            <Text className="font-mono text-xs text-term-dim mb-3">Grouped by profile level. Tap a name to message them.</Text>
            {rooms.map((level) => {
              const people = members.filter((key) => profiles[key].level === level)
                .sort((a, b) => profiles[a].name.localeCompare(profiles[b].name) || a.localeCompare(b));
              return <View key={level} className="mb-4 gap-1">
                <Text className="font-mono font-semibold text-term-text">{level} · {people.length}</Text>
                {!people.length ? <Text className="font-mono text-xs text-term-muted">No one online</Text> : null}
                {people.map((key) => <Pressable key={key} accessibilityRole="button" disabled={key === ownKey}
                    onPress={() => select(key)} className="rounded-sm border border-term-line px-3 py-3">
                  <Text className="font-mono text-term-text">● {profiles[key].name}{key === ownKey ? ' (you)' : ''}</Text>
                  <Text className="font-mono text-xs text-term-dim">{key.slice(0, 10)}…</Text>
                </Pressable>)}
              </View>;
            })}
          </ScrollView>}
        </View>
      </View>
    </Modal>
  );
}
