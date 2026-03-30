import {
  ApiDatabase,
  UserProfile,
  WebAuthChallengeType,
  WebAuthDeliveryMode,
  WebAuthRequestCodeResponse,
} from "@voicepractice/shared";

import {
  DashboardAccessEligibilityReason,
  resolveDashboardAccessEligibility,
} from "./dashboardAuthorization.js";
import { AuthCodeDeliveryError } from "./authCodeDelivery.js";

export const DASHBOARD_WEB_AUTH_REQUEST_CODE_MESSAGE =
  "If that account is eligible, a code has been sent. Enter the code below to continue.";

export type DashboardWebAuthRequestResult =
  | {
      response: WebAuthRequestCodeResponse;
      outcome: "acknowledged";
      reason: "user_not_found" | DashboardAccessEligibilityReason;
      user: null;
    }
  | {
      response: WebAuthRequestCodeResponse;
      outcome: "issued";
      reason: "eligible";
      user: UserProfile;
      challengeType: WebAuthChallengeType;
      expiresAt: string;
      delivery: WebAuthDeliveryMode;
    }
  | {
      response: WebAuthRequestCodeResponse;
      outcome: "delivery_failed";
      reason: "sign_in_delivery_failed" | "email_verification_delivery_failed";
      user: UserProfile;
      error: Error;
    };

function buildPublicResponse(): WebAuthRequestCodeResponse {
  return {
    ok: true,
    message: DASHBOARD_WEB_AUTH_REQUEST_CODE_MESSAGE,
  };
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export async function handleDashboardWebAuthCodeRequest(params: {
  db: ApiDatabase;
  email: string;
  now: Date;
  issueSignInCode: (user: UserProfile, now: Date) => Promise<{
    expiresAt: string;
    delivery: WebAuthDeliveryMode;
  }>;
  issueEmailVerificationCode: (user: UserProfile, now: Date) => Promise<{
    expiresAt: string;
    delivery: WebAuthDeliveryMode;
  }>;
}): Promise<DashboardWebAuthRequestResult> {
  const publicResponse = buildPublicResponse();
  const normalizedEmail = params.email.trim().toLowerCase();
  const user =
    params.db.users.find((entry) => entry.email.toLowerCase() === normalizedEmail) ?? null;

  if (!user) {
    return {
      response: publicResponse,
      outcome: "acknowledged",
      reason: "user_not_found",
      user: null,
    };
  }

  const eligibility = resolveDashboardAccessEligibility(params.db, user);
  if (!eligibility.eligible) {
    return {
      response: publicResponse,
      outcome: "acknowledged",
      reason: eligibility.reason,
      user: null,
    };
  }

  try {
    if (user.emailVerifiedAt) {
      const issued = await params.issueSignInCode(user, params.now);
      return {
        response: publicResponse,
        outcome: "issued",
        reason: "eligible",
        user,
        challengeType: "sign_in",
        expiresAt: issued.expiresAt,
        delivery: issued.delivery,
      };
    }

    const issued = await params.issueEmailVerificationCode(user, params.now);
    return {
      response: publicResponse,
      outcome: "issued",
      reason: "eligible",
      user,
      challengeType: "email_verification",
      expiresAt: issued.expiresAt,
      delivery: issued.delivery,
    };
  } catch (error) {
    if (!(error instanceof AuthCodeDeliveryError)) {
      throw error;
    }

    return {
      response: publicResponse,
      outcome: "delivery_failed",
      reason: user.emailVerifiedAt ? "sign_in_delivery_failed" : "email_verification_delivery_failed",
      user,
      error: normalizeError(error),
    };
  }
}
