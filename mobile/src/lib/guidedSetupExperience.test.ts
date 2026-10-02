import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(resolve(directory, "../../App.tsx"), "utf8");
const setupStart = app.indexOf("const renderSetup");
const setupEnd = app.indexOf("const renderProfile", setupStart);
const setup = app.slice(setupStart, setupEnd);
const applySelectionStart = app.indexOf("const applyScenarioSetupSelection");
const applySelectionEnd = app.indexOf("const openRelatedPracticeScenario", applySelectionStart);
const applySelection = app.slice(applySelectionStart, applySelectionEnd);
const stylesStart = app.indexOf("function createStyles");
const styles = app.slice(stylesStart);

test("guided handoffs collapse the existing selectors while browse entry expands them", () => {
  assert.ok(setupStart >= 0 && setupEnd > setupStart);
  assert.match(app, /const \[isSetupScenarioSelectionExpanded, setIsSetupScenarioSelectionExpanded\] =\s*useState\(true\)/);
  assert.match(applySelection, /setSetupOrigin\(origin\)/);
  assert.match(applySelection, /setIsSetupScenarioSelectionExpanded\(false\)/);
  assert.match(setup, /const isGuidedSetup = setupOrigin !== null/);
  assert.match(
    setup,
    /const showScenarioSelectors = !isGuidedSetup \|\| isSetupScenarioSelectionExpanded/
  );
  assert.match(setup, /\{showScenarioSelectors \? \(/);

  const browseLabels = [...app.matchAll(/accessibilityLabel="Browse Scenarios"/g)];
  assert.ok(browseLabels.length >= 2);
  assert.match(
    app,
    /accessibilityLabel="Browse Scenarios"[\s\S]*?setSetupOrigin\(null\);[\s\S]*?setIsSetupScenarioSelectionExpanded\(true\);[\s\S]*?setScreen\("setup"\)/
  );
});

test("guided Setup summarizes the selected practice without duplicating selector controls", () => {
  const summaryStart = setup.indexOf("!setupSelectionFailure && activeScenario");
  const summaryEnd = setup.indexOf('accessibilityLabel="Change scenario"', summaryStart);
  const summary = setup.slice(summaryStart, summaryEnd);

  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.equal((setup.match(/title="Industry"/g) ?? []).length, 1);
  assert.equal((setup.match(/title="Role"/g) ?? []).length, 1);
  assert.equal((setup.match(/title="Scenario"/g) ?? []).length, 1);
  assert.match(summary, />Selected Practice<\/Text>/);
  assert.match(summary, /activeScenario\.title/);
  assert.match(summary, /activeSegment\.label/);
  assert.match(summary, /activeIndustry\.label/);
  assert.match(summary, /scenarioCatalogTab === "custom" \? "Custom" : "Standard"/);
  assert.match(summary, /Focus Topic: \{activeTraining\.label\}/);
  assert.match(setup, /activeScenario\.summary \?\? activeScenario\.description/);
  assert.doesNotMatch(summary, /selectedTrainingId\}|selectedScenarioId\}|trainingPackId/);
});

test("Change scenario reveals the same controls without resetting practice choices", () => {
  const changeStart = setup.indexOf('accessibilityLabel="Change scenario"');
  const changeEnd = setup.indexOf("</Pressable>", changeStart);
  const changeHandler = setup.slice(changeStart, changeEnd);

  assert.ok(changeStart >= 0 && changeEnd > changeStart);
  assert.match(changeHandler, /setIsSetupScenarioSelectionExpanded\(true\)/);
  assert.doesNotMatch(
    changeHandler,
    /setSelected(?:TrainingId|IndustryId|RoleId|ScenarioId|Difficulty|PersonaStyle)/
  );
  assert.match(setup, /onChange=\{setSelectedTrainingId\}/);
  assert.match(setup, /onChange=\{setSelectedIndustryId\}/);
  assert.match(setup, /onChange=\{setSelectedRoleId\}/);
  assert.match(setup, /onChange=\{setSelectedScenarioId\}/);
});

test("stale guided handoffs fail closed and retain explicit recovery", () => {
  assert.match(setup, /!setupSelectionFailure && activeScenario && activeSegment && activeIndustry/);
  assert.match(setup, /accessibilityRole="alert"/);
  assert.match(setup, /disabled=\{Boolean\(setupSelectionFailure\)\}/);
  assert.match(
    setup,
    /accessibilityLabel="Browse Scenarios"[\s\S]*?setSetupOrigin\(null\);[\s\S]*?setSetupSelectionFailure\(null\);[\s\S]*?setIsSetupScenarioSelectionExpanded\(true\)/
  );
});

test("guided presentation preserves difficulty, persona, origin return, and launch semantics", () => {
  assert.match(setup, /onPress=\{\(\) => setSelectedDifficulty\(difficulty\)\}/);
  assert.match(setup, /onPress=\{\(\) => setSelectedPersonaStyle\(personaStyle\)\}/);
  assert.match(setup, /setScreen\(setupBackDestination\(setupOrigin\)\)/);
  assert.match(setup, /onPress=\{\(\) => void startSimulation\(\)\}/);
  assert.match(
    app,
    /trainingId: scenarioCatalogTab === "custom" \? activeTraining\?\.id \?\? null : null/
  );
  assert.match(
    app,
    /<ScorecardView[\s\S]*?onBack=\{\(\) => \{[\s\S]*?setScreen\("setup"\)/
  );
});

test("guided practice card remains accessible and width-safe", () => {
  assert.match(setup, /accessibilityRole="progressbar"/);
  assert.match(setup, /accessibilityLabel="Preparing selected practice"/);
  assert.match(setup, /accessibilityLabel=\{`\$\{activeScenario\.title\}/);
  assert.match(setup, /accessibilityHint="Shows the full scenario selection controls"/);
  assert.match(styles, /guidedPracticeCard:[\s\S]*?padding: 16[\s\S]*?gap: 14/);
  assert.match(styles, /guidedPracticeEyebrow:[\s\S]*?flex: 1[\s\S]*?minWidth: 0/);
  assert.match(styles, /guidedPracticeChange:[\s\S]*?minHeight: 44/);
  assert.doesNotMatch(styles, /guidedPractice(?:Card|Summary|Title|Context|Topic|Description|Meta): \{[^}]*height:/);
});
