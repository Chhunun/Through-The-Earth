import { finishMapShare, pendingMapShares, queueMapShare } from './mapStorage';
import { io } from 'socket.io-client';
import { events, mapEvents, isWalkPath, type Ack, type Challenge, type WalkPath } from '@patriot/protocol';
import { proveIdentity, publicKey } from './crypto';

export async function mapConnection(
  onPaths: (paths: WalkPath[]) => void,
  onStatus: (online: boolean, error?: string) => void,
  onQueue: (count: number) => void = () => {},
) {
  const key = await publicKey();
  const url = process.env.EXPO_PUBLIC_RELAY_URL;
  if (!url) throw new Error('Set EXPO_PUBLIC_RELAY_URL in mobile/.env');
  let ready = false;
  let closed = false;
  let flushing: Promise<void> | undefined;
  async function refreshQueue() {
    const pending = await pendingMapShares(key);
    if (!closed) onQueue(pending.length);
    return pending;
  }
  function flush(): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
      const pending = await refreshQueue();
      for (const path of pending) {
        if (!ready || closed) return;
        const ack: Ack = await socket.timeout(5000).emitWithAck(mapEvents.contribute, path);
        if (!ack.ok) throw new Error(ack.error);
        // Acknowledge only after the relay commits to disk. Retries are idempotent.
        await finishMapShare(key, path.id);
        await refreshQueue();
      }
    })().finally(() => { flushing = undefined; });
    return flushing;
  }
  function retry() {
    void flush().catch((error) => { if (!closed) onStatus(ready, String(error)); });
  }
  const socket = io(url, { auth: { publicKey: key }, autoConnect: false });
  socket.on('disconnect', () => { ready = false; onStatus(false); });
  socket.on('connect_error', (error) => { ready = false; onStatus(false, error.message); });
  socket.on(mapEvents.path, (path: unknown) => {
    if (isWalkPath(path)) onPaths([path]);
  });
  socket.on(events.challenge, async (challenge: Challenge) => {
    ready = false;
    const connection = socket.id;
    try {
      const proof = await proveIdentity(challenge);
      if (socket.id !== connection) return;
      const ack: Ack = await socket.timeout(5000).emitWithAck(events.authenticate, proof);
      if (!ack.ok) throw new Error(ack.error);
      const paths: unknown[] = await socket.timeout(5000).emitWithAck(mapEvents.read);
      if (socket.id !== connection) return;
      ready = true;
      onPaths(paths.filter(isWalkPath));
      onStatus(true);
      retry();
    } catch (error) {
      if (socket.id === connection) onStatus(false, String(error));
    }
  });
  const timer = setInterval(retry, 10000);
  retry();
  socket.connect();
  return {
    close() { closed = true; ready = false; clearInterval(timer); socket.removeAllListeners(); socket.disconnect(); },
    async contribute(path: WalkPath): Promise<boolean> {
      await queueMapShare(key, path);
      try { await flush(); }
      catch (error) { if (!closed) onStatus(ready, String(error)); }
      return (await refreshQueue()).some((item) => item.id === path.id);
    },
  };
}
