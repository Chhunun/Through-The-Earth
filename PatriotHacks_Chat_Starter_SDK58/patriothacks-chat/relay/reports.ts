import {
  incidentThreshold, incidentWindowMinutes, reportQuestions, rooms,
  type IncidentSnapshot, type LevelIncident, type LevelReport, type LevelReportView, type PublishedLevelReport, type Room, type SevereReports, type LevelTemperature, type LevelTemperatures,
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
  for (const report of level?.values() ?? []) {
    for (const { id, choices } of reportQuestions) {
      const index = (choices as readonly string[]).indexOf(report.answers[id] ?? '');
      if (index >= 0) counts[id][index]++;
    }
  }
  const temperature = averageTemperature(room);
  return {
    own: level?.get(key) ?? { answers: {} },
    recent: Array.from(level?.values() ?? []).reverse(),
    summary: {
      reports: level?.size ?? 0, counts, temperatureCount: temperature.count,
      averageTemperatureF: temperature.averageF ?? undefined,
    },
  };
}

function averageTemperature(room: Room): LevelTemperature {
  let sum = 0;
  let count = 0;
  for (const { temperatureF } of reports.get(room)?.values() ?? []) {
    if (temperatureF === undefined) continue;
    sum += temperatureF;
    count++;
  }
  return { count, averageF: count ? sum / count : null };
}

export function levelTemperatures(): LevelTemperatures {
  return {
    'Upper Level': averageTemperature('Upper Level'),
    'Middle Level': averageTemperature('Middle Level'),
    'Lower Levels': averageTemperature('Lower Levels'),
  };
}

export function incidentSnapshot(now = Date.now()): IncidentSnapshot {
  const cutoff = now - incidentWindowMinutes * 60_000;
  const snapshot: IncidentSnapshot = { 'Upper Level': [], 'Middle Level': [], 'Lower Levels': [] };
  for (const room of rooms) {
    const active = [...(reports.get(room)?.values() ?? [])].filter(
      (report) => report.submittedAt > cutoff && report.submittedAt <= now,
    );
    const issues: { issue: LevelIncident['issue']; matches: (report: PublishedLevelReport) => boolean }[] = [
      { issue: 'power', matches: ({ answers }) => Boolean(answers.power && answers.power !== 'None observed') },
      { issue: 'airflow', matches: ({ answers }) => Boolean(answers.air && answers.air !== 'None observed') },
    ];
    for (const { issue, matches } of issues) {
      const matching = active.filter(matches);
      if (matching.length < incidentThreshold) continue;
      snapshot[room].push({
        issue,
        count: matching.length,
        latestAt: Math.max(...matching.map(({ submittedAt }) => submittedAt)),
      });
    }
  }
  return snapshot;
}

export function severeReports(now = Date.now()): SevereReports {
  const cutoff = now - incidentWindowMinutes * 60_000;
  const snapshot: SevereReports = { 'Upper Level': [], 'Middle Level': [], 'Lower Levels': [] };
  for (const room of rooms) {
    for (const { id, label, choices } of reportQuestions) {
      // Keep the existing event for compatibility. Every non-baseline choice
      // gets its own count; unanswered and the least severe choice are excluded.
      for (const answer of choices.slice(1)) {
        let count = 0;
        let latestAt = 0;
        for (const report of reports.get(room)?.values() ?? []) {
          if (report.submittedAt <= cutoff || report.submittedAt > now || report.answers[id] !== answer) continue;
          count++;
          latestAt = Math.max(latestAt, report.submittedAt);
        }
        if (count) snapshot[room].push({ question: label, answer, count, latestAt,
          severity: answer === choices[choices.length - 1] ? 'severe' : 'elevated' });
      }
    }
    snapshot[room].sort((a, b) => b.latestAt - a.latestAt);
  }
  return snapshot;
}
