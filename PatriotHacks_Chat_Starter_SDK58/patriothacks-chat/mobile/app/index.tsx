import * as Crypto from 'expo-crypto';
import SosChooser, { type SosRequest } from '../src/SosChooser';
import { isSosMessage, sosText, type SosType } from '../../shared/sosTypes';
import { sendLevelSos } from '../src/sendLevelSos';
import { router } from 'expo-router';
import TemperatureBar from '../src/TemperatureBar';
import term from '../src/terminal-colors.json';
// Mobile UI polish: start with POLISH 1 (header), then POLISH 2 (bubbles),
// then POLISH 3 (composer). Save after each edit and check in Expo Go.
// Change className values first. Leave connection and send logic alone for visual edits.
import LocalClock from '../src/LocalClock';
import { checkInStatus, incidentLabels, incidentWindowMinutes, type CheckIn } from '@patriot/protocol';
import SavedContacts from '../src/SavedContacts';
import ProfileEditor from '../src/ProfileEditor';
import Announcements from '../src/Announcements';
import DailyLog from '../src/DailyLog';
import { RaiseWarningButton, RaiseWarningModal, WarningBanner, useWarningActions } from '../src/HazardWarnings';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { isPublicKey, profileLabel, rooms, sosMessage, type ChatProfile, type Room, type RoomMessage, type LevelReport } from '@patriot/protocol';
import { removeSavedAccount, resetChat, savedAccounts, startChat, useChat, type SavedAccount } from '../src/chat';
import { addAccount, switchAccount } from '../src/crypto';
// The list only needs these fields from either a room message or a direct message.
type ChatItem = Pick<RoomMessage, 'id' | 'from' | 'text'>;

// Tabs shown under a level. Daily log is personal, so it is the same on every level.
const levelTabs = [['chat', 'Chat'], ['status', 'Status'], ['log', 'Daily log']] as const;
type LevelTab = (typeof levelTabs)[number][0];

export default function ChatRoute() {
  // Bumping the generation remounts ChatScreen, which starts a new relay session for the active account.
  const [account, setAccount] = useState({ generation: 0, autoSignIn: false });
  const restart = useCallback((autoSignIn: boolean) => {
    setAccount(({ generation }) => ({ generation: generation + 1, autoSignIn }));
  }, []);
  // Keep both sign-in and chat clear of the status bar and home indicator.
  return (
      <SafeAreaView style={{ flex: 1, backgroundColor: term.bg }} edges={['top', 'right', 'bottom', 'left']}>
        <ChatScreen key={account.generation} autoSignIn={account.autoSignIn} restart={restart} />
      </SafeAreaView>
  );
}

