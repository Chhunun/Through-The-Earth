import {
  hazardKinds, rooms, warningActiveMinutes,
  type HazardKind, type Room, type WarningRequest, type WarningSnapshot,
} from '@patriot/protocol';

// In memory like level reports: a relay restart clears every warning.
type Report = { at: number; note: string };
// One entry per level and hazard. Each maps a reporter's public key to their latest report,
// in insertion order (oldest first), so re-raising moves a reporter to the end.
const warnings = new Map<string, Map<string, Report>>();
const slot = (level: Room, kind: HazardKind) => level + '|' + kind;
const maxReporters = 1000;

export function raiseWarning(key: string, { level, kind, note }: WarningRequest, now = Date.now()) {
  const reporters = warnings.get(slot(level, kind)) ?? new Map<string, Report>();
  if (reporters.size >= maxReporters && !reporters.has(key)) return false;
  reporters.delete(key);
  reporters.set(key, { at: now, note });
  warnings.set(slot(level, kind), reporters);
  return true;
}

export function clearWarning(key: string, level: Room, kind: HazardKind) {
  const reporters = warnings.get(slot(level, kind));
  reporters?.delete(key);
  if (reporters && !reporters.size) warnings.delete(slot(level, kind));
}

export function warningSnapshot(now = Date.now()): WarningSnapshot {
  const cutoff = now - warningActiveMinutes * 60_000;
  const snapshot: WarningSnapshot = [];
  for (const level of rooms) {
    for (const kind of hazardKinds) {
      const reporters = warnings.get(slot(level, kind));
      if (!reporters) continue;
      // Expired reports are dropped here, so memory doesn't grow between restarts.
      for (const [key, report] of reporters) if (report.at <= cutoff) reporters.delete(key);
      if (!reporters.size) {
        warnings.delete(slot(level, kind));
        continue;
      }
      const newestFirst = [...reporters].reverse();
      snapshot.push({
        level,
        kind,
        reporters: newestFirst.map(([key]) => key),
        latestAt: newestFirst[0][1].at,
        note: newestFirst.find(([, report]) => report.note)?.[1].note ?? '',
      });
    }
  }
  return snapshot.sort((a, b) => b.latestAt - a.latestAt);
}
