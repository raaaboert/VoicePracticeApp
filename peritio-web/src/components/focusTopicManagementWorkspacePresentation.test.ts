import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(componentsDir, "FocusTopicAdministration.tsx"), "utf8");
const styles = readFileSync(join(componentsDir, "../../app/globals.css"), "utf8");
const page = readFileSync(join(componentsDir, "../../app/app/admin/focus-topics/page.tsx"), "utf8");
const proxy = readFileSync(join(componentsDir, "../../app/api/admin/focus-topic-management/route.ts"), "utf8");

test("Draft Topics explain restrictions beside Status and keep content controls disabled until Active is saved", () => {
  assert.match(source, /const topicIsDraft = selected\?\.status === "draft"/);
  assert.match(source, /const topicContentEnabled = selected\?\.status === "active"/);
  assert.doesNotMatch(source, /const topicContentEnabled = status === "active"/);
  assert.match(source, /This Focus Topic is in Draft\. To attach related content or generate custom scenarios, change the Topic to Active and save\./);
  assert.match(source, /TriangleAlert className="focus-topic-draft-marker" aria-hidden="true"/);
  assert.match(source, /aria-describedby=\{topicIsDraft \? "focus-topic-draft-warning" : undefined\}/);
  assert.match(source, /id="focus-topic-draft-warning" role="status"/);
  assert.match(source, /Ask an Organization Admin to activate this Topic/);
  assert.match(source, /id="focus-topic-content-restriction" role="status"/);
  assert.match(source, /id="focus-topic-generation-restriction" role="status"/);
  assert.equal((source.match(/<fieldset className="focus-topic-content-controls" disabled=\{!topicContentEnabled\}/g) ?? []).length, 2);
  const attach = source.slice(source.indexOf("const attachContent ="), source.indexOf("const detachContent ="));
  const generate = source.slice(source.indexOf("const generateScenarioDraft ="), source.indexOf("const beginScenarioRevision ="));
  for (const handler of [attach, generate]) {
    assert.ok(handler.indexOf("if (!topicContentEnabled)") < handler.indexOf("await action<"));
    assert.match(handler, /setError\(DRAFT_TOPIC_RESTRICTION\)/);
  }
  assert.match(styles, /\.focus-topic-draft-warning \{[^}]*background: var\(--warning-soft\);[^}]*color: var\(--warning\)/);
  assert.match(styles, /\.focus-topic-content-controls \{[^}]*min-width: 0;[^}]*border: 0/);
});

