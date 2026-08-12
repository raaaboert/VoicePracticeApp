const {
  WarningAggregator,
  withProjectBuildGradle,
} = require("expo/config-plugins");
const {
  mergeContents,
} = require("@expo/config-plugins/build/utils/generateCode");

const PLUGIN_NAME = "with-pdfium-16kb-alignment";
const PDFIUM_COORDINATE = "io.legere:pdfiumandroid:1.0.32";

const pdfium16kbAlignmentContents = `
allprojects {
    configurations.configureEach {
        resolutionStrategy.force("${PDFIUM_COORDINATE}")
    }
}
`;

function addPdfium16kbAlignment(source) {
  return mergeContents({
    tag: PLUGIN_NAME,
    src: source,
    newSrc: pdfium16kbAlignmentContents,
    anchor: /^allprojects\s*\{/m,
    offset: 0,
    comment: "//",
  });
}

function withPdfium16kbAlignment(config) {
  return withProjectBuildGradle(config, (projectBuildGradleConfig) => {
    if (projectBuildGradleConfig.modResults.language !== "groovy") {
      WarningAggregator.addWarningAndroid(
        PLUGIN_NAME,
        "Cannot force the PDFium dependency because the project build.gradle is not Groovy."
      );
      return projectBuildGradleConfig;
    }

    projectBuildGradleConfig.modResults.contents = addPdfium16kbAlignment(
      projectBuildGradleConfig.modResults.contents
    ).contents;

    return projectBuildGradleConfig;
  });
}

module.exports = withPdfium16kbAlignment;
module.exports.addPdfium16kbAlignment = addPdfium16kbAlignment;
module.exports.pdfium16kbAlignmentContents = pdfium16kbAlignmentContents;
