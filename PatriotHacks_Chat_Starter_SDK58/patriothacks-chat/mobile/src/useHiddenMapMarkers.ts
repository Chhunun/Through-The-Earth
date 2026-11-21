import { useEffect, useState } from 'react';
import Storage from 'expo-sqlite/kv-store';

type MarkerKind = 'place' | 'ping';
const saved = new Map<string, Set<string>>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const entry = (kind: MarkerKind, id: string) => JSON.stringify([kind, id]);
const slot = (owner: string) => 'patriot:hidden-map-markers:v1:' + owner;
function parse(raw: string | null): string[] {
  const value: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('Saved marker preferences could not be read.');
  }
  return value;
}
function load(owner: string): Promise<void> {
  if (saved.has(owner)) return Promise.resolve();
  const pending = loading.get(owner);
  if (pending) return pending;
  const promise = Storage.getItemAsync(slot(owner)).then((raw) => {
    saved.set(owner, new Set(parse(raw)));
    notify();
  }).finally(() => { loading.delete(owner); });
  loading.set(owner, promise);
  return promise;
}

// Clearing is a display preference, never a relay delete or a stop-sharing call.
// Ping IDs identify sharing sessions, so movement cannot undo a dismissal.
export function useHiddenMapMarkers(owner: string) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const refresh = () => redraw((value) => value + 1);
    listeners.add(refresh);
    if (owner) void load(owner).catch(() => {});
    return () => { listeners.delete(refresh); };
  }, [owner]);
  return {
    hidden: (kind: MarkerKind, id: string) => !!saved.get(owner)?.has(entry(kind, id)),
    async hide(kind: MarkerKind, ids: string[]) {
      if (!owner) throw new Error('Sign in before clearing markers.');
      await load(owner);
      const entries = ids.map((id) => entry(kind, id));
      await Storage.setItemAsync(slot(owner), (previous) =>
        JSON.stringify([...new Set([...parse(previous), ...entries])]),
      );
      entries.forEach((item) => saved.get(owner)!.add(item));
      notify();
    },
  };
}
