import { useEffect, useState } from 'react';
import term from './terminal-colors.json';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import type { Room, WalkPath } from '@patriot/protocol';

export default function MapPathsPanel({ paths, sharedIds, selectedId, level, ownLevel, online, pending, select, remove, share }: {
  paths: WalkPath[]; sharedIds: Set<string>; selectedId?: string; level: Room; ownLevel?: Room;
  online: boolean; pending: boolean; select: (path: WalkPath) => void;
  remove: (path: WalkPath) => Promise<void>; share: (path: WalkPath) => Promise<void>;
}) {
  const residents = ownLevel === level;
  const [limit, setLimit] = useState(20);
  useEffect(() => setLimit(20), [level]);
  return <View style={{ gap: 8 }}>
    <Text className="font-mono font-semibold text-term-text">Recorded walks · {level}</Text>
    <Text className="font-mono text-xs text-term-dim">Shared walks are visible to everyone viewing this level. Select a walk to highlight it in amber before deleting.</Text>
    {!residents ? <Text className="font-mono text-xs text-term-muted">Only profiles belonging to this level can delete its shared walks.</Text> : null}
    {!online ? <Text className="font-mono text-xs text-amber-200">Offline map: shared walks may be outdated. Reconnect to receive deletions or delete a shared walk.</Text> : null}
    <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }}>
      {paths.slice(0, limit).map((path, index) => {
        const shared = sharedIds.has(path.id);
        return <View key={path.id} style={{ padding: 10, marginBottom: 6, borderRadius: 2,
          borderWidth: 1, borderColor: path.id === selectedId ? '#fbbf24' : term.line, backgroundColor: term.panel, gap: 8 }}>
          <Pressable onPress={() => select(path)} accessibilityRole="button">
            <Text className="font-mono text-term-text">Walk {index + 1} · {path.points.length} points · {shared ? 'Shared' : 'Saved on device'}</Text>
            <Text className="font-mono text-xs text-term-muted">{path.id.slice(0, 8)} · Tap to highlight</Text>
          </Pressable>
          {shared ? <Pressable disabled={!online || !residents || pending} onPress={() => {
            select(path);
            Alert.alert('Delete this recorded walk?', 'This removes the whole highlighted recording from the shared level map for everyone. Other overlapping recordings may still show the route.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete shared walk', style: 'destructive', onPress: () => { void remove(path).catch(() => {}); } },
            ]);
          }}><Text className="font-mono" style={{ color: !online || !residents || pending ? term.muted : '#fda4af' }}>Delete shared walk</Text></Pressable>
            : <Pressable disabled={pending} onPress={() => Alert.alert('Share this recorded walk?', 'Everyone viewing this level can see the route coordinates. Your live location marker remains private.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Share path', onPress: () => { void share(path).catch(() => {}); } },
            ])}><Text className="font-mono text-term-glow">Share path</Text></Pressable>}
        </View>;
      })}
      {paths.length > limit ? <Pressable onPress={() => setLimit((count) => count + 20)}><Text className="font-mono text-term-glow">Show more walks ({paths.length - limit} remaining)</Text></Pressable> : null}
      {!paths.length ? <Text className="font-mono text-xs text-term-muted">No recorded walks on this level.</Text> : null}
    </ScrollView>
  </View>;
}
