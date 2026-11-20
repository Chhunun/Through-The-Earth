import type { Server, Socket } from 'socket.io';
import { isRoom, rooms, roomEvents, type Ack, type Room, type RoomMessage } from '@patriot/protocol';
import { sosEvent, isSosType, sosText } from '../shared/sosTypes.js';

const accepted = new Map<string, string>();
export function registerSos(io: Server, socket: Socket, authenticated: () => boolean,
  profileLevel: () => Room | undefined, history: Map<Room, RoomMessage[]>) {
  socket.on(sosEvent, (request: unknown, reply: (ack: Ack) => void) => {
    if (typeof reply !== 'function') return;
    const data = request as { id?: unknown; type?: unknown; room?: unknown } | null;
    if (!authenticated() || !data || typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/.test(data.id)
      || !isSosType(data.type) || (data.room !== undefined && !isRoom(data.room))) {
      reply({ ok: false, error: 'Invalid SOS or session.' }); return;
    }
    const source = data.room ?? profileLevel();
    if (!source || !isRoom(source)) { reply({ ok: false, error: 'Choose a level in your profile first.' }); return; }
    if (data.type !== 'flood' && !isRoom(data.room)) { reply({ ok: false, error: 'Choose a level channel for this SOS.' }); return; }
    const id = socket.data.publicKey + ':' + data.id;
    const signature = JSON.stringify({ type: data.type, room: data.room, source });
    const previous = accepted.get(id);
    if (previous) { reply(previous === signature ? { ok: true } : { ok: false, error: 'SOS ID already used.' }); return; }
    const destinations: readonly Room[] = data.type === 'flood' ? rooms : [source];
    for (const room of destinations) {
      const message: RoomMessage = { id: data.id, room, from: socket.data.publicKey, text: sosText(data.type, source) };
      history.set(room, [...(history.get(room) ?? []).slice(-99), message]);
      io.to('room-readers').emit(roomEvents.message, message);
    }
    accepted.set(id, signature);
    if (accepted.size > 5000) accepted.delete(accepted.keys().next().value!);
    reply({ ok: true });
  });
}
