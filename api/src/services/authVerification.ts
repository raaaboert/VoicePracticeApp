import type { UserProfile, WebAuthDeliveryMode } from "@voicepractice/shared";
import { AuthCodeRequestLimitError, type AuthVerificationStore, type VerificationIdentity } from "../storage/authVerificationStore.js";
import { AuthCodeDeliveryError, type AuthCodeDeliveryService } from "./authCodeDelivery.js";
import type { VerificationAuthorityState } from "./authChallengeAuthority.js";

export function verificationIdentity(user: Pick<UserProfile, "id" | "email" | "orgId">, purpose: VerificationIdentity["purpose"]): VerificationIdentity {
  return { userId: user.id, email: user.email, orgId: user.orgId, purpose };
}

/** The reservation commits before delivery; failures invalidate/refund only that reservation. */
export async function deliverVerificationChallenge(params: {
  store: AuthVerificationStore; delivery: AuthCodeDeliveryService; user: UserProfile;
  purpose: VerificationIdentity["purpose"]; experience: "dashboard" | "mobile";
  authority?: VerificationAuthorityState;
}): Promise<{ expiresAt: string; delivery: WebAuthDeliveryMode }> {
  const identity = params.authority ? params.store.bindIdentity(params.authority, params.user, params.purpose)
    : verificationIdentity(params.user, params.purpose);
  const challenge = await params.store.issue(identity);
  if (!challenge) throw new AuthCodeRequestLimitError();
  let delivery: WebAuthDeliveryMode;
  try {
    delivery = params.purpose === "sign_in"
      ? await params.delivery.sendWebSignInCode({ email: params.user.email, code: challenge.code, expiresAt: challenge.expiresAt })
      : await params.delivery.sendEmailVerificationCode({ email: params.user.email, code: challenge.code, expiresAt: challenge.expiresAt, experience: params.experience });
  } catch (error) {
    const confirmedFailure = error instanceof AuthCodeDeliveryError && !error.deliveryUncertain;
    await params.store.finishDelivery(identity, challenge.id, false, confirmedFailure);
    // Provider response bodies may contain addresses or other sensitive material.
    throw new AuthCodeDeliveryError("Verification email could not be delivered. Please try again later.");
  }
  // A database confirmation failure is not a failed email send. Keep its reservation;
  // never refund a successfully dispatched email on an uncertain COMMIT outcome.
  await params.store.finishDelivery(identity, challenge.id, true);
  return { expiresAt: challenge.expiresAt, delivery };
}
