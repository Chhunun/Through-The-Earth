import { useChat } from '../src/chat';
import { publicKey } from '../src/crypto';
import MapPathLayer from '../src/MapPathLayer';
import { mergeWalkPaths } from '../src/mergeWalkPaths';
import MapJoystick from '../src/MapJoystick';
import { mapDistance } from '../src/mapScale';
import MapControls from '../src/MapControls';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { rooms, type MapPoint, type Room, type WalkPath } from '@patriot/protocol';
import { mapConnection } from '../src/mapConnection';
import { loadMap, saveMapPath, queueMapShare } from '../src/mapStorage';

export default function MapScreen() {
  const canTest = useChat((state) => state.profiles[state.key]?.name === 'test');
  const [pendingShares, setPendingShares] = useState(0);
  const [usingJoystick, setUsingJoystick] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPaths, setTestPaths] = useState<WalkPath[]>([]);
  const [heading, setHeading] = useState<number>();
  const [headingSource, setHeadingSource] = useState('');
  const headingWatcher = useRef<Location.LocationSubscription | undefined>(undefined);
  const headingFreshAt = useRef(0);
  const displayedHeading = useRef({ value: -1, at: 0 });
  const testPoint = useRef<MapPoint>({ latitude: 0, longitude: 0 });
  const [level, setLevel] = useState<Room>('Middle Level');
  const [paths, setPaths] = useState<WalkPath[]>([]);
  const [position, setPosition] = useState<MapPoint>();
  const [accuracy, setAccuracy] = useState<number>();
  const [draft, setDraft] = useState<WalkPath>();
  const [recording, setRecording] = useState(false);
  const [consent, setConsent] = useState(false);
  const [online, setOnline] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(2);
  const [size, setSize] = useState({ width: 300, height: 300 });
  const watcher = useRef<Location.LocationSubscription | undefined>(undefined);
  const walk = useRef<WalkPath | undefined>(undefined);
  const active = useRef(true);
  const generation = useRef(0);
  const connection = useRef<Awaited<ReturnType<typeof mapConnection>> | undefined>(undefined);

  function stop() {
    generation.current++;
    watcher.current?.remove();
    watcher.current = undefined;
    headingWatcher.current?.remove();
    headingWatcher.current = undefined;
    displayedHeading.current = { value: -1, at: 0 };
    setHeading(undefined);
    setHeadingSource('');
    setRecording(false);
    setUsingJoystick(false);
    setPosition(undefined);
    setBusy(false);
  }

  useEffect(() => {
    if (!canTest && testing) {
      stop();
      walk.current = undefined;
      setDraft(undefined);
      setTestPaths([]);
      setTesting(false);
    }
  }, [canTest, testing]);

  useEffect(() => {
    active.current = true;
    function merge(incoming: WalkPath[]) {
      if (!active.current) return;
      setPaths((current) => [...new Map([...current, ...incoming].map((path) => [path.id, path])).values()]);
    }
    loadMap().then(merge).catch(() => setMessage('Could not load the cached map.'));
    mapConnection((incoming) => {
      merge(incoming);
      for (const path of incoming) void saveMapPath(path).catch(() => {
        if (active.current) setMessage('Could not cache a shared path.');
      });
    }, (connected, error) => {
      if (!active.current) return;
      setOnline(connected);
      if (error) setMessage(error);
    }, (count) => { if (active.current) setPendingShares(count); }).then((relay) => {
      if (active.current) connection.current = relay;
      else relay.close();
    }).catch((error) => { if (active.current) setMessage(String(error)); });
    Alert.alert('Contribute walking paths?', 'Recording uses your phone’s location while this map is open. Saved paths stay on this device until you tap Share path. Sharing sends the route to everyone on the relay. Your live marker stays on this phone. Select your current floor manually.',
      [{ text: 'Browse only' }, { text: 'Allow recording', onPress: () => setConsent(true) }]);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        stop();
        setPosition(undefined);
      }
    });
    return () => {
      active.current = false;
      generation.current++;
      watcher.current?.remove();
      headingWatcher.current?.remove();
      connection.current?.close();
      subscription.remove();
    };
  }, []);

  async function start() {
    if (busy || recording) return;
    if (walk.current?.points.length) {
      setMessage('Save or discard your current walk before starting another.');
      return;
    }
    if (testing) {
      if (!canTest) return;
      const next: WalkPath = { id: Crypto.randomUUID(), level, points: [{ ...testPoint.current }] };
      walk.current = next;
      setDraft(next);
      setPosition({ ...testPoint.current });
      setRecording(true);
      setMessage('Simulated walk. Drag the joystick to move.');
      return;
    }
    if (!consent) {
      Alert.alert('Allow path recording?', 'Use location while this map is open to draw your walk. Sharing is a separate action.',
        [{ text: 'Cancel' }, { text: 'Allow', onPress: () => setConsent(true) }]);
      return;
    }
    const request = ++generation.current;
    setBusy(true);
    setMessage('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active.current || generation.current !== request) return;
      if (!permission.granted) throw new Error('Location permission was denied. You can still browse the map.');
      try {
        const compass = await Location.watchHeadingAsync((value) => {
          if (!active.current || generation.current !== request) return;
          if (value.accuracy < 1) return;
          const bearing = value.trueHeading >= 0 ? value.trueHeading : value.magHeading;
          if (!Number.isFinite(bearing) || bearing < 0) return;
          headingFreshAt.current = Date.now();
          const previous = displayedHeading.current;
          const difference = Math.abs(((bearing - previous.value + 540) % 360) - 180);
          if (Date.now() - previous.at < 150 || (previous.value >= 0 && difference < 2)) return;
          displayedHeading.current = { value: bearing, at: Date.now() };
          setHeading(bearing);
          setHeadingSource(value.trueHeading >= 0 ? 'Phone heading' : 'Magnetic heading');
        });
        if (!active.current || generation.current !== request) { compass.remove(); return; }
        headingWatcher.current = compass;
      } catch {
        if (!active.current || generation.current !== request) return;
      }
      const next: WalkPath = { id: Crypto.randomUUID(), level, points: [] };
      walk.current = next;
      setDraft(next);
      const subscription = await Location.watchPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2, timeInterval: 1500,
      }, (location) => {
        if (!active.current || generation.current !== request) return;
        const { latitude, longitude, accuracy } = location.coords;
        setAccuracy(accuracy ?? undefined);
        if (accuracy === null || accuracy > 20 || Date.now() - location.timestamp > 15000) {
          setPosition(undefined);
          if (next.points.length) {
            stop();
            setMessage('Recording paused because location became uncertain. Save this segment, then start a new walk.');
          } else setMessage('Location is uncertain. Waiting for a more accurate fix.');
          return;
        }
        const point = { latitude, longitude };
        setPosition(point);
        if (Date.now() - headingFreshAt.current > 5000) {
          const course = location.coords.heading;
          if (course !== null && course >= 0 && (location.coords.speed ?? 0) > 0.5) {
            setHeading(course);
            setHeadingSource('Direction of movement');
          } else { setHeading(undefined); setHeadingSource(''); }
        }
        setMessage('Estimated position. Indoor accuracy may be limited.');
        next.points = [...next.points, point];
        setDraft({ ...next });
        if (next.points.length >= 300) {
          stop();
          setMessage('Walk limit reached. Save this path before recording another.');
        }
      });
      if (!active.current || generation.current !== request) subscription.remove();
      else {
        watcher.current = subscription;
        setRecording(true);
        setMessage('Recording. Waiting for a location fix…');
      }
    } catch (error) {
      if (active.current && generation.current === request) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (active.current && generation.current === request) setBusy(false);
    }
  }

  async function save(share: boolean) {
    const path = walk.current;
    if (!path || path.points.length < 2) { setMessage('Walk far enough to collect at least two location fixes.'); return; }
    stop();
    if (testing) {
      setTestPaths((current) => [...current, path]);
      walk.current = undefined;
      setDraft(undefined);
      setMessage('Test path kept for this map session.');
      return;
    }
    setBusy(true);
    let queued = false;
    try {
      await saveMapPath(path);
      setPaths((current) => [...new Map([...current, path].map((item) => [item.id, item])).values()]);
      if (share) {
        if (connection.current) queued = await connection.current.contribute(path);
        else {
          await queueMapShare(await publicKey(), path);
          queued = true;
          setPendingShares((count) => count + 1);
        }
      }
      walk.current = undefined;
      setDraft(undefined);
      setMessage(queued ? 'Path saved and queued. Open this map when connected to finish sharing.' : share ? 'Path shared. Your live marker remains private.' : 'Path saved on this device.');
    } catch (error) { setMessage(String(error)); }
    finally { if (active.current) setBusy(false); }
  }

  function moveTest(east: number, north: number) {
    if (!canTest || !testing || !recording || !walk.current) return;
    const last = testPoint.current;
    const next = { latitude: last.latitude + north / 111320,
      longitude: last.longitude + east / (111320 * Math.cos(last.latitude * Math.PI / 180)) };
    testPoint.current = next;
    const path = walk.current;
    path.points = [...path.points, next];
    setPosition(next);
    setDraft({ ...path });
    setHeading((Math.atan2(east, north) * 180 / Math.PI + 360) % 360);
    setHeadingSource('Simulated movement');
    if (path.points.length >= 300) {
      stop();
      setMessage('Test path limit reached. Save or discard this segment.');
    }
  }

  function toggleTesting() {
    if (!canTest || recording || busy || draft) return;
    stop();
    testPoint.current = { latitude: 0, longitude: 0 };
    setTesting((value) => !value);
    setMessage('');
  }

  const visible = (testing ? testPaths : paths).filter((path) => path.level === level);
  const tracks = [...visible, ...(draft?.level === level ? [draft] : [])];
  const merged = useMemo(() => mergeWalkPaths(
    (testing ? testPaths : paths).filter((path) => path.level === level),
  ), [testing, testPaths, paths, level]);
  const center = position ?? tracks[0]?.points[0];


  return <SafeAreaView style={{ flex: 1, backgroundColor: '#020617' }}>
    <ScrollView scrollEnabled={!usingJoystick} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: testing && recording ? 170 : 16 }}>
      <Pressable onPress={() => router.back()} accessibilityRole="button"><Text className="font-semibold text-sky-300">‹ Social network</Text></Pressable>
      <Text className="text-xl font-bold text-white">Level map</Text>
      <View className="flex-row gap-2">{rooms.map((room) =>
        <Pressable key={room} disabled={recording || busy || !!draft} onPress={() => { setLevel(room); setPosition(undefined); }}
          className={room === level ? 'rounded bg-sky-800 p-2' : 'rounded bg-zinc-800 p-2'}>
          <Text className="text-white">{room.replace(' Levels', '').replace(' Level', '')}</Text>
        </Pressable>)}</View>
      <Text className="text-xs text-slate-300">Choose your current floor. Overlapping recordings merge into the most supported route. Walls and room layouts are unknown.</Text>
      <View onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      }} style={{ height: 350, overflow: 'hidden', borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a' }}>
        <MapPathLayer segments={merged} draft={draft?.level === level ? draft : undefined}
          center={center} width={size.width} height={size.height} scale={scale} />
        {position ? <View accessibilityLabel="Your estimated location, visible only to you" style={{ position: 'absolute', left: size.width / 2 - 7, top: size.height / 2 - 7, height: 14, width: 14, borderRadius: 7, backgroundColor: '#f8fafc', borderWidth: 3, borderColor: '#2563eb' }} /> : null}
        {position && heading !== undefined ? <View pointerEvents="none" style={{
          position: 'absolute', left: size.width / 2 - 14, top: size.height / 2 - 14,
          width: 28, height: 28, transform: [{ rotate: heading + 'deg' }],
        }}>
          <Text style={{ position: 'absolute', top: -15, left: 5, color: '#60a5fa', fontSize: 20 }}>▲</Text>
        </View> : null}
        {!tracks.some((path) => path.points.length > 1) ? <Text className="px-12 pt-24 text-slate-400">No paths recorded on this level yet.</Text> : null}
        <MapControls width={size.width} scale={scale} zoom={setScale} heading={heading} />
      </View>
      <Text className="text-xs text-slate-400">Light blue: multiple recordings overlap · Blue: one recording · Nearby parallel routes may merge within about 6.5 ft.</Text>
      <Text className="text-xs text-slate-400">Map north stays up · Compass turns with your heading · Distances in feet and inches.</Text>
      <Text className="text-xs text-slate-300">{heading !== undefined ? headingSource + ' · ' + Math.round(heading) + '°' : 'Heading unavailable · Start a walk to enable phone compass'}</Text>
      <Text className="text-xs text-slate-300">{position ? testing ? 'Simulated location' : 'Your estimated location · ±' + mapDistance(accuracy ?? 0) + ' · Private' : 'Location unavailable or tracking stopped'} · {online ? 'Relay connected' : 'Offline map cache'}</Text>
      {pendingShares > 0 ? <Text className="text-xs text-amber-200">{pendingShares} shared path(s) waiting to sync. Retries run while this map is open.</Text> : null}
      {canTest ? <Pressable accessibilityRole="switch" accessibilityState={{ checked: testing, disabled: recording || busy || !!draft }}
        disabled={recording || busy || !!draft} onPress={toggleTesting} className="self-start rounded bg-zinc-800 p-3">
        <Text className="text-white">{testing ? 'Test joystick: on' : 'Test joystick: off'}</Text>
      </Pressable> : null}
      {testing ? <Text className="text-xs text-amber-200">Simulation · Test paths stay in this session. Choose Record walk, then drag the joystick.</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        <Pressable disabled={busy} className="rounded bg-sky-800 p-3" onPress={() => { if (recording) stop(); else void start(); }}><Text className="text-white">{recording ? 'Stop recording' : 'Record walk'}</Text></Pressable>
      </View>
      {draft ? <View className="flex-row flex-wrap gap-2">
        <Pressable disabled={busy} className="rounded bg-zinc-800 p-3" onPress={() => { void save(false); }}><Text className="text-white">{testing ? 'Keep test path' : 'Save locally'}</Text></Pressable>
        {!testing ? <Pressable disabled={busy} className="rounded bg-sky-800 p-3" onPress={() => Alert.alert('Share this route?', 'Everyone connected to this relay can see its coordinates. The route may reveal places you visited.', [{ text: 'Cancel' }, { text: 'Share path', onPress: () => { void save(true); } }])}><Text className="text-white">Share path</Text></Pressable> : null}
        <Pressable disabled={busy} className="rounded bg-zinc-800 p-3" onPress={() => { stop(); walk.current = undefined; setDraft(undefined); }}><Text className="text-white">Discard walk</Text></Pressable>
      </View> : null}
      {message ? <Text className="text-sm text-slate-200">{message}</Text> : null}
      <Text className="text-xs text-slate-400">Recording stops when this map leaves the foreground. A shared route contains coordinates, but no name or live location marker.</Text>
    </ScrollView>
    {canTest && testing && recording ? <MapJoystick move={moveTest} interaction={setUsingJoystick} /> : null}
  </SafeAreaView>;
}
