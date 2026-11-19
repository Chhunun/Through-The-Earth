import { useEffect, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';

export default function MapJoystick({ move }: { move: (east: number, north: number) => void }) {
  const callback = useRef(move);
  callback.current = move;
  const vector = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  function reset() {
    vector.current = { x: 0, y: 0 };
    setKnob({ x: 0, y: 0 });
  }
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, gesture) => {
      const length = Math.hypot(gesture.dx, gesture.dy);
      const divisor = Math.max(1, length / 32);
      const next = { x: gesture.dx / divisor, y: gesture.dy / divisor };
      vector.current = next;
      setKnob(next);
    },
    onPanResponderRelease: reset,
    onPanResponderTerminate: reset,
  })).current;
  useEffect(() => {
    const timer = setInterval(() => {
      const { x, y } = vector.current;
      if (Math.hypot(x, y) > 3) callback.current(x / 32 * 0.5, -y / 32 * 0.5);
    }, 200);
    return () => clearInterval(timer);
  }, []);
  return <View style={{ position: 'absolute', left: 52, bottom: 42, alignItems: 'center' }}>
    <Text style={{ color: '#fde68a', fontSize: 10, marginBottom: 4 }}>TEST WALK</Text>
    <View {...responder.panHandlers} accessibilityLabel="Test walk joystick. Drag to move."
      style={{ width: 94, height: 94, borderRadius: 47, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#fbbf24', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#fbbf24', transform: [{ translateX: knob.x }, { translateY: knob.y }] }} />
    </View>
  </View>;
}
