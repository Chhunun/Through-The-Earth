import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { isPublicKey, profileLabel, type ChatProfiles } from '@patriot/protocol';
import { savedContacts, storeContact } from './storage';

type Props = {
  owner: string;
  recipient: string;
  profiles: ChatProfiles;
  select: (key: string) => void;
};

export default function SavedContacts({ owner, recipient, profiles, select }: Props) {
  const [contacts, setContacts] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const saved = contacts.includes(recipient);
  const canSave = loaded && !busy && isPublicKey(recipient) && recipient !== owner;

  useEffect(() => {
    if (!owner) return;
    let active = true;
    setLoaded(false);
    setContacts([]);
    savedContacts(owner).then((items) => {
      if (!active) return;
      setContacts(items);
      setLoaded(true);
      setStatus('');
    }).catch(() => {
      if (active) setStatus('Could not load saved contacts.');
    });
    return () => { active = false; };
  }, [owner]);

  async function toggleContact() {
    if (!canSave) return;
    setBusy(true);
    setStatus('');
    try {
      await storeContact(owner, recipient, !saved);
      setContacts((items) => saved ? items.filter((key) => key !== recipient) : [...items, recipient]);
      setStatus(saved ? 'Contact removed.' : 'Contact saved.');
    } catch {
      setStatus('Could not update saved contacts.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-2">
      {contacts.length ? (
        <>
          <Text className="text-sm font-semibold text-zinc-200">Saved contacts</Text>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
            {contacts.map((key) => {
              const label = profiles[key] ? profileLabel(profiles[key]) : key.slice(0, 10) + '…';
              return (
                <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: key === recipient }}
                  onPress={() => select(key)}
                  className={key === recipient ? 'rounded-lg bg-sky-800 px-3 py-2' : 'rounded-lg bg-zinc-800 px-3 py-2'}>
                  <Text className="text-white">{label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}
      {isPublicKey(recipient) && recipient !== owner ? (
        <Pressable accessibilityRole="button" disabled={!canSave} onPress={toggleContact}
          className="self-start rounded-lg bg-zinc-800 px-3 py-2 disabled:opacity-50">
          <Text className="text-white">{saved ? 'Remove contact' : 'Save contact'}</Text>
        </Pressable>
      ) : null}
      {status ? <Text accessibilityLiveRegion="polite" className="text-xs text-zinc-300">{status}</Text> : null}
    </View>
  );
}
