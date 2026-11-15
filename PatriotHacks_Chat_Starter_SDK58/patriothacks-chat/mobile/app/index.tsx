import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Share, Text, TextInput, View } from 'react-native';
import { isPublicKey, rooms, type Room, type RoomMessage } from '@patriot/protocol';
import { startChat, useChat } from '../src/chat';

export default function ChatScreen() {
  const { key, online, relayError, messages, roomMessages } = useChat();
  const session = useRef<Awaited<ReturnType<typeof startChat>>>(undefined);
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

  const canSend = online && (room !== undefined || validPeer) && draft.trim().length > 0 && !sending;

  return (
    <KeyboardAvoidingView className="flex-1 bg-slate-950" behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
      <View className="gap-3 border-b border-slate-800 p-5">
        <Text className="text-sm text-slate-300">{online ? 'Relay connected' : 'Relay offline'}</Text>
        <View className="flex-row flex-wrap gap-2">
          {([undefined, ...rooms] as const).map((option) => (
            <Pressable key={option ?? 'direct'} accessibilityRole="button"
              accessibilityState={{ selected: room === option }}
              className={room === option ? 'rounded-lg bg-sky-800 px-3 py-2' : 'rounded-lg bg-slate-800 px-3 py-2'}
              onPress={() => {
                if (room === option) return;
                setRoom(option);
                setDraft('');
                setError('');
              }}>
              <Text className="text-white">{option ?? 'Direct chat'}</Text>
            </Pressable>
          ))}
        </View>
        {room ? <Text className="text-xs text-slate-300">
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
      <FlatList<Pick<RoomMessage, "id" | "from" | "text">> className="flex-1" contentContainerStyle={{ padding: 16, gap: 10 }}
        data={thread} keyExtractor={(item) => item.from + ':' + item.id}
        ListEmptyComponent={<Text className="text-slate-400">
          {room ? 'No messages in this room yet.' : validPeer ? 'No messages in this chat yet.' : 'Exchange public keys to start a chat.'}
        </Text>}
        renderItem={({ item }) => (
          <View className={item.from === key ? 'self-end rounded-lg bg-sky-800 p-3' : 'self-start rounded-lg bg-slate-800 p-3'}>
            {room && item.from !== key ? <Text className="text-xs text-slate-300">{item.from.slice(0, 10)}…</Text> : null}
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
    </KeyboardAvoidingView>
  );
}
