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
  assert.match(source, /generatedScenario\?\.similarity\.flagged/);
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
  assert.match(source, /defaultOpen=\{practiceScenarios\?\.permissions\.canAuthor === true/);
  for (const sectionKey of ["assignments", "managers", "practice", "related"]) {
    assert.equal(source.includes("key={`${selected.id}-" + sectionKey + "`}"), true, sectionKey);
  }
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
