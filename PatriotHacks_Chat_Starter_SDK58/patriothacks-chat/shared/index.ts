export const events = {
  challenge: 'identity:challenge',
  authenticate: 'identity:authenticate',
  send: 'message:send',
  receive: 'message:receive',
  received: 'message:received',
} as const;

export interface Envelope {
  v: 1;
  id: string;
  from: string;
  to: string;
  nonce: string;
  ciphertext: string;
  sentAt: number;
}

export interface Challenge {
  publicKey: string;
  nonce: string;
  ciphertext: string;
}

export type Ack = { ok: true } | { ok: false; error: string };

export const isPublicKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(value);

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<Envelope>;
  return e.v === 1 && typeof e.id === 'string' && /^[0-9a-f-]{36}$/.test(e.id)
    && isPublicKey(e.from) && isPublicKey(e.to) && e.from !== e.to
    && typeof e.nonce === 'string' && /^[A-Za-z0-9+/]{32}$/.test(e.nonce)
    && typeof e.ciphertext === 'string' && e.ciphertext.length >= 24
    && e.ciphertext.length <= 32_768 && e.ciphertext.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(e.ciphertext)
    && typeof e.sentAt === 'number' && Number.isSafeInteger(e.sentAt) && e.sentAt > 0;
}

export const rooms = ['Upper Level', 'Middle Level', 'Lower Levels'] as const;
export type Room = (typeof rooms)[number];
export interface RoomMessage {
  id: string;
  room: Room;
  from: string;
  text: string;
}
export const roomEvents = {
  history: 'room:history',
  send: 'room:send',
  message: 'room:message',
} as const;
export const isRoom = (value: unknown): value is Room =>
  rooms.some((room) => room === value);

export const reportQuestions = [
  { id: 'air', label: 'Air shortage or poor airflow', choices: ['None observed', 'Reduced airflow', 'Little or no airflow'] },
  { id: 'power', label: 'Power outages', choices: ['None observed', 'Intermittent', 'Partial outage', 'Power is out'] },
  { id: 'blackout', label: 'Lighting blackout', choices: ['None observed', 'Some areas dark', 'Whole level dark'] },
  { id: 'supplies', label: 'Essential supplies available', choices: ['Adequate', 'Running low', 'Out of essentials'] },
  { id: 'ill', label: 'Visibly ill people you observed', choices: ['0', '1–5', '6–10', '11+'] },
  { id: 'heat', label: 'Heat conditions', choices: ['Comfortable', 'Hot', 'Very hot'] },
  { id: 'lung', label: 'Breathing or lung symptoms observed', choices: ['None observed', 'Yes'] },
] as const;

export type ReportAnswers = Partial<Record<(typeof reportQuestions)[number]['id'], string>>;
export interface LevelReport {
  answers: ReportAnswers;
  temperatureF?: number;
}
export interface LevelReportSummary {
  reports: number;
  counts: Record<string, number[]>;
  averageTemperatureF?: number;
  temperatureCount: number;
}
export interface PublishedLevelReport extends LevelReport {
  reporter: string;
  submittedAt: number;
}
export interface LevelReportView {
  recent: PublishedLevelReport[];
  summary: LevelReportSummary;
  own: LevelReport;
}
export type LevelReportResult = { ok: true; view: LevelReportView } | { ok: false; error: string };

export const reportEvents = { read: 'report:read', submit: 'report:submit' } as const;

export function parseLevelReport(answers: ReportAnswers, temperature: string): LevelReport {
  const report: LevelReport = { answers };
  if (temperature.trim()) {
    const value = Number(temperature);
    if (!Number.isFinite(value) || value < -100 || value > 200) {
      throw new Error('Enter a measured temperature between −100 and 200 °F.');
    }
    report.temperatureF = value;
  }
  if (!Object.values(answers).some(Boolean) && report.temperatureF === undefined) {
    throw new Error('Answer at least one question or enter a temperature.');
  }
  return report;
}

// Chart colors follow choice order (least to most severe): terminal green through amber to red.
const responseColors = ['#6bff8f', '#d4e157', '#ffa040', '#ff5f5f'];

export function reportPie(counts: readonly number[]) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  let end = 0;
  return counts.flatMap((count, index) => {
    if (!count || !total) return [];
    const start = end;
    const fraction = count / total;
    end += fraction * 360;
    return [{ index, count, color: responseColors[index] ?? '#34d399',
      start, end, percent: Math.round(fraction * 100) }];
  });
}

export interface ChatProfile {
  name: string;
  level: Room;
}