function ChatScreen({ autoSignIn, restart }: { autoSignIn: boolean; restart: (autoSignIn: boolean) => void }) {
  // Shared state comes from the chat store. The useState calls below hold screen-only state.
  const { key, online, relayError, messages, roomMessages, profiles, profilesReady, pendingCheckIns, incidents, presence, severeReports, temperatures, warnings } = useChat();
  // Refs keep the connection and list handles across renders without causing a redraw.
  const session = useRef<Awaited<ReturnType<typeof startChat>>>(undefined);
  const chatList = useRef<FlatList<ChatItem>>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [tab, setTab] = useState<LevelTab>('chat');
  const [editingProfile, setEditingProfile] = useState(false);
  // A room value selects a level. An undefined room means Direct chat.
  const [room, setRoom] = useState<Room>();
  const [peer, setPeer] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const [sending, setSending] = useState(false);
  const [sosRequest, setSosRequest] = useState<SosRequest>();
  const sosOpen = useRef(false);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [switching, setSwitching] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const warningActions = useWarningActions();
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

  // The sign-in screen lists the other accounts saved on this device.
  useEffect(() => {
    if (!key || signedIn) return;
    let active = true;
    savedAccounts().then((list) => { if (active) setAccounts(list); }).catch(() => {});
    return () => { active = false; };
  }, [key, signedIn]);

  // After switching to a saved account, go straight to its chat once its profile is known.
  const autoEntered = useRef(false);
  useEffect(() => {
    if (!autoSignIn || autoEntered.current || !profile) return;
    autoEntered.current = true;
    enterChat(profile.level);
  }, [autoSignIn, profile]);

  // Close this account's relay session, change the active key, then remount for the new account.
  async function changeAccount(change: () => Promise<void>, enter: boolean) {
    if (switching) return;
    setSwitching(true);
    session.current?.close();
    session.current = undefined;
    let changed = true;
    try {
      await change();
    } catch (cause) {
      changed = false;
      Alert.alert('Could not switch accounts', cause instanceof Error ? cause.message : String(cause));
    }
    resetChat();
    restart(changed && enter);
  }

  // Removing deletes the key from this device, so always confirm first.
  function confirmRemove(account: SavedAccount) {
    const known = profiles[account.key] ?? account.profile;
    Alert.alert('Remove ' + (known?.name ?? 'this account') + '?',
        'This deletes the account’s key, contacts and messages from this device. It can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        // The active account needs its session closed first, then the screen restarts on the next account.
        if (account.key === key) {
          void changeAccount(() => removeSavedAccount(account.key), false);
          return;
        }
        removeSavedAccount(account.key)
            .then(() => setAccounts((list) => list.filter((item) => item.key !== account.key)))
            .catch((cause) => Alert.alert('Could not remove account', cause instanceof Error ? cause.message : String(cause)));
      } },
    ]);
  }

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

  // Signing out only returns to the sign-in screen. The device keeps its key, profile,
  // contacts and messages, and the relay session stays open for the next sign-in.
  function signOut() {
    Keyboard.dismiss();
    setChannelsOpen(false);
    setEditingProfile(false);
    setWarningOpen(false);
    setTab('chat');
    setDraft('');
    setError('');
    setSignedIn(false);
  }

  // Sign-in is its own layout. Edit the card classes below to change its appearance.
  if (!signedIn) {
    return (
        <KeyboardAvoidingView className="flex-1 bg-term-bg"
                              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                              keyboardVerticalOffset={0}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
            <View className="gap-3 rounded bg-term-panel border border-term-line p-5">
              <View className="flex-row flex-wrap justify-between gap-3">
                <Text accessibilityRole="header" className="font-mono uppercase tracking-widest shrink text-xl font-semibold text-term-text">Sign in to Through The Earth</Text>
                <LocalClock />
              </View>
              {!profile && (!online || !profilesReady) ? (
                  <Text accessibilityLiveRegion="polite" className="font-mono text-term-dim">
                    {error || relayError || (online ? 'Loading your profile…' : 'Connecting to the relay…')}
                  </Text>
              ) : profile ? (
                  <>
                    <Text className="font-mono text-term-text">{profileLabel(profile)}{online ? '' : ' · Relay offline'}</Text>
                    <View className="flex-row items-center gap-3">
                      <Pressable accessibilityRole="button" className="rounded-sm bg-term-active border border-term-text px-4 py-3"
                                 onPress={() => enterChat(profile.level)}>
                        <Text className="font-mono font-semibold text-term-text">Sign in</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={'Remove ' + profile.name + ' from this device'}
                                 disabled={switching} className="px-2 py-3 disabled:opacity-50"
                                 onPress={() => confirmRemove({ key, profile })}>
                        <Text className="font-mono text-rose-300">Remove</Text>
                      </Pressable>
                    </View>
                  </>
              ) : (
                  <ProfileEditor online={online} submitLabel="Sign in" save={async (next) => {
                    await saveProfile(next);
                    enterChat(next.level);
                  }} />
              )}
            </View>
            {/* Other accounts on this device. Each account has its own key, contacts and messages. */}
            {key ? (
                <View className="mt-3 gap-2 rounded bg-term-panel border border-term-line p-5">
                  <Text accessibilityRole="header" className="font-mono uppercase tracking-widest font-semibold text-term-text">Sign in to another account</Text>
                  {accounts.filter((account) => account.key !== key).map((account) => {
                    const known = profiles[account.key] ?? account.profile;
                    const label = known ? profileLabel(known) : account.key.slice(0, 10) + '…';
                    return (
                        <View key={account.key} className="flex-row items-center gap-2">
                          <Pressable accessibilityRole="button" disabled={switching}
                                     className="min-w-0 flex-1 rounded-sm bg-term-field border border-term-line px-4 py-3 disabled:opacity-50"
                                     onPress={() => { void changeAccount(() => switchAccount(account.key), true); }}>
                            <Text numberOfLines={1} className="font-mono text-term-text">{label}</Text>
                          </Pressable>
                          <Pressable accessibilityRole="button" accessibilityLabel={'Remove ' + label + ' from this device'}
                                     disabled={switching} className="px-2 py-3 disabled:opacity-50"
                                     onPress={() => confirmRemove(account)}>
                            <Text className="font-mono text-rose-300">Remove</Text>
                          </Pressable>
                        </View>
                    );
                  })}
                  <Pressable accessibilityRole="button" disabled={switching} className="self-start py-2 disabled:opacity-50"
                             onPress={() => { void changeAccount(addAccount, false); }}>
                    <Text className="font-mono font-semibold text-term-glow">{switching ? 'Switching…' : '+ Add another account'}</Text>
                  </Pressable>
                </View>
            ) : null}
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

  function confirmSOS(contactOnly = false) {
    if (sosOpen.current || !session.current) return;
    const destinationRoom = contactOnly ? undefined : room;
    const to = recipient;
    if (!destinationRoom && !validPeer) return;
    const expectedKey = key;
    const currentSession = session.current;
    const id = Crypto.randomUUID();
    sosOpen.current = true;
    setSosRequest({
      id, destination: destinationRoom ?? 'this direct contact',
      floodLevel: destinationRoom ?? profile?.level,
      send: async (type: SosType) => {
        sosOpen.current = false;
        setSosRequest(undefined);
        setSending(true);
        setError('');
        try {
          if (session.current !== currentSession) throw new Error('Account changed. Open SOS again.');
          if (type === 'flood' || destinationRoom) await sendLevelSos(id, type, destinationRoom, expectedKey);
          else if (type === 'general') await currentSession.checkIn(to, 'help');
          else await currentSession.send(to, sosText(type));
        } catch (cause) { setError('SOS could not be sent: ' + String(cause)); }
        finally { setSending(false); }
      },
    });
  }
  function cancelSOS() { sosOpen.current = false; setSosRequest(undefined); }

  return (
      <KeyboardAvoidingView
          className="flex-1 bg-term-bg"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
      >

        <SosChooser request={sosRequest} cancel={cancelSOS} />
        {/* POLISH 1: Header. Start with padding, spacing, and title size. The first row holds relay status and the clock. */}
        <View className="gap-3 border-b border-term-line p-5">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="font-mono text-sm text-term-dim">{online ? 'Relay connected' : 'Relay offline'}</Text>
            <LocalClock />
          </View>
          {/* Channel navigation stays on the left. Tap the profile on the right to edit it. */}
          <View className="flex-row items-center justify-between gap-3">
            <Pressable accessibilityRole="button" accessibilityLabel="Open channels"
                       hitSlop={5} className="h-9 justify-center rounded-sm bg-term-field border border-term-line px-2"
                       onPress={() => {
                         Keyboard.dismiss();
                         setChannelsOpen(true);
                       }}>
              <Text className="font-mono font-semibold text-term-text">☰ Channels</Text>
            </Pressable>
            {/* Sign out and profile share the right side. The profile name truncates first on narrow screens. */}
            <View className="min-w-0 flex-1 flex-row items-center justify-end gap-2">
              <Pressable accessibilityRole="button" onPress={signOut}
                         hitSlop={5} className="h-9 justify-center rounded-sm bg-term-field border border-term-line px-2">
                <Text className="font-mono text-xs font-semibold text-term-text">Sign out</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Edit chat profile"
                         accessibilityValue={{ text: profile ? profileLabel(profile) : undefined }}
                         accessibilityState={{ expanded: editingProfile }}
                         onPress={() => setEditingProfile((open) => !open)}
                         hitSlop={5} className="h-9 min-w-0 shrink items-end justify-center rounded-sm bg-term-field border border-term-line px-2">
                <Text numberOfLines={1} className="font-mono max-w-full text-right text-xs font-semibold leading-4 text-term-text">
                  {profile?.name ?? 'Set up profile'}
                </Text>
                {profile ? <Text numberOfLines={1} className="font-mono text-right text-xs leading-4 text-term-dim">{profile.level}</Text> : null}
              </Pressable>
            </View>
          </View>
          {editingProfile ? (
              <ProfileEditor profile={profile} online={online} save={saveProfile}
                             close={() => setEditingProfile(false)} />
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            <Pressable accessibilityRole="button" onPress={() => router.push('/map')}
              className="rounded-sm bg-term-active border border-term-text px-3 py-2">
              <Text className="font-mono font-semibold text-term-text">Open map</Text>
            </Pressable>
            {/* Warning system: alert every resident to an air cutout or bad water. Also on the map screen. */}
            <RaiseWarningButton onPress={() => { Keyboard.dismiss(); setWarningOpen(true); }} />
          </View>
          <RaiseWarningModal visible={warningOpen} online={online} defaultLevel={room ?? profile?.level}
                             submit={warningActions.raise} close={() => setWarningOpen(false)} />
          {/* Channel drawer. Change panel width and selected-row styling here. */}
          <Modal visible={channelsOpen} transparent animationType="fade"
                 onRequestClose={() => setChannelsOpen(false)}>
            <View className="flex-1 flex-row bg-black/60">
              <SafeAreaView style={{ width: '76%', maxWidth: 300, backgroundColor: term.panel, borderRightWidth: 1, borderColor: term.line }}
                            accessibilityViewIsModal>
                <View className="flex-row items-center justify-between px-4 py-2">
                  <Text className="font-mono font-semibold text-term-text">Channels</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close channels"
                             className="p-3" onPress={() => setChannelsOpen(false)}>
                    <Text className="font-mono text-lg text-term-text">×</Text>
                  </Pressable>
                </View>
                <View className="gap-1 px-2">
                  {([...rooms, undefined] as const).map((option) => (
                      <Pressable key={option ?? 'direct'} accessibilityRole="button"
                                 accessibilityState={{ selected: room === option }}
                                 className={room === option ? 'rounded-sm bg-term-active border border-term-text px-3 py-3' : 'rounded-sm px-3 py-3'}
                                 onPress={() => {
                                   setChannelsOpen(false);
                                   if (room === option) return;
                                   setRoom(option);
                                   setTab('chat');
                                   setDraft('');
                                   setError('');
                                 }}>
                        <Text className={room === option ? 'font-mono font-semibold text-term-text' : 'font-mono text-term-muted'}>
                          {option ?? 'Direct chat'}
                        </Text>
                          {option ? <Text className="font-mono text-xs text-term-muted">
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
            {levelTabs.map(([value, label]) => (
                <Pressable key={value} accessibilityRole="tab"
                           accessibilityState={{ selected: value === tab }}
                           className={value === tab ? 'rounded-sm bg-term-active border border-term-text px-3 py-2' : 'rounded-sm px-3 py-2'}
                           onPress={() => setTab(value)}>
                  <Text className="font-mono text-term-text">{label}</Text>
                </Pressable>
            ))}
          </View> : null}
          {/* Room visibility note or Direct chat controls. */}
          {room ? <TemperatureBar reading={temperatures[room]} online={online} /> : null}
          {room ? tab === 'chat' && <Text className="font-mono text-xs text-term-dim">
            Open demo room · Messages are visible to the relay.
          </Text> : <>
            {/* Direct chat: public key, sharing, recipient input, and saved contacts. */}
            <Text selectable className="font-mono text-xs text-term-muted">{key || 'Loading device identity…'}</Text>
            {key ? <Pressable accessibilityRole="button" onPress={() => Share.share({ message: key }).catch((cause) => setError(String(cause)))}>
              <Text className="font-mono font-semibold text-term-glow">Share my public key</Text>
            </Pressable> : null}
            <TextInput accessibilityLabel="Recipient public key" autoCapitalize="none" autoCorrect={false}
                       placeholder="Paste recipient public key" placeholderTextColor={term.muted}
                       value={peer} onChangeText={chooseContact} className="font-mono rounded-sm bg-term-field border border-term-line p-3 text-term-text" />
            <SavedContacts owner={key} recipient={recipient} profiles={profiles} select={chooseContact} />
            {/* Direct chat: last received check-in, queued count, and quick actions. */}
            {validPeer ? (
                <View className="gap-2 rounded-sm bg-term-panel border border-term-line p-3">
                  <Text className="font-mono text-term-text">{latestCheckIn
                      ? 'Last check-in · ' + checkInStatus(latestCheckIn.text) + ' · ' + new Date(latestCheckIn.sentAt).toLocaleString()
                      : 'No check-in received from this contact.'}</Text>
                  {pendingCount ? <Text className="font-mono text-amber-300">
                    {pendingCount} {pendingCount === 1 ? 'check-in queued' : 'check-ins queued'} · {online ? 'Waiting to send' : 'Waiting for connection'}
                  </Text> : null}
                  <View className="flex-row flex-wrap gap-2">
                    <Pressable accessibilityRole="button" disabled={checkingIn} className="rounded bg-term-active border border-term-text px-2 py-2"
                               onPress={() => { void checkIn('okay'); }}>
                      <Text className="font-mono text-term-text">I’m okay</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={checkingIn} className="rounded bg-term-field border border-term-line px-2 py-2"
                               onPress={() => { void checkIn('request'); }}>
                      <Text className="font-mono text-term-text">Request a check-in</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={checkingIn} className="rounded border border-rose-500 bg-rose-900 px-2 py-2"
                               onPress={() => confirmSOS(true)}>
                      <Text className="font-mono text-rose-100">I need help</Text>
                    </Pressable>
                  </View>
                </View>
            ) : null}
          </>}
        </View>
        {/* Hazard warnings show on every tab and in Direct chat, because they concern every resident. */}
        <WarningBanner warnings={warnings} ownKey={key} online={online} homeLevel={profile?.level} busy={warningActions.busy}
                       confirm={warningActions.confirm} clear={warningActions.clear} />
        {/* Resident-report warnings belong above level chat. Keep counts and timestamps readable on small screens. */}
        {room && tab === 'chat' && severeReports[room]?.length ? (
          <View accessibilityLiveRegion="polite" className="mx-3 mt-2 gap-1 rounded-sm border border-rose-500 bg-rose-950 px-3 py-2">
            <Text className="font-mono font-bold text-rose-100">Severe · Resident reports</Text>
            {!online ? <Text className="font-mono text-xs text-rose-200">Relay offline · Showing last received warning</Text> : null}
            <ScrollView style={{ maxHeight: 92 }} nestedScrollEnabled>
              {severeReports[room].map(({ question, answer, count, latestAt }) => (
                <Text key={question} className="font-mono mb-1 text-xs text-rose-100">
                  {question}: {answer} · {count} {count === 1 ? 'report' : 'reports'} · {new Date(latestAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </Text>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {room && tab === 'chat' && incidents[room]?.length ? (
            <View accessibilityLiveRegion="polite" className="mx-3 mt-2 gap-1 rounded-sm border border-amber-700 bg-amber-950 px-3 py-2">
              <Text className="font-mono font-semibold text-amber-100">Early warning · Resident reports</Text>
              {!online ? <Text className="font-mono text-xs text-amber-200">Relay offline · Showing last received warning</Text> : null}
              {incidents[room].map(({ issue, count, latestAt }) => (
                  <Text key={issue} className="font-mono text-xs text-amber-100">
                    {incidentLabels[issue]} · {count} reports in the past {incidentWindowMinutes} min · Latest {new Date(latestAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
              ))}
            </View>
        ) : null}
        {/* Status and Daily log render their own components. Switching levels resets Status form state. */}
        {room && tab === 'status' ? <Announcements key={room} online={online} ownKey={key} profiles={profiles} load={loadReport} />
          : room && tab === 'log' ? <DailyLog key={key} ownKey={key} /> : <>
          {/* Message-list spacing and empty states. The list scrolls to the bottom when the latest message is SOS. */}
          <FlatList<ChatItem> ref={chatList} className="flex-1"
                              onContentSizeChange={() => {
                                if (isSosMessage(thread.at(-1)?.text ?? '')) chatList.current?.scrollToEnd();
                              }} contentContainerStyle={{ padding: 16, gap: 10 }}
                              data={thread} keyExtractor={(item) => item.from + ':' + item.id}
                              ListEmptyComponent={<Text className="font-mono text-term-muted">
                                {room ? 'No messages in this room yet.' : validPeer ? 'No messages in this chat yet.' : 'Exchange public keys to start a chat.'}
                              </Text>}
                              renderItem={({ item }) => (
                                  // POLISH 2: Message bubbles. Change the colors, width, and padding here. Keep SOS visually distinct.
                                  <View className={isSosMessage(item.text) ? 'self-stretch rounded-sm border border-rose-500 bg-rose-950 p-3'
                                      : item.from === key ? 'self-end rounded-sm bg-term-active border border-term-text p-3' : 'self-start rounded-sm bg-term-field border border-term-line p-3'}>
                                    {profiles[item.from] ? <Text className="font-mono text-xs text-term-text">{profileLabel(profiles[item.from])}</Text>
                                        : isSosMessage(item.text) || (room && item.from !== key) ? (
                                            <Text className="font-mono text-xs text-term-dim">{item.from === key ? 'You' : item.from.slice(0, 10) + '…'}</Text>
                                        ) : null}
                                    <Text selectable className={isSosMessage(item.text) ? 'font-mono font-bold text-rose-100' : 'font-mono text-term-text'}>{item.text}</Text>
                                  </View>
                              )} />
          {/* POLISH 3: Composer. Tune spacing, touch targets, and contrast here. Test with the iPhone keyboard open. */}
          <View className="gap-2 border-t border-term-line p-4">
            <Text accessibilityRole="header" className="font-mono uppercase tracking-widest text-sm font-semibold text-term-text">
              {room ? room + (online && presence ? ' · ' + presence[room] + ' online' : '') : 'Direct chat'}
            </Text>
            {error || relayError ? <Text className="font-mono text-rose-300">{error || relayError}</Text> : null}
            <View className="flex-row items-center gap-2">
              <Pressable accessibilityRole="button" accessibilityLabel="Send SOS" disabled={!canSendAlert}
                         className="rounded-sm border border-rose-500 bg-rose-900 p-3 disabled:opacity-50" onPress={() => confirmSOS()}>
                <Text className="font-mono font-bold text-rose-100">SOS</Text>
              </Pressable>
              <TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft}
                         maxLength={2000} placeholder="Message" placeholderTextColor={term.muted}
                         className="font-mono flex-1 rounded-sm bg-term-field border border-term-line p-3 text-term-text" />
              <Pressable accessibilityRole="button" disabled={!canSend} onPress={() => send()}
                         className={canSend ? 'rounded-sm bg-term-text border border-term-text p-3' : 'rounded-sm bg-term-field border border-term-line p-3'}>
                <Text className={canSend ? 'font-mono font-semibold text-term-bg' : 'font-mono font-semibold text-term-muted'}>{sending ? 'Sending…' : 'Send'}</Text>
              </Pressable>
            </View>
          </View>
        </>}
      </KeyboardAvoidingView>
  );
}