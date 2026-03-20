import assert from "node:assert/strict";
import test from "node:test";

import { createAuthCodeDeliveryService } from "./authCodeDelivery.js";

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

test("dashboard resend override can be enabled while mobile verification stays log_only", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
  const logLines: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return createJsonResponse({ id: "email_123" });
  }) as typeof fetch;
  console.log = ((...args: unknown[]) => {
    logLines.push(args.map((value) => String(value)).join(" "));
  }) as typeof console.log;

  try {
    const service = createAuthCodeDeliveryService({
      defaultProvider: "log_only",
      webAuthProvider: "resend",
      mobileEmailVerificationProvider: null,
      resendApiKey: "re_test_12345678901234567890",
      fromEmail: "noreply@example.com",
      fromName: "Peritio",
      replyTo: null
    });

    const signInDelivery = await service.sendWebSignInCode({
      email: "dashboard@example.com",
      code: "123456",
      expiresAt: "2026-03-20T12:00:00.000Z"
    });
    const verificationDelivery = await service.sendEmailVerificationCode({
      email: "dashboard@example.com",
      code: "654321",
      expiresAt: "2026-03-20T12:00:00.000Z",
      experience: "dashboard"
    });
    const mobileDelivery = await service.sendEmailVerificationCode({
      email: "mobile@example.com",
      code: "999888",
      expiresAt: "2026-03-20T12:00:00.000Z",
      experience: "mobile"
    });

    assert.equal(signInDelivery, "email");
    assert.equal(verificationDelivery, "email");
    assert.equal(mobileDelivery, "log_only");
    assert.equal(fetchCalls.length, 2);
    assert.equal(logLines.length, 1);
    assert.match(logLines[0], /\[email-verification]/);
    assert.match(logLines[0], /mobile@example\.com/);

    const signInPayload = JSON.parse(String(fetchCalls[0].init?.body)) as {
      subject: string;
      text: string;
    };
    assert.equal(signInPayload.subject, "Peritio Dashboard sign-in code");
    assert.match(signInPayload.text, /app\.peritio\.ai/);

    const dashboardVerificationPayload = JSON.parse(String(fetchCalls[1].init?.body)) as {
      subject: string;
      text: string;
    };
    assert.equal(dashboardVerificationPayload.subject, "Peritio Dashboard verification code");
    assert.match(dashboardVerificationPayload.text, /continue signing in to Peritio Dashboard at app\.peritio\.ai/i);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test("mobile resend override uses mobile app email copy", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return createJsonResponse({ id: "email_456" });
  }) as typeof fetch;

  try {
    const service = createAuthCodeDeliveryService({
      defaultProvider: "log_only",
      webAuthProvider: null,
      mobileEmailVerificationProvider: "resend",
      resendApiKey: "re_test_12345678901234567890",
      fromEmail: "noreply@example.com",
      fromName: "Peritio",
      replyTo: "support@example.com"
    });

    const delivery = await service.sendEmailVerificationCode({
      email: "mobile@example.com",
      code: "111222",
      expiresAt: "2026-03-20T12:00:00.000Z",
      experience: "mobile"
    });

    assert.equal(delivery, "email");
    assert.equal(fetchCalls.length, 1);

    const payload = JSON.parse(String(fetchCalls[0].init?.body)) as {
      subject: string;
      text: string;
      reply_to?: string;
    };
    assert.equal(payload.subject, "Peritio app verification code");
    assert.match(payload.text, /Peritio mobile app/);
    assert.doesNotMatch(payload.text, /app\.peritio\.ai/);
    assert.equal(payload.reply_to, "support@example.com");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
