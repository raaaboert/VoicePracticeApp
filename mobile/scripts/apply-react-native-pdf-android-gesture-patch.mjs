import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_REACT_NATIVE_PDF_VERSION = "6.7.7";

const VIEW_PARENT_IMPORT = "import android.view.ViewParent;";
const GESTURE_PARENT_FIELD = "    private ViewParent gestureParent;";
const PATCH_MARKER = "private void disallowParentIntercept()";

const IMPORT_ANCHOR = "import android.view.ViewGroup;";
const FIELD_ANCHOR = "    private boolean scrollEnabled = true;";
const METHOD_ANCHOR = `    @Override
    public void onPageChanged(int page, int numberOfPages) {`;
const ERROR_ANCHOR = `    @Override
    public void onError(Throwable t){`;

const GESTURE_METHODS = `    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
            disallowParentIntercept();
        }

        boolean handled = super.dispatchTouchEvent(event);
        if (
            action == MotionEvent.ACTION_UP ||
            action == MotionEvent.ACTION_CANCEL ||
            (action == MotionEvent.ACTION_DOWN && !handled)
        ) {
            allowParentIntercept();
        }
        return handled;
    }

    @Override
    protected void onDetachedFromWindow() {
        allowParentIntercept();
        super.onDetachedFromWindow();
    }

    private void disallowParentIntercept() {
        ViewParent parent = getParent();
        if (parent != null) {
            gestureParent = parent;
            parent.requestDisallowInterceptTouchEvent(true);
        }
    }

    private void allowParentIntercept() {
        ViewParent parent = gestureParent;
        gestureParent = null;
        if (parent != null) {
            parent.requestDisallowInterceptTouchEvent(false);
        }
    }

`;

const REQUIRED_PATCH_FRAGMENTS = [
  VIEW_PARENT_IMPORT,
  GESTURE_PARENT_FIELD,
  "action == MotionEvent.ACTION_DOWN",
  "action == MotionEvent.ACTION_UP",
  "action == MotionEvent.ACTION_CANCEL",
  "action == MotionEvent.ACTION_DOWN && !handled",
  "protected void onDetachedFromWindow()",
  "public void onError(Throwable t){\n        allowParentIntercept();",
  "parent.requestDisallowInterceptTouchEvent(true)",
  "parent.requestDisallowInterceptTouchEvent(false)",
];

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = dirname(scriptPath);

function fail(message) {
  throw new Error(`[react-native-pdf-android-gesture-patch] ${message}`);
}

function replaceRequired(source, anchor, replacement, description) {
  if (!source.includes(anchor)) {
    fail(`Expected ${description} was not found.`);
  }
  return source.replace(anchor, replacement);
}

export function patchReactNativePdfAndroidSource(source) {
  if (source.includes(PATCH_MARKER)) {
    for (const fragment of REQUIRED_PATCH_FRAGMENTS) {
      if (!source.includes(fragment)) {
        fail("Installed Android gesture patch is incomplete.");
      }
    }
    return source;
  }

  let patched = replaceRequired(
    source,
    IMPORT_ANCHOR,
    `${IMPORT_ANCHOR}\n${VIEW_PARENT_IMPORT}`,
    "ViewGroup import"
  );
  patched = replaceRequired(
    patched,
    FIELD_ANCHOR,
    `${FIELD_ANCHOR}\n${GESTURE_PARENT_FIELD}`,
    "scrollEnabled field"
  );
  patched = replaceRequired(
    patched,
    METHOD_ANCHOR,
    `${GESTURE_METHODS}${METHOD_ANCHOR}`,
    "onPageChanged method"
  );
  patched = replaceRequired(
    patched,
    ERROR_ANCHOR,
    `${ERROR_ANCHOR}\n        allowParentIntercept();`,
    "onError method"
  );
  return patched;
}

function applyInstalledPatch() {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("react-native-pdf/package.json", {
    paths: [resolve(scriptDirectory, "..")],
  });
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (packageJson.version !== EXPECTED_REACT_NATIVE_PDF_VERSION) {
    fail(
      `Expected react-native-pdf ${EXPECTED_REACT_NATIVE_PDF_VERSION}, found ${String(
        packageJson.version
      )}.`
    );
  }

  const pdfViewPath = resolve(
    dirname(packageJsonPath),
    "android",
    "src",
    "main",
    "java",
    "org",
    "wonday",
    "pdf",
    "PdfView.java"
  );
  const source = readFileSync(pdfViewPath, "utf8");
  const patchedSource = patchReactNativePdfAndroidSource(source);
  if (patchedSource !== source) {
    writeFileSync(pdfViewPath, patchedSource);
    console.log(
      "[react-native-pdf-android-gesture-patch] Applied parent-interception guard."
    );
    return;
  }
  console.log(
    "[react-native-pdf-android-gesture-patch] Parent-interception guard already applied."
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  applyInstalledPatch();
}
