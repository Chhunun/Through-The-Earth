import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { MapPoint } from '@patriot/protocol';
import type { MapPing } from '../../shared/mapPings';

export default function MapPingList({ pings, ownKey, stop, focus, pending }: {
  pings: MapPing[]; ownKey: string; stop: () => void; focus: (point: MapPoint) => void; pending: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const visible = pings.filter((p) => p.expiresAt > now);
  if (!visible.length) return null;
  return <View style={{ gap: 8 }}>
    <Text className="font-mono font-semibold text-term-glow">Location pings · selected map level</Text>
    <ScrollView nestedScrollEnabled style={{ maxHeight: 160 }}>
      {visible.map((ping) => <Pressable key={ping.id} onPress={() => focus(ping.point)} className="mb-2 rounded border border-term-line bg-term-field p-3">
        <Text style={{ color: ping.emergency ? '#fb7185' : '#22d3ee', fontWeight: 'bold' }}>{ping.simulated ? 'TEST · ' : ''}{ping.emergency ? 'SOS · ' : ''}{ping.name}{ping.from === ownKey ? ' (you)' : ''}</Text>
        <Text className="font-mono text-xs text-term-dim">{ping.simulated ? 'Simulated position' : 'Shared position · ±' + Math.round(ping.accuracy * 3.28084) + ' ft'} · {Math.max(0, Math.ceil((ping.expiresAt - now) / 1000))}s left · Tap to locate</Text>
      </Pressable>)}
    </ScrollView>
    {visible.some((p) => p.from === ownKey) ? <Pressable disabled={pending} onPress={stop}><Text className="font-mono text-term-glow">Stop sharing my ping</Text></Pressable> : null}
  </View>;
}
