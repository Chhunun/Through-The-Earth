import { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { Room } from '@patriot/protocol';
import { sosLabels, sosTypes, type SosType } from '../../shared/sosTypes';
import { startSosChoice } from '../../shared/sosChoice';

export type SosRequest = { id: string; destination: string; floodLevel?: Room; send: (type: SosType) => Promise<void> };
export default function SosChooser({ request, cancel }: { request?: SosRequest; cancel: () => void }) {
  const controller = useRef<ReturnType<typeof startSosChoice<SosType>> | undefined>(undefined);
  const [seconds, setSeconds] = useState(5);
  useEffect(() => {
    if (!request) return;
    const choice = startSosChoice<SosType>('general', (type) => { void request.send(type); });
    controller.current = choice;
    setSeconds(5);
    const refresh = () => {
      setSeconds(choice.remaining());
      // Native timers can pause while the app is suspended. Resolve an expired
      // deadline on return instead of granting a second five-second window.
      if (choice.remaining() === 0) choice.choose('general');
    };
    const ticker = setInterval(refresh, 250);
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { choice.cancel(); clearInterval(ticker); app.remove(); controller.current = undefined; };
  }, [request]);
  function dismiss() { controller.current?.cancel(); cancel(); }
  return <Modal visible={!!request} transparent animationType="fade" onRequestClose={dismiss}>
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#000b' }}>
      <View style={{ backgroundColor: '#0f172a', padding: 20, borderRadius: 16, gap: 12 }}>
        <Text className="text-xl font-bold text-rose-200">Send SOS</Text>
        <Text className="text-white">To: {request?.destination}</Text>
        <Text accessibilityLiveRegion="polite" className="text-amber-200">Default “I need help” sends in {seconds}s unless you choose or cancel.</Text>
        <ScrollView style={{ maxHeight: 360 }}>
          {sosTypes.map((type) => <Pressable key={type} accessibilityRole="button"
            disabled={type === 'flood' && !request?.floodLevel} onPress={() => controller.current?.choose(type)}
            className="mb-2 rounded-lg bg-rose-900 p-3">
            <Text className="font-semibold text-white">{sosLabels[type]}</Text>
            {type === 'flood' ? <Text className="text-xs text-rose-100">Flooding on {request?.floodLevel ?? 'a level you must set in your profile'} · Sends to all three levels · Requires relay connection</Text> : null}
          </Pressable>)}
        </ScrollView>
        <Text className="text-xs text-slate-300">Choosing an option sends it immediately.</Text>
        <Pressable accessibilityRole="button" onPress={dismiss} className="rounded bg-slate-700 p-3"><Text className="text-center text-white">Cancel SOS</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
