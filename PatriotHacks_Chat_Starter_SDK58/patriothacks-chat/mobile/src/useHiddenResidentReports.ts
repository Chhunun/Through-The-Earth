import { useEffect, useState } from 'react';
import Storage from 'expo-sqlite/kv-store';

const cache = new Map<string, Set<string>>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const slot = (owner: string) => 'patriot:hidden-resident-reports:v1:' + owner;
function parse(raw: string | null): string[] {
  const value: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('Saved report preferences could not be read.');
  }
  return value;
}
function load(owner: string): Promise<void> {
  if (cache.has(owner)) return Promise.resolve();
  const existing = pending.get(owner);
  if (existing) return existing;
  const promise = Storage.getItemAsync(slot(owner)).then((raw) => {
    cache.set(owner, new Set(parse(raw)));
    notify();
  }).finally(() => { pending.delete(owner); });
  pending.set(owner, promise);
  return promise;
}
export const residentReportId = (...parts: (string | number)[]) => JSON.stringify(parts);

// Local display preferences only. Reports and chart totals stay on the relay.
export function useHiddenResidentReports(owner: string) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const refresh = () => redraw((value) => value + 1);
    listeners.add(refresh);
    if (owner) void load(owner).catch(() => {});
    return () => { listeners.delete(refresh); };
  }, [owner]);
  async function hideMany(ids: string[]) {
    if (!owner) throw new Error('Sign in before clearing reports.');
    await load(owner);
    await Storage.setItemAsync(slot(owner), (raw) => JSON.stringify([...new Set([...parse(raw), ...ids])]));
    ids.forEach((id) => cache.get(owner)!.add(id));
    notify();
  }
  return {
    hidden: (id: string) => !!cache.get(owner)?.has(id),
    hide: (id: string) => hideMany([id]),
    hideMany,
  };
}
