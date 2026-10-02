import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

function source(relativePath: string): string {
  return readFileSync(resolve(sourceDirectory, relativePath), "utf8");
}

test("landing renders every server-ordered topic as an accessible scalable card", () => {
  const landing = source("./FocusTopicLandingScreen.tsx");
  const card = source("./FocusTopicCard.tsx");

  assert.match(landing, /props\.topics\.map\(\(topic\)/);
  assert.doesNotMatch(landing, /\.sort\(/);
  assert.match(landing, /Choose a topic to focus your practice and learning\./);
  assert.match(landing, /FOCUS_TOPICS_EMPTY_MESSAGE/);
  assert.match(landing, /accessibilityRole="progressbar"/);
  assert.match(landing, /accessibilityLabel="Retry Focus Topics"/);
  assert.match(card, /accessibilityRole="button"/);
  assert.match(card, /Open Focus Topic \$\{topic\.name\}/);
  assert.match(card, /minWidth: 0/);
  assert.doesNotMatch(`${landing}${card}`, /numberOfLines=/);
  assert.doesNotMatch(`${landing}${card}`, /Training Pack/);
});

test("screen clears old catalog, retries locally, and guards stale identity requests", () => {
  const screen = source("./FocusTopicsScreen.tsx");
  const model = source("./model.ts");

  assert.match(screen, /const attempt = requestGate\.current\.start\(\);/);
  assert.match(screen, /setTopics\(null\);/);
  assert.match(screen, /setSelectedTopicId\(null\);/);
  assert.match(screen, /signal: attempt\.signal/);
  assert.match(screen, /requestGate\.current\.isCurrent\(attempt\)/);
  assert.match(screen, /onRetry=\{\(\) => \{ void loadTopics\(\); \}\}/);
  assert.match(model, /activeController\?\.abort\(\)/);
});

test("client uses the shared authenticated request path with acting-org headers intact", () => {
  const binding = source("./api.ts");
  const client = source("./client.ts");
  const sharedApi = source("../lib/api.ts");

  assert.match(binding, /createFocusTopicCatalogClient\(requestJson\)/);
  assert.match(client, /\/mobile\/users\/\$\{encodeURIComponent\(userId\)\}\/focus-topics/);
  assert.match(client, /authToken/);
  assert.match(client, /signal: options\?\.signal/);
  assert.match(sharedApi, /"X-Superuser-Org-Id": activeSuperUserOrgId/);
});

test("Home makes Focus Topics primary for eligible users while retaining setup and resources", () => {
  const app = source("../../App.tsx");
  const homeStart = app.indexOf("const renderHome");
  const homeEnd = app.indexOf("const renderOnboarding", homeStart);
  const home = app.slice(homeStart, homeEnd);

  const focusEntry = home.indexOf('accessibilityLabel="Open Focus Topics"');
  const scenarioEntry = home.indexOf('accessibilityLabel="Browse Scenarios"');
  const resourcesEntry = home.indexOf('accessibilityLabel="Open Learning Resources"');
  const activeRole = home.indexOf("activeSegment ? (");
  assert.ok(focusEntry >= 0 && focusEntry < scenarioEntry);
  assert.ok(scenarioEntry < resourcesEntry);
  assert.ok(resourcesEntry < activeRole);
  assert.match(home, /styles\.trainingModuleTile, styles\.homeDestinationPrimary/);
  assert.match(
    home,
    /Practice scenarios and review resources organized around what you're working on\./
  );
  assert.match(home, /Explore the full scenario library\./);
  assert.match(home, /Browse all company learning materials\./);
  assert.match(home, /setScreen\("focus_topics"\)/);
  assert.match(home, /Browse Scenarios/);
  assert.match(home, /setTrainingContentPracticeReturnContentId\(null\)/);
  assert.match(home, /setScreen\("setup"\)/);
  assert.match(home, /void openTrainingContent\(\)/);
  assert.match(home, />Active role<\/Text>/);
  assert.match(home, />Ready<\/Text>/);
  assert.match(home, /Setup opens with this role selected\./);
  assert.match(app, /screen === "focus_topics"/);
});

test("individual Home retains its existing setup-first hierarchy", () => {
  const app = source("../../App.tsx");
  const homeStart = app.indexOf("const renderHome");
  const homeEnd = app.indexOf("const renderOnboarding", homeStart);
  const home = app.slice(homeStart, homeEnd);
  const enterpriseBranchStart = home.indexOf("{canOpenFocusTopics ? (");
  const individualSetupStyle = home.indexOf(
    "style={[styles.homePrimaryButton",
    enterpriseBranchStart
  );
  const individualBranchStart = home.lastIndexOf("<Pressable", individualSetupStyle);
  const individualBranch = home.slice(individualBranchStart, home.indexOf("{activeSegment ? ("));

  assert.ok(enterpriseBranchStart >= 0);
  assert.ok(individualSetupStyle >= 0);
  assert.ok(individualBranchStart >= 0);
  assert.match(individualBranch, /styles\.homePrimaryButton/);
  assert.match(individualBranch, /Continue to setup/);
  assert.match(individualBranch, /setTrainingContentPracticeReturnContentId\(null\)/);
  assert.match(individualBranch, /setScreen\("setup"\)/);
  assert.doesNotMatch(individualBranch, /Focus Topics/);
  assert.doesNotMatch(individualBranch, /homeDestinationGroup/);
});

test("eligible enterprise Home renders Learning Resources only in the grouped destinations", () => {
  const app = source("../../App.tsx");
  const homeStart = app.indexOf("const renderHome");
  const homeEnd = app.indexOf("const renderOnboarding", homeStart);
  const home = app.slice(homeStart, homeEnd);
  const groupedStart = home.indexOf('<View style={styles.homeDestinationGroup}>');
  const individualSetupStyle = home.indexOf("style={[styles.homePrimaryButton", groupedStart);
  const groupedDestinations = home.slice(groupedStart, individualSetupStyle);
  const activeRoleStart = home.indexOf("{activeSegment ? (", individualSetupStyle);
  const afterActiveRole = home.slice(activeRoleStart);

  assert.ok(groupedStart >= 0);
  assert.ok(individualSetupStyle > groupedStart);
  assert.equal(
    groupedDestinations.match(/accessibilityLabel="Open Learning Resources"/g)?.length,
    1
  );
  assert.match(afterActiveRole, /\{!canOpenFocusTopics && trainingContentEnabled \? \(/);
  assert.equal(
    afterActiveRole.match(/accessibilityLabel="Open Learning Resources"/g)?.length,
    1
  );
});

test("Topic Detail refetches authoritative content and keeps scenarios presentation-only", () => {
  const app = source("../../App.tsx");
  const screen = source("./FocusTopicsScreen.tsx");
  const detail = source("./FocusTopicDetailScreen.tsx");
  const client = source("./client.ts");
  const model = source("./model.ts");
  const combined = `${screen}\n${detail}\n${client}\n${model}`;

  assert.match(screen, /openTopic\(topic\.id\)/);
  assert.match(detail, /fetchFocusTopicDetail/);
  assert.match(detail, /setDetail\(null\)/);
  assert.match(detail, /formatFocusTopicDetailCounts\(detail\)/);
  assert.match(detail, />Practice<\/Text>/);
  assert.match(detail, />Learning Resources<\/Text>/);
  assert.match(detail, /detail\.scenarios\.map/);
  assert.match(detail, /detail\.resources\.map/);
  assert.match(detail, /<View[\s\S]*?key=\{scenario\.id\}[\s\S]*?accessible/);
  assert.match(
    detail,
    /accessibilityLabel=\{`\$\{scenario\.title\}[\s\S]*?\$\{scenario\.description\}/
  );
  assert.doesNotMatch(detail, /onPress=.*scenario|Set Up Practice|Start Simulation/);
  assert.doesNotMatch(detail, /Topic activities will be available here in a future update/);
  assert.doesNotMatch(combined, /setSimulationConfig|setSelectedScenarioId|Start Simulation|setScreen\("setup"\)/i);
  assert.match(app, /fetchMobileConfig\(nextUser\.id, authToken\)/);
  assert.match(app, /fetchAppConfig\(\)/);
});

test("Topic resources reuse the existing viewer and return to refreshed Topic Detail", () => {
  const screen = source("./FocusTopicsScreen.tsx");
  const detail = source("./FocusTopicDetailScreen.tsx");
  const resourceCard = source("../trainingContent/TrainingContentCard.tsx");
  const resourceDetail = source("../trainingContent/TrainingContentDetailScreen.tsx");

  assert.match(detail, /<TrainingContentCard/);
  assert.match(detail, /showRelatedFocusTopic=\{false\}/);
  assert.match(screen, /<TrainingContentDetailScreen/);
  assert.match(screen, /showRelatedPracticeScenarios=\{false\}/);
  assert.match(screen, /contentHorizontalInset/);
  assert.match(screen, /setDetailRefreshKey\(\(current\) => current \+ 1\)/);
  assert.match(screen, /const handleTopicResourceBack = useCallback/);
  assert.match(screen, /const handleTopicResourceRemoved = useCallback/);
  assert.match(screen, /onBack=\{handleTopicResourceBack\}/);
  assert.match(screen, /onItemRemoved=\{handleTopicResourceRemoved\}/);
  assert.match(screen, /onModuleRemoved=\{handleTopicResourceRemoved\}/);
  assert.doesNotMatch(screen, /on(?:Item|Module)Removed=\{\([^)]*\) =>/);
  assert.match(resourceCard, /showRelatedFocusTopic && item\.relatedFocusTopic/);
  assert.match(resourceDetail, /props\.showRelatedPracticeScenarios === false/);
  assert.match(
    resourceDetail,
    /props\.contentHorizontalInset \? styles\.contentHorizontalInset : null/
  );
  assert.match(resourceDetail, /contentHorizontalInset: \{ paddingHorizontal: 16 \}/);
});

test("Topic Detail handles loading, unavailable, retry, empty sections, and stale requests", () => {
  const detail = source("./FocusTopicDetailScreen.tsx");
  const screen = source("./FocusTopicsScreen.tsx");

  assert.match(detail, /accessibilityRole="progressbar"/);
  assert.match(detail, /This Focus Topic is no longer available\./);
  assert.match(detail, /accessibilityLabel="Retry Focus Topic"/);
  assert.match(detail, /No practice scenarios are available for this topic right now\./);
  assert.match(detail, /No learning resources are available for this topic right now\./);
  assert.match(detail, /requestGate\.current\.isCurrent\(attempt\)/);
  assert.match(detail, /return \(\) => requestGate\.current\.invalidate\(\)/);
  assert.match(screen, /<FocusTopicDetailScreen[\s\S]*?key=\{selectedTopicId\}/);
  assert.ok(screen.includes('key={`${selectedTopicId}:${selectedResourceId}`}'));
  assert.match(screen, /setRefreshCatalogOnBack\(true\)/);
  assert.match(screen, /void loadTopics\(\)/);
});

test("identity key remounts the catalog for user or acting-organization changes", () => {
  const app = source("../../App.tsx");
  assert.match(app, /const focusTopicContextKey = `\$\{user\.id\}:\$\{activeSuperUserOrgId \?\? user\.orgId \?\? ""\}`/);
  assert.match(app, /<FocusTopicsScreen[\s\S]*?key=\{focusTopicContextKey\}/);
});

test("landing uses shared light/dark tokens and width-safe text layout", () => {
  const screen = source("./FocusTopicsScreen.tsx");
  const landing = source("./FocusTopicLandingScreen.tsx");
  const card = source("./FocusTopicCard.tsx");

  assert.match(screen, /getTrainingContentTheme\(props\.colorScheme\)/);
  assert.match(screen, /styles\.surface, \{ backgroundColor: theme\.background, borderColor: theme\.border \}/);
  assert.match(screen, /borderRadius: 18/);
  assert.match(screen, /overflow: "hidden"/);
  assert.match(landing, /<ScrollView/);
  assert.match(landing, /paddingHorizontal: 16/);
  assert.match(card, /copy: \{ flex: 1, minWidth: 0 \}/);
  assert.match(card, /flexShrink: 0/);
  assert.doesNotMatch(card, /width:\s*[3-9]\d\d/);
  assert.doesNotMatch(card, /numberOfLines/);
});
