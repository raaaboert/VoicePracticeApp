const {
  WarningAggregator,
  withProjectBuildGradle,
} = require("expo/config-plugins");
const {
  mergeContents,
} = require("@expo/config-plugins/build/utils/generateCode");

const PLUGIN_NAME = "with-react-native-pdf-monorepo";

const reactNativePdfMonorepoContents = `
def peritioReactNativePackageJson = ["node", "--print", "require.resolve('react-native/package.json')"]
    .execute(null, rootDir)
    .text
    .trim()

if (!peritioReactNativePackageJson) {
    throw new GradleException("Unable to resolve react-native/package.json for react-native-pdf")
}

rootProject.ext.REACT_NATIVE_NODE_MODULES_DIR = new File(peritioReactNativePackageJson)
    .getParentFile()
    .getAbsoluteFile()
`;

function addReactNativePdfMonorepoResolution(source) {
  return mergeContents({
    tag: PLUGIN_NAME,
    src: source,
    newSrc: reactNativePdfMonorepoContents,
    anchor: /^buildscript\s*\{/m,
    offset: 0,
    comment: "//",
  });
}

function withReactNativePdfMonorepo(config) {
  return withProjectBuildGradle(config, (projectBuildGradleConfig) => {
    if (projectBuildGradleConfig.modResults.language !== "groovy") {
      WarningAggregator.addWarningAndroid(
        PLUGIN_NAME,
        "Cannot configure react-native-pdf because the project build.gradle is not Groovy."
      );
      return projectBuildGradleConfig;
    }

    projectBuildGradleConfig.modResults.contents =
      addReactNativePdfMonorepoResolution(
        projectBuildGradleConfig.modResults.contents
      ).contents;

    return projectBuildGradleConfig;
  });
}

module.exports = withReactNativePdfMonorepo;
module.exports.addReactNativePdfMonorepoResolution =
  addReactNativePdfMonorepoResolution;
module.exports.reactNativePdfMonorepoContents =
  reactNativePdfMonorepoContents;
