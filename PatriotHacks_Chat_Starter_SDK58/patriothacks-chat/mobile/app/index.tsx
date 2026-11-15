import ProfileEditor from '../src/ProfileEditor';
import Announcements from '../src/Announcements';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { isPublicKey, profileLabel, rooms, type ChatProfile, type Room, type RoomMessage, type LevelReport } from '@patriot/protocol';
import { startChat, useChat } from '../src/chat';

export default function ChatScreen() {
  const { key, online, relayError, messages, roomMessages, profiles, profilesReady } = useChat();
  const session = useRef<Awaited<ReturnType<typeof startChat>>>(undefined);
  const [signedIn, setSignedIn] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [announcements, setAnnouncements] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [room, setRoom] = useState<Room>();
  const [peer, setPeer] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const recipient = peer.trim();
  const validPeer = isPublicKey(recipient) && recipient !== key;
  const thread = room ? roomMessages[room] ?? [] : messages.filter((m) =>
    (m.from === key && m.to === recipient) || (m.to === key && m.from === recipient),
  );

  useEffect(() => {
    let active = true;
    startChat(() => active).then((connection) => {
      if (active) session.current = connection;
      else connection?.close();
    }).catch((cause) => {
      if (active) setError(String(cause));
    });
    return () => {
      active = false;
      session.current?.close();
      session.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (online && room) {
      session.current?.loadRoom(room).catch(() => setError('Could not load room history. Check that the updated relay is running.'));
    }
  }, [online, room]);

  async function send() {
    const text = draft.trim();
    if (!session.current || (!room && !validPeer) || !text || sending) return;
    setSending(true);
    setError('');
    try {
      if (room) await session.current.sendRoom(room, text);
      else await session.current.send(recipient, text);
      setDraft((current) => current === draft ? '' : current);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSending(false);
    }
  }

  const loadReport = useCallback(async (report?: LevelReport) => {
    if (!room || !session.current) throw new Error('Relay is offline');
    return session.current.levelReport(room, report);
  }, [room]);

  const profile = profiles[key];

  async function saveProfile(next: ChatProfile) {
    if (!session.current) throw new Error('Relay is offline');
    await session.current.saveProfile(next);
  }

  function enterChat(level: Room) {
    Keyboard.dismiss();
    setRoom(level);
    setSignedIn(true);
  }

  if (!signedIn) {
    return (
      <KeyboardAvoidingView className="flex-1 bg-slate-950"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
          <View className="gap-3 rounded-2xl bg-zinc-900 p-5">
            <Text accessibilityRole="header" className="text-2xl font-semibold text-white">Sign in to PatriotHacks</Text>
            {!online || !profilesReady ? (
              <Text accessibilityLiveRegion="polite" className="text-zinc-300">
                {error || relayError || (online ? 'Loading your profile…' : 'Connecting to the relay…')}
              </Text>
            ) : profile ? (
              <>
                <Text className="text-zinc-200">{profileLabel(profile)}</Text>
                <Pressable accessibilityRole="button" className="self-start rounded-lg bg-sky-800 px-4 py-3"
                  onPress={() => enterChat(profile.level)}>
                  <Text className="font-semibold text-white">Continue to chat</Text>
                </Pressable>
              </>
            ) : (
              <ProfileEditor online={online} submitLabel="Sign in" save={async (next) => {
                await saveProfile(next);
                enterChat(next.level);
              }} />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const canSend = online && (room !== undefined || validPeer) && draft.trim().length > 0 && !sending;

  return (
    <KeyboardAvoidingView className="flex-1 bg-slate-950" behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
      <View className="gap-3 border-b border-slate-800 p-5">
        <Text className="text-sm text-slate-300">{online ? 'Relay connected' : 'Relay offline'}</Text>
        <View className="flex-row items-center gap-3">
          <Pressable accessibilityRole="button" accessibilityLabel="Open channels"
            className="rounded-lg bg-zinc-800 px-3 py-3"
            onPress={() => {
              Keyboard.dismiss();
              setChannelsOpen(true);
            }}>
            <Text className="font-semibold text-zinc-100">☰ Channels</Text>
          </Pressable>
          <Text className="flex-1 text-lg font-semibold text-zinc-100">
            {room ? '# ' + room : 'Direct chat'}
          </Text>
        </View>
        {editingProfile ? (
          <ProfileEditor profile={profile} online={online} save={saveProfile}
            close={() => setEditingProfile(false)} />
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Edit chat profile"
            onPress={() => setEditingProfile(true)} className="self-start rounded-md bg-zinc-800 px-3 py-2">
            <Text className="text-zinc-100">{profile ? profileLabel(profile) : 'Set up profile'}</Text>
          </Pressable>
        )}
        <Modal visible={channelsOpen} transparent animationType="fade"
          onRequestClose={() => setChannelsOpen(false)}>
          <View className="flex-1 flex-row bg-black/60">
            <SafeAreaView style={{ width: '76%', maxWidth: 300, backgroundColor: '#18181b' }}
              accessibilityViewIsModal>
              <View className="flex-row items-center justify-between px-4 py-2">
                <Text className="font-semibold text-zinc-100">Channels</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close channels"
                  className="p-3" onPress={() => setChannelsOpen(false)}>
                  <Text className="text-lg text-zinc-100">×</Text>
                </Pressable>
              </View>
              <View className="gap-1 px-2">
                {([...rooms, undefined] as const).map((option) => (
                  <Pressable key={option ?? 'direct'} accessibilityRole="button"
                    accessibilityState={{ selected: room === option }}
                    className={room === option ? 'rounded-md bg-zinc-700 px-3 py-3' : 'rounded-md px-3 py-3'}
                    onPress={() => {
                      setChannelsOpen(false);
                      if (room === option) return;
                      setRoom(option);
                      setAnnouncements(false);
                      setDraft('');
                      setError('');
                    }}>
                    <Text className={room === option ? 'font-semibold text-white' : 'text-zinc-400'}>
                      {option ? '#  ' + option : 'Direct chat'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </SafeAreaView>
            <Pressable accessible={false} className="flex-1" onPress={() => setChannelsOpen(false)} />
          </View>
        </Modal>
        {room ? <View className="flex-row gap-2">
          {[false, true].map((value) => (
            <Pressable key={String(value)} accessibilityRole="tab"
              accessibilityState={{ selected: value === announcements }}
              className={value === announcements ? 'rounded-md bg-zinc-700 px-3 py-2' : 'rounded-md px-3 py-2'}
              onPress={() => setAnnouncements(value)}>
              <Text className="text-white">{value ? 'Announcements' : 'Chat'}</Text>
            </Pressable>
          ))}
        </View> : null}
        {room ? !announcements && <Text className="text-xs text-slate-300">
          Open demo room · Messages are visible to the relay.
        </Text> : <>
        <Text selectable className="text-xs text-slate-400">{key || 'Loading device identity…'}</Text>
        {key ? <Pressable accessibilityRole="button" onPress={() => Share.share({ message: key }).catch((cause) => setError(String(cause)))}>
          <Text className="font-semibold text-sky-400">Share my public key</Text>
        </Pressable> : null}
        <TextInput accessibilityLabel="Recipient public key" autoCapitalize="none" autoCorrect={false}
          placeholder="Paste recipient public key" placeholderTextColor="#94a3b8"
          value={peer} onChangeText={setPeer} className="rounded-lg bg-slate-800 p-3 text-white" />
        </>}
      </View>
      {room && announcements ? <Announcements key={room} online={online} ownKey={key} profiles={profiles} load={loadReport} /> : <>
      <FlatList<Pick<RoomMessage, "id" | "from" | "text">> className="flex-1" contentContainerStyle={{ padding: 16, gap: 10 }}
        data={thread} keyExtractor={(item) => item.from + ':' + item.id}
        ListEmptyComponent={<Text className="text-slate-400">
          {room ? 'No messages in this room yet.' : validPeer ? 'No messages in this chat yet.' : 'Exchange public keys to start a chat.'}
        </Text>}
        renderItem={({ item }) => (
          <View className={item.from === key ? 'self-end rounded-lg bg-sky-800 p-3' : 'self-start rounded-lg bg-slate-800 p-3'}>
            {profiles[item.from] ? <Text className="text-xs text-slate-200">{profileLabel(profiles[item.from])}</Text>
              : room && item.from !== key ? <Text className="text-xs text-slate-300">{item.from.slice(0, 10)}…</Text> : null}
            <Text selectable className="text-white">{item.text}</Text>
          </View>
        )} />
      <View className="gap-2 border-t border-slate-800 p-4">
        {error || relayError ? <Text className="text-rose-300">{error || relayError}</Text> : null}
        <View className="flex-row items-center gap-2">
          <TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft}
            maxLength={2000} placeholder="Message" placeholderTextColor="#94a3b8"
            className="flex-1 rounded-lg bg-slate-800 p-3 text-white" />
          <Pressable accessibilityRole="button" disabled={!canSend} onPress={send}
            className={canSend ? 'rounded-lg bg-sky-400 p-3' : 'rounded-lg bg-slate-500 p-3'}>
            <Text className="font-semibold text-slate-950">{sending ? 'Sending…' : 'Send'}</Text>
          </Pressable>
        </View>
      </View>
      </>}
    </KeyboardAvoidingView>
  );
}
