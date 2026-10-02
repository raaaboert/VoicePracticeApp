import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(resolve(directory, "../../App.tsx"), "utf8");
const trainingHeader = readFileSync(
  resolve(directory, "../trainingContent/TrainingContentHeader.tsx"),
  "utf8"
);
const trainingTheme = readFileSync(
  resolve(directory, "../trainingContent/theme.ts"),
  "utf8"
);
const setupStart = app.indexOf("const renderSetup");
const setupEnd = app.indexOf("const renderProfile", setupStart);
const setup = app.slice(setupStart, setupEnd);
const stylesStart = app.indexOf("function createStyles");
const styles = app.slice(stylesStart);

test("Setup uses the shared rounded surface and integrated Training Content header", () => {
  assert.ok(setupStart >= 0 && setupEnd > setupStart);
  assert.match(app, /getTrainingContentTheme\(colorScheme\)/);
  assert.match(setup, /styles\.setupSurface/);
  assert.match(setup, /<TrainingContentHeader/);
  assert.match(setup, /title="Setup"/);
  assert.match(setup, /theme=\{setupSurfaceTheme\}/);
  assert.doesNotMatch(setup, /styles\.topRow|styles\.ghostButton/);
  assert.match(styles, /setupSurface:[\s\S]*?borderRadius: 18[\s\S]*?overflow: "hidden"/);
  assert.match(trainingHeader, /accessibilityLabel="Back"/);
  assert.match(trainingHeader, /name="arrow-left"/);
  assert.match(trainingTheme, /colorScheme === "classic_blue"/);
  assert.match(trainingTheme, /background: "#f5f7f5"/);
});

test("Setup keeps one working hierarchy with reachable Session, Difficulty, and Persona sections", () => {
  const session = setup.indexOf("Session Selection");
  const difficulty = setup.indexOf(">Difficulty</Text>");
  const persona = setup.indexOf(">Opponent Persona Style</Text>");
  const dock = setup.indexOf("styles.setupActionRegion");

  assert.ok(session >= 0 && session < difficulty);
  assert.ok(difficulty < persona);
  assert.ok(persona < dock);
  assert.match(setup, /contentContainerStyle=\{styles\.setupScrollContent\}/);
  assert.match(setup, /styles\.setupSessionCard/);
  assert.match(setup, /accessibilityRole="header" style=\{styles\.setupSectionTitle\}/);
  assert.match(styles, /setupScrollContent:[\s\S]*?paddingHorizontal: 16[\s\S]*?paddingBottom: 28/);
  assert.doesNotMatch(styles, /setup(?:Surface|ScrollContent|Section): \{[^}]*height:/);
});

test("Setup visual convergence preserves selectors, origins, recovery, and launch behavior", () => {
  assert.match(setup, /onPress=\{\(\) => setScenarioCatalogTab\("standard"\)\}/);
  assert.match(setup, /onPress=\{\(\) => setScenarioCatalogTab\("custom"\)\}/);
  assert.match(setup, /onChange=\{setSelectedTrainingId\}/);
  assert.match(setup, /onChange=\{setSelectedIndustryId\}/);
  assert.match(setup, /onChange=\{setSelectedRoleId\}/);
  assert.match(setup, /onChange=\{setSelectedScenarioId\}/);
  assert.match(setup, /onPress=\{\(\) => setSelectedDifficulty\(difficulty\)\}/);
  assert.match(setup, /onPress=\{\(\) => setSelectedPersonaStyle\(personaStyle\)\}/);
  assert.match(setup, /setScreen\(setupBackDestination\(setupOrigin\)\)/);
  assert.match(setup, /disabled=\{Boolean\(setupSelectionFailure\)\}/);
  assert.match(setup, /onPress=\{\(\) => void startSimulation\(\)\}/);
  assert.match(setup, />Browse Scenarios<\/Text>/);
  assert.match(styles, /setupActionRegion:[\s\S]*?borderTopWidth: StyleSheet\.hairlineWidth/);
});

test("Setup nested surfaces reuse the training-content palette without changing selected accents", () => {
  assert.match(
    setup,
    /styles\.setupSessionCard[\s\S]*?backgroundColor: setupSurfaceTheme\.surface[\s\S]*?borderColor: setupSurfaceTheme\.border/
  );
  assert.equal(
    (setup.match(/triggerStyle=\{\{[\s\S]*?backgroundColor: setupSurfaceTheme\.background[\s\S]*?borderColor: setupSurfaceTheme\.border[\s\S]*?\}\}/g) ?? []).length,
    4
  );
  assert.match(
    setup,
    /styles\.optionCard[\s\S]*?backgroundColor: setupSurfaceTheme\.surface[\s\S]*?selectedDifficulty === difficulty \? styles\.selectedCard : null/
  );
  assert.match(
    setup,
    /styles\.optionCard[\s\S]*?backgroundColor: setupSurfaceTheme\.surface[\s\S]*?selectedPersonaStyle === personaStyle \? styles\.selectedCard : null/
  );
  assert.match(setup, /styles\.guidedPracticeCard[\s\S]*?backgroundColor: setupSurfaceTheme\.surface/);
  assert.match(styles, /selectedCard: \{ borderColor: theme\.accent, backgroundColor: theme\.selectedCardBg \}/);
});
