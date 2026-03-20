import { WebAuthDeliveryMode } from "@voicepractice/shared";
import { AuthCodeDeliveryProvider } from "../runtimeConfig.js";

type EmailVerificationExperience = "dashboard" | "mobile";
type AuthCodeDeliveryTarget =
  | "dashboard_sign_in"
  | "dashboard_email_verification"
  | "mobile_email_verification";

export class AuthCodeDeliveryError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "AuthCodeDeliveryError";
    this.statusCode = statusCode;
  }
}

export interface AuthCodeDeliveryService {
  sendEmailVerificationCode(params: {
    email: string;
    code: string;
    expiresAt: string;
    experience?: EmailVerificationExperience;
  }): Promise<WebAuthDeliveryMode>;
  sendWebSignInCode(params: {
    email: string;
    code: string;
    expiresAt: string;
  }): Promise<WebAuthDeliveryMode>;
}

interface CreateAuthCodeDeliveryServiceParams {
  defaultProvider: AuthCodeDeliveryProvider;
  webAuthProvider: AuthCodeDeliveryProvider | null;
  mobileEmailVerificationProvider: AuthCodeDeliveryProvider | null;
  resendApiKey: string | null;
  fromEmail: string | null;
  fromName: string;
  replyTo: string | null;
}

function formatExpiresAt(expiresAt: string): string {
  return new Date(expiresAt).toLocaleString();
}

function buildEmailTemplate(
  target: AuthCodeDeliveryTarget,
  code: string,
  expiresAt: string
): { subject: string; html: string; text: string } {
  let subject: string;
  let eyebrow: string;
  let headline: string;
  let body: string;

  switch (target) {
    case "dashboard_sign_in":
      subject = "Peritio Dashboard sign-in code";
      eyebrow = "Peritio Dashboard";
      headline = "Your sign-in code";
      body = "Use this one-time code to sign in to Peritio Dashboard at app.peritio.ai.";
      break;
    case "dashboard_email_verification":
      subject = "Peritio Dashboard verification code";
      eyebrow = "Peritio Dashboard";
      headline = "Verify your email";
      body = "Use this one-time code to verify your email and continue signing in to Peritio Dashboard at app.peritio.ai.";
      break;
    case "mobile_email_verification":
      subject = "Peritio app verification code";
      eyebrow = "Peritio";
      headline = "Verify your email";
      body = "Use this one-time code to verify your email in the Peritio mobile app.";
      break;
    default:
      subject = "Peritio verification code";
      eyebrow = "Peritio";
      headline = "Verify your email";
      body = "Use this one-time code to verify your email.";
      break;
  }

  const expiresLabel = formatExpiresAt(expiresAt);

  return {
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#122117;padding:24px;background:#f5f1e8;">
        <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #d8d0c2;border-radius:16px;padding:32px;">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#6a5e4d;">${eyebrow}</p>
          <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;">${headline}</h1>
          <p style="margin:0 0 20px;font-size:16px;color:#2d3e30;">${body}</p>
          <div style="margin:0 0 20px;padding:16px 20px;background:#122117;color:#fffdf8;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:0.28em;text-align:center;">${code}</div>
          <p style="margin:0 0 8px;font-size:14px;color:#5d685f;">This code expires at ${expiresLabel}.</p>
          <p style="margin:0;font-size:14px;color:#5d685f;">If you did not request this code, you can ignore this email.</p>
        </div>
      </div>
    `.trim(),
    text: `${eyebrow}\n\n${headline}\n\n${body}\n\nCode: ${code}\nExpires: ${expiresLabel}\n\nIf you did not request this code, you can ignore this email.`,
  };
}

export function createAuthCodeDeliveryService(params: CreateAuthCodeDeliveryServiceParams): AuthCodeDeliveryService {
  const defaultProvider = params.defaultProvider;
  const webAuthProvider = params.webAuthProvider;
  const mobileEmailVerificationProvider = params.mobileEmailVerificationProvider;
  const resendApiKey = params.resendApiKey?.trim() || null;
  const fromEmail = params.fromEmail?.trim() || null;
  const fromName = params.fromName.trim() || "Peritio";
  const replyTo = params.replyTo?.trim() || null;

  function logCode(tag: string, email: string, code: string, expiresAt: string): WebAuthDeliveryMode {
    const expiresLocal = formatExpiresAt(expiresAt);
    console.log(`[${tag}] ${email} code=${code} expiresAt=${expiresAt} (${expiresLocal})`);
    return "log_only";
  }

  function resolveProvider(target: AuthCodeDeliveryTarget): AuthCodeDeliveryProvider {
    if (target === "mobile_email_verification") {
      return mobileEmailVerificationProvider ?? defaultProvider;
    }

    return webAuthProvider ?? defaultProvider;
  }

  async function sendWithResend(
    target: AuthCodeDeliveryTarget,
    email: string,
    code: string,
    expiresAt: string
  ): Promise<WebAuthDeliveryMode> {
    if (!resendApiKey || !fromEmail) {
      throw new AuthCodeDeliveryError("Resend delivery is not configured.");
    }

    const { subject, html, text } = buildEmailTemplate(target, code, expiresAt);
    const payload: Record<string, unknown> = {
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject,
      html,
      text,
    };
    if (replyTo) {
      payload.reply_to = replyTo;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new AuthCodeDeliveryError(
        errorPayload?.message || `Resend email delivery failed (${response.status}).`
      );
    }

    return "email";
  }

  async function sendCode(
    tag: string,
    target: AuthCodeDeliveryTarget,
    params: { email: string; code: string; expiresAt: string }
  ): Promise<WebAuthDeliveryMode> {
    const provider = resolveProvider(target);
    if (provider === "log_only") {
      return logCode(tag, params.email, params.code, params.expiresAt);
    }

    if (provider === "resend") {
      return sendWithResend(target, params.email, params.code, params.expiresAt);
    }

    throw new AuthCodeDeliveryError(`Unsupported auth code delivery provider "${provider}".`, 500);
  }

  return {
    sendEmailVerificationCode(params) {
      return sendCode(
        "email-verification",
        params.experience === "mobile" ? "mobile_email_verification" : "dashboard_email_verification",
        params
      );
    },
    sendWebSignInCode(params) {
      return sendCode("web-auth-code", "dashboard_sign_in", params);
    },
  };
}
