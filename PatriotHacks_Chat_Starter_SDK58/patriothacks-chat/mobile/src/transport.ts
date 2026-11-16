import { io } from 'socket.io-client';
import { events, isEnvelope, incidentEvent, type IncidentSnapshot, profileEvents, reportEvents, type ChatProfile, type ChatProfiles, roomEvents, type LevelReport, type LevelReportResult, type Room, type RoomMessage, type Ack, type Challenge, type Envelope } from '@patriot/protocol';
import { proveIdentity } from './crypto';

export function connectRelay(
  url: string,
  key: string,
  onMessage: (message: Envelope) => Promise<void>,
  onRoomMessage: (message: RoomMessage) => void,
  onProfiles: (profiles: ChatProfiles, replace: boolean) => void,
  onIncidents: (snapshot: IncidentSnapshot) => void,
  onStatus: (online: boolean, error?: string) => void,
) {
  const socket = io(url, { auth: { publicKey: key }, autoConnect: false });
  let authenticated = false;

  socket.on('disconnect', () => {
    authenticated = false;
    onStatus(false);
  });
  socket.on('connect_error', (error) => onStatus(false, error.message));

  socket.on(events.challenge, async (challenge: Challenge) => {
    const connectionId = socket.id;
    try {
      const proof = await proveIdentity(challenge);
      if (socket.id !== connectionId) return;
      const ack: Ack = await socket.timeout(5000).emitWithAck(events.authenticate, proof);
      if (!ack.ok) throw new Error(ack.error);
      if (socket.id !== connectionId) return;
      authenticated = true;
      onStatus(true);
    } catch (error) {
      if (socket.id === connectionId) onStatus(false, String(error));
    }
  });

  socket.on(events.receive, async (message: unknown) => {
    if (!isEnvelope(message) || message.to !== key) return;
    const connectionId = socket.id;
    try {
      await onMessage(message);
      if (socket.connected && socket.id === connectionId) {
        socket.emit(events.received, message.from, message.id);
      }
    } catch (error) {
      console.warn('Could not accept message', String(error));
    }
  });
  socket.on(roomEvents.message, onRoomMessage);
  socket.on(profileEvents.snapshot, (profiles: ChatProfiles) => onProfiles(profiles, true));
  socket.on(profileEvents.changed, (key: string, profile: ChatProfile) =>
    onProfiles({ [key]: profile }, false));
  socket.on(incidentEvent, onIncidents);
  socket.connect();

  return {
    close() {
      socket.removeAllListeners();
      socket.disconnect();
    },
    async saveProfile(profile: ChatProfile) {
      if (!authenticated || !socket.connected) throw new Error('Relay is offline');
      const ack: Ack = await socket.timeout(5000).emitWithAck(profileEvents.save, profile);
      if (!ack.ok) throw new Error(ack.error);
    },
    async levelReport(room: Room, report?: LevelReport) {
      if (!authenticated || !socket.connected) throw new Error('Relay is offline');
      const request = socket.timeout(5000);
      const result: LevelReportResult = report
        ? await request.emitWithAck(reportEvents.submit, room, report)
        : await request.emitWithAck(reportEvents.read, room);
      if (!result.ok) throw new Error(result.error);
      return result.view;
    },
    roomHistory(room: Room): Promise<RoomMessage[]> {
      return socket.timeout(5000).emitWithAck(roomEvents.history, room);
    },
    async sendRoom(room: Room, text: string) {
      if (!authenticated || !socket.connected) throw new Error('Relay is offline');
      const ack: Ack = await socket.timeout(5000).emitWithAck(roomEvents.send, room, text);
      if (!ack.ok) throw new Error(ack.error);
    },
    async send(message: Envelope) {
      if (!authenticated || !socket.connected) throw new Error('Relay is offline');
      const ack: Ack = await socket.timeout(5000).emitWithAck(events.send, message);
      if (!ack.ok) throw new Error(ack.error);
    },
  };
}
