import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AiUsageEventKind, SimulationSessionRecord, UserProfile, EnterpriseOrg } from "@voicepractice/shared";
import { splitTextForRemoteTtsFastStart } from "@voicepractice/shared";
import { assertSimulationSessionLifetime, resolveSimulationConversationDeadlineMs, SimulationSessionValidationError,
  SIMULATION_SESSION_COMPLETION_WINDOW_GRACE_MINUTES } from "./simulationSessionLifecycle.js";

const issuedAdmissions = new WeakSet<object>();
export interface AuthorizedSimulationAdmission {
  readonly session: SimulationSessionRecord;
  readonly operation: "conversation" | "completion";
  readonly deadlineMs: number;
}

/** Only call with a session loaded from the authoritative store, never a request body. */
export function authorizeSimulationAiAdmission(input: {
  user: UserProfile; org: EnterpriseOrg; session: SimulationSessionRecord;
  operation: "conversation" | "completion"; maxSimulationMinutes: number; now: Date;
}): AuthorizedSimulationAdmission {
  const { user, org, session } = input;
  if (user.accountType !== "enterprise" || user.isSuperUser || user.status !== "active" || !user.emailVerifiedAt
    || org.status !== "active" || user.orgId !== org.id || session.userId !== user.id || session.orgId !== org.id) {
    throw new SimulationSessionValidationError(404, "session_not_recognized", "Simulation session is not available.");
  }
  assertSimulationSessionLifetime(session, input.maxSimulationMinutes, input.now, input.operation);
  const deadlineMs = input.operation === "conversation"
    ? resolveSimulationConversationDeadlineMs(session, input.maxSimulationMinutes)
    : Math.min(resolveSimulationConversationDeadlineMs(session, input.maxSimulationMinutes) + SIMULATION_SESSION_COMPLETION_WINDOW_GRACE_MINUTES * 60_000,
      session.usageRecordedAt ? Date.parse(session.usageRecordedAt) + SIMULATION_SESSION_COMPLETION_WINDOW_GRACE_MINUTES * 60_000 : Infinity);
  const admission = Object.freeze({ session: Object.freeze({ ...session }), operation: input.operation, deadlineMs });
  issuedAdmissions.add(admission);
  return admission;
}

export function isAuthorizedSimulationAdmission(admission: AuthorizedSimulationAdmission | undefined,
  kind: AiUsageEventKind, userId: string, orgId: string | null, now = Date.now()): boolean {
  return Boolean(admission && issuedAdmissions.has(admission) && now < admission.deadlineMs
    && admission.session.userId === userId && admission.session.orgId === orgId
    && (admission.operation === "completion" ? kind === "score"
      : ["opening", "turn", "transcribe", "tts"].includes(kind)));
}

const normalizeSpeech = (text: string) => text.trim().replace(/\s+/g, " ");
const hashSpeech = (text: string) => createHash("sha256").update(normalizeSpeech(text)).digest("base64url");
const signature = (body: string, secret: string) => createHmac("sha256", secret)
  .update(`peritio.simulation-speech.v1:${body}`).digest("base64url");

/** Stateless across API processes; contains hashes/identity only, never speech text. */
export function issueSimulationSpeechAuthorization(admission: AuthorizedSimulationAdmission | undefined, text: string, secret: string): string | undefined {
  if (!admission || !isAuthorizedSimulationAdmission(admission, "tts", admission.session.userId, admission.session.orgId)) return undefined;
  const body = Buffer.from(JSON.stringify({ v: 1, user: admission.session.userId, org: admission.session.orgId,
    session: admission.session.simulationSessionId, start: admission.session.serverStartedAt,
    expires: admission.deadlineMs, hashes: [...new Set([text, ...splitTextForRemoteTtsFastStart(text)].map(hashSpeech))] })).toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

export function assertSimulationSpeechAuthorization(admission: AuthorizedSimulationAdmission, text: string, token: unknown, secret: string): void {
  const deny = () => { throw new SimulationSessionValidationError(403, "speech_authorization_invalid", "This speech response is not available. Resume the simulation to recover its response."); };
  if (typeof token !== "string" || token.length > 32_000) return deny();
  const [body, supplied, extra] = token.split(".");
  if (!body || !supplied || extra) return deny();
  const expected = signature(body, secret);
  if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return deny();
  let grant;
  try { grant = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return deny(); }
  if (!grant || typeof grant !== "object" || grant.v !== 1 || grant.user !== admission.session.userId || grant.org !== admission.session.orgId
    || grant.session !== admission.session.simulationSessionId || grant.start !== admission.session.serverStartedAt
    || !Number.isFinite(grant.expires) || Date.now() >= grant.expires
    || !Array.isArray(grant.hashes) || !grant.hashes.includes(hashSpeech(text))
    || !isAuthorizedSimulationAdmission(admission, "tts", admission.session.userId, admission.session.orgId)) return deny();
}
