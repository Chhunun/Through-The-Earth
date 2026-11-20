import { mapPlaceEvents, isMapPlaceSnapshot, type MapPlaceSnapshot, type SharedMapPlace, type MapPoint } from '@patriot/protocol';
import { finishMapShare, pendingMapShares, queueMapShare, loadRemovedPathIds, forgetSharedPath, forgetSharedPaths } from './mapStorage';
import { io } from 'socket.io-client';
import { events, mapEvents, isWalkPath, isMapPathState, type Ack, type Challenge, type WalkPath } from '@patriot/protocol';
import { proveIdentity, publicKey } from './crypto';

export async function mapConnection(
  onPaths: (paths: WalkPath[]) => void,
  onStatus: (online: boolean, error?: string) => void,
  onQueue: (count: number) => void = () => {},
  onPlaces: (snapshot: MapPlaceSnapshot) => void = () => {},
  onRemovedPaths: (ids: string[]) => void = () => {},
) {
  const key = await publicKey();
  const deleted = new Set(await loadRemovedPathIds());
  function removed(ids: string[]) {
    for (const id of ids) deleted.add(id);
    onRemovedPaths(ids);
    void forgetSharedPaths(ids).catch((error) => { if (!closed) onStatus(ready, String(error)); });
  }
  const url = process.env.EXPO_PUBLIC_RELAY_URL;
  if (!url) throw new Error('Set EXPO_PUBLIC_RELAY_URL in mobile/.env');
  let ready = false;
  let markerRevision = -1;
  function receivePlaces(value: unknown) {
    if (isMapPlaceSnapshot(value) && value.revision >= markerRevision) {
      markerRevision = value.revision;
      onPlaces(value);
    }
  }
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
        if (!ack.ok) {
          if (ack.error === 'PATH_REMOVED') { removed([path.id]); await finishMapShare(key, path.id); await refreshQueue(); continue; }
          throw new Error(ack.error);
        }
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
  socket.on(mapPlaceEvents.snapshot, receivePlaces);
  socket.on('disconnect', () => { ready = false; onStatus(false); });
  socket.on('connect_error', (error) => { ready = false; onStatus(false, error.message); });
  socket.on(mapEvents.removed, (id: unknown) => {
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) removed([id]);
  });
  socket.on(mapEvents.path, (path: unknown) => {
    if (isWalkPath(path) && !deleted.has(path.id)) onPaths([path]);
  });
  socket.on(events.challenge, async (challenge: Challenge) => {
    ready = false;
    markerRevision = -1;
    const connection = socket.id;
    try {
      const proof = await proveIdentity(challenge);
      if (socket.id !== connection) return;
      const ack: Ack = await socket.timeout(5000).emitWithAck(events.authenticate, proof);
      if (!ack.ok) throw new Error(ack.error);
      const state: unknown = await socket.timeout(5000).emitWithAck(mapEvents.sync);
      if (!isMapPathState(state)) throw new Error('Invalid shared map response. Restart the updated relay.');
      removed(state.deletedIds);
      if (socket.id !== connection) return;
      const places: unknown = await socket.timeout(5000).emitWithAck(mapPlaceEvents.read);
      if (closed || socket.id !== connection) return;
      receivePlaces(places);
      ready = true;
      onPaths(state.paths.filter((path) => !deleted.has(path.id)));
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
    async removePath(id: string) {
      if (!ready) throw new Error('Connect to the relay to delete a shared path.');
      const ack: Ack = await socket.timeout(5000).emitWithAck(mapEvents.remove, id);
      if (!ack.ok) throw new Error(ack.error);
      removed([id]);
      await forgetSharedPath(id);
    },
    async addPlace(place: SharedMapPlace) {
      if (!ready) throw new Error('Connect to the relay to publish a shared marker.');
      const ack: Ack = await socket.timeout(5000).emitWithAck(mapPlaceEvents.add, place);
      if (!ack.ok) throw new Error(ack.error);
    },
    async movePlace(id: string, from: MapPoint, to: MapPoint) {
      if (!ready) throw new Error('Connect to the relay to move a shared marker.');
      const ack: Ack = await socket.timeout(5000).emitWithAck(mapPlaceEvents.move, id, from, to);
      if (!ack.ok) throw new Error(ack.error);
    },
    async removePlace(id: string) {
      if (!ready) throw new Error('Connect to the relay to remove a shared marker.');
      const ack: Ack = await socket.timeout(5000).emitWithAck(mapPlaceEvents.remove, id);
      if (!ack.ok) throw new Error(ack.error);
    },
    async contribute(path: WalkPath): Promise<boolean> {
      await queueMapShare(key, path);
      try { await flush(); }
      catch (error) { if (!closed) onStatus(ready, String(error)); }
      return (await refreshQueue()).some((item) => item.id === path.id);
    },
  };
}
