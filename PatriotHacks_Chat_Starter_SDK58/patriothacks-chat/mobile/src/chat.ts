import { create } from 'zustand';
import { decryptMessage, encryptMessage, publicKey } from './crypto';
import { history, save } from './storage';
import { connectRelay } from './transport';
import type { Envelope, Room, RoomMessage } from '@patriot/protocol';

type Message = Envelope & { text: string };
export const useChat = create<{
  key: string;
  online: boolean;
  relayError: string;
  messages: Message[];
  roomMessages: Partial<Record<Room, RoomMessage[]>>;
}>(() => ({ key: '', online: false, relayError: '', messages: [], roomMessages: {} }));

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
  if (!isActive()) return;
  useChat.setState({ key, messages, online: false, relayError: '' });
  const url = process.env.EXPO_PUBLIC_RELAY_URL;
  if (!url) {
    useChat.setState({ relayError: 'Set EXPO_PUBLIC_RELAY_URL in mobile/.env' });
    return;
  }
  const relay = connectRelay(url, key, display, (message) => mergeRoom(message.room, [], message), (online, error) => {
    useChat.setState({ online, relayError: error ?? '' });
  });
  return {
    close: relay.close,
    sendRoom: relay.sendRoom,
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
