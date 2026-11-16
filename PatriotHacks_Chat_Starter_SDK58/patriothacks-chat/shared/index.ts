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

const responseColors = ['#60a5fa', '#fbbf24', '#f87171', '#a78bfa'];

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

export function localClock(now = new Date()) {
  return {
    date: now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
    time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}
