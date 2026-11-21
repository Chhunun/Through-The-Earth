import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { MapPoint } from '@patriot/protocol';
import type { MapPing } from '../../shared/mapPings';

export default function MapPingList({ pings, ownKey, stop, focus, pending, clear, clearAll }: {
  clear: (id: string) => void; clearAll: () => void;
  pings: MapPing[]; ownKey: string; stop: () => void; focus: (point: MapPoint) => void; pending: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const visible = pings.filter((p) => p.expiresAt > now);
  return <View style={{ gap: 8 }}>
    <Text className="font-mono font-semibold text-term-glow">Location pings · selected map level</Text>
    <Pressable accessibilityRole="button" disabled={!visible.length || !ownKey} onPress={clearAll}
      className="self-start rounded border border-term-line px-3 py-2 disabled:opacity-50">
      <Text className="font-mono text-term-text">Clear all pings</Text>
    </Pressable>
    <Text className="font-mono text-xs text-term-dim">Clears pings on this level for you only. New pings still appear.</Text>
    {!visible.length ? <Text className="font-mono text-xs text-term-muted">No visible location pings.</Text> : null}
    <ScrollView nestedScrollEnabled style={{ maxHeight: 160 }}>
      {visible.map((ping) => <View key={ping.id} className="mb-2 rounded border border-term-line bg-term-field p-3"><Pressable accessibilityRole="button" onPress={() => focus(ping.point)}>
        <Text style={{ color: ping.emergency ? '#fb7185' : '#22d3ee', fontWeight: 'bold' }}>{ping.simulated ? 'TEST · ' : ''}{ping.emergency ? 'SOS · ' : ''}{ping.name}{ping.from === ownKey ? ' (you)' : ''}</Text>
        <Text className="font-mono text-xs text-term-dim">{ping.simulated ? 'Simulated position' : (ping.live ? 'Live position · ±' : 'Shared position · ±') + Math.round(ping.accuracy * 3.28084) + ' ft'} · {ping.live ? 'Updated ' + Math.max(0, Math.floor((now - ping.sentAt) / 1000)) + 's ago' : Math.max(0, Math.ceil((ping.expiresAt - now) / 1000)) + 's left'} · Tap to locate</Text>
      </Pressable>
        <Pressable accessibilityRole="button" disabled={!ownKey} accessibilityLabel={'Clear ' + ping.name + ' location ping for me only'}
          onPress={() => clear(ping.id)} className="mt-2 self-start rounded border border-term-line px-3 py-2">
          <Text className="font-mono text-term-text">Clear for me</Text>
        </Pressable>
      </View>)}
    </ScrollView>
    {visible.some((p) => p.from === ownKey) ? <Pressable disabled={pending} onPress={stop}><Text className="font-mono text-term-glow">Stop sharing my ping</Text></Pressable> : null}
  </View>;
}
