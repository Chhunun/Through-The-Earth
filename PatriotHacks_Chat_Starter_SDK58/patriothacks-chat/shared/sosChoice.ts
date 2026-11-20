// Resolve the choice synchronously before sending, so a tap at the deadline
// cannot send both a selected message and the default SOS.
export function startSosChoice<T>(fallback: T, send: (value: T) => void, delay = 5000) {
  let settled = false;
  const deadline = Date.now() + delay;
  const timer = setTimeout(() => choose(fallback), delay);
  function choose(value: T) {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    send(value);
    return true;
  }
  return {
    choose,
    cancel() { settled = true; clearTimeout(timer); },
    remaining() { return Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); },
  };
}
