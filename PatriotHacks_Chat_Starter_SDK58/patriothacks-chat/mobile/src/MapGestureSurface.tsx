import { useEffect, useRef } from 'react';
import { AppState, PanResponder, View, type GestureResponderEvent } from 'react-native';
import type { MapPoint } from '@patriot/protocol';
import { pointOnMap } from './mapMarkerLayout';
import { gestureViewport, type ScreenPoint, type Viewport } from './mapViewport';

type Props = {
  center?: MapPoint; scale: number; width: number; height: number; longitudeMeters: number;
  disabled?: boolean; change: (view: Viewport) => void; interaction: (active: boolean) => void;
  pick?: (point: MapPoint) => void;
};
type Gesture = { count: number; start: Viewport; anchor: ScreenPoint; span: number;
  width: number; height: number; longitudeMeters: number; changed: boolean };
export default function MapGestureSurface(props: Props) {
  const latest = useRef(props); latest.current = props;
  const active = useRef<Gesture | undefined>(undefined);
  const frame = useRef<Viewport>({ center: props.center ?? { latitude: 0, longitude: 0 }, scale: props.scale });
  const origin = useRef({ x: 0, y: 0 });
  const held = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const raf = useRef<number | undefined>(undefined);
  const locked = useRef(false);

  function touches(event: GestureResponderEvent) {
    return event.nativeEvent.touches.slice(0, 2).map((t) => ({
      x: t.pageX - origin.current.x, y: t.pageY - origin.current.y,
    }));
  }
  function midpoint(points: ScreenPoint[]): ScreenPoint {
    return points.length === 1 ? points[0] : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  }
  function span(points: ScreenPoint[]) {
    return points.length < 2 ? 0 : Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  }
  function push() {
    if (raf.current !== undefined) return;
    raf.current = requestAnimationFrame(() => { raf.current = undefined; latest.current.change(frame.current); });
  }
  function rebase(points: ScreenPoint[]) {
    const previous = active.current;
    active.current = { count: points.length, start: frame.current, anchor: midpoint(points),
      span: span(points), width: latest.current.width, height: latest.current.height,
      longitudeMeters: latest.current.longitudeMeters, changed: previous?.changed ?? false };
  }
  function finish(commit = true) {
    clearTimeout(held.current);
    if (raf.current !== undefined) { cancelAnimationFrame(raf.current); raf.current = undefined; }
    if (commit && active.current?.changed) latest.current.change(frame.current);
    active.current = undefined;
    if (locked.current) { locked.current = false; latest.current.interaction(false); }
  }
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled && !!latest.current.center && Math.abs(latest.current.longitudeMeters) > 1,
    onPanResponderGrant: (event) => {
      const p = latest.current;
      if (!p.center) return;
      frame.current = { center: { ...p.center }, scale: p.scale };
      origin.current = { x: event.nativeEvent.pageX - event.nativeEvent.locationX,
        y: event.nativeEvent.pageY - event.nativeEvent.locationY };
      const points = touches(event);
      if (!points.length) return;
      rebase(points);
      locked.current = true; p.interaction(true);
      if (points.length === 1 && p.pick) held.current = setTimeout(() => {
        const gesture = active.current;
        if (!gesture || gesture.changed || gesture.count !== 1) return;
        gesture.changed = true;
        latest.current.change(frame.current);
        latest.current.pick?.(pointOnMap(gesture.anchor.x, gesture.anchor.y, gesture.start.center,
          gesture.width, gesture.height, gesture.longitudeMeters, gesture.start.scale));
      }, 450);
    },
    onPanResponderStart: (event) => {
      const points = touches(event);
      if (!active.current || !points.length || points.length === active.current.count) return;
      clearTimeout(held.current); rebase(points);
    },
    onPanResponderMove: (event) => {
      const points = touches(event);
      const gesture = active.current;
      if (!gesture || !points.length) return;
      if (points.length !== gesture.count) { clearTimeout(held.current); rebase(points); return; }
      if (gesture.count > 1 && gesture.span <= 1) { rebase(points); return; }
      const middle = midpoint(points);
      const distance = span(points);
      if (gesture.count === 1 && !gesture.changed && Math.hypot(middle.x - gesture.anchor.x, middle.y - gesture.anchor.y) < 4) return;
      clearTimeout(held.current);
      const ratio = gesture.count > 1 && gesture.span > 1 ? distance / gesture.span : 1;
      gesture.changed = true;
      frame.current = gestureViewport(gesture.start, gesture.anchor, middle, ratio,
        gesture.width, gesture.height, gesture.longitudeMeters);
      push();
    },
    onPanResponderEnd: (event) => {
      const points = touches(event);
      if (active.current && points.length) { clearTimeout(held.current); rebase(points); }
    },
    onPanResponderRelease: () => finish(),
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => finish(),
  })).current;
  useEffect(() => {
    const app = AppState.addEventListener('change', (state) => { if (state !== 'active') finish(); });
    return () => { app.remove(); finish(false); };
  }, []);
  useEffect(() => { if (active.current) finish(); }, [props.width, props.height, props.disabled]);
  return <View {...responder.panHandlers} pointerEvents={props.disabled ? 'none' : 'auto'}
    accessibilityLabel="Map. Swipe to pan, pinch to zoom, or hold to choose a place."
    style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />;
}
