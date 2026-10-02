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
  assert.match(screen, /setSelectedTopic\(null\);/);
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

test("4C shell receives safe summary only and cannot launch or mutate scenarios", () => {
  const app = source("../../App.tsx");
  const screen = source("./FocusTopicsScreen.tsx");
  const shell = source("./FocusTopicDetailShell.tsx");
  const model = source("./model.ts");
  const combined = `${screen}\n${shell}\n${model}`;

  assert.match(screen, /buildFocusTopicNavigationSummary\(topic\)/);
  assert.match(shell, /Practice and Learning Resources/);
  assert.doesNotMatch(combined, /trainingId|setSimulationConfig|setSelectedScenarioId|launch/i);
  assert.doesNotMatch(combined, /scenario(?:s)?\s*:/);
  assert.doesNotMatch(combined, /resource(?:s)?\s*:/);
  assert.match(app, /fetchMobileConfig\(nextUser\.id, authToken\)/);
  assert.match(app, /fetchAppConfig\(\)/);
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
