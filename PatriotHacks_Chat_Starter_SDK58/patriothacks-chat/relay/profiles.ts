import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPublicKey, parseChatProfile, type ChatProfile, type ChatProfiles } from '@patriot/protocol';

const path = process.env.PATRIOT_PROFILES_FILE ?? fileURLToPath(new URL('./profiles.local.json', import.meta.url));

function readProfiles(): ChatProfiles {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return Object.fromEntries(Object.entries(data).flatMap(([key, value]) => {
      const profile = parseChatProfile(value);
      return isPublicKey(key) && profile ? [[key, profile]] : [];
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export let profiles = readProfiles();

export function storeProfile(key: string, profile: ChatProfile) {
  if (!profiles[key] && Object.keys(profiles).length >= 1000) return false;
  const next = { ...profiles, [key]: profile };
  const temporary = path + '.tmp';
  writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
  renameSync(temporary, path);
  profiles = next;
  return true;
}