test("Topic resource panels shrink within their cards and wrap content actions without clipping", () => {
  for (const selector of ["focus-topic-admin", "focus-topic-admin-panel", "focus-topic-panel-body",
    "focus-topic-assignment-section", "focus-topic-assignment-list"]) {
    const rule = styles.match(new RegExp(`\\.${selector} \\{([^}]+)\\}`))?.[1];
    assert.ok(rule, selector);
    assert.match(rule, /grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(rule, /min-width: 0/);
  }
  assert.match(styles, /\.focus-topic-assignment-row \{[^}]*flex-wrap: wrap/);
  assert.match(styles, /\.focus-topic-admin :is\(input, select, textarea\) \{[^}]*max-width: 100%/);
  assert.match(styles, /\.focus-topic-assignment-row > \.training-content-order-copy \{[^}]*flex-basis: min\(100%, 20rem\)/);
  assert.match(styles, /\.focus-topic-panel-body\[hidden\] \{\s*display: none/);
});

test("Focus Topic workspace separates details, learner access, scoped managers, and Related Content", () => {
  for (const copy of [
    "Topic details",
    "Learner assignments",
    "Topic managers",
    "Related Content",
    "Attached Content",
    "Available Content",
    "Upload New",
  ]) {
    assert.equal(source.includes(copy), true, copy);
  }
  assert.match(source, /canManageAllTopics \? <div className="focus-topic-actions">/);
  assert.match(source, /Topic Managers can assign and revoke individual assignments for their current direct reports/);
  assert.match(source, /disabled=\{busy \|\| !canManageAllTopics/);
});

test("Related Content uses toggleable authorized attach and upload panels", () => {
  assert.match(source, /action: "list_related_content"/);
  assert.match(source, /action: "attach_content"/);
  assert.match(source, /action: "detach_content"/);
  assert.match(source, /action: "create_content"/);
  assert.match(source, /action: "initiate_content_upload"/);
  assert.match(source, /action: "finalize_content_upload"/);
  assert.match(source, /action: "update_content"/);
  assert.match(source, /"publish_content" \| "unpublish_content"/);
  assert.match(source, /item\?\.canMutate/);
  assert.match(source, /item\.mutationRestriction/);
  assert.match(source, /related\?\.permissions\.canManageRelatedContent/);
  assert.match(source, /Learning Resources are not enabled for this organization/);
  assert.match(source, /useState<"attach" \| "upload" \| null>\(null\)/);
  assert.match(source, /current === "attach" \? null : "attach"/);
  assert.match(source, /current === "upload" \? null : "upload"/);
  assert.match(source, /aria-controls="focus-topic-available-content"/);
  assert.match(source, /aria-controls="focus-topic-upload-content"/);
  assert.match(source, /aria-pressed=\{contentMode === "attach"\}/);
  assert.match(proxy, /case "list_related_content"/);
  assert.match(proxy, /case "attach_content"/);
  assert.match(proxy, /case "detach_content"/);
  assert.match(proxy, /case "create_content"/);
  assert.match(proxy, /case "initiate_content_upload"/);
  assert.match(proxy, /case "finalize_content_upload"/);
});

test("Related Content supports YouTube sources, private transcripts, and eligibility state", () => {
  assert.match(source, />YouTube URL<\/button>/);
  assert.match(source, /Public YouTube URL/);
  assert.match(source, /Create Draft YouTube Resource/);
  assert.match(source, /item\.contentType !== "external_url" \? <label>Replace file/);
  assert.match(source, /Generation source:/);
  assert.match(source, /Transcript/);
  assert.match(source, /Not provided/);
  assert.match(source, /Ready/);
  assert.match(source, /Add Transcript/);
  assert.match(source, /Replace Transcript/);
  assert.match(source, /Remove Transcript/);
  assert.match(source, /readOnly=\{!item\.transcript\.canMutate\}/);
  assert.match(source, /A transcript is required before this resource can be used to generate practice scenarios/);
  assert.match(proxy, /case "get_content_transcript"/);
  assert.match(proxy, /case "put_content_transcript"/);
  assert.match(proxy, /case "remove_content_transcript"/);
});

test("scoped dashboard page uses server-derived Topic capability and filtered workspace metadata", () => {
  assert.match(page, /viewer\.capabilities\.manageFocusTopics/);
  assert.match(page, /topics\.management\.canManageAllTopics/);
  assert.match(page, /topics\.management\.learningResourcesEnabled/);
  assert.match(page, /usersPayload\?\.users \?\? \[\]/);
});

test("Focus Topic workspace exposes the customer Practice Scenario review lifecycle", () => {
  for (const copy of [
    "Practice Scenarios",
    "Create Draft",
    "Submit for Review",
    "Approve",
    "Reject",
    "Publish",
    "Archive",
    "Edit / New Revision",
  ]) {
    assert.equal(source.includes(copy), true, copy);
  }
  assert.match(source, /practiceScenarios\.permissions\.canReviewAndPublish/);
  assert.match(source, /practiceScenarios\.editableScenarioIds/);
  assert.match(source, /Awaiting review:/);
  assert.match(source, /Review comment \(optional\)/);
  assert.match(source, /Version and review history/);
  assert.match(source, /Related Content sources \(optional\)/);
  assert.match(source, /sourceContentIds: scenarioSourceContentIds/);
  assert.doesNotMatch(source, /Source reference \(optional\)/);
  assert.match(proxy, /case "list_practice_scenarios"/);
  assert.match(proxy, /case "create_practice_scenario"/);
  assert.match(proxy, /case "generate_practice_scenario"/);
  assert.match(proxy, /case "submit_practice_scenario"/);
  assert.match(proxy, /transitionDashboardCustomerPracticeScenario/);
  assert.equal(source.includes("Generate with AI"), false);
  assert.match(source, /Generate Scenario Draft/);
  assert.match(source, /Generate Scenario/);
  assert.match(source, /const scenarioGenerationInFlight = useRef\(false\)/);
  assert.match(source, /if \(scenarioGenerationInFlight\.current \|\| !selected \|\| !practiceScenarios\) return/);
  assert.match(source, /generationInput = buildScenarioGenerationRequest/);
  assert.match(source, /scenarioGenerationInFlight\.current = true/);
  assert.match(source, /setGeneratingScenario\(true\)/);
  assert.match(source, /\.finally\(\(\) => \{[\s\S]*?scenarioGenerationInFlight\.current = false;[\s\S]*?setGeneratingScenario\(false\)/);
  assert.match(source, /LoaderCircle aria-hidden="true" className="spin" size=\{18\}/);
  assert.match(source, /Generating scenario…/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /Generating a draft from the selected sources…/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.spin\s*\{[\s\S]*?animation: none;/);
  assert.match(source, /generatedScenario\?\.similarity\.flagged/);
});

test("Practice Scenario authoring and review expose guidance, provenance, and current rejection feedback", () => {
  assert.match(source, /CircleHelp aria-hidden="true" size=\{18\}/);
  assert.match(source, /aria-label="How scenario generation works"/);
  assert.match(source, /role="tooltip" className="focus-topic-generation-tooltip"/);
  assert.match(source, /Generating creates one unsaved draft/);
  assert.match(styles, /\.focus-topic-generation-help:hover \.focus-topic-generation-tooltip/);
  assert.match(styles, /\.focus-topic-generation-help:focus-within \.focus-topic-generation-tooltip/);
  assert.match(styles, /\.focus-topic-generation-help-button\s*\{[\s\S]*?border: 1px solid var\(--border-strong\);[\s\S]*?color: var\(--text-secondary\);/);
  assert.match(styles, /\.focus-topic-generation-help-button:hover,[\s\S]*?color: var\(--text\);[\s\S]*?border-color: var\(--accent\);[\s\S]*?background: var\(--accent-soft\);/);
  assert.match(styles, /\.focus-topic-generation-help-button:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--accent\);/);
  assert.match(source, /rows=\{8\} value=\{scenarioDescription\}/);
  assert.match(source, /rows=\{8\} value=\{scenarioScoringGuidance\}/);
  assert.match(source, /rows=\{3\} maxLength=\{2000\}/);
  assert.match(styles, /\.focus-topic-admin textarea\.text-input\s*\{[\s\S]*?resize: vertical;/);
  assert.match(styles, /\.focus-topic-admin textarea\.focus-topic-scenario-textarea/);
  assert.match(source, /function latestApplicableRejectionFeedback/);
  assert.match(source, /if \(scenario\.status !== "rejected"\) return null/);
  assert.match(source, /Latest rejection feedback/);
  assert.match(source, /function scenarioProvenanceLabel/);
  assert.match(source, /Manual revision of an AI-generated scenario/);
  assert.match(source, /AI-generated draft from selected Related Content/);
  assert.match(source, /Manually authored from an existing scenario/);
});

test("Practice Scenario scoring mode preserves editable guidance and submits explicit industry-only guidance", () => {
  assert.match(source, /Use existing industry scoring only/);
  assert.match(source, /useState\(false\)/);
  assert.match(source, /setScenarioScoringGuidance\(generated\.scoringGuidance\); setScenarioUseIndustryScoringOnly\(false\)/);
  assert.match(source, /setScenarioUseIndustryScoringOnly\(!version\.scoringGuidance\.trim\(\)\)/);
  assert.match(source, /disabled=\{scenarioUseIndustryScoringOnly\} aria-describedby="focus-topic-scoring-mode-help"/);
  assert.match(source, /scoringGuidance: scenarioUseIndustryScoringOnly \? "" : scenarioScoringGuidance/);
  assert.match(source, /!scenarioUseIndustryScoringOnly && !scenarioScoringGuidance\.trim\(\)/);
  assert.match(source, /Your unsaved guidance is retained if you switch back/);
  assert.match(source, /version\.scoringGuidance \|\| "Existing industry scoring only"/);
  assert.match(source, /className="focus-topic-scenario-scoring-guidance"/);
  assert.match(styles, /\.focus-topic-scenario-scoring-guidance\s*\{[\s\S]*?white-space: pre-wrap;/);
  assert.match(styles, /\.focus-topic-scoring-mode/);
});

test("Practice Scenario rows group active and archived scenarios behind accessible disclosures", () => {
  assert.match(source, /const activePracticeScenarios = orderedPracticeScenarios\.filter\(\(scenario\) => scenario\.status !== "archived"\)/);
  assert.match(source, /const archivedPracticeScenarios = orderedPracticeScenarios\.filter\(\(scenario\) => scenario\.status === "archived"\)/);
  assert.match(source, /scenarioGroupOpenByTopic/);
  assert.match(source, /expandedScenarioIdsByTopic/);
  assert.match(source, /\?\? \{ active: true, archived: false \}/);
  assert.match(source, />Active Scenarios \(\{activePracticeScenarios\.length\}\)</);
  assert.match(source, />Archived Scenarios \(\{archivedPracticeScenarios\.length\}\)</);
  assert.match(source, /No active Practice Scenarios\. Archived scenarios remain available below\./);
  assert.match(source, /aria-controls=\{`focus-topic-\$\{selected\.id\}-active-scenarios-content`\}/);
  assert.match(source, /aria-controls=\{contentId\}/);
  assert.match(source, /className="focus-topic-scenario-group-body"[\s\S]*?hidden=\{!selectedScenarioGroupOpen\.active\}/);
  assert.match(source, /className="focus-topic-scenario-detail" hidden=\{!open\}/);
  assert.match(source, /if \(next === "archive"\) setScenarioGroupOpen\("archived", true\)/);
  assert.match(styles, /\.focus-topic-scenario-group-body\[hidden\],[\s\S]*?\.focus-topic-scenario-detail\[hidden\][\s\S]*?display: none;/);
  assert.match(styles, /\.focus-topic-scenario-row\s*\{[\s\S]*?padding: 0\.75rem 0\.85rem;/);
});

test("Practice Scenario expanded details retain actions, review state, and history", () => {
  assert.match(source, /const renderPracticeScenarioRows/);
  assert.match(source, /className="focus-topic-scenario-detail-header"/);
  assert.match(source, /className="focus-topic-scenario-actions"/);
  assert.match(source, /className="focus-topic-scenario-version-details"/);
  for (const detail of ["Scenario context", "Desired outcome", "AI counterpart role", "Scoring guidance"]) {
    assert.equal(source.includes(`<dt>${detail}</dt>`), true, detail);
  }
  assert.match(source, /applicable \{industryLabels\.length === 1 \? "industry" : "industries"\}: \{industryLabels\.join/);
  assert.match(source, /className="focus-topic-field focus-topic-review-comment"/);
  assert.match(source, /className="focus-topic-scenario-archive-action"/);
  assert.match(source, /\[\.\.\.scenario\.history\][\s\S]*?Date\.parse\(right\.createdAt\) - Date\.parse\(left\.createdAt\)/);
  assert.match(source, /className="focus-topic-scenario-history-event"/);
  assert.match(styles, /\.focus-topic-scenario-detail-header[\s\S]*?justify-content: space-between;/);
  assert.match(styles, /\.focus-topic-scenario-version-details\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.focus-topic-scenario-archive-action\s*\{[\s\S]*?border-top/);
});

test("Focus Topic workspace keeps accessible disclosure bodies mounted per selected Topic", () => {
  assert.match(source, /function FocusTopicWorkspaceSection/);
  assert.match(source, /className="focus-topic-section-copy"/);
  assert.match(source, /<h3 id=\{headingId\}>\{title\}<\/h3>/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=\{contentId\}/);
  assert.match(source, /aria-label=\{`\$\{open \? "Collapse" : "Expand"\} \$\{title\}`\}/);
  assert.match(source, /<ChevronUp aria-hidden="true" size=\{18\} \/>/);
  assert.match(source, /<ChevronDown aria-hidden="true" size=\{18\} \/>/);
  assert.match(source, /className="focus-topic-panel-body" hidden=\{!open\}/);
  assert.match(styles, /\.focus-topic-panel-body\[hidden\]\s*\{\s*display: none;/);
  assert.match(styles, /\.focus-topic-section-toggle:hover\s*\{[\s\S]*?var\(--brand-forest\)/);
  for (const heading of [
    "focus-topic-assignments-heading",
    "focus-topic-managers-heading",
    "focus-topic-practice-heading",
    "focus-topic-related-heading",
  ]) {
    assert.equal(source.includes(`headingId="${heading}"`), true, heading);
  }
  assert.match(source, /summary=\{`\$\{learnerParts\.activeAssignments\.length\} active/);
  assert.match(source, /summary=\{`\$\{managerParts\.activeAssignments\.length\} active/);
  assert.match(source, /awaiting review/);
  assert.match(source, /defaultOpen = false/);
  assert.doesNotMatch(source, /defaultOpen=\{practiceScenarios/);
  for (const sectionKey of ["assignments", "managers", "practice", "related"]) {
    assert.equal(source.includes("key={`${selected.id}-" + sectionKey + "`}"), true, sectionKey);
  }
});

test("Practice Scenario source selectors retain native inputs with scoped polished option rows", () => {
  assert.equal((source.match(/focus-topic-scenario-option-group/g) ?? []).length >= 3, true);
  assert.match(source, /className="scenario-option-list focus-topic-scenario-option-list"/);
  assert.match(source, /className=\{`scenario-option-row focus-topic-scenario-option-row\$\{scenarioSourceContentIds\.includes\(item\.id\)/);
  assert.match(source, /className=\{`scenario-option-row focus-topic-scenario-option-row\$\{scenarioIndustryIds\.includes\(option\.id\)/);
  assert.equal((source.match(/type="checkbox"/g) ?? []).length >= 3, true);
  assert.match(styles, /\.focus-topic-scenario-option-group\s*\{[\s\S]*?border: 0;/);
  assert.match(styles, /\.focus-topic-scenario-option-row\.is-selected\s*\{[\s\S]*?background: var\(--accent-soft\);/);
  assert.match(styles, /\.focus-topic-scenario-option-row input\s*\{[\s\S]*?appearance: none;/);
  assert.match(styles, /@media \(forced-colors: active\)\s*\{[\s\S]*?\.focus-topic-scenario-option-row input\s*\{[\s\S]*?appearance: auto;/);
});

test("scenario editor restricts options and explains editable versus saved industry state", () => {
  assert.match(source, /editableScenarioIndustries\(version\.applicableIndustryIds/);
  assert.match(source, /scenarioRolesForIndustries\(practiceScenarios\.roleOptions, scenarioIndustryIds\)/);
  assert.match(source, /The saved version is unchanged/);
  assert.match(source, /No industries are currently available for this organization/);
  assert.match(source, /currently unavailable/);
});

test("available Related Content searches authorized candidates and refreshes after attach", () => {
  assert.match(source, /const matchingAvailableContent = normalizedAvailableContentSearch/);
  assert.match(source, /\[item\.title, item\.description, item\.contentType\]/);
  assert.match(source, /id="focus-topic-available-content-search" type="search"/);
  assert.match(source, /Search available Learning Resources/);
  assert.match(source, /Showing \{visibleAvailableContent\.length\} of \{matchingAvailableContent\.length\}/);
  assert.match(source, /No available Learning Resources match this search/);
  assert.match(source, /slice\(0, availableContentVisibleCount\)/);
  assert.match(source, /setAvailableContentVisibleCount\(\(count\) => count \+ 50\)/);
  assert.match(source, />Show More<\/button>/);
  assert.match(source, /caught\.status !== 409/);
  assert.match(source, /await refreshRelatedContent\(\);/);
  assert.match(source, /setContentMode\(null\); setAvailableContentSearch\(""\); setAvailableContentVisibleCount\(50\);/);
});
test("scoped Topic managers always receive the individual learner picker with bounded feedback", () => {
  assert.match(source, /const assignmentAudience: Audience = canManageAllTopics \? audience : "individual"/);
  assert.match(source, /value=\{assignmentAudience\}/);
  assert.match(source, /action: "list_assignable_learners"/);
  assert.match(source, /Loading current eligible direct reports/);
  assert.match(source, /No current eligible direct reports are available for this Topic/);
  assert.match(source, /Eligible direct reports could not be loaded/);
  assert.match(source, /: assignableLearners\.map/);
  assert.match(source, /audience: assignmentAudience/);
});

test("scenario learner context precedes generation and review separates it from the AI counterpart", () => {
  assert.ok(source.indexOf(">Learner Role") < source.indexOf("<h4>Generate Scenario Draft</h4>"));
  assert.ok(source.indexOf("<legend>Applicable industries</legend>") < source.indexOf("<h4>Generate Scenario Draft</h4>"));
  assert.match(source, /buildScenarioGenerationRequest\(practiceScenarios, scenarioSegmentId/);
  assert.match(source, /\.\.\.generationInput/);
  assert.match(source, /generatedScenarioContextMatches\(generatedScenario, scenarioSegmentId, scenarioIndustryIds\)/);
  assert.match(source, /Regenerate the draft or restore its original selections before saving/);
  assert.match(source, /Your text edits are preserved/);
  assert.match(source, /disabled=\{busy \|\| generatedContextChanged/);
  assert.match(source, /<dt>Learner Role<\/dt>/);
  assert.match(source, /role\.id === version\.segmentId/);
  assert.match(source, /<dt>Applicable industries<\/dt>/);
  assert.match(source, /<dt>AI counterpart role<\/dt>/);
  assert.match(proxy, /segmentId: string; applicableIndustryIds: string\[\]/);
});
