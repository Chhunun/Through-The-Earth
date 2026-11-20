import DraggableMapPin from './DraggableMapPin';
import { pointOnMap, stackMapPlaces } from './mapMarkerLayout';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { MapPlace, MapPlaceKind, MapPoint, Room } from '@patriot/protocol';

export const placeSymbol = (kind: MapPlaceKind) => kind === 'personal' ? '●' : kind === 'blackout' ? '⚡' : '✕';
const placeColor = (kind: MapPlaceKind) => kind === 'personal' ? '#a78bfa' : kind === 'blackout' ? '#facc15' : '#fb7185';

export function MapPlaceLayer({ places, center, originLatitude, scale, width, height, picked, pick, inspect, move, interaction, online }: {
  places: MapPlace[]; center?: MapPoint; originLatitude: number; scale: number;
  width: number; height: number; picked?: MapPoint; pick: (point: MapPoint) => void;
  inspect: (place: MapPlace) => void; move: (place: MapPlace, point: MapPoint) => Promise<void>;
  interaction: (active: boolean) => void; online: boolean;
}) {
  const [stackIds, setStackIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const longitudeMeters = 111320 * Math.cos(originLatitude * Math.PI / 180);
  if (!center || Math.abs(longitudeMeters) < 1) return null;
  function screen(point: MapPoint) {
    return { x: width / 2 + (point.longitude - center!.longitude) * longitudeMeters * scale,
      y: height / 2 - (point.latitude - center!.latitude) * 111320 * scale };
  }
  const toPoint = (x: number, y: number) => pointOnMap(x, y, center, width, height, longitudeMeters, scale);
  const projected = places.map((place) => ({ place, ...screen(place.point) }))
    .filter((point) => point.x >= -20 && point.y >= -20 && point.x <= width + 20 && point.y <= height + 20);
  const groups = stackMapPlaces(projected.filter((p) => p.place.id !== selectedId));
  const selected = projected.find((p) => p.place.id === selectedId);
  if (selected) groups.push([selected]);
  const stack = places.filter((p) => stackIds.includes(p.id));
  const target = picked ? screen(picked) : undefined;
  return <>
    <Pressable accessibilityLabel="Map: hold to choose a pin location" delayLongPress={450}
      onLongPress={({ nativeEvent }) => { setSelectedId(undefined); pick(toPoint(nativeEvent.locationX, nativeEvent.locationY)); }}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
    {groups.map((group) => {
      const item = group[0];
      if (group.length === 1) return <DraggableMapPin key={item.place.id}
        item={item} width={width} height={height} color={placeColor(item.place.kind)} symbol={placeSymbol(item.place.kind)}
        online={online} toPoint={toPoint} inspect={inspect} interaction={interaction}
        move={async (place, point) => { try { await move(place, point); } finally { setSelectedId(undefined); } }} />;
      return <Pressable key={'stack:' + group.map((p) => p.place.id).join(',')} accessibilityRole="button"
        accessibilityLabel={group.length + ' overlapping markers. Open stack.'}
        onPress={() => setStackIds(group.map((p) => p.place.id))}
        style={{ position: 'absolute', left: item.x - 20, top: item.y - 38, width: 44, height: 42, zIndex: 5 }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 6, top: 0, width: 36, height: 34, borderRadius: 10, backgroundColor: '#475569', borderWidth: 1, borderColor: '#cbd5e1' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 3, top: 3, width: 36, height: 34, borderRadius: 10, backgroundColor: '#334155', borderWidth: 1, borderColor: '#cbd5e1' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 6, width: 36, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', borderWidth: 2, borderColor: '#e2e8f0' }}>
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>{group.length}</Text>
        </View>
      </Pressable>;
    })}
    {target ? <Text pointerEvents="none" style={{ position: 'absolute', left: target.x - 10, top: target.y - 15, color: '#fb923c', fontSize: 24 }}>＋</Text> : null}
    <Modal visible={stack.length > 0} transparent animationType="fade" onRequestClose={() => setStackIds([])}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#000a' }}>
        <View style={{ backgroundColor: '#0f172a', padding: 20, borderRadius: 16, gap: 14 }}>
          <Text className="text-lg font-bold text-white">Stacked locations · {stack.length}</Text>
          <ScrollView style={{ maxHeight: 350 }}>{stack.map((place) => <View key={place.id} style={{ gap: 8, marginBottom: 16 }}>
            <Text style={{ color: placeColor(place.kind) }}>{placeSymbol(place.kind)} {place.label}</Text>
            <View className="flex-row gap-3">
              <Pressable onPress={() => { setStackIds([]); inspect(place); }} className="rounded bg-slate-800 p-3"><Text className="text-white">Details</Text></Pressable>
              <Pressable disabled={place.kind !== 'personal' && !online} onPress={() => {
                setSelectedId(place.id); setStackIds([]);
              }} className="rounded bg-sky-800 p-3"><Text className="text-white">Select to drag</Text></Pressable>
            </View>
          </View>)}</ScrollView>
          <Text className="text-xs text-slate-300">Select one marker, then hold it until it highlights and drag it. Shared markers require a connection.</Text>
          <Pressable onPress={() => setStackIds([])}><Text className="text-sky-300">Close</Text></Pressable>
        </View>
      </View>
    </Modal>
  </>;
}

export function MapPlacesPanel({ level, target, picked, clearPicked, places, online, disabled, create, inspect, focus }: {
  level: Room; target?: MapPoint; picked: boolean; clearPicked: () => void; places: MapPlace[];
  online: boolean; disabled: boolean; create: (kind: MapPlaceKind, label: string, blackout: 'Some areas dark' | 'Whole level dark', point: MapPoint, id: string) => Promise<void>;
  inspect: (place: MapPlace) => void; focus: (point: MapPoint) => void;
}) {
  const [kind, setKind] = useState<MapPlaceKind>();
  const [selectedPoint, setSelectedPoint] = useState<MapPoint>();
  const [markerId, setMarkerId] = useState('');
  const [label, setLabel] = useState('');
  const [blackout, setBlackout] = useState<'Some areas dark' | 'Whole level dark'>('Some areas dark');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  function open(next: MapPlaceKind) {
    if (!target) { Alert.alert('Choose a location', 'Allow location access or hold a location on an existing map.'); return; }
    if (next !== 'personal' && !online) { Alert.alert('Relay offline', 'Reconnect before publishing a shared marker.'); return; }
    setSelectedPoint({ latitude: target.latitude, longitude: target.longitude });
    setMarkerId(Crypto.randomUUID());
    setKind(next); setLabel(next === 'block' ? 'Blocked passage' : next === 'blackout' ? 'Blackout' : '');
    setBlackout('Some areas dark'); setError('');
  }
  async function save() {
    if (!kind || saving || !selectedPoint) return;
    if (!label.trim()) { setError('Enter a name for this location.'); return; }
    setSaving(true);
    try { await create(kind, label.trim(), blackout, selectedPoint, markerId); setKind(undefined); }
    catch (cause) { setError(String(cause)); }
    finally { setSaving(false); }
  }
  return <View style={{ gap: 10 }}>
    <Text className="font-semibold text-white">Places · {level}</Text>
    <Text className="text-xs text-slate-300">{picked ? 'Using the orange target. ' : 'Using your location. '}Hold on the map to choose another spot.</Text>
    {picked ? <Pressable onPress={clearPicked}><Text className="text-sky-300">Use my location instead</Text></Pressable> : null}
    <View className="flex-row flex-wrap gap-2">
      {(['personal', 'blackout', 'block'] as const).map((value) => <Pressable key={value}
        disabled={disabled || saving} onPress={() => open(value)} className="rounded bg-slate-800 p-3">
        <Text style={{ color: placeColor(value) }}>{value === 'personal' ? 'Save pin' : value === 'blackout' ? 'Report blackout' : 'Block passage'}</Text>
      </Pressable>)}
    </View>
    <Text className="text-xs text-slate-400">Purple: your saved pins · Yellow: reported blackout · Red: blocked passage. Tap a stack to choose a marker. Hold a marker until it highlights, then drag to move it. Tap for details or removal.</Text>
    {!online ? <Text className="text-xs text-amber-200">Shared markers are a cached snapshot and may be outdated. Reconnect to update or remove them.</Text> : null}
    <ScrollView nestedScrollEnabled style={{ maxHeight: 180 }}>
      {places.map((place) => <View key={place.id} className="mb-2 flex-row items-center gap-3">
        <Pressable style={{ flex: 1 }} onPress={() => { focus(place.point); inspect(place); }}>
          <Text style={{ color: placeColor(place.kind) }}>{placeSymbol(place.kind)} {place.label}</Text>
          <Text className="text-xs text-slate-400">{place.kind === 'personal' ? 'Private' : 'Resident report'} · {new Date(place.createdAt).toLocaleString()}</Text>
        </Pressable>
      </View>)}
      {!places.length ? <Text className="text-xs text-slate-400">No saved places or reports on this level yet.</Text> : null}
    </ScrollView>
    <Modal visible={!!kind} transparent animationType="fade" onRequestClose={() => { if (!saving) setKind(undefined); }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#000a' }}>
        <View style={{ backgroundColor: '#0f172a', padding: 20, borderRadius: 16, gap: 14 }}>
          <Text className="text-lg font-bold text-white">{kind === 'personal' ? 'Save private place' : kind === 'block' ? 'Report blocked passage' : 'Report blackout'}</Text>
          <Text className="text-slate-300">{level}</Text>
          <TextInput accessibilityLabel="Location name" value={label} onChangeText={setLabel} maxLength={80}
            placeholder="Location name" placeholderTextColor="#94a3b8" className="rounded bg-slate-800 p-3 text-white" />
          {kind === 'blackout' ? <View style={{ gap: 8 }}>{(['Some areas dark', 'Whole level dark'] as const).map((choice) =>
            <Pressable key={choice} onPress={() => setBlackout(choice)} className="rounded bg-slate-800 p-3">
              <Text className="text-white">{blackout === choice ? '● ' : '○ '}{choice}</Text>
            </Pressable>)}</View> : null}
          <Text className="text-sm text-slate-300">{kind === 'personal' ? 'Saved only on this device for your account.' : 'This sends the selected coordinates to everyone on this relay. Anyone can remove the marker.'}</Text>
          {kind === 'blackout' ? <Text className="text-xs text-slate-400">Also updates your lighting-blackout answer in Status for this level. Removing this marker does not change that answer.</Text> : null}
          {error ? <Text className="text-rose-300">{error}</Text> : null}
          <View className="flex-row gap-3">
            <Pressable disabled={saving} onPress={() => setKind(undefined)} className="rounded bg-slate-800 p-3"><Text className="text-white">Cancel</Text></Pressable>
            <Pressable disabled={saving} onPress={() => { void save(); }} className="rounded bg-sky-800 p-3"><Text className="text-white">{saving ? 'Saving…' : kind === 'personal' ? 'Save pin' : 'Publish report'}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}
