import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { splitTextForRemoteTtsFastStart, type EnterpriseOrg, type UserProfile } from "@voicepractice/shared";
import { authorizeSimulationAiAdmission, isAuthorizedSimulationAdmission, issueSimulationSpeechAuthorization,
  assertSimulationSpeechAuthorization } from "./simulationAiAdmission.js";
import { buildSimulationSessionStartRecord } from "./simulationSessionLifecycle.js";

const secret = "local-only-speech-domain-test-secret";
const fixture = () => {
  const now = new Date();
  const user = { id: "learner", orgId: "org", accountType: "enterprise", status: "active", emailVerifiedAt: now.toISOString() } as UserProfile;
  const org = { id: "org", status: "active" } as EnterpriseOrg;
  const session = buildSimulationSessionStartRecord({ simulationSessionId: "full_session_identity", userId: user.id,
    orgId: org.id, segmentId: "role", scenarioId: "scenario", trainingId: "topic", trainingPackId: null, clientStartedAt: null, now });
  const input = { user, org, session, maxSimulationMinutes: 20, operation: "conversation" as const, now };
  return { ...input, admission: authorizeSimulationAiAdmission(input) };
};

test("only server-issued admission objects qualify, bound to actor/org, operation and deadline", () => {
  const f = fixture();
  for (const kind of ["opening", "turn", "transcribe", "tts"] as const) assert.equal(isAuthorizedSimulationAdmission(f.admission, kind, f.user.id, f.org.id), true);
  assert.equal(isAuthorizedSimulationAdmission({ ...f.admission }, "turn", f.user.id, f.org.id), false);
  assert.equal(isAuthorizedSimulationAdmission(f.admission, "turn", "another", f.org.id), false);
  assert.equal(isAuthorizedSimulationAdmission(f.admission, "turn", f.user.id, "another"), false);
  assert.equal(isAuthorizedSimulationAdmission(f.admission, "customer_scenario_generation", f.user.id, f.org.id), false);
  assert.equal(isAuthorizedSimulationAdmission(f.admission, "turn", f.user.id, f.org.id, f.admission.deadlineMs), false);
  assert.throws(() => authorizeSimulationAiAdmission({ ...f, user: { ...f.user, isSuperUser: true } }));
  assert.throws(() => authorizeSimulationAiAdmission({ ...f, user: { ...f.user, status: "disabled" } }));
});

test("signed speech permits full server response, later chunks and retries, without storing speech text", () => {
  const f = fixture();
  const text = "Let us identify the important concern. ".repeat(30);
  const token = issueSimulationSpeechAuthorization(f.admission, text, secret)!;
  assert.ok(token);
  const reloadedAdmission = authorizeSimulationAiAdmission({ ...f, session: { ...f.session } });
  assert.doesNotThrow(() => assertSimulationSpeechAuthorization(reloadedAdmission, text, token, secret), "no process-local speech cache is needed");
  assert.doesNotMatch(Buffer.from(token.split(".")[0]!, "base64url").toString(), /important concern/);
  const chunks = splitTextForRemoteTtsFastStart(text);
  assert.ok(chunks.length > 1);
  for (const chunk of [text, ...chunks, ...chunks]) assert.doesNotThrow(() => assertSimulationSpeechAuthorization(f.admission, chunk, token, secret));
  assert.throws(() => assertSimulationSpeechAuthorization(f.admission, "Unrelated arbitrary speech", token, secret));
  assert.throws(() => assertSimulationSpeechAuthorization(f.admission, chunks[0]!, `${token}forged`, secret));
  assert.throws(() => assertSimulationSpeechAuthorization(f.admission, text, undefined, secret));
});

test("speech cannot cross session identities, timestamps, secrets or expiration", () => {
  const f = fixture(), text = "Server generated response";
  const token = issueSimulationSpeechAuthorization(f.admission, text, secret)!;
  for (const session of [{ ...f.session, simulationSessionId: "other_session" },
    { ...f.session, serverStartedAt: new Date(Date.now() - 1000).toISOString() }]) {
    const other = authorizeSimulationAiAdmission({ ...f, session });
    assert.throws(() => assertSimulationSpeechAuthorization(other, text, token, secret));
  }
  assert.throws(() => assertSimulationSpeechAuthorization(f.admission, text, token, "different-key"));
  const grant = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()); grant.expires = Date.now() - 1;
  const body = Buffer.from(JSON.stringify(grant)).toString("base64url");
  const expired = `${body}.${createHmac("sha256", secret).update(`peritio.simulation-speech.v1:${body}`).digest("base64url")}`;
  assert.throws(() => assertSimulationSpeechAuthorization(f.admission, text, expired, secret));
});

test("completed sessions only receive completion admission and cannot grant speech; original deadlines hold", () => {
  const f = fixture();
  const session = { ...f.session, status: "usage_recorded" as const, usageRecordedAt: f.now.toISOString() };
  assert.throws(() => authorizeSimulationAiAdmission({ ...f, session }));
  const completion = authorizeSimulationAiAdmission({ ...f, session, operation: "completion" });
  assert.equal(isAuthorizedSimulationAdmission(completion, "score", f.user.id, f.org.id), true);
  assert.equal(issueSimulationSpeechAuthorization(completion, "No speech after completion", secret), undefined);
  assert.throws(() => authorizeSimulationAiAdmission({ ...f, session, operation: "completion", now: new Date(f.now.getTime() + 20 * 60_000) }));
});
