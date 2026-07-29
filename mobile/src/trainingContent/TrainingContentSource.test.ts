import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

function source(relativePath: string): string {
  return readFileSync(resolve(sourceDirectory, relativePath), "utf8");
}

test("Training Content is a first-class entitlement-controlled home module", () => {
  const app = source("../../App.tsx");
  const homeStart = app.indexOf("const renderHome");
  const homeEnd = app.indexOf("const renderOnboarding");
  const home = app.slice(homeStart, homeEnd);
  const menu = home.slice(home.indexOf("<Modal"), home.indexOf("</Modal>"));

  assert.match(home, /trainingContentEnabled\s*\?\s*\(/);
  assert.match(home, /Review company resources and learning materials\./);
  assert.match(home, /void openTrainingContent\(\)/);
  assert.doesNotMatch(menu, /Training Content/);
  assert.match(app, /screen === "training_content"/);
  assert.match(app, /fetchMobileModules\(user\.id, mobileAuthToken\)/);
});

test("library navigation keeps search, category, detail, and empty states inside the module", () => {
  const screen = source("./TrainingContentScreen.tsx");
  const library = source("./TrainingContentLibraryScreen.tsx");
  const category = source("./TrainingContentCategoryScreen.tsx");
  const detail = source("./TrainingContentDetailScreen.tsx");

  assert.match(screen, /type: "library"/);
  assert.match(screen, /type: "category"/);
  assert.match(screen, /type: "detail"/);
  assert.match(screen, /setQuery/);
  assert.match(library, /Search training content/);
  assert.match(library, /All Content/);
  assert.match(library, /TRAINING_CONTENT_EMPTY_MESSAGE/);
  assert.match(category, /onOpenItem/);
  assert.match(detail, /refreshControl/);
  assert.doesNotMatch(`${library}${category}${detail}`, /Mark Complete|assignment details|publication state/i);
});

test("signed asset URLs stay in viewer memory and every uploaded type has a dedicated viewer", () => {
  const hook = source("./useTrainingContentAssetAccess.ts");
  const viewer = source("./TrainingContentViewer.tsx");
  const video = source("./viewers/VideoContentViewer.tsx");
  const audio = source("./viewers/AudioContentViewer.tsx");
  const pdf = source("./viewers/PdfContentViewer.tsx");
  const docx = source("./viewers/DocxContentViewer.tsx");

  assert.doesNotMatch(hook, /AsyncStorage|SecureStore|console\./);
  assert.match(hook, /fetchTrainingContentAssetAccess/);
  assert.match(hook, /expiresAt/);
  assert.match(viewer, /ImageContentViewer/);
  assert.match(viewer, /VideoContentViewer/);
  assert.match(viewer, /AudioContentViewer/);
  assert.match(viewer, /PdfContentViewer/);
  assert.match(viewer, /DocxContentViewer/);
  assert.doesNotMatch(video, /player\.(?:pause|release)\(\)/);
  assert.match(video, /buildProgressiveVideoSource/);
  assert.match(video, /return \(\) => clearTimeout\(timer\)/);
  assert.match(audio, /player\.pause\(\)/);
  assert.match(pdf, /buildPrivatePdfSource/);
  assert.match(pdf, /NATIVE_VIEWER_LOAD_TIMEOUT_MS/);
  assert.match(pdf, /settleNativeViewerLoad/);
  assert.match(pdf, /disposeNativeViewerLoadGuard/);
  assert.match(pdf, /trustAllCerts=\{false\}/);
  assert.match(viewer, /accessState\.accessRevision/);
  assert.match(docx, /FileSystem\.deleteAsync/);
});

test("external and native resources use constrained rendering and leave-app confirmation", () => {
  const links = source("./externalLinks.ts");
  const markdown = source("./markdownModel.ts");
  const nativeViewer = source("./NativeMarkdownViewer.tsx");

  assert.match(links, /This resource opens outside Peritio\. Continue\?/);
  assert.match(links, /Linking\.openURL/);
  assert.doesNotMatch(markdown, /WebView|renderHTML|dangerouslySetInnerHTML/);
  assert.match(markdown, /sanitizeTrainingContentLink/);
  assert.match(nativeViewer, /parseSafeMarkdown/);
});
