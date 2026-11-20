import { useEffect, useRef, useState } from 'react';
import term from './terminal-colors.json';
import { Alert, Animated, AppState, PanResponder, Text } from 'react-native';
import type { MapPlace, MapPoint } from '@patriot/protocol';
import type { ScreenPlace } from './mapMarkerLayout';

type Props = {
  item: ScreenPlace; width: number; height: number; color: string; symbol: string; online: boolean;
  toPoint: (x: number, y: number) => MapPoint; inspect: (place: MapPlace) => void;
  move: (place: MapPlace, point: MapPoint) => Promise<void>; interaction: (active: boolean) => void;
};
export default function DraggableMapPin(props: Props) {
  const current = useRef(props);
  current.current = props;
  const offset = useRef(new Animated.ValueXY()).current;
  const gesture = useRef({ armed: false, movedBeforeHold: false, dx: 0, dy: 0,
    item: props.item, toPoint: props.toPoint, width: props.width, height: props.height });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const saving = useRef(false);
  const locked = useRef(false);
  const [lifted, setLifted] = useState(false);
  function reset() {
    clearTimeout(timer.current);
    gesture.current.armed = false;
    offset.setValue({ x: 0, y: 0 });
    if (locked.current) { locked.current = false; current.current.interaction(false); }
    if (mounted.current) setLifted(false);
  }
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !saving.current,
    onPanResponderGrant: () => {
      const p = current.current;
      gesture.current = { armed: false, movedBeforeHold: false, dx: 0, dy: 0,
        item: p.item, toPoint: p.toPoint, width: p.width, height: p.height };
      timer.current = setTimeout(() => {
        if (!mounted.current || gesture.current.movedBeforeHold) return;
        if (p.item.place.kind !== 'personal' && !current.current.online) {
          gesture.current.movedBeforeHold = true;
          Alert.alert('Relay offline', 'Reconnect to move a shared marker.');
          return;
        }
        gesture.current.armed = true;
        setLifted(true);
        locked.current = true;
        p.interaction(true);
      }, 400);
    },
    onPanResponderMove: (_, state) => {
      const g = gesture.current;
      if (!g.armed) {
        if (Math.hypot(state.dx, state.dy) > 8) {
          g.movedBeforeHold = true; clearTimeout(timer.current);
        }
        return;
      }
      g.dx = Math.max(-g.item.x, Math.min(g.width - g.item.x, state.dx));
      g.dy = Math.max(-g.item.y, Math.min(g.height - g.item.y, state.dy));
      offset.setValue({ x: g.dx, y: g.dy });
    },
    onPanResponderRelease: () => {
      clearTimeout(timer.current);
      const g = gesture.current;
      if (!g.armed) {
        if (!g.movedBeforeHold) current.current.inspect(current.current.item.place);
        reset(); return;
      }
      if (Math.hypot(g.dx, g.dy) < 3) { reset(); return; }
      const point = g.toPoint(g.item.x + g.dx, g.item.y + g.dy);
      saving.current = true;
      void current.current.move(g.item.place, point).catch(() => {
        // Parent displays the failure; reset restores the authoritative position.
      }).finally(() => { saving.current = false; reset(); });
    },
    onPanResponderTerminationRequest: () => !gesture.current.armed,
    onPanResponderTerminate: reset,
  })).current;
  useEffect(() => {
    mounted.current = true;
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && !saving.current) reset();
    });
    return () => { mounted.current = false; clearTimeout(timer.current); app.remove(); if (locked.current) { locked.current = false; current.current.interaction(false); } };
  }, []);
  return <Animated.View {...responder.panHandlers} accessible accessibilityRole="button"
    accessibilityLabel={props.item.place.kind + ': ' + props.item.place.label + '. Hold then drag to move.'}
    accessibilityActions={[{ name: 'activate', label: 'View marker' }]}
    onAccessibilityAction={() => props.inspect(props.item.place)}
    style={{ position: 'absolute', left: (lifted ? gesture.current.item.x : props.item.x) - 18, top: (lifted ? gesture.current.item.y : props.item.y) - 34,
      width: 36, height: 34, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
      backgroundColor: lifted ? term.active : term.bg, borderWidth: lifted ? 3 : 2,
      borderColor: props.color, zIndex: lifted ? 100 : 10,
      transform: offset.getTranslateTransform() }}>
    <Text className="font-mono" style={{ color: props.color, fontWeight: 'bold', fontSize: 20 }}>{props.symbol}</Text>
  </Animated.View>;
}
