#!/usr/bin/env node

const DEFAULT_API_BASE_URL = "http://localhost:4100";
const DEFAULT_EMAIL = "rbdautel@gmail.com";
const DEFAULT_ORG_NAME = "Rob's company";
const DEFAULT_ORG_ROLE = "org_admin";
const REQUEST_MAX_ATTEMPTS = 6;

const ALLOWED_ORG_ROLES = new Set(["org_admin", "user_admin", "user"]);

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function createRequestError(message, retryable) {
  const error = new Error(message);
  error.retryable = retryable;
  return error;
}

async function requestJson(baseUrl, path, init = {}, token = "") {
  const retryableStatusCodes = new Set([429, 502, 503, 504]);

  for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // ignore
      }

      if (!response.ok) {
        const reason =
          payload && typeof payload === "object" && typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;

        const canRetry = retryableStatusCodes.has(response.status) && attempt < REQUEST_MAX_ATTEMPTS;
        if (canRetry) {
          const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
          console.log(`${path}: transient ${response.status}; retrying in ${backoffMs}ms (attempt ${attempt + 1}/${REQUEST_MAX_ATTEMPTS})...`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        throw createRequestError(`${path}: ${reason}`, false);
      }

      return payload;
    } catch (error) {
      const retryable = !(error instanceof Error && "retryable" in error) || error.retryable === true;
      const canRetry = retryable && attempt < REQUEST_MAX_ATTEMPTS;
      if (!canRetry) {
        throw error;
      }

      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`${path}: transient network error "${reason}"; retrying in ${backoffMs}ms (attempt ${attempt + 1}/${REQUEST_MAX_ATTEMPTS})...`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error(`${path}: request failed after ${REQUEST_MAX_ATTEMPTS} attempts.`);
}

function printHelp() {
  console.log(`
Usage:
  node scripts/ops/assign-enterprise-user.mjs --apiBaseUrl <url> --adminPassword <password>

Optional:
  --email <email>           Default: ${DEFAULT_EMAIL}
  --orgName <name>          Default: ${DEFAULT_ORG_NAME}
  --orgRole <role>          org_admin | user_admin | user (default: ${DEFAULT_ORG_ROLE})

Env fallbacks:
  API_BASE_URL
  ADMIN_PASSWORD
  USER_EMAIL
  ORG_NAME
  ORG_ROLE
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === "true") {
    printHelp();
    return;
  }

  const apiBaseUrl = normalizeBaseUrl(args.apiBaseUrl || process.env.API_BASE_URL || DEFAULT_API_BASE_URL);
  const adminPassword = (args.adminPassword || process.env.ADMIN_PASSWORD || "").trim();
  const email = (args.email || process.env.USER_EMAIL || DEFAULT_EMAIL).trim().toLowerCase();
  const orgName = (args.orgName || process.env.ORG_NAME || DEFAULT_ORG_NAME).trim();
  const orgRole = (args.orgRole || process.env.ORG_ROLE || DEFAULT_ORG_ROLE).trim();

  if (!apiBaseUrl) {
    throw new Error("apiBaseUrl is required.");
  }

  if (!adminPassword) {
    throw new Error("adminPassword is required. Provide --adminPassword or ADMIN_PASSWORD.");
  }

  if (!email) {
    throw new Error("email is required.");
  }

  if (!orgName) {
    throw new Error("orgName is required.");
  }

  if (!ALLOWED_ORG_ROLES.has(orgRole)) {
    throw new Error(`orgRole must be one of: ${Array.from(ALLOWED_ORG_ROLES).join(", ")}`);
  }

  console.log(`Using API: ${apiBaseUrl}`);
  console.log(`Target user: ${email}`);
  console.log(`Enterprise org: ${orgName}`);

  const login = await requestJson(apiBaseUrl, "/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: adminPassword })
  });

  const token = login?.token;
  if (!token || typeof token !== "string") {
    throw new Error("Login succeeded but token missing.");
  }

  const orgs = await requestJson(apiBaseUrl, "/orgs", undefined, token);
  let org = Array.isArray(orgs)
    ? orgs.find((entry) => String(entry?.name || "").trim().toLowerCase() === orgName.toLowerCase())
    : null;

  if (!org) {
    org = await requestJson(
      apiBaseUrl,
      "/orgs",
      {
        method: "POST",
        body: JSON.stringify({
          name: orgName,
          contactName: "Rob Bautel",
          contactEmail: email,
          activeIndustries: ["people_management"]
        })
      },
      token
    );
    console.log(`Created org: ${org.id}`);
  } else {
    console.log(`Using existing org: ${org.id}`);
  }

  const users = await requestJson(apiBaseUrl, "/users", undefined, token);
  const user = Array.isArray(users)
    ? users.find((entry) => String(entry?.email || "").trim().toLowerCase() === email)
    : null;

  if (!user) {
    throw new Error(`User not found: ${email}. Onboard this email first, then rerun script.`);
  }

  const updatedUser = await requestJson(
    apiBaseUrl,
    `/users/${encodeURIComponent(user.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        accountType: "enterprise",
        tier: "enterprise",
        orgId: org.id,
        orgRole,
        status: "active"
      })
    },
    token
  );

  console.log("Assignment complete:");
  console.log(
    JSON.stringify(
      {
        userId: updatedUser.id,
        email: updatedUser.email,
        accountType: updatedUser.accountType,
        tier: updatedUser.tier,
        orgId: updatedUser.orgId,
        orgRole: updatedUser.orgRole,
        status: updatedUser.status
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