export type ChatProfiles = Record<string, ChatProfile>;
export const profileEvents = {
  snapshot: 'profile:snapshot',
  changed: 'profile:changed',
  save: 'profile:save',
} as const;

export function parseChatProfile(input: unknown): ChatProfile | undefined {
  if (!input || typeof input !== 'object') return;
  const { name, level } = input as Partial<ChatProfile>;
  if (typeof name !== 'string' || !isRoom(level)) return;
  const displayName = name.trim();
  if (!displayName || displayName.length > 40 || /[\x00-\x1f\x7f]/.test(displayName)) return;
  return { name: displayName, level };
}

export function profileLabel(profile: ChatProfile) {
  return profile.name + ' · ' + profile.level;
}

export const sosMessage = 'SOS — I need help.';

export const checkInMessages = {
  okay: 'Check-in — I’m okay.',
  help: sosMessage,
  request: 'Check-in request — are you okay?',
} as const;
export type CheckIn = keyof typeof checkInMessages;

export function checkInStatus(text: string) {
  if (text === checkInMessages.okay) return 'I’m okay';
  if (text === checkInMessages.help) return 'Needs help';
}

export const incidentEvent = 'incident:snapshot';
export const incidentThreshold = 2;
export const incidentWindowMinutes = 60;
export const incidentLabels = {
  power: 'Power disruption',
  airflow: 'Reduced airflow',
} as const;
export type IncidentIssue = keyof typeof incidentLabels;

export interface LevelIncident {
  issue: IncidentIssue;
  count: number;
  latestAt: number;
}

export type IncidentSnapshot = Record<Room, LevelIncident[]>;

// Daily log: a private record of the user's own day. It stays on the device and is never sent to the relay.
// Like reportQuestions, choices run from best to worst.
export const dailyLogQuestions = [
  { id: 'sleep', label: 'Sleep last night', choices: ['8+ hours', '6–8 hours', '4–6 hours', 'Under 4 hours'] },
  { id: 'mood', label: 'Mood', choices: ['Good', 'Okay', 'Low', 'Very low'] },
  { id: 'body', label: 'Body health', choices: ['Feeling well', 'Tired', 'Aches or pain', 'Sick'] },
  { id: 'food', label: 'Meals eaten today', choices: ['3 or more', '2', '1', 'None'] },
] as const;
export const dailyLogNotesLimit = 500;

export type DailyLogAnswers = Partial<Record<(typeof dailyLogQuestions)[number]['id'], string>>;
export interface DailyLogEntry {
  day: string; // Local date as YYYY-MM-DD
  answers: DailyLogAnswers;
  notes: string;
  savedAt: number;
}

