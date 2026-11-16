import { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { localClock } from '@patriot/protocol';

export default function LocalClock() {
  const [clock, setClock] = useState(localClock);

  useEffect(() => {
    function refresh() {
      const next = localClock();
      setClock((previous) => previous.date === next.date && previous.time === next.time ? previous : next);
    }
    const timer = setInterval(refresh, 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  return (
    <View accessible accessibilityLabel={'Local time ' + clock.time + ', ' + clock.date}
      className="shrink-0 items-end">
      <Text className="text-sm font-semibold text-white">{clock.time}</Text>
      <Text className="text-xs text-zinc-300">{clock.date}</Text>
    </View>
  );
}
