import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, PanResponder, Text, View } from 'react-native';

type Props = {
  disabled: boolean;
  begin: () => Promise<void>;
  preview: (x: number, y: number) => void;
  finish: (drop?: { x: number; y: number }) => Promise<void>;
  cancel: () => void;
};

// The button owns the touch until release, even as the finger moves onto the map.
export default function BlockPassageButton(props: Props) {
  const current = useRef(props); current.current = props;
  const mounted = useRef(true);
  const session = useRef(0);
  const gesture = useRef({ x: 0, y: 0, dragging: false });
  const preparing = useRef<Promise<void> | undefined>(undefined);
  const working = useRef(false);
  const [pressed, setPressed] = useState(false);
  function cancel() {
    session.current++;
    working.current = false;
    current.current.cancel();
    if (mounted.current) setPressed(false);
  }
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !current.current.disabled && !working.current,
    onPanResponderGrant: (event) => {
      session.current++;
      working.current = true;
      gesture.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, dragging: false };
      setPressed(true);
      preparing.current = current.current.begin();
      // Store rejection for release without an unhandled promise rejection.
      void preparing.current.catch(() => {});
    },
    onPanResponderMove: (_, state) => {
      if (!working.current) return;
      if (Math.hypot(state.dx, state.dy) > 8) gesture.current.dragging = true;
      if (gesture.current.dragging) current.current.preview(gesture.current.x + state.dx, gesture.current.y + state.dy);
    },
    onPanResponderRelease: (_, state) => {
      if (!working.current) return;
      const request = session.current;
      const drop = gesture.current.dragging ? { x: gesture.current.x + state.dx, y: gesture.current.y + state.dy } : undefined;
      void (async () => {
        try {
          await preparing.current;
          if (!mounted.current || request !== session.current) return;
          await current.current.finish(drop);
        } catch (error) {
          if (mounted.current && request === session.current) Alert.alert('Passage not marked', String(error));
        } finally {
          if (request === session.current) cancel();
        }
      })();
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: cancel,
  })).current;
  useEffect(() => {
    mounted.current = true;
    const app = AppState.addEventListener('change', (state) => { if (state !== 'active') cancel(); });
    return () => { mounted.current = false; app.remove(); cancel(); };
  }, []);
  return <View {...responder.panHandlers} accessible accessibilityRole="button"
    accessibilityState={{ disabled: props.disabled }} accessibilityLabel="Block passage. Tap at your location, or drag onto the map."
    accessibilityActions={[{ name: 'activate', label: 'Block passage at my location' }]}
    onAccessibilityAction={() => {
      if (current.current.disabled || working.current) return;
      working.current = true;
      void current.current.finish().catch((error) => Alert.alert('Passage not marked', String(error))).finally(cancel);
    }}
    style={{ backgroundColor: pressed ? '#881337' : '#4c0519', borderWidth: 1, borderColor: '#f43f5e', padding: 12, borderRadius: 2, opacity: props.disabled ? 0.5 : 1 }}>
    <Text className="font-mono" style={{ color: '#ffe4e6' }}>{pressed ? 'Drop onto map' : 'Block passage'}</Text>
  </View>;
}
