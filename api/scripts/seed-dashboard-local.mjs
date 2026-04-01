import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for local dashboard seeding.`);
  }

  return value;
}

function requireDashboardSuperUserEmail() {
  const explicitSuperUserEmail = process.env.PERITIO_LOCAL_SUPER_USER_EMAIL?.trim();
  if (explicitSuperUserEmail) {
    return explicitSuperUserEmail;
  }

  // Backward compatibility for existing local setups that still use the legacy env name.
  return requireEnv("PERITIO_LOCAL_PLATFORM_ADMIN_EMAIL");
}

function nowIso() {
  return new Date().toISOString();
}

function loadDatabase(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      config: null,
      users: [],
      orgs: [],
      trainingPackAssignments: [],
      usageSessions: [],
      scoreRecords: [],
      mobileAuthTokens: [],
      emailVerifications: [],
      webAuthChallenges: [],
      enterpriseJoinRequests: [],
      admin: {
        passwordHash: null,
        activeSessionIds: [],
      },
    };
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function saveDatabase(filePath, db) {
  fs.writeFileSync(filePath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function randomJoinCode() {
  return crypto.randomBytes(4).toString("hex").slice(0, 8).toUpperCase();
}

function ensureOrg(db, orgInput) {
  const now = nowIso();
  let org = db.orgs.find((entry) => entry.id === orgInput.id);
  if (!org) {
    org = {
      id: orgInput.id,
      name: orgInput.name,
      status: "active",
      contactName: orgInput.contactName,
      contactEmail: orgInput.contactEmail,
      emailDomain: orgInput.emailDomain,
      joinCode: randomJoinCode(),
      activeIndustries: orgInput.activeIndustries,
      dailySecondsQuota: 86400,
      perUserDailySecondsCap: 1800,
      pendingPerUserDailySecondsCap: null,
      pendingPerUserDailySecondsCapEffectiveAt: null,
      manualBonusSeconds: 0,
      contractSignedAt: now,
      monthlyMinutesAllotted: orgInput.monthlyMinutesAllotted,
      renewalTotalUsd: orgInput.renewalTotalUsd,
      softLimitPercentTriggers: [50, 75, 90],
      maxSimulationMinutes: 20,
      enableModularPromptArchitecture: true,
      customScenarios: [],
      createdAt: now,
      updatedAt: now,
    };
    db.orgs.push(org);
    return org;
  }

  org.name = orgInput.name;
  org.status = "active";
  org.contactName = orgInput.contactName;
  org.contactEmail = orgInput.contactEmail;
  org.emailDomain = orgInput.emailDomain;
  org.activeIndustries = orgInput.activeIndustries;
  org.monthlyMinutesAllotted = orgInput.monthlyMinutesAllotted;
  org.renewalTotalUsd = orgInput.renewalTotalUsd;
  org.updatedAt = now;
  if (!Array.isArray(org.softLimitPercentTriggers) || org.softLimitPercentTriggers.length === 0) {
    org.softLimitPercentTriggers = [50, 75, 90];
  }
  if (!org.joinCode) {
    org.joinCode = randomJoinCode();
  }

  return org;
}

function createBaseUser(userInput, now) {
  return {
    id: userInput.id,
    email: userInput.email.toLowerCase(),
    emailVerifiedAt: now,
    isPlatformAdmin: userInput.isPlatformAdmin,
    isSuperUser: userInput.isSuperUser === true,
    dashboardAccessEnabled: userInput.dashboardAccessEnabled === true,
    accountType: userInput.accountType,
    tier: userInput.tier,
    status: "active",
    orgId: userInput.orgId,
    orgRole: userInput.orgRole,
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: now,
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function ensureDashboardSuperUser(db, userInput) {
  const now = nowIso();
  let user = db.users.find((entry) => entry.email.toLowerCase() === userInput.email.toLowerCase());
  if (!user) {
    user = createBaseUser(userInput, now);
    db.users.push(user);
    return user;
  }

  user.email = userInput.email.toLowerCase();
  user.emailVerifiedAt = now;
  user.isPlatformAdmin = false;
  user.isSuperUser = true;
  user.dashboardAccessEnabled = false;
  user.status = "active";
  user.timezone = user.timezone || "America/Denver";
  user.updatedAt = now;
  return user;
}

function ensureCustomerDashboardUser(db, userInput) {
  const now = nowIso();
  let user = db.users.find((entry) => entry.email.toLowerCase() === userInput.email.toLowerCase());
  if (!user) {
    user = createBaseUser(userInput, now);
    db.users.push(user);
    return user;
  }

  user.email = userInput.email.toLowerCase();
  user.emailVerifiedAt = now;
  user.isPlatformAdmin = false;
  user.isSuperUser = false;
  user.dashboardAccessEnabled = userInput.dashboardAccessEnabled === true;
  user.accountType = "enterprise";
  user.tier = "enterprise";
  user.status = "active";
  user.orgId = userInput.orgId;
  if (user.orgRole !== "org_admin" && user.orgRole !== "user_admin") {
    user.orgRole = userInput.orgRole;
  }
  user.timezone = user.timezone || "America/Denver";
  user.updatedAt = now;
  return user;
}

const storageProvider = (process.env.STORAGE_PROVIDER?.trim().toLowerCase() || "file");
if (storageProvider !== "file") {
  throw new Error("seed-dashboard-local only supports STORAGE_PROVIDER=file. Set that in api/.env.local first.");
}

const dbPath = path.resolve(process.cwd(), process.env.DB_PATH?.trim() || "./db.local.json");
const db = loadDatabase(dbPath);
db.users = Array.isArray(db.users) ? db.users : [];
db.orgs = Array.isArray(db.orgs) ? db.orgs : [];
db.trainingPackAssignments = Array.isArray(db.trainingPackAssignments) ? db.trainingPackAssignments : [];
db.webAuthChallenges = Array.isArray(db.webAuthChallenges) ? db.webAuthChallenges : [];
if ("dashboardCredentials" in db) {
  delete db.dashboardCredentials;
}
if ("auditEvents" in db) {
  delete db.auditEvents;
}
if ("aiUsageEvents" in db) {
  delete db.aiUsageEvents;
}
if ("scoreRecords" in db) {
  delete db.scoreRecords;
}
if ("supportCases" in db) {
  delete db.supportCases;
}
if ("webAuthSessions" in db) {
  delete db.webAuthSessions;
}

const superUserEmail = requireDashboardSuperUserEmail().toLowerCase();
const customerEmail = requireEnv("PERITIO_LOCAL_CUSTOMER_EMAIL").toLowerCase();
const secondCustomerEmail = requireEnv("PERITIO_LOCAL_SECOND_CUSTOMER_EMAIL").toLowerCase();

const primaryOrg =
  db.orgs.find((entry) => entry.status === "active")
  ?? ensureOrg(db, {
    id: "org_dashboard_local_primary",
    name: "Rob's Company",
    contactName: "Rob",
    contactEmail: "rbdautel@gmail.com",
    emailDomain: "robscompany.example",
    activeIndustries: ["people_management"],
    monthlyMinutesAllotted: 4000,
    renewalTotalUsd: 24000,
  });

const secondaryOrg = ensureOrg(db, {
  id: "org_dashboard_local_secondary",
  name: "Summit Revenue Systems",
  contactName: "Summit Team",
  contactEmail: "ops@summitrevenue.example",
  emailDomain: "summitrevenue.example",
  activeIndustries: ["sales"],
  monthlyMinutesAllotted: 3200,
  renewalTotalUsd: 18000,
});

const superUser = ensureDashboardSuperUser(db, {
  id: "usr_dashboard_local_super_user",
  email: superUserEmail,
  isPlatformAdmin: false,
  isSuperUser: true,
  dashboardAccessEnabled: false,
  accountType: "individual",
  tier: "pro_plus",
  orgId: null,
  orgRole: "user",
});

const primaryCustomer = ensureCustomerDashboardUser(db, {
  id: "usr_dashboard_local_customer_primary",
  email: customerEmail,
  isPlatformAdmin: false,
  dashboardAccessEnabled: true,
  accountType: "enterprise",
  tier: "enterprise",
  orgId: primaryOrg.id,
  orgRole: "org_admin",
});

const secondaryCustomer = ensureCustomerDashboardUser(db, {
  id: "usr_dashboard_local_customer_secondary",
  email: secondCustomerEmail,
  isPlatformAdmin: false,
  dashboardAccessEnabled: true,
  accountType: "enterprise",
  tier: "enterprise",
  orgId: secondaryOrg.id,
  orgRole: "org_admin",
});

saveDatabase(dbPath, db);

console.log("Seeded local dashboard identities:");
console.log(`- super_user: ${superUser.email}`);
console.log(`- customer (primary): ${primaryCustomer.email} -> ${primaryOrg.name} (${primaryOrg.id})`);
console.log(`- customer (secondary): ${secondaryCustomer.email} -> ${secondaryOrg.name} (${secondaryOrg.id})`);
