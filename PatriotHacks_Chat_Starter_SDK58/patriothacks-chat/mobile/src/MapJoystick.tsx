import { useEffect, useMemo, useRef } from 'react';
import term from './terminal-colors.json';
import { Animated, PanResponder, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  move: (east: number, north: number) => void;
  interaction: (active: boolean) => void;
};

export default function MapJoystick({ move, interaction }: Props) {
  const insets = useSafeAreaInsets();
  const callbacks = useRef({ move, interaction });
  callbacks.current = { move, interaction };
  const vector = useRef({ x: 0, y: 0 });
  const touching = useRef(false);
  const knob = useRef(new Animated.ValueXY()).current;

  const responder = useMemo(() => {
    function reset() {
      touching.current = false;
      vector.current = { x: 0, y: 0 };
      knob.setValue({ x: 0, y: 0 });
      callbacks.current.interaction(false);
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        touching.current = true;
        callbacks.current.interaction(true);
      },
      onPanResponderMove: (_, gesture) => {
        const length = Math.hypot(gesture.dx, gesture.dy);
        const divisor = Math.max(1, length / 30);
        const next = { x: gesture.dx / divisor, y: gesture.dy / divisor };
        vector.current = next;
        knob.setValue(next);
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderRelease: reset,
      onPanResponderTerminate: reset,
    });
  }, [knob]);

  useEffect(() => {
    let previous = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const seconds = Math.min(0.25, (now - previous) / 1000);
      previous = now;
      const { x, y } = vector.current;
      if (touching.current && Math.hypot(x, y) > 4) {
        // Full deflection walks at 2.5 meters per second.
        callbacks.current.move(x / 30 * 2.5 * seconds, -y / 30 * 2.5 * seconds);
      }
    }, 200);
    return () => {
      clearInterval(timer);
      touching.current = false;
      vector.current = { x: 0, y: 0 };
    };
  }, []);

  return (
    <View style={{ position: 'absolute', right: 16, bottom: insets.bottom + 12,
      alignItems: 'center', zIndex: 20, elevation: 8 }}>
      <Text className="font-mono" style={{ color: '#fde68a', fontSize: 10, marginBottom: 5,
        backgroundColor: term.bg, paddingHorizontal: 6 }}>TEST WALK</Text>
      <View {...responder.panHandlers} accessibilityLabel="Test walk joystick. Drag to move."
        style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: term.field,
          borderWidth: 1, borderColor: '#fbbf24', alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View pointerEvents="none" style={{ width: 36, height: 36, borderRadius: 18,
          backgroundColor: '#fbbf24', transform: knob.getTranslateTransform() }} />
      </View>
    </View>
  );
}
