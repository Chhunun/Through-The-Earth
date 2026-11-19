import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { accountKeys, decryptMessage, encryptMessage, publicKey, removeAccount } from './crypto';
import { forgetOwner, history, queuedCheckIns, queueCheckIn, removeCheckIn, save } from './storage';
import { connectRelay } from './transport';
import { checkInMessages, parseChatProfile, type CheckIn, type IncidentSnapshot, type LevelPresence, type LevelTemperatures, type SevereReports, type ChatProfile, type ChatProfiles, type Envelope, type Room, type RoomMessage } from '@patriot/protocol';

type Message = Envelope & { text: string };
type ChatState = {
  key: string;
  profiles: ChatProfiles;
  profilesReady: boolean;
  online: boolean;
  incidents: Partial<IncidentSnapshot>;
  presence?: LevelPresence;
  severeReports: Partial<SevereReports>;
  temperatures: Partial<LevelTemperatures>;
  relayError: string;
  messages: Message[];
  pendingCheckIns: Envelope[];
  roomMessages: Partial<Record<Room, RoomMessage[]>>;
};
const initialState: ChatState = { key: '', profiles: {}, profilesReady: false, online: false, incidents: {}, presence: undefined, severeReports: {}, temperatures: {}, relayError: '', messages: [], pendingCheckIns: [], roomMessages: {} };
export const useChat = create<ChatState>(() => initialState);

async function display(envelope: Envelope) {
  const message = { ...envelope, text: await decryptMessage(envelope) };
  await save(envelope);
  useChat.setState(({ messages }) => ({
    messages: messages.some(({ from, id }) => from === message.from && id === message.id)
      ? messages
      : [...messages, message].sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id)),
  }));
}

function mergeRoom(room: Room, history: RoomMessage[], live?: RoomMessage) {
  useChat.setState(({ roomMessages }) => {
    const combined = new Map(history.map((message) => [message.id, message]));
    for (const message of roomMessages[room] ?? []) combined.set(message.id, message);
    if (live) combined.set(live.id, live);
    return { roomMessages: { ...roomMessages, [room]: [...combined.values()].slice(-100) } };
  });
}

const cachedProfileSlot = 'patriot-chat.profile-cache';

// Profiles cached per public key, so every account on the device can be labelled offline.
async function cachedProfiles(): Promise<ChatProfiles> {
  const result: ChatProfiles = {};
  try {
    const raw = await SecureStore.getItemAsync(cachedProfileSlot);
    const saved = raw ? JSON.parse(raw) : {};
    // Older builds stored a single { key, profile } entry.
    const entries = typeof saved?.key === 'string' ? { [saved.key]: saved.profile } : saved;
    for (const [key, value] of Object.entries(entries ?? {})) {
      const profile = parseChatProfile(value);
      if (profile) result[key] = profile;
    }
  } catch {
    // An unavailable cache should not affect online sign-in.
  }
  return result;
}

function cacheProfile(key: string, profile: ChatProfile) {
  void cachedProfiles()
    .then((all) => SecureStore.setItemAsync(cachedProfileSlot, JSON.stringify({ ...all, [key]: profile })))
    .catch(() => {});
}

export type SavedAccount = { key: string; profile?: ChatProfile };

export async function savedAccounts(): Promise<SavedAccount[]> {
  const [keys, profiles] = await Promise.all([accountKeys(), cachedProfiles()]);
  return keys.map((key) => ({ key, profile: profiles[key] }));
}

// Remove an account and its local data from this device. Its relay profile is left as is.
export async function removeSavedAccount(key: string) {
  const remaining = await removeAccount(key);
  await forgetOwner(key, remaining);
  const { [key]: _removed, ...rest } = await cachedProfiles();
  await SecureStore.setItemAsync(cachedProfileSlot, JSON.stringify(rest)).catch(() => {});
}

// Clear the previous account's state before the screen remounts for a different account.
export function resetChat() {
  useChat.setState(initialState);
}

export async function startChat(isActive: () => boolean) {
  const key = await publicKey();
  const messages: Message[] = [];
  for (const envelope of await history(key)) {
    try {
      messages.push({ ...envelope, text: await decryptMessage(envelope) });
    } catch {
      // An unreadable row should not make the rest of the history inaccessible.
    }
  }
  const [pendingCheckIns, cachedProfile] = await Promise.all([queuedCheckIns(key), cachedProfiles().then((all) => all[key])]);
  if (!isActive()) return;
  useChat.setState({ key, messages, pendingCheckIns, profiles: cachedProfile ? { [key]: cachedProfile } : {}, profilesReady: false, online: false, incidents: {}, presence: undefined, severeReports: {}, temperatures: {}, relayError: '' });
  const url = process.env.EXPO_PUBLIC_RELAY_URL;
  if (!url) {
    useChat.setState({ relayError: 'Set EXPO_PUBLIC_RELAY_URL in mobile/.env' });
    return;
  }
  const relay = connectRelay(url, key, display, (message) => mergeRoom(message.room, [], message),
    (profiles, replace) => {
      if (profiles[key]) cacheProfile(key, profiles[key]);
      useChat.setState((state) => ({
        profiles: replace ? profiles : { ...state.profiles, ...profiles },
        profilesReady: replace || state.profilesReady,
      }));
    },
    (incidents) => useChat.setState({ incidents }),
    (presence) => useChat.setState({ presence }),
    (severeReports) => useChat.setState({ severeReports }),
    (temperatures) => useChat.setState({ temperatures }),
    (online, error) => {
      if (!online) useChat.setState({ presence: undefined });
      useChat.setState({ online, relayError: error ?? '' });
      if (online) void flushCheckIns();
    });
  let flushing = false;

  async function flushCheckIns() {
    if (flushing || !isActive() || !useChat.getState().online) return;
    flushing = true;
    try {
      for (const envelope of await queuedCheckIns(key)) {
        if (!isActive() || !useChat.getState().online) break;
        await relay.send(envelope);
        await display(envelope);
        await removeCheckIn(envelope);
        if (isActive()) useChat.setState(({ pendingCheckIns }) => ({
          pendingCheckIns: pendingCheckIns.filter((item) => item.id !== envelope.id),
        }));
      }
    } catch {
      // Keep the original encrypted envelope queued for retry.
    } finally {
      flushing = false;
    }
  }

  const retry = setInterval(() => { void flushCheckIns(); }, 5000);
  return {
    close() {
      clearInterval(retry);
      relay.close();
    },
    async checkIn(to: string, kind: CheckIn) {
      const envelope = await encryptMessage(to, checkInMessages[kind]);
      await queueCheckIn(envelope);
      if (isActive()) useChat.setState(({ pendingCheckIns }) => ({
        pendingCheckIns: [...pendingCheckIns, envelope],
      }));
      void flushCheckIns();
    },
    sendRoom: relay.sendRoom,
    levelReport: relay.levelReport,
    saveProfile: relay.saveProfile,
    async loadRoom(room: Room) {
      mergeRoom(room, await relay.roomHistory(room));
    },
    async send(to: string, text: string) {
      const message = await encryptMessage(to, text);
      await relay.send(message);
      await display(message);
    },
  };
}
