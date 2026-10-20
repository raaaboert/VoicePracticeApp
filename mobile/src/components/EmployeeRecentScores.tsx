import { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  EMPLOYEE_SCORE_PAGE_SIZE, employeeScenarioOptions, employeeScoreDate, employeeScoreLabel,
  filterEmployeeScores, type EmployeeScoreDetail, type ScoreDateFilter, type ScoreSort,
} from "../lib/employeeRecentScores";

interface ScoreTheme {
  text: string; textMuted: string; accent: string; border: string;
  panel: string; selectedCardBg: string; ghostButtonBg: string;
}
interface ScenarioFilterProps {
  value: string; options: {value: string; label: string}[]; onChange: (value: string) => void;
}
export interface EmployeeRecentScoresProps {
  detail: EmployeeScoreDetail;
  theme: ScoreTheme;
  scenarioTitles: ReadonlyMap<string, string>;
  segmentLabels: ReadonlyMap<string, string>;
  industryLabels: ReadonlyMap<string, string>;
  renderScenarioFilter: (props: ScenarioFilterProps) => ReactNode;
}

export function EmployeeRecentScores({detail, theme, scenarioTitles, segmentLabels, industryLabels, renderScenarioFilter}: EmployeeRecentScoresProps) {
  const [date, setDate] = useState<ScoreDateFilter>("all");
  const [scenarioId, setScenarioId] = useState("");
  const [sort, setSort] = useState<ScoreSort>("newest");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rows = detail.scores.recent;
  const filtered = useMemo(() => filterEmployeeScores(rows, {date, scenarioId, sort, periodEndAt: detail.period.endAt}),
    [rows, date, scenarioId, sort, detail.period.endAt]);
  const options = useMemo(() => employeeScenarioOptions(rows, scenarioTitles), [rows, scenarioTitles]);
  const effectivePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / EMPLOYEE_SCORE_PAGE_SIZE) - 1));
  const start = effectivePage * EMPLOYEE_SCORE_PAGE_SIZE;
  const visible = filtered.slice(start, start + EMPLOYEE_SCORE_PAGE_SIZE);
  const resetRows = () => {setPage(0);setExpandedId(null);};
  const control = (label: string, onPress: () => void, selected = false, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected, disabled}}
      disabled={disabled} onPress={onPress} style={({pressed}) => [styles.control, {borderColor: theme.border,
        backgroundColor: selected || pressed ? theme.selectedCardBg : theme.ghostButtonBg, opacity: disabled ? 0.5 : 1}]}>
      <Text style={[styles.controlText, {color: theme.text}]}>{label}</Text>
    </Pressable>
  );
  return <View style={[styles.section, {backgroundColor: theme.panel, borderColor: theme.border}]}>
    <Text accessibilityRole="header" style={[styles.heading, {color: theme.text}]}>Recent Scores</Text>
    <Text style={[styles.body, {color: theme.textMuted}]}>
      {rows.length} loaded of {detail.scores.sessions} scored sessions in this reporting window. The server returns up to the latest 20 results.
    </Text>
    <Text style={[styles.caption, {color: theme.textMuted}]}>
      {employeeScoreDate(detail.period.startAt)} to {employeeScoreDate(detail.period.endAt)}. Filters and sorting apply only to these loaded results; summary totals above are unchanged.
    </Text>
    {rows.length === 0 ? <Text style={[styles.body, {color: theme.textMuted}]}>No scored sessions are available in this reporting window.</Text> : <>
      <Text style={[styles.label, {color: theme.text}]}>Date · loaded results</Text>
      <View style={styles.controls}>
        {([['all', 'All loaded'], ['7', '7 days'], ['30', '30 days']] as const).map(([value, label]) =>
          <View key={value}>{control(label, () => {setDate(value);resetRows();}, date === value)}</View>)}
      </View>
      <Text style={[styles.label, {color: theme.text}]}>Scenario</Text>
      {renderScenarioFilter({value:scenarioId,options,onChange:(value) => {setScenarioId(value);resetRows();}})}
      <View style={styles.controls}>
        {control(sort === "newest" ? "Newest first" : "Oldest first", () => {setSort(sort === "newest" ? "oldest" : "newest");resetRows();})}
        {control("Clear filters", () => {setDate("all");setScenarioId("");setSort("newest");resetRows();}, false,
          date === "all" && !scenarioId && sort === "newest")}
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.caption, {color: theme.textMuted}]}>
        {filtered.length ? `Showing ${start + 1}-${start + visible.length} of ${filtered.length} matching loaded results` : "No loaded results match these filters. Try another filter or Clear filters."}
      </Text>
      {visible.map((row) => {
        const expanded = expandedId === row.id;
        const title = scenarioTitles.get(row.scenarioId) || "Unavailable scenario";
        const score = employeeScoreLabel(row.overallScore);
        const completed = employeeScoreDate(row.endedAt);
        return <View key={row.id} style={[styles.result, {borderColor: theme.border, backgroundColor: theme.ghostButtonBg}]}>
          <Pressable testID={`employee-score-${row.id}`} accessibilityRole="button" accessibilityState={{expanded}}
            accessibilityLabel={`${title}. Score: ${score}. Completed ${completed}.`}
            accessibilityHint={expanded ? "Collapse result details" : "Expand result details"}
            onPress={() => setExpandedId((current) => current === row.id ? null : row.id)} style={styles.resultToggle}>
            <View style={styles.resultCopy}>
              <Text style={[styles.resultTitle, {color: theme.text}]}>{title}</Text>
              <Text style={[styles.caption, {color: theme.textMuted}]}>{completed}</Text>
            </View>
            <View style={styles.score}>
              <Text style={[styles.label, {color: theme.text}]}>{score}</Text>
              <MaterialCommunityIcons name={expanded ? "chevron-up" : "chevron-down"} size={22} color={theme.accent} accessible={false} />
            </View>
          </Pressable>
          {expanded ? <View style={[styles.details, {borderTopColor: theme.border}]}>
            <Text style={[styles.body, {color: theme.text}]}>Scenario: {title}</Text>
            {!scenarioTitles.has(row.scenarioId) ? <Text style={[styles.caption, {color: theme.textMuted}]}>Scenario reference: {row.scenarioId}</Text> : null}
            <Text style={[styles.body, {color: theme.textMuted}]}>Score: {score}{"\n"}Completed: {completed}{"\n"}Role: {segmentLabels.get(row.segmentId) ?? row.segmentId ?? "Not available"}</Text>
            {row.industryId ? <Text style={[styles.body, {color: theme.textMuted}]}>Industry: {industryLabels.get(row.industryId) ?? row.industryId}</Text> : null}
          </View> : null}
        </View>;
      })}
      {filtered.length > EMPLOYEE_SCORE_PAGE_SIZE ? <View style={styles.controls}>
        {control("Previous results", () => {setPage(effectivePage - 1);setExpandedId(null);}, false, effectivePage === 0)}
        {control("Next results", () => {setPage(effectivePage + 1);setExpandedId(null);}, false, start + visible.length >= filtered.length)}
      </View> : null}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: {borderWidth:1,borderRadius:16,padding:16,gap:10,marginBottom:14},
  heading: {fontSize:23,fontWeight:"700"},
  body: {fontSize:14.5,lineHeight:21},
  caption: {fontSize:13,lineHeight:19},
  label: {fontSize:14,fontWeight:"700"},
  controls: {flexDirection:"row",flexWrap:"wrap",gap:8,alignItems:"center"},
  control: {minHeight:44,paddingVertical:10,paddingHorizontal:12,borderWidth:1,borderRadius:12,justifyContent:"center"},
  controlText: {fontSize:14,fontWeight:"600",flexShrink:1},
  result: {borderWidth:1,borderRadius:12},
  resultToggle: {minHeight:64,flexDirection:"row",alignItems:"center",gap:12,padding:12},
  resultCopy: {flex:1,minWidth:0,gap:4},
  resultTitle: {fontSize:15.5,lineHeight:22,fontWeight:"700",flexShrink:1},
  score: {alignItems:"center",flexShrink:1,minWidth:32,gap:4},
  details: {borderTopWidth:1,padding:12,gap:6},
});