// The local calendar day, so an entry made at 11 pm belongs to that day, not the next one in UTC.
export function dailyLogDay(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

export function dailyLogDayLabel(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Validates an entry read back from device storage. Unknown questions and choices are dropped.
export function parseDailyLogEntry(value: unknown): DailyLogEntry | undefined {
  if (!value || typeof value !== 'object') return;
  const { day, answers, notes, savedAt } = value as Record<string, unknown>;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof savedAt !== 'number') return;
  const parsed: DailyLogAnswers = {};
  for (const { id, choices } of dailyLogQuestions) {
    const answer = (answers as Record<string, unknown> | undefined)?.[id];
    if (typeof answer === 'string' && (choices as readonly string[]).includes(answer)) parsed[id] = answer;
  }
  return { day, answers: parsed, notes: typeof notes === 'string' ? notes.slice(0, dailyLogNotesLimit) : '', savedAt };
}

export function localClock(now = new Date()) {
  return {
    date: now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
    time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}

export const levelPresenceEvent = 'level:presence';
export type LevelPresence = Record<Room, number>;

export const severeReportsEvent = 'report:severe';
// Includes every report choice above the least severe option.
export interface SevereReportSummary {
  severity?: 'severe' | 'elevated';
  question: string;
  answer: string;
  count: number;
  latestAt: number;
}
export type SevereReports = Record<Room, SevereReportSummary[]>;

export const levelTemperatureEvent = 'level:temperature';
export interface LevelTemperature {
  count: number;
  averageF: number | null;
}
export type LevelTemperatures = Record<Room, LevelTemperature>;

// Hazard warnings: a resident raises one for a level and every signed-in resident sees it.
// Each resident's warning stays active for warningActiveMinutes unless they raise it again or clear it.
export const hazardLabels = {
  air: 'Air cutout',
  water: 'Unsafe water',
} as const;
export type HazardKind = keyof typeof hazardLabels;
export const hazardKinds = Object.keys(hazardLabels) as HazardKind[];
export const isHazardKind = (value: unknown): value is HazardKind =>
  hazardKinds.some((kind) => kind === value);
export const warningActiveMinutes = 60;
export const warningNoteLimit = 120;
export const warningEvents = {
  raise: 'warning:raise',
  clear: 'warning:clear',
  snapshot: 'warning:snapshot',
} as const;

export interface WarningRequest {
  level: Room;
  kind: HazardKind;
  note: string; // Where on the level, '' when not given
}
export interface HazardWarning {
  level: Room;
  kind: HazardKind;
  reporters: string[]; // Public keys of everyone who raised or confirmed it, newest first
  latestAt: number;
  note: string; // The newest non-empty note
}
// Newest first, across all levels, because every resident sees every warning.
export type WarningSnapshot = HazardWarning[];

export function parseWarningRequest(input: unknown): WarningRequest | undefined {
  if (!input || typeof input !== 'object') return;
  const { level, kind, note } = input as Record<string, unknown>;
  if (!isRoom(level) || !isHazardKind(kind) || (note !== undefined && typeof note !== 'string')) return;
  const text = (note ?? '').trim();
  if (text.length > warningNoteLimit || /[\x00-\x1f\x7f]/.test(text)) return;
  return { level, kind, note: text };
}


export type MapPoint = { latitude: number; longitude: number };
export type WalkPath = { id: string; level: Room; points: MapPoint[] };
export const mapEvents = { read: 'map:read', contribute: 'map:contribute', path: 'map:path', sync: 'map:sync', remove: 'map:remove', removed: 'map:removed' };

export function isWalkPath(value: unknown): value is WalkPath {
  if (!value || typeof value !== 'object') return false;
  const path = value as WalkPath;
  return typeof path.id === 'string' && /^[0-9a-f-]{36}$/.test(path.id)
    && isRoom(path.level) && Array.isArray(path.points)
    && path.points.length >= 2 && path.points.length <= 300
    && path.points.every((point) => point && Number.isFinite(point.latitude)
      && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude)
      && Math.abs(point.longitude) <= 180);
}

export type MapPlaceKind = 'personal' | 'blackout' | 'block';
export interface MapPlace {
  id: string;
  level: Room;
  point: MapPoint;
  kind: MapPlaceKind;
  label: string;
  createdAt: number;
  blackout?: 'Some areas dark' | 'Whole level dark';
}
export type SharedMapPlace = MapPlace & { kind: 'blackout' | 'block' };
export type MapPlaceSnapshot = { revision: number; places: SharedMapPlace[] };
export const mapPlaceEvents = { read: 'map:places:read', add: 'map:places:add',
  remove: 'map:places:remove', move: 'map:places:move', snapshot: 'map:places:snapshot' };
export function isMapPlace(value: unknown): value is MapPlace {
  if (!value || typeof value !== 'object') return false;
  const p = value as MapPlace;
  return typeof p.id === 'string' && /^[0-9a-f-]{36}$/.test(p.id) && isRoom(p.level)
    && ['personal', 'blackout', 'block'].includes(p.kind)
    && typeof p.label === 'string' && p.label.trim().length > 0 && p.label.length <= 80
    && Number.isSafeInteger(p.createdAt) && p.createdAt >= 0 && !!p.point
    && Number.isFinite(p.point.latitude) && Math.abs(p.point.latitude) <= 90
    && Number.isFinite(p.point.longitude) && Math.abs(p.point.longitude) <= 180
    && (p.kind !== 'blackout' || p.blackout === 'Some areas dark' || p.blackout === 'Whole level dark');
}
export function isMapPlaceSnapshot(value: unknown): value is MapPlaceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as MapPlaceSnapshot;
  return Number.isSafeInteger(s.revision) && s.revision >= 0 && Array.isArray(s.places)
    && s.places.length <= 1000 && s.places.every((p) => isMapPlace(p) && (p.kind === 'blackout' || p.kind === 'block'));
}

export function isMapPoint(value: unknown): value is MapPoint {
  if (!value || typeof value !== 'object') return false;
  const p = value as MapPoint;
  return Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90
    && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180;
}

export type MapPathState = { paths: WalkPath[]; deletedIds: string[] };
export function isMapPathState(value: unknown): value is MapPathState {
  if (!value || typeof value !== 'object') return false;
  const s = value as MapPathState;
  return Array.isArray(s.paths) && s.paths.length <= 1000 && s.paths.every(isWalkPath)
    && Array.isArray(s.deletedIds) && s.deletedIds.length <= 10000
    && s.deletedIds.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id));
}

// Authenticated accounts with a saved profile; one entry per public key.
export const onlinePeopleEvent = 'people:online';
