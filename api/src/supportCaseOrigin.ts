export type SupportCaseOrigin = "organization_plan";

const ORGANIZATION_PLAN_MARKER = "[[PERITIO_SUPPORT_ORIGIN:organization_plan]]";
const UNCLASSIFIED_MESSAGE_MARKER = "[[PERITIO_SUPPORT_ORIGIN:unclassified]]";

export function normalizeSupportCaseOrigin(value: unknown): SupportCaseOrigin | null {
  return value === "organization_plan" ? value : null;
}

export function authorizeSupportCaseOrigin(
  origin: SupportCaseOrigin | null,
  user: {
    accountType?: string | null;
    orgRole?: string | null;
    isPlatformAdmin?: boolean;
    isSuperUser?: boolean;
  },
): SupportCaseOrigin | null {
  if (origin !== "organization_plan") {
    return null;
  }

  return user.isSuperUser === true
    || user.isPlatformAdmin === true
    || (user.accountType === "enterprise" && user.orgRole === "org_admin")
    ? origin
    : null;
}

export function encodeSupportCaseMessage(message: string, origin: SupportCaseOrigin | null): string {
  const trimmedMessage = message.trim();
  if (origin === "organization_plan") {
    return `${ORGANIZATION_PLAN_MARKER}\n${trimmedMessage}`;
  }

  return trimmedMessage.startsWith(ORGANIZATION_PLAN_MARKER)
    ? `${UNCLASSIFIED_MESSAGE_MARKER}\n${trimmedMessage}`
    : trimmedMessage;
}

export function decodeSupportCaseMessage(message: string): {
  message: string;
  origin: SupportCaseOrigin | null;
} {
  if (message.startsWith(UNCLASSIFIED_MESSAGE_MARKER)) {
    return {
      message: message.slice(UNCLASSIFIED_MESSAGE_MARKER.length).replace(/^\r?\n/, ""),
      origin: null,
    };
  }

  if (!message.startsWith(ORGANIZATION_PLAN_MARKER)) {
    return { message, origin: null };
  }

  return {
    message: message.slice(ORGANIZATION_PLAN_MARKER.length).replace(/^\r?\n/, ""),
    origin: "organization_plan",
  };
}
