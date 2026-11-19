import TemperatureBar from '../src/TemperatureBar';
// Mobile UI polish: start with POLISH 1 (header), then POLISH 2 (bubbles),
// then POLISH 3 (composer). Save after each edit and check in Expo Go.
// Change className values first. Leave connection and send logic alone for visual edits.
import LocalClock from '../src/LocalClock';
import { checkInStatus, incidentLabels, incidentWindowMinutes, type CheckIn } from '@patriot/protocol';
import SavedContacts from '../src/SavedContacts';
import ProfileEditor from '../src/ProfileEditor';
import Announcements from '../src/Announcements';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { isPublicKey, profileLabel, rooms, sosMessage, type ChatProfile, type Room, type RoomMessage, type LevelReport } from '@patriot/protocol';
import { startChat, useChat } from '../src/chat';

// The list only needs these fields from either a room message or a direct message.
type ChatItem = Pick<RoomMessage, 'id' | 'from' | 'text'>;

export default function ChatRoute() {
  // Keep both sign-in and chat clear of the status bar and home indicator.
  return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#020617' }} edges={['top', 'right', 'bottom', 'left']}>
        <ChatScreen />
      </SafeAreaView>
  );
}

function ChatScreen() {
  // Shared state comes from the chat store. The useState calls below hold screen-only state.
  const { key, online, relayError, messages, roomMessages, profiles, profilesReady, pendingCheckIns, incidents, presence, severeReports, temperatures } = useChat();
  // Refs keep the connection and list handles across renders without causing a redraw.
  const session = useRef<Awaited<ReturnType<typeof startChat>>>(undefined);
  const chatList = useRef<FlatList<ChatItem>>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [announcements, setAnnouncements] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  // A room value selects a level. An undefined room means Direct chat.
  const [room, setRoom] = useState<Room>();
  const [peer, setPeer] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const [sending, setSending] = useState(false);
  // Trim a pasted public key, reject our own key, and choose the visible conversation.
  const recipient = peer.trim();
  const validPeer = isPublicKey(recipient) && recipient !== key;
  const thread = room ? roomMessages[room] ?? [] : messages.filter((m) =>
      (m.from === key && m.to === recipient) || (m.to === key && m.from === recipient),
  );

  // Start the relay session when the screen mounts. Clean it up when the screen closes.
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

  // Reload the selected room history when changing levels or reconnecting.
  useEffect(() => {
    if (online && room) {
      session.current?.loadRoom(room).catch(() => setError('Could not load room history. Check that the updated relay is running.'));
    }
  }, [online, room]);

  // Changing the recipient clears the old draft so it cannot go to the wrong person.
  function chooseContact(next: string) {
    if (next.trim() !== recipient) {
      setDraft('');
      setError('');
    }
    setPeer(next);
  }

  // Send an ordinary message or the preset SOS to the room or selected contact.
  async function send(sos = false) {
    const text = sos ? sosMessage : draft.trim();
    if (!session.current || (!room && !validPeer) || !text || sending) return;
    setSending(true);
    setError('');
    try {
      if (room) await session.current.sendRoom(room, text);
      else await session.current.send(recipient, text);
      // Clear the draft only if the user has not typed anything new while sending.
      if (!sos) setDraft((current) => current === draft ? '' : current);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSending(false);
    }
  }

  // Status uses this callback to fetch results or submit a new report for the current level.
  const loadReport = useCallback(async (report?: LevelReport) => {
    if (!room || !session.current) throw new Error('Relay is offline');
    return session.current.levelReport(room, report);
  }, [room]);

  const profile = profiles[key];

  async function saveProfile(next: ChatProfile) {
    if (!session.current) throw new Error('Relay is offline');
    await session.current.saveProfile(next);
  }

  // After sign-in, open the saved or newly chosen home level.
  function enterChat(level: Room) {
    Keyboard.dismiss();
    setRoom(level);
    setSignedIn(true);
  }

  // Sign-in is its own layout. Edit the card classes below to change its appearance.
  if (!signedIn) {
    return (
        <KeyboardAvoidingView className="flex-1 bg-slate-950"
                              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                              keyboardVerticalOffset={0}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
            <View className="gap-3 rounded-2xl bg-zinc-900 p-5">
              <View className="flex-row flex-wrap justify-between gap-3">
                <Text accessibilityRole="header" className="shrink text-xl font-semibold text-white">Sign in to Through The Earth</Text>
                <LocalClock />
              </View>
              {!profile && (!online || !profilesReady) ? (
                  <Text accessibilityLiveRegion="polite" className="text-zinc-300">
                    {error || relayError || (online ? 'Loading your profile…' : 'Connecting to the relay…')}
                  </Text>
              ) : profile ? (
                  <>
                    <Text className="text-zinc-200">{profileLabel(profile)}{online ? '' : ' · Relay offline'}</Text>
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

  // Copy before reversing so the shared message list keeps its original order.
  const latestCheckIn = [...messages].reverse().find((message) =>
      message.from === recipient && message.to === key && checkInStatus(message.text));
  const pendingCount = pendingCheckIns.filter((message) => message.to === recipient).length;

  // Check-ins use the session queue, so this action can work while the relay is offline.
  async function checkIn(kind: CheckIn) {
    if (!session.current || !validPeer || checkingIn) return;
    setCheckingIn(true);
    setError('');
    try {
      await session.current.checkIn(recipient, kind);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCheckingIn(false);
    }
  }

  // The composer SOS needs a live connection. The contact-panel SOS can be queued.
  const canSendAlert = online && (room !== undefined || validPeer) && !sending;
  const canSend = canSendAlert && draft.trim().length > 0;

  function confirmSOS() {
    const destination = room ?? 'this direct chat';
    Alert.alert('Send SOS?', 'Post an in-app SOS to ' + destination + '?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send SOS', onPress: () => { void send(true); } },
    ]);
  }

  return (
      <KeyboardAvoidingView
          className="flex-1 bg-slate-950"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
      >

        {/* POLISH 1: Header. Start with padding, spacing, and title size. The first row holds relay status and the clock. */}
        <View className="gap-3 border-b border-slate-800 p-5">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="text-sm text-slate-300">{online ? 'Relay connected' : 'Relay offline'}</Text>
            <LocalClock />
          </View>
          {/* Channel navigation stays on the left. Tap the profile on the right to edit it. */}
          <View className="flex-row items-center justify-between gap-3">
            <Pressable accessibilityRole="button" accessibilityLabel="Open channels"
                       hitSlop={5} className="h-9 justify-center rounded-lg bg-zinc-800 px-2"
                       onPress={() => {
                         Keyboard.dismiss();
                         setChannelsOpen(true);
                       }}>
              <Text className="font-semibold text-zinc-100">☰ Channels</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Edit chat profile"
                       accessibilityValue={{ text: profile ? profileLabel(profile) : undefined }}
                       accessibilityState={{ expanded: editingProfile }}
                       onPress={() => setEditingProfile((open) => !open)}
                       hitSlop={5} className="h-9 min-w-0 max-w-[48%] items-end justify-center rounded-lg bg-zinc-800 px-2">
              <Text numberOfLines={1} className="max-w-full text-right text-xs font-semibold leading-4 text-zinc-100">
                {profile?.name ?? 'Set up profile'}
              </Text>
              {profile ? <Text className="text-right text-xs leading-4 text-zinc-300">{profile.level}</Text> : null}
            </Pressable>
          </View>
          {editingProfile ? (
              <ProfileEditor profile={profile} online={online} save={saveProfile}
                             close={() => setEditingProfile(false)} />
          ) : null}
          {/* Channel drawer. Change panel width and selected-row styling here. */}
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
                          {option ?? 'Direct chat'}
                        </Text>
                          {option ? <Text className="text-xs text-zinc-400">
                            {online && presence ? presence[option] + ' online' : 'Online count unavailable'}
                          </Text> : null}
                      </Pressable>
                  ))}
                </View>
              </SafeAreaView>
              <Pressable accessible={false} className="flex-1" onPress={() => setChannelsOpen(false)} />
            </View>
          </Modal>
          {/* Level navigation. This is where a future Map tab would sit alongside Chat and Status. */}
          {room ? <View className="flex-row gap-2">
            {[false, true].map((value) => (
                <Pressable key={String(value)} accessibilityRole="tab"
                           accessibilityState={{ selected: value === announcements }}
                           className={value === announcements ? 'rounded-md bg-zinc-700 px-3 py-2' : 'rounded-md px-3 py-2'}
                           onPress={() => setAnnouncements(value)}>
                  <Text className="text-white">{value ? 'Status' : 'Chat'}</Text>
                </Pressable>
            ))}
          </View> : null}
          {/* Room visibility note or Direct chat controls. */}
          {room ? <TemperatureBar reading={temperatures[room]} online={online} /> : null}
          {room ? !announcements && <Text className="text-xs text-slate-300">
            Open demo room · Messages are visible to the relay.
          </Text> : <>
            {/* Direct chat: public key, sharing, recipient input, and saved contacts. */}
            <Text selectable className="text-xs text-slate-400">{key || 'Loading device identity…'}</Text>
            {key ? <Pressable accessibilityRole="button" onPress={() => Share.share({ message: key }).catch((cause) => setError(String(cause)))}>
              <Text className="font-semibold text-sky-400">Share my public key</Text>
            </Pressable> : null}
            <TextInput accessibilityLabel="Recipient public key" autoCapitalize="none" autoCorrect={false}
                       placeholder="Paste recipient public key" placeholderTextColor="#94a3b8"
                       value={peer} onChangeText={chooseContact} className="rounded-lg bg-slate-800 p-3 text-white" />
            <SavedContacts owner={key} recipient={recipient} profiles={profiles} select={chooseContact} />
            {/* Direct chat: last received check-in, queued count, and quick actions. */}
            {validPeer ? (
                <View className="gap-2 rounded-lg bg-zinc-900 p-3">
                  <Text className="text-zinc-100">{latestCheckIn
                      ? 'Last check-in · ' + checkInStatus(latestCheckIn.text) + ' · ' + new Date(latestCheckIn.sentAt).toLocaleString()
                      : 'No check-in received from this contact.'}</Text>
                  {pendingCount ? <Text className="text-amber-300">
                    {pendingCount} {pendingCount === 1 ? 'check-in queued' : 'check-ins queued'} · {online ? 'Waiting to send' : 'Waiting for connection'}
                  </Text> : null}
                  <View className="flex-row flex-wrap gap-2">
                    <Pressable accessibilityRole="button" disabled={checkingIn} className="rounded bg-sky-800 px-2 py-2"
                               onPress={() => { void checkIn('okay'); }}>
                      <Text className="text-white">I’m okay</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={checkingIn} className="rounded bg-zinc-800 px-2 py-2"
                               onPress={() => { void checkIn('request'); }}>
                      <Text className="text-white">Request a check-in</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={checkingIn} className="rounded bg-rose-900 px-2 py-2"
                               onPress={() => Alert.alert('Send SOS?', 'Send an in-app SOS to this contact?', [
                                 { text: 'Cancel', style: 'cancel' },
                                 { text: 'Send SOS', onPress: () => { void checkIn('help'); } },
                               ])}>
                      <Text className="text-white">I need help</Text>
                    </Pressable>
                  </View>
                </View>
            ) : null}
          </>}
        </View>
        {/* Resident-report warnings belong above level chat. Keep counts and timestamps readable on small screens. */}
        {room && !announcements && severeReports[room]?.length ? (
          <View accessibilityLiveRegion="polite" className="mx-3 mt-2 gap-1 rounded-lg border border-rose-500 bg-rose-950 px-3 py-2">
            <Text className="font-bold text-rose-100">Severe · Resident reports</Text>
            {!online ? <Text className="text-xs text-rose-200">Relay offline · Showing last received warning</Text> : null}
            <ScrollView style={{ maxHeight: 92 }} nestedScrollEnabled>
              {severeReports[room].map(({ question, answer, count, latestAt }) => (
                <Text key={question} className="mb-1 text-xs text-rose-100">
                  {question}: {answer} · {count} {count === 1 ? 'report' : 'reports'} · {new Date(latestAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </Text>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {room && !announcements && incidents[room]?.length ? (
            <View accessibilityLiveRegion="polite" className="mx-3 mt-2 gap-1 rounded-lg border border-amber-700 bg-amber-950 px-3 py-2">
              <Text className="font-semibold text-amber-100">Early warning · Resident reports</Text>
              {!online ? <Text className="text-xs text-amber-200">Relay offline · Showing last received warning</Text> : null}
              {incidents[room].map(({ issue, count, latestAt }) => (
                  <Text key={issue} className="text-xs text-amber-100">
                    {incidentLabels[issue]} · {count} reports in the past {incidentWindowMinutes} min · Latest {new Date(latestAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
              ))}
            </View>
        ) : null}
        {/* Status renders its own component. Switching levels resets its local form state. */}
        {room && announcements ? <Announcements key={room} online={online} ownKey={key} profiles={profiles} load={loadReport} /> : <>
          {/* Message-list spacing and empty states. The list scrolls to the bottom when the latest message is SOS. */}
          <FlatList<ChatItem> ref={chatList} className="flex-1"
                              onContentSizeChange={() => {
                                if (thread.at(-1)?.text === sosMessage) chatList.current?.scrollToEnd();
                              }} contentContainerStyle={{ padding: 16, gap: 10 }}
                              data={thread} keyExtractor={(item) => item.from + ':' + item.id}
                              ListEmptyComponent={<Text className="text-slate-400">
                                {room ? 'No messages in this room yet.' : validPeer ? 'No messages in this chat yet.' : 'Exchange public keys to start a chat.'}
                              </Text>}
                              renderItem={({ item }) => (
                                  // POLISH 2: Message bubbles. Change the colors, width, and padding here. Keep SOS visually distinct.
                                  <View className={item.text === sosMessage ? 'self-stretch rounded-lg border border-rose-500 bg-rose-950 p-3'
                                      : item.from === key ? 'self-end rounded-lg bg-sky-800 p-3' : 'self-start rounded-lg bg-slate-800 p-3'}>
                                    {profiles[item.from] ? <Text className="text-xs text-slate-200">{profileLabel(profiles[item.from])}</Text>
                                        : item.text === sosMessage || (room && item.from !== key) ? (
                                            <Text className="text-xs text-slate-300">{item.from === key ? 'You' : item.from.slice(0, 10) + '…'}</Text>
                                        ) : null}
                                    <Text selectable className={item.text === sosMessage ? 'font-bold text-rose-100' : 'text-white'}>{item.text}</Text>
                                  </View>
                              )} />
          {/* POLISH 3: Composer. Tune spacing, touch targets, and contrast here. Test with the iPhone keyboard open. */}
          <View className="gap-2 border-t border-slate-800 p-4">
            <Text accessibilityRole="header" className="text-sm font-semibold text-zinc-100">
              {room ? room + (online && presence ? ' · ' + presence[room] + ' online' : '') : 'Direct chat'}
            </Text>
            {error || relayError ? <Text className="text-rose-300">{error || relayError}</Text> : null}
            <View className="flex-row items-center gap-2">
              <Pressable accessibilityRole="button" accessibilityLabel="Send SOS" disabled={!canSendAlert}
                         className="rounded-lg bg-rose-900 p-3 disabled:opacity-50" onPress={confirmSOS}>
                <Text className="font-bold text-white">SOS</Text>
              </Pressable>
              <TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft}
                         maxLength={2000} placeholder="Message" placeholderTextColor="#94a3b8"
                         className="flex-1 rounded-lg bg-slate-800 p-3 text-white" />
              <Pressable accessibilityRole="button" disabled={!canSend} onPress={() => send()}
                         className={canSend ? 'rounded-lg bg-sky-400 p-3' : 'rounded-lg bg-slate-500 p-3'}>
                <Text className="font-semibold text-slate-950">{sending ? 'Sending…' : 'Send'}</Text>
              </Pressable>
            </View>
          </View>
        </>}
      </KeyboardAvoidingView>
  );
}