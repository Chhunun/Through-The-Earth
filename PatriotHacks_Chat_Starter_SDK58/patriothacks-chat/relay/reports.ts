import {
  reportQuestions, type LevelReport, type LevelReportView, type PublishedLevelReport, type Room,
} from '@patriot/protocol';

const reports = new Map<Room, Map<string, PublishedLevelReport>>();

export function validateReport(value: unknown): LevelReport | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { answers, temperatureF } = value as Partial<LevelReport>;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return;
  const clean: LevelReport = { answers: {} };
  for (const [id, answer] of Object.entries(answers)) {
    const question = reportQuestions.find((entry) => entry.id === id);
    if (!question || !(question.choices as readonly string[]).includes(answer)) return;
    clean.answers[question.id] = answer;
  }
  if (temperatureF !== undefined) {
    if (typeof temperatureF !== 'number' || !Number.isFinite(temperatureF)
      || temperatureF < -100 || temperatureF > 200) return;
    clean.temperatureF = temperatureF;
  }
  if (Object.keys(clean.answers).length || clean.temperatureF !== undefined) return clean;
}

export function saveReport(room: Room, key: string, report: LevelReport) {
  const level = reports.get(room) ?? new Map<string, PublishedLevelReport>();
  if (level.size >= 1000 && !level.has(key)) return false;
  level.delete(key);
  level.set(key, { ...report, reporter: key, submittedAt: Date.now() });
  reports.set(room, level);
  return true;
}

export function readReports(room: Room, key: string): LevelReportView {
  const level = reports.get(room);
  const counts: Record<string, number[]> = Object.fromEntries(
    reportQuestions.map(({ id, choices }) => [id, choices.map(() => 0)]),
  );
  let sum = 0;
  let temperatureCount = 0;
  for (const report of level?.values() ?? []) {
    for (const { id, choices } of reportQuestions) {
      const index = (choices as readonly string[]).indexOf(report.answers[id] ?? '');
      if (index >= 0) counts[id][index]++;
    }
    if (report.temperatureF !== undefined) {
      sum += report.temperatureF;
      temperatureCount++;
    }
  }
  return {
    own: level?.get(key) ?? { answers: {} },
    recent: Array.from(level?.values() ?? []).reverse(),
    summary: {
      reports: level?.size ?? 0, counts, temperatureCount,
      averageTemperatureF: temperatureCount ? sum / temperatureCount : undefined,
    },
  };
}
