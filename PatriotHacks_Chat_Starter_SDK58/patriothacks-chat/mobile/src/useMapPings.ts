import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { events, type Ack, type Challenge, type Room, type MapPoint } from '@patriot/protocol';
import { mapPingEvents, isPingSnapshot, type MapPing, type PingSnapshot } from '../../shared/mapPings';
import { proveIdentity, publicKey } from './crypto';

export function useMapPings(level: Room | undefined, expectedKey: string) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  const [pings, setPings] = useState<MapPing[]>([]);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef<ReturnType<typeof io> | undefined>(undefined);
  const ready = useRef(false);
  const now = useRef(Date.now());
  useEffect(() => {
    let active = true;
    let socket: ReturnType<typeof io> | undefined;
    let revision = -1;
    ready.current = false;
    setOnline(false); setPings([]); setError('');
    const tick = setInterval(() => {
      now.current = Date.now();
      setPings((current) => current.some((p) => p.expiresAt <= now.current) ? current.filter((p) => p.expiresAt > now.current) : current);
    }, 1000);
    function receive(value: unknown) {
      if (!active || !isPingSnapshot(value) || value.level !== level || value.revision < revision) return;
      revision = value.revision;
      setPings(value.pings.filter((p) => p.expiresAt > Date.now()));
    }
    async function connect() {
      if (!level || !expectedKey || !foreground) return;
      if (await publicKey() !== expectedKey || !active) return;
      const url = process.env.EXPO_PUBLIC_RELAY_URL;
      if (!url) throw new Error('Set EXPO_PUBLIC_RELAY_URL in mobile/.env');
      socket = io(url, { auth: { publicKey: expectedKey }, autoConnect: false });
      socketRef.current = socket;
      socket.on(mapPingEvents.snapshot, receive);
      socket.on('disconnect', () => { ready.current = false; if (active) { setOnline(false); setPings([]); } });
      socket.on('connect_error', (cause) => { if (active) { setError(cause.message); setOnline(false); } });
      socket.on(events.challenge, async (challenge: Challenge) => {
        const connectionId = socket?.id;
        revision = -1;
        ready.current = false;
        try {
          const proof = await proveIdentity(challenge);
          if (!active || socket?.id !== connectionId) return;
          const auth: Ack = await socket!.timeout(5000).emitWithAck(events.authenticate, proof);
          if (!auth.ok) throw new Error(auth.error);
          const result: { ok: boolean; snapshot?: PingSnapshot; error?: string } =
            await socket!.timeout(5000).emitWithAck(mapPingEvents.watch, level);
          if (!active || socket?.id !== connectionId) return;
          if (!result.ok) throw new Error(result.error);
          receive(result.snapshot);
          ready.current = true; setOnline(true); setError('');
        } catch (cause) { if (active) { setError(String(cause)); setOnline(false); } }
      });
      socket.connect();
    }
    void connect().catch((cause) => { if (active) setError(String(cause)); });
    return () => {
      active = false; ready.current = false; clearInterval(tick);
      socket?.removeAllListeners(); socket?.disconnect();
      if (socketRef.current === socket) socketRef.current = undefined;
    };
  }, [level, expectedKey, foreground]);
  return {
    pings, online, error,
    async publish(id: string, point: MapPoint, accuracy: number, emergency: boolean) {
      if (!ready.current || !socketRef.current) throw new Error('Connect to the relay on your own level to send a location ping.');
      const ack: Ack = await socketRef.current.timeout(5000).emitWithAck(mapPingEvents.send, { id, level, point, accuracy, emergency });
      if (!ack.ok) throw new Error(ack.error);
    },
    async stop() {
      if (!ready.current || !socketRef.current) throw new Error('Reconnect to stop your ping early. Otherwise it expires automatically.');
      const ack: Ack = await socketRef.current.timeout(5000).emitWithAck(mapPingEvents.stop);
      if (!ack.ok) throw new Error(ack.error);
    },
  };
}
