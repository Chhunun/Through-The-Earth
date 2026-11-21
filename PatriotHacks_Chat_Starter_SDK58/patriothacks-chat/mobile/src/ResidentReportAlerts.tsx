import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { incidentLabels, incidentWindowMinutes, type Room, type SevereReportSummary, type LevelIncident } from '@patriot/protocol';
import { residentReportId, useHiddenResidentReports } from './useHiddenResidentReports';

export default function ResidentReportAlerts({ owner, level, online, reports, incidents }: {
  owner: string; level: Room; online: boolean;
  reports: SevereReportSummary[]; incidents: LevelIncident[];
}) {
  const personal = useHiddenResidentReports(owner);
  const reportId = (report: SevereReportSummary) => residentReportId('alert', level, report.question, report.answer, report.latestAt, report.count);
  const incidentId = (incident: LevelIncident) => residentReportId('incident', level, incident.issue, incident.latestAt, incident.count);
  const visible = reports.filter((report) => !personal.hidden(reportId(report)));
  const early = incidents.filter((incident) => !personal.hidden(incidentId(incident)));
  function dismissAll() {
    void personal.hideMany([...visible.map(reportId), ...early.map(incidentId)])
      .catch((error) => Alert.alert('Reports not hidden', String(error)));
  }
  if (!visible.length && !early.length) return null;
  return <View accessibilityLiveRegion="polite" className="mx-3 mt-2 gap-2 rounded-sm border border-term-line bg-term-panel p-2">
    <View className="flex-row items-start justify-between">
      <Text className="flex-1 font-mono font-bold text-term-text">Resident reports · {level}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Clear all current resident report alerts for me only"
        disabled={!owner} onPress={dismissAll} style={{ padding: 10, marginTop: -8, marginRight: -8 }}>
        <Text className="font-mono text-lg text-term-text">×</Text>
      </Pressable>
    </View>
    {!online ? <Text className="font-mono text-xs text-term-muted">Relay offline · Showing last received reports</Text> : null}
    {visible.length ? <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
      {visible.map((report) => <View key={reportId(report)}
        className={report.severity === 'elevated' ? 'mb-1 flex-row rounded-sm border border-amber-700 bg-amber-950 pl-3 py-1' : 'mb-1 flex-row rounded-sm border border-rose-500 bg-rose-950 pl-3 py-1'}>
        <View className="flex-1 py-1 gap-1">
          <Text className="font-mono font-bold text-term-text">{report.severity === 'elevated' ? 'Warning' : 'Severe'} · Resident reports · {level}</Text>
          <Text className="font-mono text-xs text-term-text">{report.question}: {report.answer} · {report.count} {report.count === 1 ? 'report' : 'reports'} · {new Date(report.latestAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
        </View>
      </View>)}
    </ScrollView> : null}
    {early.map((incident) => <View key={incidentId(incident)} className="flex-row rounded-sm border border-amber-700 bg-amber-950 pl-3 py-1">
      <View className="flex-1 py-1 gap-1">
        <Text className="font-mono font-semibold text-amber-100">Early warning · Resident reports · {level}</Text>
        <Text className="font-mono text-xs text-amber-100">{incidentLabels[incident.issue]} · {incident.count} reports in the past {incidentWindowMinutes} min · Latest {new Date(incident.latestAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
      </View>
    </View>)}
  </View>;
}
