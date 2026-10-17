import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { MobileOnboardRequest, MobileOnboardResponse } from "@voicepractice/shared";

const FROZEN_MAIN = "aa79a9d1fbac6704eb1d0033af81c6342538073d";

/** Execute the actual client callback and setup helpers without mounting React Native. */
export async function exerciseOnboardingConsumer(
  revision: "current" | "frozen",
  input: MobileOnboardRequest,
  onboard: (body: MobileOnboardRequest) => Promise<MobileOnboardResponse>,
): Promise<MobileOnboardResponse> {
  const source = (relative: string) => revision === "current"
    ? readFile(new URL(`../../${relative}`, import.meta.url), "utf8")
    : Promise.resolve(execFileSync("git", ["show", `${FROZEN_MAIN}:${relative}`], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8",
    }));
  const app = await source("mobile/App.tsx");
  const setup = await source("mobile/src/lib/onboardingState.ts");
  const helpers: Record<string, any> = {};
  const compiledHelpers = ts.transpileModule(setup, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("exports", compiledHelpers)(helpers);
  const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "runOnboarding" && node.initializer) {
      assert.equal(callback, undefined, "client callback must be unambiguous");
      callback = node.initializer.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(callback, `${revision} client onboarding callback exists`);
  const state: Record<string, any> = {};
  let response: MobileOnboardResponse | undefined;
  const context: Record<string, any> = {
    ...helpers,
    user: null,
    onboardingEmail: input.email, onboardingFirstName: input.firstName, onboardingLastName: input.lastName,
    onboardingTimezone: input.timezone, onboardingCompanyCode: input.joinCode ?? "",
    isEmailLike: (email: string) => email.includes("@"),
    onboardMobileUser: async (body: MobileOnboardRequest) => { response = await onboard(body); return response; },
    saveUserId: async (id: string) => { state.savedId = id; },
    saveMobileAuthToken: async (token: string) => { state.savedToken = token; },
    getErrorMessage: (error: Error) => error.message,
    submitAutoErrorReport: async () => { state.errorReported = true; },
    openSuperUserOrgSelector: async () => { state.protectedNavigation = true; },
    resolveOrganizationAccessForSession: async () => { state.protectedNavigation = true; },
    activateApprovedMobileSession: async () => { state.protectedNavigation = true; },
  };
  for (const name of ["OnboardingError", "IsOnboardingSaving", "User", "MobileAuthToken", "SettingsEmail",
    "SettingsTimezone", "PendingVerificationUserId", "VerificationCode", "VerificationExpiresAt",
    "VerificationNotice", "VerificationError", "Screen"]) {
    context[`set${name}`] = (value: unknown) => { state[name] = value; };
  }
  const compiledCallback = ts.transpileModule(`const runOnboarding = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  await new Function(...Object.keys(context), `${compiledCallback}\nreturn runOnboarding;`)(...Object.values(context))();
  assert.equal(state.OnboardingError, null);
  assert.ok(response);
  assert.equal(state.OnboardingError, null);
  assert.equal(state.errorReported, undefined);
  assert.equal(state.Screen, "verify_email");
  assert.equal(state.PendingVerificationUserId, response.user.id);
  assert.equal(state.savedId, response.user.id);
  assert.equal(state.savedToken, response.authToken);
  assert.equal(state.SettingsEmail, input.email.trim().toLowerCase());
  assert.equal(state.SettingsTimezone, input.timezone);
  assert.equal(state.VerificationExpiresAt, response.verificationExpiresAt);
  assert.equal(state.IsOnboardingSaving, false);
  assert.equal(state.protectedNavigation, undefined);
  assert.equal(helpers.resolveMobileSetupStep(response.user), "verify_email");
  assert.equal(helpers.canStartMobileUpdates(response.user, "verify_email"), false);
  return response;
}
