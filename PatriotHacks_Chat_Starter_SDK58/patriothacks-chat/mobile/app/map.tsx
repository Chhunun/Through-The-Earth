import MapPingLayer from '../src/MapPingLayer';
import MapPingList from '../src/MapPingList';
import { useMapPings } from '../src/useMapPings';
import { canUseMapTesting } from '../../shared/mapPings';
import MapPathsPanel from '../src/MapPathsPanel';
import term from '../src/terminal-colors.json';
import { cacheSharedPath, loadRemovedPathIds, loadSharedPathIds } from '../src/mapStorage';
import { blockPlacementPoint, type DropFrame } from '../src/blockPlacement';
import { MapPlaceLayer, MapPlacesPanel } from '../src/MapPlaces';
import { loadPrivatePlaces, savePrivatePlace, removePrivatePlace, movePrivatePlace, loadSharedPlaces, cacheSharedPlaces } from '../src/mapStorage';
import type { MapPlace, MapPlaceKind, MapPlaceSnapshot } from '@patriot/protocol';
import { usePrivateMapLocation } from '../src/usePrivateMapLocation';
import { useChat } from '../src/chat';
import { RaiseWarningButton, RaiseWarningModal, WarningBanner, useWarningActions } from '../src/HazardWarnings';
import { publicKey } from '../src/crypto';
import MapPathLayer from '../src/MapPathLayer';
import { mergeWalkPaths } from '../src/mergeWalkPaths';
import MapJoystick from '../src/MapJoystick';
import { mapDistance } from '../src/mapScale';
import MapControls from '../src/MapControls';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { rooms, type MapPoint, type Room, type WalkPath } from '@patriot/protocol';
import { mapConnection } from '../src/mapConnection';
import { loadMap, saveMapPath, queueMapShare } from '../src/mapStorage';

