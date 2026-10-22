import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./SimulationScreen.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("SimulationScreen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const paletteStatement = ast.statements.find(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "SIMULATION_PALETTES"));
const stylesFunction = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "createStyles");
assert.ok(paletteStatement); assert.ok(stylesFunction);
// Evaluate the actual theme/styles without loading native UI modules.
const code = ts.transpileModule(`${paletteStatement.getText(ast)}\n${stylesFunction.getText(ast)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const { palettes, styles } = new Function("StyleSheet", `${code}; return { palettes: SIMULATION_PALETTES, styles: createStyles };`)(
  { create: (value: unknown) => value },
);

function luminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/i, "opaque colors make contrast independent of the screen behind the banner");
  const linear = [1, 3, 5].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

for (const theme of ["light", "dark"]) {
  test(`${theme} simulation error text exceeds AA contrast and has an unconstrained wrapping layout`, () => {
    const rendered = styles(palettes[theme]);
    const foreground = luminance(rendered.errorText.color);
    const background = luminance(rendered.errorCard.backgroundColor);
    const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    assert.ok(contrast >= 4.5, `${theme}: ${contrast.toFixed(2)}:1`);
    assert.equal(rendered.errorCard.borderColor, palettes[theme].errorBorder);
    assert.ok(rendered.errorCard.padding >= 10);
    assert.equal(rendered.errorCard.minWidth, 0);
    assert.equal(rendered.errorCard.maxWidth, "100%");
    assert.equal(rendered.errorText.flexShrink, 1);
    assert.ok(rendered.errorText.lineHeight >= rendered.errorText.fontSize * 1.4);
    for (const style of [rendered.errorCard, rendered.errorText]) {
      assert.equal(style.height, undefined); assert.equal(style.maxHeight, undefined);
      assert.equal(style.overflow, undefined);
    }
    const banner = source.slice(source.indexOf("{error ? ("), source.indexOf("{error ? (") + 950);
    assert.match(banner, /style=\{styles\.errorText\} accessibilityRole="alert">\{error\}/);
    assert.doesNotMatch(banner, /numberOfLines|ellipsizeMode/);
    assert.match(source, /colorScheme === "soft_light" \? "light" : "dark"/);
  });
}
