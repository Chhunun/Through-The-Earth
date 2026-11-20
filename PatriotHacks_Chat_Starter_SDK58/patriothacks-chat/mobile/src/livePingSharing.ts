import { mapPingEvents, validPingPoint } from '../../shared/mapPings';
import type { MapPoint } from '@patriot/protocol';

export type LivePingSample = { point: MapPoint; accuracy: number; simulated: boolean; timestamp: number };
type Options = {
  sample: () => LivePingSample | undefined;
  send: (event: string, payload: unknown) => Promise<void>;
  state: (sharing: boolean) => void;
  error: (message: string) => void;
};
type LiveSession = { id: string; simulated: boolean; timer?: ReturnType<typeof setInterval>; updating: boolean };
export function createLivePingSharing(options: Options) {
  let current: LiveSession | undefined;
  function sample() {
    const fix = options.sample();
    if (!fix || !validPingPoint(fix.point) || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 1000
      || Date.now() - fix.timestamp > 15000 || fix.timestamp > Date.now() + 5000) {
      throw new Error('Live sharing stopped because location is unavailable or outdated.');
    }
    return fix;
  }
  async function stop() {
    const session = current;
    current = undefined;
    if (!session) return;
    clearInterval(session.timer);
    options.state(false);
    try { await options.send(mapPingEvents.stop, { id: session.id }); }
    catch { throw new Error('Location updates stopped locally. The last remote marker will disappear when the relay detects the disconnect or after 60 seconds without updates.'); }
  }
  async function update(session: LiveSession) {
    if (session !== current || session.updating) return;
    session.updating = true;
    try {
      const fix = sample();
      if (fix.simulated !== session.simulated) throw new Error('Live sharing stopped because the location mode changed.');
      await options.send(mapPingEvents.update, { id: session.id, point: fix.point, accuracy: fix.accuracy });
    } catch (error) {
      if (current === session) {
        void stop().catch(() => {});
        options.error(String(error));
      }
    } finally { session.updating = false; }
  }
  return {
    async start(id: string, emergency: boolean) {
      if (current) throw new Error('Location is already being shared.');
      const fix = sample();
      const session: LiveSession = { id, simulated: fix.simulated, updating: false };
      current = session;
      options.state(true);
      try {
        await options.send(mapPingEvents.send, { id, point: fix.point, accuracy: fix.accuracy,
          emergency, simulated: fix.simulated, live: true });
        if (current !== session) {
          void options.send(mapPingEvents.stop, { id }).catch(() => {});
          throw new Error('Live sharing was cancelled.');
        }
        session.timer = setInterval(() => { void update(session); }, 2500);
      } catch (error) {
        if (current === session) {
          current = undefined; clearInterval(session.timer); options.state(false);
          void options.send(mapPingEvents.stop, { id }).catch(() => {});
        }
        throw error;
      }
    },
    stop,
    cancel() { void stop().catch((error) => options.error(String(error))); },
  };
}
