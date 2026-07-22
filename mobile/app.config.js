const baseConfig = require("./app.json");

const API_TARGETS = {
  staging: "https://voicepractice-api-dev.onrender.com",
  production: "https://peritio-api-prod.onrender.com",
};

const APP_VARIANTS = {
  staging: {
    name: "Peritio Staging",
    iosBundleIdentifier: "com.peritio.practice.staging",
  },
  production: {
    name: "Peritio",
    iosBundleIdentifier: "com.peritio.practice",
  },
};

function readChoice(name, choices) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(choices, raw)) {
    throw new Error(`${name} must be one of: ${Object.keys(choices).join(", ")}.`);
  }

  return raw;
}

function inferApiTarget() {
  const explicit = readChoice("PERITIO_MOBILE_ENV", API_TARGETS);
  if (explicit) {
    return explicit;
  }

  switch (process.env.EAS_BUILD_PROFILE) {
    case "preview":
    case "staging-ios":
      return "staging";
    case "production":
    case "production-ios":
      return "production";
    default:
      return null;
  }
}

function inferAppVariant() {
  const explicit = readChoice("PERITIO_MOBILE_APP_VARIANT", APP_VARIANTS);
  if (explicit) {
    return explicit;
  }

  switch (process.env.EAS_BUILD_PROFILE) {
    case "preview":
    case "staging-ios":
      return "staging";
    case "production":
    case "production-ios":
    default:
      return "production";
  }
}

function applyApiTarget(apiTarget) {
  if (!apiTarget) {
    return null;
  }

  const expectedApiBaseUrl = API_TARGETS[apiTarget];
  const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (configuredApiBaseUrl && configuredApiBaseUrl.replace(/\/+$/, "") !== expectedApiBaseUrl) {
    throw new Error(
      `EXPO_PUBLIC_API_BASE_URL must be ${expectedApiBaseUrl} when PERITIO_MOBILE_ENV=${apiTarget}.`
    );
  }

  process.env.EXPO_PUBLIC_API_BASE_URL = expectedApiBaseUrl;
  return expectedApiBaseUrl;
}

module.exports = () => {
  const apiTarget = inferApiTarget();
  const appVariantKey = inferAppVariant();
  const appVariant = APP_VARIANTS[appVariantKey];
  const apiBaseUrl = applyApiTarget(apiTarget);
  const expo = baseConfig.expo;

  return {
    ...expo,
    name: appVariant.name,
    ios: {
      ...expo.ios,
      bundleIdentifier: appVariant.iosBundleIdentifier,
    },
    android: {
      ...expo.android,
      package: expo.android.package,
    },
    extra: {
      ...expo.extra,
      peritio: {
        mobileEnvironment: apiTarget,
        appVariant: appVariantKey,
        apiBaseUrl,
      },
    },
  };
};
