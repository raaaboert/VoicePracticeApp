import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_VERSION = "6.7.7";
const COMPONENT_NAME = "RNPDFPdfView";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(
  scriptDirectory,
  "..",
  "node_modules",
  "react-native-pdf",
  "package.json"
);

function fail(message) {
  throw new Error(`[react-native-pdf-ios-codegen-patch] ${message}`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

if (packageJson.version !== EXPECTED_VERSION) {
  fail(
    `Expected react-native-pdf ${EXPECTED_VERSION}, found ${String(packageJson.version)}.`
  );
}

const componentProvider =
  packageJson.codegenConfig?.ios?.componentProvider;
const existingRegistration = componentProvider?.[COMPONENT_NAME];

if (
  existingRegistration !== undefined &&
  existingRegistration !== COMPONENT_NAME
) {
  fail(`Unexpected existing ${COMPONENT_NAME} component-provider registration.`);
}

packageJson.codegenConfig = {
  ...packageJson.codegenConfig,
  ios: {
    ...packageJson.codegenConfig?.ios,
    componentProvider: {
      ...componentProvider,
      [COMPONENT_NAME]: COMPONENT_NAME,
    },
  },
};

writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(
  `[react-native-pdf-ios-codegen-patch] Applied ${COMPONENT_NAME} registration.`
);
