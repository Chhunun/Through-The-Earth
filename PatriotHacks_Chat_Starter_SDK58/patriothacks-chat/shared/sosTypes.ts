import { rooms, sosMessage, type Room } from '@patriot/protocol';
export const sosTypes = ['general', 'lost', 'medical', 'heat', 'food', 'water', 'flood'] as const;
export type SosType = (typeof sosTypes)[number];
export const sosLabels: Record<SosType, string> = {
  general: 'I need help', lost: "I'm lost", medical: 'I need medical attention',
  heat: "It's too hot here", food: 'I urgently need food', water: 'I need water', flood: 'Flooding — alert all levels',
};
export const sosEvent = 'sos:send';
export function isSosType(value: unknown): value is SosType {
  return sosTypes.some((type) => type === value);
}
export function sosText(type: SosType, source?: Room): string {
  if (type === 'general') return sosMessage;
  if (type === 'flood') return 'SOS — Flooding reported on ' + source + '. Alert for all levels.';
  return 'SOS — ' + sosLabels[type] + '.';
}
export function isSosMessage(text: string): boolean {
  return sosTypes.filter((type) => type !== 'flood').some((type) => text === sosText(type))
    || rooms.some((level) => text === sosText('flood', level));
}
