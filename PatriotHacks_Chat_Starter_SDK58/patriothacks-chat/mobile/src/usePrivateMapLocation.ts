import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

export type PrivateFix = { latitude: number; longitude: number; accuracy: number | null; timestamp: number };

// Viewing a position never stores a route or sends coordinates to the relay.
export function usePrivateMapLocation(enabled: boolean) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [fix, setFix] = useState<PrivateFix>();
  const [heading, setHeading] = useState<number>();
  const [headingSource, setHeadingSource] = useState('');
  const [status, setStatus] = useState('Allow location to show your private marker.');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!enabled || !foreground) return;
    let cancelled = false;
    let positionWatch: Location.LocationSubscription | undefined;
    let compassWatch: Location.LocationSubscription | undefined;
    let lastCompass = 0;
    let displayed = { bearing: -1, at: 0 };
    setHeading(undefined);
    setHeadingSource('');
    async function locate() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!permission.granted) { setStatus('Location permission denied. Enable it in your phone settings to show your marker.'); return; }
        setStatus('Finding your location…');
        // A cached fix can show a clearly labelled last-known marker while GPS settles.
        const cached = await Location.getLastKnownPositionAsync().catch(() => null);
        if (cancelled) return;
        if (cached) setFix({ ...cached.coords, timestamp: cached.timestamp });
        positionWatch = await Location.watchPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 1500,
        }, (location) => {
          if (cancelled) return;
          const { latitude, longitude, accuracy, heading: course, speed } = location.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
          setFix({ latitude, longitude, accuracy, timestamp: location.timestamp });
          setNow(Date.now());
          setStatus('');
          if (Date.now() - lastCompass > 5000) {
            if (course !== null && course >= 0 && (speed ?? 0) > 0.5) {
              setHeading(course); setHeadingSource('Direction of movement');
            } else { setHeading(undefined); setHeadingSource(''); }
          }
        }, (reason) => {
          if (!cancelled) setStatus('Location unavailable: ' + reason);
        });
        if (cancelled) { positionWatch.remove(); return; }
        try {
          compassWatch = await Location.watchHeadingAsync((value) => {
            if (cancelled || value.accuracy < 1) return;
            const bearing = value.trueHeading >= 0 ? value.trueHeading : value.magHeading;
            if (!Number.isFinite(bearing) || bearing < 0) return;
            lastCompass = Date.now();
            const difference = Math.abs(((bearing - displayed.bearing + 540) % 360) - 180);
            if (Date.now() - displayed.at < 150 || (displayed.bearing >= 0 && difference < 2)) return;
            displayed = { bearing, at: Date.now() };
            setHeading(bearing);
            setHeadingSource(value.trueHeading >= 0 ? 'Phone heading' : 'Magnetic heading');
          });
          if (cancelled) compassWatch.remove();
        } catch { /* Movement can still supply a heading without a compass. */ }
      } catch (error) {
        if (!cancelled) setStatus('Location unavailable: ' + String(error));
      }
    }
    void locate();
    return () => { cancelled = true; positionWatch?.remove(); compassWatch?.remove(); };
  }, [enabled, foreground]);
  const stale = !enabled || !foreground || !!status || !fix || now - fix.timestamp > 15000;
  return { fix, heading: stale ? undefined : heading, headingSource, stale, status };
}