export default function MapScreen() {
  const [pingPending, setPingPending] = useState(false);
  const ownLevel = useChat((state) => state.profiles[state.key]?.level);
  const deletedPaths = useRef(new Set<string>());
  const [sharedPathIds, setSharedPathIds] = useState(new Set<string>());
  const [selectedPathId, setSelectedPathId] = useState<string>();
  const [changingPath, setChangingPath] = useState(false);
  const canTest = useChat((state) => canUseMapTesting(state.profiles[state.key]?.name));
  // Hazard warnings go through the chat screen's relay session, which stays open underneath the map.
  const warnings = useChat((state) => state.warnings);
  const ownKey = useChat((state) => state.key);
  const relayOnline = useChat((state) => state.online);
  const warningActions = useWarningActions();
  const [warningOpen, setWarningOpen] = useState(false);
  const mapView = useRef<ComponentRef<typeof View>>(null);
  const rootView = useRef<ComponentRef<typeof View>>(null);
  const [blockGhost, setBlockGhost] = useState<{ x: number; y: number }>();
  const rootOrigin = useRef({ x: 0, y: 0 });
  const dropFrame = useRef<DropFrame | undefined>(undefined);
  const [draggingPin, setDraggingPin] = useState(false);
  const [privatePlaces, setPrivatePlaces] = useState<MapPlace[]>([]);
  const [sharedPlaces, setSharedPlaces] = useState<MapPlaceSnapshot>({ revision: 0, places: [] });
  const [picked, setPicked] = useState<MapPoint>();
  const [camera, setCamera] = useState<MapPoint>();
  const receivedPlaces = useRef(false);
  const cacheWrites = useRef(Promise.resolve());
  const [pendingShares, setPendingShares] = useState(0);
  const [usingJoystick, setUsingJoystick] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPaths, setTestPaths] = useState<WalkPath[]>([]);
  const [simHeading, setSimHeading] = useState<number>();
  const [locationEnabled, setLocationEnabled] = useState(false);
  const live = usePrivateMapLocation(locationEnabled && !testing);
  const heading = testing ? simHeading : live.heading;
  const headingSource = testing ? 'Simulated movement' : live.headingSource;
  const lastRecordedAt = useRef(0);
  const testPoint = useRef<MapPoint>({ latitude: 0, longitude: 0 });
  const [level, setLevel] = useState<Room>('Middle Level');
  const locationPings = useMapPings(level, ownKey, () => {
    if (testing) return canTest && simPosition ? {
      point: simPosition, accuracy: 0, timestamp: Date.now(), simulated: true,
    } : undefined;
    const fix = live.fix;
    return fix && !live.stale && fix.accuracy !== null ? {
      point: { latitude: fix.latitude, longitude: fix.longitude }, accuracy: fix.accuracy,
      timestamp: fix.timestamp, simulated: false,
    } : undefined;
  });
  const [paths, setPaths] = useState<WalkPath[]>([]);
  const [simPosition, setSimPosition] = useState<MapPoint>();
  const position = testing ? simPosition : live.fix;
  const accuracy = testing ? undefined : live.fix?.accuracy;
  const [draft, setDraft] = useState<WalkPath>();
  const [recording, setRecording] = useState(false);
  const [consent, setConsent] = useState(false);
  const [online, setOnline] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(2);
  const [size, setSize] = useState({ width: 300, height: 300 });
  const walk = useRef<WalkPath | undefined>(undefined);
  const active = useRef(true);
  const connection = useRef<Awaited<ReturnType<typeof mapConnection>> | undefined>(undefined);

  function stop() {
    setRecording(false);
    setUsingJoystick(false);
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
      setPaths((current) => [...new Map([...current, ...incoming].filter((path) => !deletedPaths.current.has(path.id)).map((path) => [path.id, path])).values()]);
    }
    let owner: string;
    publicKey().then(async (key) => {
      owner = key;
      const places = await loadPrivatePlaces(owner);
      if (active.current) setPrivatePlaces(places);
    }).catch(() => { if (active.current) setMessage('Could not load private pins.'); });
    loadSharedPlaces().then((snapshot) => {
      if (snapshot && active.current && !receivedPlaces.current) setSharedPlaces(snapshot);
    }).catch(() => { if (active.current) setMessage('Could not load cached markers.'); });
    Promise.all([loadRemovedPathIds(), loadSharedPathIds(), loadMap()]).then(([deleted, ids, cached]) => {
      for (const id of deleted) deletedPaths.current.add(id);
      if (!active.current) return;
      setSharedPathIds((current) => new Set([...current, ...ids].filter((id) => !deletedPaths.current.has(id))));
      merge(cached);
    }).catch(() => { if (active.current) setMessage('Could not load the cached map.'); });
    mapConnection((incoming) => {
      merge(incoming);
      setSharedPathIds((current) => new Set([...current, ...incoming.map((path) => path.id)].filter((id) => !deletedPaths.current.has(id))));
      for (const path of incoming) void cacheSharedPath(path).catch(() => {
        if (active.current) setMessage('Could not cache a shared path.');
      });
    }, (connected, error) => {
      if (!active.current) return;
      setOnline(connected);
      if (error) setMessage(error);
    }, (count) => { if (active.current) setPendingShares(count); }, (snapshot) => {
      if (!active.current) return;
      receivedPlaces.current = true;
      setSharedPlaces(snapshot);
      // Serialize snapshots so a slow older disk write cannot restore deleted markers.
      cacheWrites.current = cacheWrites.current.then(() => cacheSharedPlaces(snapshot)).catch(() => {
        if (active.current) setMessage('Could not cache map markers.');
      });
    }, (ids) => {
      for (const id of ids) deletedPaths.current.add(id);
      if (!active.current) return;
      setPaths((current) => current.filter((path) => !deletedPaths.current.has(path.id)));
      setSharedPathIds((current) => new Set([...current].filter((id) => !deletedPaths.current.has(id))));
      setSelectedPathId((current) => current && deletedPaths.current.has(current) ? undefined : current);
    }).then((relay) => {
      if (active.current) connection.current = relay;
      else relay.close();
    }).catch((error) => { if (active.current) setMessage(String(error)); });
    Alert.alert('Contribute walking paths?', 'Recording uses your phone’s location while this map is open. Saved paths stay on this device until you tap Share path. Sharing sends the route to everyone on the relay. Your private marker uses location even when browsing, with your phone’s permission. Recording and sharing are separate. Select your current floor manually.',
      [{ text: 'Browse only', onPress: () => setLocationEnabled(true) }, { text: 'Allow recording', onPress: () => { setLocationEnabled(true); setConsent(true); } }]);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        stop();
      }
    });
    return () => {
      active.current = false;
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
      setSimPosition({ ...testPoint.current });
      setRecording(true);
      setMessage('Simulated walk. Drag the joystick to move.');
      return;
    }
    if (!consent) {
      Alert.alert('Allow path recording?', 'Use location while this map is open to draw your walk. Sharing is a separate action.',
        [{ text: 'Cancel' }, { text: 'Allow', onPress: () => setConsent(true) }]);
      return;
    }
    setLocationEnabled(true);
    lastRecordedAt.current = Date.now();
    const next: WalkPath = { id: Crypto.randomUUID(), level, points: [] };
    walk.current = next;
    setDraft(next);
    setRecording(true);
    setMessage('Recording. Waiting for a fresh, accurate location fix…');
  }

  useEffect(() => {
    if (!recording || testing || !live.fix) return;
    const fix = live.fix;
    if (live.stale || fix.accuracy === null || fix.accuracy > 20) {
      if (walk.current?.points.length) {
        stop();
        setMessage('Recording paused because location became uncertain. Save this segment, then start a new walk.');
      }
      return;
    }
    if (fix.timestamp <= lastRecordedAt.current) return;
    lastRecordedAt.current = fix.timestamp;
    const path = walk.current;
    if (!path) return;
    path.points = [...path.points, { latitude: fix.latitude, longitude: fix.longitude }];
    setDraft({ ...path });
    if (path.points.length >= 300) {
      stop();
      setMessage('Walk limit reached. Save this path before recording another.');
    }
  }, [live.fix, live.stale, recording, testing]);

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
      setMessage(queued ? 'Path saved and queued. Open this map when connected to finish sharing.' : share ? 'Path shared. Location sharing is controlled by the ping button.' : 'Path saved on this device.');
    } catch (error) { setMessage(String(error)); }
    finally { if (active.current) setBusy(false); }
  }

  function moveTest(east: number, north: number) {
    if (!canTest || !testing) return;
    const last = testPoint.current;
    const next = { latitude: last.latitude + north / 111320,
      longitude: last.longitude + east / (111320 * Math.cos(last.latitude * Math.PI / 180)) };
    testPoint.current = next;
    const path = walk.current;
    setSimPosition(next);
    setSimHeading((Math.atan2(east, north) * 180 / Math.PI + 360) % 360);
    if (!recording || !path) return;
    path.points = [...path.points, next];
    setDraft({ ...path });
    if (path.points.length >= 300) {
      stop();
      setMessage('Test path limit reached. Save or discard this segment.');
    }
  }

  function toggleTesting() {
    if (!canTest || recording || busy || draft) return;
    stop();
    testPoint.current = { latitude: 0, longitude: 0 };
    setSimPosition(testing ? undefined : { ...testPoint.current });
    setSimHeading(undefined);
    setCamera(undefined);
    setPicked(undefined);
    setTesting((value) => !value);
    setMessage('');
  }

  async function removeSharedWalk(path: WalkPath) {
    setChangingPath(true);
    try {
      if (!connection.current) throw new Error('Relay unavailable.');
      await connection.current.removePath(path.id);
      if (active.current) setMessage('Shared walk deleted for everyone.');
    } catch (error) {
      if (active.current) setMessage(String(error));
      throw error;
    } finally { if (active.current) setChangingPath(false); }
  }
  async function shareSavedWalk(path: WalkPath) {
    setChangingPath(true);
    try {
      if (!connection.current) throw new Error('Reopen the map to initialize the relay connection.');
      const queued = await connection.current.contribute(path);
      if (active.current) setMessage(queued ? 'Path queued. Open the map when connected to finish sharing.' : 'Path shared with this level.');
    } catch (error) {
      if (active.current) setMessage(String(error));
      throw error;
    } finally { if (active.current) setChangingPath(false); }
  }
  async function createPlace(kind: MapPlaceKind, label: string, blackout: 'Some areas dark' | 'Whole level dark', point: MapPoint, id: string) {
    if (!point || testing) throw new Error('Choose a real map location first.');
    if (kind !== 'block' && !picked && live.stale) throw new Error('Your location is outdated. Wait for a fresh fix or hold a location on the map.');
    const place: MapPlace = { id, kind, label, level,
      point: { latitude: point.latitude, longitude: point.longitude }, createdAt: Date.now(),
      ...(kind === 'blackout' ? { blackout } : {}) };
    if (kind === 'personal') {
      await savePrivatePlace(await publicKey(), place);
      setPrivatePlaces((current) => [...current.filter((p) => p.id !== place.id), place]);
      setMessage('Private pin saved on this device.');
    } else {
      if (!connection.current) throw new Error('Relay unavailable.');
      await connection.current.addPlace({ ...place, kind });
      setMessage('Map report published.');
    }
    setPicked(undefined);
  }
  async function movePlace(place: MapPlace, point: MapPoint) {
    try {
      if (place.kind === 'personal') {
        await movePrivatePlace(await publicKey(), place, point);
        if (active.current) setPrivatePlaces((current) => current.map((p) => p.id === place.id ? { ...p, point } : p));
      } else {
        if (!connection.current) throw new Error('Relay unavailable.');
        await connection.current.movePlace(place.id, place.point, point);
      }
      if (active.current) setMessage('Marker moved.');
    } catch (error) {
      if (active.current) setMessage(String(error));
      throw error;
    }
  }
  function inspectPlace(place: MapPlace) {
    Alert.alert(place.label, (place.kind === 'personal' ? 'Private saved place' : 'Resident-reported ' + (place.kind === 'block' ? 'blocked passage' : 'blackout'))
      + '\n' + place.level + '\n' + new Date(place.createdAt).toLocaleString()
      + (place.blackout ? '\n' + place.blackout : '')
      + (place.kind === 'blackout' ? '\nRemoving the marker does not change your Status answer.' : ''), [
      { text: 'Close', style: 'cancel' },
      { text: 'Remove marker', style: 'destructive', onPress: () => {
        void (async () => {
          if (place.kind === 'personal') {
            await removePrivatePlace(await publicKey(), place.id);
            setPrivatePlaces((current) => current.filter((p) => p.id !== place.id));
          } else {
            if (!connection.current) throw new Error('Relay unavailable.');
            await connection.current.removePlace(place.id);
          }
          if (active.current) setMessage('Marker removed.');
        })().catch((error) => { if (active.current) setMessage(String(error)); });
      } },
    ]);
  }
  const places = [...privatePlaces, ...sharedPlaces.places].filter((p) => p.level === level);
  const visible = (testing ? testPaths : paths).filter((path) => path.level === level);
  const tracks = [...visible, ...(draft?.level === level ? [draft] : [])];
  const merged = useMemo(() => mergeWalkPaths(
    (testing ? testPaths : paths).filter((path) => path.level === level),
  ), [testing, testPaths, paths, level]);
  const center = camera ?? position ?? tracks[0]?.points[0] ?? places[0]?.point ?? locationPings.pings[0]?.point;
  const originLatitude = merged[0]?.from.latitude ?? draft?.points[0]?.latitude ?? center?.latitude ?? 0;
  const longitudeMeters = 111320 * Math.cos(originLatitude * Math.PI / 180);
  const markerX = center && position ? size.width / 2 + (position.longitude - center.longitude) * longitudeMeters * scale : -100;
  const markerY = center && position ? size.height / 2 - (position.latitude - center.latitude) * 111320 * scale : -100;


  async function beginBlockPlacement() {
    setDraggingPin(true);
    if (center) setCamera({ ...center });
    rootView.current?.measureInWindow((x, y) => { rootOrigin.current = { x, y }; });
    // Freeze projection while the button is being dragged. Screen coordinates
    // are measured in the same window space as the finger.
    const projection = center ? { center: { ...center }, longitudeMeters, scale } : undefined;
    dropFrame.current = undefined;
    if (!projection) return;
    await new Promise<void>((resolve, reject) => {
      if (!mapView.current) { reject(new Error('Map is not ready.')); return; }
      mapView.current.measureInWindow((x, y, width, height) => {
        dropFrame.current = { x: x + 1, y: y + 1, width: Math.max(0, width - 2), height: Math.max(0, height - 2), ...projection };
        resolve();
      });
    });
  }
  async function finishBlockPlacement(drop?: { x: number; y: number }) {
    const point = blockPlacementPoint(drop, dropFrame.current, position, live.stale);
    setBlockGhost(undefined);
    await createPlace('block', 'Blocked passage', 'Some areas dark', point, Crypto.randomUUID());
  }

  const validPingPosition = testing ? canTest && !!simPosition : !!live.fix && !live.stale && live.fix.accuracy !== null;
  function confirmPing() {
    if (locationPings.sharing) {
      setPingPending(true);
      void locationPings.stop().then(() => setMessage('Live location sharing stopped.'))
        .catch((error) => setMessage(String(error))).finally(() => setPingPending(false));
      return;
    }
    const simulated = testing && canTest;
    const fix = simulated && simPosition ? { ...simPosition, accuracy: 0, timestamp: Date.now() } : live.fix;
    if (!validPingPosition || !fix || fix.accuracy === null) {
      setMessage('Wait for a fresh location fix, or use the test joystick with a tester profile.'); return;
    }
    const publish = (emergency: boolean) => {
      void (async () => {
        setPingPending(true);
        try {
          if (!simulated && Date.now() - fix.timestamp > 15000) throw new Error('Location became outdated. Open Ping my location again.');
          await locationPings.publish(Crypto.randomUUID(), { latitude: fix.latitude, longitude: fix.longitude }, fix.accuracy!, emergency, simulated);
          setMessage((simulated ? 'TEST position' : 'Your position') + ' now follows you on ' + level + '. Tap Stop sharing location to stop.');
        } catch (error) { setMessage(String(error)); }
        finally { setPingPending(false); }
      })();
    };
    Alert.alert((simulated ? 'Share TEST position on ' : 'Share your location on ') + level + '?',
      'Your name and moving position will be visible to everyone viewing this map level while this map is open. Tap the same button again to stop.' +
      (simulated ? ' This is a simulated joystick position labelled TEST.' : ' Sharing stops if you leave the map, change levels, or the app goes into the background.'),
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Share position', onPress: () => publish(false) },
        { text: 'Emergency ping', onPress: () => publish(true) }]);
  }
  const pingControl = <Pressable accessibilityRole="button" disabled={pingPending || (!locationPings.sharing && (!locationPings.online || !validPingPosition)) || draggingPin}
    onPress={confirmPing} className="rounded bg-term-active border border-term-text p-3 disabled:opacity-50">
    <Text className="font-mono font-semibold text-term-glow">{pingPending ? 'Please wait…' : locationPings.sharing ? 'Stop sharing location' : 'Ping my location'}</Text>
  </Pressable>;
  const recordWalkControl = <Pressable accessibilityRole="button" disabled={busy || draggingPin}
    className="rounded bg-term-active border border-term-text p-3" onPress={() => { if (recording) stop(); else void start(); }}>
    <Text className="font-mono text-term-text">{recording ? 'Stop recording' : 'Record walk'}</Text>
  </Pressable>;

  return <SafeAreaView ref={rootView} collapsable={false} style={{ flex: 1, backgroundColor: term.bg }}>
    <ScrollView scrollEnabled={!usingJoystick && !draggingPin} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: testing && canTest ? 170 : 16 }}>
      <Pressable onPress={() => router.back()} accessibilityRole="button"><Text className="font-mono font-semibold text-term-glow">‹ Social network</Text></Pressable>
      <Text accessibilityRole="header" className="font-mono uppercase tracking-widest text-xl font-bold text-term-glow">Level map</Text>
      {/* Warning system. The form starts on the floor shown on the map. */}
      <RaiseWarningButton disabled={draggingPin} onPress={() => setWarningOpen(true)} />
      <RaiseWarningModal visible={warningOpen} online={relayOnline} defaultLevel={level}
                         submit={warningActions.raise} close={() => setWarningOpen(false)} />
      {/* The banner's own margin is reset for this padded layout. */}
      {warnings.length ? <View className="-mx-3 -mt-2">
        <WarningBanner warnings={warnings} ownKey={ownKey} online={relayOnline} homeLevel={ownLevel}
                       busy={warningActions.busy} confirm={warningActions.confirm} clear={warningActions.clear} />
      </View> : null}
      <View className="flex-row gap-2">{rooms.map((room) =>
        <Pressable key={room} disabled={recording || busy || !!draft || draggingPin} onPress={() => { setLevel(room); setPicked(undefined); setCamera(undefined); }}
          className={room === level ? 'rounded bg-term-active border border-term-text p-2' : 'rounded bg-term-field border border-term-line p-2'}>
          <Text className="font-mono text-term-text">{room.replace(' Levels', '').replace(' Level', '')}</Text>
        </Pressable>)}</View>
      <Text className="font-mono text-xs text-term-dim">Choose your current floor. Overlapping recordings merge into the most supported route. Walls and room layouts are unknown.</Text>
      <View ref={mapView} collapsable={false} onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      }} style={{ height: 350, overflow: 'hidden', borderWidth: 1, borderColor: term.line, backgroundColor: term.panel }}>
        <MapPathLayer segments={merged} draft={draft?.level === level ? draft : undefined}
          center={center} width={size.width} height={size.height} scale={scale}
          highlight={!testing ? visible.find((path) => path.id === selectedPathId) : undefined} />
        {position ? <View accessibilityLabel="Your estimated location, visible only to you" style={{ position: 'absolute', left: markerX - 7, top: markerY - 7, height: 14, width: 14, borderRadius: 7, backgroundColor: term.glow, borderWidth: 3, borderColor: !testing && live.stale ? term.muted : term.active }} /> : null}
        {position && heading !== undefined ? <View pointerEvents="none" style={{
          position: 'absolute', left: markerX - 14, top: markerY - 14,
          width: 28, height: 28, transform: [{ rotate: heading + 'deg' }],
        }}>
          <Text className="font-mono" style={{ position: 'absolute', top: -15, left: 5, color: term.glow, fontSize: 20 }}>▲</Text>
        </View> : null}
        {!tracks.some((path) => path.points.length > 1) ? <Text pointerEvents="none" className="font-mono text-term-muted" style={{ position: 'absolute', left: 12, right: 12, top: 96, textAlign: 'left' }}>No paths recorded on this level yet.</Text> : null}
        {!testing ? <MapPlaceLayer places={places} center={center} originLatitude={originLatitude}
          scale={scale} width={size.width} height={size.height} picked={picked}
          pick={setPicked} inspect={inspectPlace} move={movePlace} online={online}
          interaction={(value) => { if (value && center) setCamera({ ...center }); setDraggingPin(value); }} /> : null}
        <MapPingLayer pings={locationPings.pings} center={center} originLatitude={originLatitude}
          scale={scale} width={size.width} height={size.height} />
        <MapControls width={size.width} scale={scale} zoom={setScale} heading={heading} />
      </View>
      {camera ? <Pressable onPress={() => setCamera(undefined)}><Text className="font-mono text-term-glow">Follow my location</Text></Pressable> : null}
      {!testing ? <MapPlacesPanel level={level} target={picked ?? position} picked={!!picked}
        clearPicked={() => setPicked(undefined)} places={places} online={online} disabled={busy}
        create={createPlace} inspect={inspectPlace} focus={setCamera} walkControl={recordWalkControl} pingControl={pingControl}
        blockPlacement={{
          begin: beginBlockPlacement,
          preview: (x, y) => setBlockGhost({ x: x - rootOrigin.current.x, y: y - rootOrigin.current.y }),
          finish: finishBlockPlacement,
          cancel: () => { dropFrame.current = undefined; setBlockGhost(undefined); setDraggingPin(false); },
        }} /> : null}
      <MapPingList pings={locationPings.pings} ownKey={ownKey} pending={pingPending} focus={setCamera}
        stop={() => { void locationPings.stop().then(() => setMessage('Your ping was removed.')).catch((error) => setMessage(String(error))); }} />
      {!testing ? <Text className="font-mono text-xs text-term-muted">Cyan ripple: shared position · Red ripple: emergency location · Live pings follow the sender; stale pings disappear after 60 seconds without updates.</Text> : null}
      {locationPings.error ? <Text className="font-mono text-xs text-amber-200">{locationPings.error}</Text> : null}
      {!testing ? <MapPathsPanel paths={visible} sharedIds={sharedPathIds} selectedId={selectedPathId}
        level={level} ownLevel={ownLevel} online={online} pending={changingPath}
        select={(path) => { setSelectedPathId(path.id); setCamera(path.points[0]); }}
        remove={removeSharedWalk} share={shareSavedWalk} /> : null}
      <Text className="font-mono text-xs text-term-muted">Dim green: saved paths · Green: overlapping recordings · Bright: current walk · Amber: selected walk · Nearby parallel routes may merge within about 6.5 ft.</Text>
      <Text className="font-mono text-xs text-term-muted">Map north stays up · Compass turns with your heading · Distances in feet and inches.</Text>
      <Text className="font-mono text-xs text-term-dim">{heading !== undefined ? headingSource + ' · ' + Math.round(heading) + '°' : 'Heading unavailable'}</Text>
      <Text className="font-mono text-xs text-term-dim">{position ? testing ? 'Simulated location' : (live.stale ? 'Last known location' : 'Your estimated location') + (accuracy != null ? ' · ±' + mapDistance(accuracy) : ' · Accuracy unknown') + (locationPings.sharing ? ' · Sharing live' : ' · Private') : 'Waiting for location'} · {online ? 'Relay connected' : 'Offline map cache'}</Text>
      {!testing && live.status ? <Text className="font-mono text-xs text-amber-200">{live.status}</Text> : null}
      {!testing ? <Text className="font-mono text-xs text-term-muted">Your moving marker stays private. Ping my location shares your moving position until you stop or leave the map. Choose your floor manually; GPS cannot identify indoor floors.</Text> : null}
      {pendingShares > 0 ? <Text className="font-mono text-xs text-amber-200">{pendingShares} shared path(s) waiting to sync. Retries run while this map is open.</Text> : null}
      {canTest ? <Pressable accessibilityRole="switch" accessibilityState={{ checked: testing, disabled: recording || busy || !!draft }}
        disabled={recording || busy || !!draft || draggingPin} onPress={toggleTesting} className="self-start rounded bg-term-field border border-term-line p-3">
        <Text className="font-mono text-term-text">{testing ? 'Test joystick: on' : 'Test joystick: off'}</Text>
      </Pressable> : null}
      {testing ? <Text className="font-mono text-xs text-amber-200">Simulation · Move with the joystick. Record walk saves a test path locally; shared test pings are labelled TEST.</Text> : null}
      {testing ? <View className="flex-row flex-wrap gap-2">{recordWalkControl}{pingControl}</View> : null}
      {draft ? <View className="flex-row flex-wrap gap-2">
        <Pressable disabled={busy} className="rounded bg-term-field border border-term-line p-3" onPress={() => { void save(false); }}><Text className="font-mono text-term-text">{testing ? 'Keep test path' : 'Save locally'}</Text></Pressable>
        {!testing ? <Pressable disabled={busy} className="rounded bg-term-active border border-term-text p-3" onPress={() => Alert.alert('Share this route?', 'Everyone connected to this relay can see its coordinates. The route may reveal places you visited.', [{ text: 'Cancel' }, { text: 'Share path', onPress: () => { void save(true); } }])}><Text className="font-mono text-term-text">Share path</Text></Pressable> : null}
        <Pressable disabled={busy} className="rounded bg-term-field border border-term-line p-3" onPress={() => { stop(); walk.current = undefined; setDraft(undefined); }}><Text className="font-mono text-term-text">Discard walk</Text></Pressable>
      </View> : null}
      {message ? <Text className="font-mono text-sm text-term-text">{message}</Text> : null}
      <Text className="font-mono text-xs text-term-muted">Location updates and recording stop when this map leaves the foreground. A shared route contains coordinates, but no name or live location marker.</Text>
    </ScrollView>
    {blockGhost ? <View pointerEvents="none" style={{ position: 'absolute', left: blockGhost.x - 20,
      top: blockGhost.y - 36, width: 40, height: 36, borderRadius: 4, backgroundColor: '#7f1d1d',
      borderWidth: 2, borderColor: '#fb7185', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
      <Text className="font-mono" style={{ color: '#ffe4e6', fontWeight: 'bold', fontSize: 24 }}>✕</Text>
    </View> : null}
    {canTest && testing ? <MapJoystick move={moveTest} interaction={setUsingJoystick} /> : null}
  </SafeAreaView>;
}
