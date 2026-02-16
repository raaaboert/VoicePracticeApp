export const USAGE_BILLING_INCREMENT_SECONDS = 15;
export const TIER_IDS = ["free", "pro", "pro_plus", "enterprise"];
export const ACCOUNT_TYPES = ["individual", "enterprise"];
export const USER_STATUSES = ["active", "disabled"];
export const ORG_STATUSES = ["active", "disabled"];
export const ORG_USER_ROLES = ["org_admin", "user_admin", "user"];
export const ORG_USER_ROLE_LABELS = {
    org_admin: "Org Admin",
    user_admin: "User Admin",
    user: "User"
};
export const INDUSTRY_IDS = ["people_management", "sales", "medical"];
export const INDUSTRY_LABELS = {
    people_management: "People Management",
    sales: "Sales",
    medical: "Medical"
};
export const INDUSTRY_ROLE_SEGMENT_IDS = {
    people_management: ["solution_manager", "project_manager"],
    sales: ["sales_representative", "sales_engineer"],
    medical: ["nurse", "doctor"]
};
export const COMMON_TIMEZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Toronto",
    "America/Vancouver",
    "America/Mexico_City",
    "America/Sao_Paulo",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Madrid",
    "Europe/Rome",
    "Europe/Amsterdam",
    "Europe/Warsaw",
    "Africa/Johannesburg",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
    "UTC"
];
export const DEFAULT_TIER_DEFINITIONS = [
    {
        id: "free",
        label: "Free",
        priceUsdMonthly: 0,
        dailySecondsLimit: 10 * 60,
        supportIncluded: false,
        canCreateCustomScenarios: false,
        description: "10 minutes of simulation time per day."
    },
    {
        id: "pro",
        label: "Pro",
        priceUsdMonthly: 11.99,
        dailySecondsLimit: 30 * 60,
        supportIncluded: true,
        canCreateCustomScenarios: false,
        description: "30 minutes daily plus support."
    },
    {
        id: "pro_plus",
        label: "Pro+",
        priceUsdMonthly: 22.99,
        dailySecondsLimit: 60 * 60,
        supportIncluded: true,
        canCreateCustomScenarios: false,
        description: "60 minutes daily plus support. Custom scenarios reserved for later."
    },
    {
        id: "enterprise",
        label: "Enterprise",
        priceUsdMonthly: 0,
        dailySecondsLimit: null,
        supportIncluded: true,
        canCreateCustomScenarios: false,
        description: "Enterprise licensing is available by request."
    }
];
export const DEFAULT_SEGMENTS = [
    {
        id: "solution_manager",
        label: "Solution Manager",
        summary: "People management conversations for client leadership and direct reports.",
        enabled: true,
        scenarios: [
            {
                id: "sm_undermining_report",
                segmentId: "solution_manager",
                title: "Direct Report Undermining Decisions",
                description: "A direct report keeps undermining your decisions in front of the team.",
                aiRole: "a direct report who keeps undermining your decisions",
                enabled: true
            },
            {
                id: "sm_scope_creep_client",
                segmentId: "solution_manager",
                title: "Frustrated Client With Scope Changes",
                description: "A client is frustrated after repeated scope changes and wants accountability.",
                aiRole: "a frustrated client upset about delays",
                enabled: true
            }
        ]
    },
    {
        id: "project_manager",
        label: "Project Manager",
        summary: "People management conversations focused on team execution and alignment.",
        enabled: true,
        scenarios: [
            {
                id: "pm_unmotivated_member",
                segmentId: "project_manager",
                title: "Unmotivated Team Member",
                description: "A team member is unmotivated, disengaged, and missing deadlines.",
                aiRole: "an unmotivated project team member",
                enabled: true
            },
            {
                id: "pm_team_conflict",
                segmentId: "project_manager",
                title: "Conflict Between Team Members",
                description: "Two team members are in conflict and expect you to resolve it.",
                aiRole: "a project team member in conflict with a colleague",
                enabled: true
            }
        ]
    },
    {
        id: "sales_representative",
        label: "Sales Representative",
        summary: "Sales conversations that require objection handling and trust building.",
        enabled: true,
        scenarios: [
            {
                id: "sales_discount_pushback",
                segmentId: "sales_representative",
                title: "Discount Pushback",
                description: "A prospect is unhappy with the discount and keeps pushing for more.",
                aiRole: "a potential customer unhappy with your discount offer",
                enabled: true
            },
            {
                id: "sales_false_rumors",
                segmentId: "sales_representative",
                title: "False Rumors About Your Company",
                description: "A prospect heard damaging rumors and questions your credibility.",
                aiRole: "a skeptical customer influenced by false negative rumors",
                enabled: true
            }
        ]
    },
    {
        id: "sales_engineer",
        label: "Sales Engineer",
        summary: "Technical sales conversations that demand clear explanations and boundaries.",
        enabled: true,
        scenarios: [
            {
                id: "se_repeating_questions",
                segmentId: "sales_engineer",
                title: "Client Keeps Asking Same Questions and Doesn't Get it",
                description: "A client keeps asking the same technical questions and still seems unconvinced.",
                aiRole: "a client who repeatedly asks the same technical questions",
                enabled: true
            },
            {
                id: "se_unfixable_issue",
                segmentId: "sales_engineer",
                title: "Customer brings up issue that can't be fixed but for good reason",
                description: "A customer raises a limitation that cannot be changed due to valid constraints.",
                aiRole: "a customer frustrated by a product limitation that has to remain",
                enabled: true
            }
        ]
    },
    {
        id: "nurse",
        label: "Nurse",
        summary: "Medical conversations requiring de-escalation, clarity, and professional authority.",
        enabled: true,
        scenarios: [
            {
                id: "nurse_young_doctor",
                segmentId: "nurse",
                title: "New, Young Doctor Thinks They Know Better Than you",
                description: "A new doctor dismisses your experience and ignores your guidance.",
                aiRole: "a new doctor who dismisses your clinical judgment",
                enabled: true
            },
            {
                id: "nurse_vaccine_conspiracy",
                segmentId: "nurse",
                title: "Patient Is Angry About Vaccines And Spews Conspiracy Theories",
                description: "An angry patient challenges vaccine guidance with conspiracy claims.",
                aiRole: "an upset patient repeating vaccine conspiracy claims",
                enabled: true
            }
        ]
    },
    {
        id: "doctor",
        label: "Doctor",
        summary: "Medical leadership conversations involving difficult family and patient communication.",
        enabled: true,
        scenarios: [
            {
                id: "doctor_erratic_family_member",
                segmentId: "doctor",
                title: "Family Member Is Erratic And Afraid About Low Risk Procedure",
                description: "A family member becomes erratic and fearful about a low-risk procedure.",
                aiRole: "an anxious family member acting erratically before a low-risk procedure",
                enabled: true
            },
            {
                id: "doctor_unsuccessful_surgery",
                segmentId: "doctor",
                title: "Tell Somone A Surgery Was Unsuccessful",
                description: "You need to communicate that a surgery was unsuccessful with empathy and clarity.",
                aiRole: "a family member receiving difficult post-surgery news",
                enabled: true
            }
        ]
    }
];
export function createDefaultConfig(nowIso) {
    return {
        activeSegmentId: "project_manager",
        defaultDifficulty: "medium",
        defaultPersonaStyle: "skeptical",
        segments: DEFAULT_SEGMENTS,
        tiers: DEFAULT_TIER_DEFINITIONS,
        enterprise: {
            visibleInApp: true,
            contactEmail: "enterprise@example.com",
            contactUrl: "https://example.com/enterprise",
            defaultOrgDailySecondsQuota: 8 * 60 * 60,
            defaultPerUserDailySecondsCap: 60 * 60,
            allowManualBonusSeconds: true
        },
        featureFlags: {
            scoringEnabled: true,
            customScenarioBuilder: false
        },
        updatedAt: nowIso
    };
}
export function isTierId(value) {
    return TIER_IDS.includes(value);
}
export function isAccountType(value) {
    return ACCOUNT_TYPES.includes(value);
}
export function isUserStatus(value) {
    return USER_STATUSES.includes(value);
}
export function isIndustryId(value) {
    return INDUSTRY_IDS.includes(value);
}
export function isOrgUserRole(value) {
    return ORG_USER_ROLES.includes(value);
}
export function getRoleSegmentIdsForIndustries(industryIds) {
    const ids = new Set();
    for (const industryId of industryIds) {
        const roleSegmentIds = INDUSTRY_ROLE_SEGMENT_IDS[industryId] ?? [];
        for (const roleSegmentId of roleSegmentIds) {
            ids.add(roleSegmentId);
        }
    }
    return Array.from(ids);
}
export function getTierById(tiers, id) {
    return tiers.find((tier) => tier.id === id);
}
export function secondsToWholeMinutes(seconds) {
    return Math.floor(Math.max(0, seconds) / 60);
}
export function formatSecondsAsClock(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
}
