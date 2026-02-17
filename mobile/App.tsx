import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system/legacy";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  COMMON_TIMEZONES,
  formatSecondsAsClock,
  ORG_USER_ROLE_LABELS,
  INDUSTRY_IDS,
  INDUSTRY_LABELS,
  INDUSTRY_ROLE_SEGMENT_IDS,
  IndustryId,
  secondsToWholeMinutes,
} from "@voicepractice/shared";
import {
  AI_VOICE_GENDER_OPTIONS,
  AI_VOICE_OPTIONS,
  COLOR_SCHEME_OPTIONS,
  getVoiceSpeechTuning,
  getAiVoiceOption,
  selectSpeechVoiceIdentifier,
} from "./src/data/preferences";
import {
  DIFFICULTY_HINTS,
  DIFFICULTY_LABELS,
  PERSONA_HINTS,
  PERSONA_LABELS,
} from "./src/data/prompts";
import {
  fetchAppConfig,
  fetchEntitlements,
  fetchMobileConfig,
  fetchMobileUser,
  fetchScoreSummary,
  fetchOrgAdminAnalytics,
  fetchOrgAdminAccessRequests,
  fetchOrgAdminDashboard,
  fetchOrgAdminUserDetail,
  fetchOrgAdminUsers,
  fetchMyOrgAccessRequests,
  fetchTimezones,
  longPollMobileUpdates,
  onboardMobileUser,
  resendMobileVerificationEmail,
  createSupportCase,
  recordSimulationScore,
  recordUsageSession,
  submitOrgAccessRequest,
  decideOrgAdminAccessRequest,
  setOrgAdminUserStatus,
  updateMobileSettings,
  verifyMobileEmail,
} from "./src/lib/api";
import { evaluateSimulation, isOpenAiConfigured } from "./src/lib/openai";
import {
  clearUserId,
  loadActiveSegment,
  loadColorScheme,
  loadMobileAuthToken,
  loadUserId,
  loadVoiceGender,
  loadVoiceProfile,
  saveActiveSegment,
  saveColorScheme,
  saveMobileAuthToken,
  saveUserId,
  saveVoiceGender,
  saveVoiceProfile,
} from "./src/lib/storage";
import { ScorecardView } from "./src/screens/ScorecardView";
import { SimulationScreen } from "./src/screens/SimulationScreen";
import {
  AiVoiceGender,
  AiVoiceProfile,
  AppColorScheme,
  AppConfig,
  Difficulty,
  DialogueMessage,
  PersonaStyle,
  Scenario,
  SessionTiming,
  SimulationConfig,
  SimulationScorecard,
  UserEntitlementsResponse,
  UserProfile,
} from "./src/types";

type SharingModule = {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (url: string, options?: { mimeType?: string; dialogTitle?: string }) => Promise<void>;
};

const loadSharingModule = async (): Promise<SharingModule | null> => {
  try {
    return await import("expo-sharing");
  } catch {
    return null;
  }
};

type Screen =
  | "home"
  | "onboarding"
  | "verify_email"
  | "domain_match"
  | "setup"
  | "simulation"
  | "scorecard"
  | "usage_dashboard"
  | "admin_home"
  | "admin_org_dashboard"
  | "admin_org_requests"
  | "admin_user_list"
  | "admin_user_detail"
  | "settings"
  | "profile"
  | "subscription";

interface ThemeTokens {
  bgTop: string;
  bgBottom: string;
  panel: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  danger: string;
  success: string;
  hint: string;
  ghostButtonBg: string;
  menuOverlayBackdrop: string;
  menuOverlayCardBg: string;
  menuCloseBg: string;
  menuItemBg: string;
  selectedCardBg: string;
  currentPlanCardBg: string;
  planBadgeText: string;
  inputBg: string;
  inlineButtonBg: string;
  dropdownBg: string;
  dropdownChevron: string;
  dropdownModalBackdrop: string;
  dropdownModalCardBg: string;
  dropdownOptionBg: string;
  dropdownOptionSelectedBg: string;
  warningBorder: string;
  warningBg: string;
  warningText: string;
  errorCardBorder: string;
  errorCardBg: string;
  linkButtonBg: string;
  primaryButtonText: string;
}

const APP_THEME_TOKENS: Record<AppColorScheme, ThemeTokens> = {
  soft_light: {
    bgTop: "#f8f7f3",
    bgBottom: "#ece9e2",
    panel: "rgba(255, 255, 255, 0.94)",
    border: "rgba(31, 41, 55, 0.18)",
    text: "#1f2937",
    textMuted: "#475467",
    accent: "#1d4ed8",
    danger: "#b42318",
    success: "#067647",
    hint: "#5f6c80",
    ghostButtonBg: "rgba(246, 248, 251, 0.95)",
    menuOverlayBackdrop: "rgba(23, 29, 38, 0.34)",
    menuOverlayCardBg: "rgba(255, 255, 255, 0.99)",
    menuCloseBg: "rgba(242, 246, 252, 0.95)",
    menuItemBg: "rgba(247, 250, 255, 0.95)",
    selectedCardBg: "rgba(227, 238, 255, 0.96)",
    currentPlanCardBg: "rgba(220, 233, 255, 0.98)",
    planBadgeText: "#ffffff",
    inputBg: "rgba(255, 255, 255, 0.95)",
    inlineButtonBg: "rgba(244, 248, 255, 0.95)",
    dropdownBg: "rgba(255, 255, 255, 0.95)",
    dropdownChevron: "#475467",
    dropdownModalBackdrop: "rgba(23, 29, 38, 0.4)",
    dropdownModalCardBg: "rgba(255, 255, 255, 0.99)",
    dropdownOptionBg: "rgba(247, 250, 255, 0.95)",
    dropdownOptionSelectedBg: "rgba(223, 236, 255, 0.98)",
    warningBorder: "rgba(180, 121, 25, 0.45)",
    warningBg: "rgba(255, 242, 219, 0.78)",
    warningText: "#8c5300",
    errorCardBorder: "rgba(180, 35, 24, 0.4)",
    errorCardBg: "rgba(255, 234, 230, 0.82)",
    linkButtonBg: "rgba(246, 249, 255, 0.95)",
    primaryButtonText: "#ffffff",
  },
  classic_blue: {
    bgTop: "#071225",
    bgBottom: "#16365d",
    panel: "rgba(17, 37, 64, 0.84)",
    border: "rgba(143, 183, 232, 0.28)",
    text: "#eaf2ff",
    textMuted: "#9eb6d5",
    accent: "#35c2ff",
    danger: "#ff7c7c",
    success: "#78e5b8",
    hint: "#8fb4e5",
    ghostButtonBg: "rgba(18, 40, 70, 0.5)",
    menuOverlayBackdrop: "rgba(5, 10, 18, 0.58)",
    menuOverlayCardBg: "rgba(10, 30, 55, 0.97)",
    menuCloseBg: "rgba(17, 39, 65, 0.9)",
    menuItemBg: "rgba(19, 45, 74, 0.7)",
    selectedCardBg: "rgba(25, 59, 99, 0.9)",
    currentPlanCardBg: "rgba(21, 56, 92, 0.92)",
    planBadgeText: "#062235",
    inputBg: "rgba(8, 26, 44, 0.8)",
    inlineButtonBg: "rgba(20, 44, 72, 0.74)",
    dropdownBg: "rgba(8, 26, 44, 0.8)",
    dropdownChevron: "#9eb6d5",
    dropdownModalBackdrop: "rgba(5, 10, 18, 0.76)",
    dropdownModalCardBg: "rgba(9, 26, 46, 0.98)",
    dropdownOptionBg: "rgba(18, 40, 67, 0.72)",
    dropdownOptionSelectedBg: "rgba(28, 75, 120, 0.95)",
    warningBorder: "rgba(255, 194, 95, 0.5)",
    warningBg: "rgba(69, 49, 14, 0.48)",
    warningText: "#ffc25f",
    errorCardBorder: "rgba(255, 124, 124, 0.52)",
    errorCardBg: "rgba(79, 24, 24, 0.55)",
    linkButtonBg: "rgba(18, 42, 72, 0.66)",
    primaryButtonText: "#062235",
  },
};

interface SelectOption {
  value: string;
  label: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function fallbackScorecard(history: DialogueMessage[]): SimulationScorecard {
  const userTurns = history.filter((message) => message.role === "user").length;

  if (userTurns === 0) {
    return {
      overallScore: 0,
      persuasion: 1,
      clarity: 1,
      empathy: 1,
      assertiveness: 1,
      strengths: ["Session started successfully."],
      improvements: [
        "Speak at least once before ending the session.",
        "Use clearer and more direct points.",
        "Address objections with examples.",
      ],
      summary: "No user voice response was captured, so scoring is limited.",
    };
  }

  const base = Math.min(100, 45 + userTurns * 8);
  return {
    overallScore: base,
    persuasion: Math.min(10, 3 + userTurns),
    clarity: Math.min(10, 3 + Math.floor(userTurns / 2)),
    empathy: Math.min(10, 2 + Math.floor(userTurns / 2)),
    assertiveness: Math.min(10, 3 + Math.floor(userTurns / 2)),
    strengths: [
      "Stayed engaged through the conversation.",
      "Kept responses focused on the scenario.",
      "Maintained steady communication tone.",
    ],
    improvements: [
      "Use more evidence to support key points.",
      "Summarize agreements and next steps.",
      "Address concerns with tighter framing.",
    ],
    summary: "Fallback scoring applied. Keep refining persuasive structure and evidence.",
  };
}

function dedupeTimezones(list: string[]): string[] {
  return Array.from(new Set(list));
}

function resolveDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatDateLabel(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

interface TimezoneDropdownProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  styles: any;
}

function TimezoneDropdown({
  value,
  options,
  onChange,
  placeholder = "Select timezone",
  styles,
}: TimezoneDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = value.trim() ? value : placeholder;

  return (
    <View style={styles.dropdownWrapper}>
      <Pressable style={styles.dropdownTrigger} onPress={() => setIsOpen(true)}>
        <Text style={styles.dropdownValue} numberOfLines={1}>
          {selectedLabel}
        </Text>
        <Text style={styles.dropdownChevron}>v</Text>
      </Pressable>
      <Modal transparent visible={isOpen} animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <View style={styles.dropdownModalRoot}>
          <Pressable style={styles.dropdownModalBackdrop} onPress={() => setIsOpen(false)} />
          <View style={styles.dropdownModalCard}>
            <Text style={styles.dropdownModalTitle}>Select Timezone</Text>
            <ScrollView style={styles.dropdownOptionsScroll} contentContainerStyle={styles.dropdownOptionsContent}>
              {options.map((timezone) => (
                <Pressable
                  key={timezone}
                  style={[styles.dropdownOption, value === timezone ? styles.dropdownOptionSelected : null]}
                  onPress={() => {
                    onChange(timezone);
                    setIsOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownOptionText,
                      value === timezone ? styles.dropdownOptionTextSelected : null,
                    ]}
                  >
                    {timezone}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface SelectionDropdownProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  title: string;
  styles: any;
}

function SelectionDropdown({
  value,
  options,
  onChange,
  placeholder,
  title,
  styles,
}: SelectionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? placeholder ?? `Select ${title.toLowerCase()}`;

  return (
    <View style={styles.dropdownWrapper}>
      <Pressable style={styles.dropdownTrigger} onPress={() => setIsOpen(true)}>
        <Text style={styles.dropdownValue} numberOfLines={1}>
          {selectedLabel}
        </Text>
        <Text style={styles.dropdownChevron}>v</Text>
      </Pressable>
      <Modal transparent visible={isOpen} animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <View style={styles.dropdownModalRoot}>
          <Pressable style={styles.dropdownModalBackdrop} onPress={() => setIsOpen(false)} />
          <View style={styles.dropdownModalCard}>
            <Text style={styles.dropdownModalTitle}>Select {title}</Text>
            <ScrollView style={styles.dropdownOptionsScroll} contentContainerStyle={styles.dropdownOptionsContent}>
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  style={[styles.dropdownOption, value === option.value ? styles.dropdownOptionSelected : null]}
                  onPress={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownOptionText,
                      value === option.value ? styles.dropdownOptionTextSelected : null,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface SearchableSelectionDropdownProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  title: string;
  searchPlaceholder?: string;
  styles: any;
}

function SearchableSelectionDropdown({
  value,
  options,
  onChange,
  placeholder,
  title,
  searchPlaceholder,
  styles,
}: SearchableSelectionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? placeholder ?? `Select ${title.toLowerCase()}`;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  return (
    <View style={styles.dropdownWrapper}>
      <Pressable
        style={styles.dropdownTrigger}
        onPress={() => {
          setQuery("");
          setIsOpen(true);
        }}
      >
        <Text style={styles.dropdownValue} numberOfLines={1}>
          {selectedLabel}
        </Text>
        <Text style={styles.dropdownChevron}>v</Text>
      </Pressable>
      <Modal
        transparent
        visible={isOpen}
        animationType="fade"
        onRequestClose={() => {
          setIsOpen(false);
        }}
      >
        <KeyboardAvoidingView
          style={styles.dropdownModalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={24}
        >
          <Pressable style={styles.dropdownModalBackdrop} onPress={() => setIsOpen(false)} />
          <View style={styles.dropdownModalCard}>
            <Text style={styles.dropdownModalTitle}>Select {title}</Text>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder ?? `Search ${title.toLowerCase()}...`}
              placeholderTextColor={"#667085"}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ScrollView style={styles.dropdownOptionsScroll} contentContainerStyle={styles.dropdownOptionsContent}>
              {filtered.length === 0 ? (
                <Text style={styles.body}>(No matches.)</Text>
              ) : (
                filtered.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[styles.dropdownOption, value === option.value ? styles.dropdownOptionSelected : null]}
                    onPress={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownOptionText,
                        value === option.value ? styles.dropdownOptionTextSelected : null,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function App() {
  const detectedTimezone = useMemo(() => resolveDeviceTimezone(), []);

  const [screen, setScreen] = useState<Screen>("home");
  const [colorScheme, setColorScheme] = useState<AppColorScheme>("soft_light");
  const [voiceProfile, setVoiceProfile] = useState<AiVoiceProfile>("balanced");
  const [voiceGender, setVoiceGender] = useState<AiVoiceGender>("female");
  const [isVoiceSamplePlaying, setIsVoiceSamplePlaying] = useState(false);
  const [isHomeMenuOpen, setIsHomeMenuOpen] = useState(false);
  const [isHomeMenuMounted, setIsHomeMenuMounted] = useState(false);
  const homeMenuSlide = useRef(new Animated.Value(0)).current;
  const mobileUpdatesCursorRef = useRef(0);
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [appError, setAppError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [timezones, setTimezones] = useState<string[]>(COMMON_TIMEZONES);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [mobileAuthToken, setMobileAuthToken] = useState<string | null>(null);
  const [entitlements, setEntitlements] = useState<UserEntitlementsResponse | null>(null);

  const [selectedIndustryId, setSelectedIndustryId] = useState<IndustryId | "">("");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("");
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>("medium");
  const [selectedPersonaStyle, setSelectedPersonaStyle] = useState<PersonaStyle>("skeptical");

  const [onboardingEmail, setOnboardingEmail] = useState("");
  const [onboardingTimezone, setOnboardingTimezone] = useState(detectedTimezone);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [isOnboardingSaving, setIsOnboardingSaving] = useState(false);
  const [pendingVerificationUserId, setPendingVerificationUserId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationExpiresAt, setVerificationExpiresAt] = useState<string | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerificationSaving, setIsVerificationSaving] = useState(false);
  const [domainMatch, setDomainMatch] = useState<{ orgId: string; orgName: string; emailDomain: string } | null>(null);
  const [orgJoinCodeInput, setOrgJoinCodeInput] = useState("");
  const [orgRequestNotice, setOrgRequestNotice] = useState<string | null>(null);
  const [orgRequestError, setOrgRequestError] = useState<string | null>(null);
  const [isOrgRequestSaving, setIsOrgRequestSaving] = useState(false);
  const [myOrgAccessRequests, setMyOrgAccessRequests] = useState<Array<{
    id: string;
    status: string;
    orgName: string;
    emailDomain: string;
    createdAt: string;
    expiresAt: string;
    decidedAt: string | null;
    decisionReason: string | null;
  }>>([]);
  const [orgAccessRequestsLoading, setOrgAccessRequestsLoading] = useState(false);

  const [settingsEmail, setSettingsEmail] = useState("");
  const [settingsTimezone, setSettingsTimezone] = useState(detectedTimezone);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);

  const [simulationConfig, setSimulationConfig] = useState<SimulationConfig | null>(null);
  const [lastCompletedConfig, setLastCompletedConfig] = useState<SimulationConfig | null>(null);
  const [scorecard, setScorecard] = useState<SimulationScorecard | null>(null);
  const [scorecardError, setScorecardError] = useState<string | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<{
    text: string;
    fileName: string;
    meta: Record<string, unknown>;
  } | null>(null);

  type ScoreSummaryResponse = Awaited<ReturnType<typeof fetchScoreSummary>>;
  const [dashboardDays, setDashboardDays] = useState(30);
  const [dashboardSegmentId, setDashboardSegmentId] = useState<string>("");
  const [scoreSummary, setScoreSummary] = useState<ScoreSummaryResponse | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  type OrgAdminDashboardResponse = Awaited<ReturnType<typeof fetchOrgAdminDashboard>>;
  type OrgAdminAnalyticsResponse = Awaited<ReturnType<typeof fetchOrgAdminAnalytics>>;
  type OrgAdminUsersResponse = Awaited<ReturnType<typeof fetchOrgAdminUsers>>;
  type OrgAdminUserDetailResponse = Awaited<ReturnType<typeof fetchOrgAdminUserDetail>>;
  type OrgAdminAccessRequestsResponse = Awaited<ReturnType<typeof fetchOrgAdminAccessRequests>>;

  const [adminRangeDays, setAdminRangeDays] = useState(30);
  const [orgAdminDashboard, setOrgAdminDashboard] = useState<OrgAdminDashboardResponse | null>(null);
  const [orgAdminAnalytics, setOrgAdminAnalytics] = useState<OrgAdminAnalyticsResponse | null>(null);
  const [orgAdminUsers, setOrgAdminUsers] = useState<OrgAdminUsersResponse | null>(null);
  const [orgAdminAccessRequests, setOrgAdminAccessRequests] = useState<OrgAdminAccessRequestsResponse | null>(null);
  const [adminUserStatusFilter, setAdminUserStatusFilter] = useState<"active" | "locked" | "all">("active");
  const [selectedAdminUserId, setSelectedAdminUserId] = useState<string>("");
  const [orgAdminUserDetail, setOrgAdminUserDetail] = useState<OrgAdminUserDetailResponse | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  const apiConfigured = useMemo(() => isOpenAiConfigured(), []);

  const enabledSegments = useMemo(
    () => config?.segments?.filter((segment) => segment.enabled) ?? [],
    [config],
  );

  const industryOptions = useMemo(
    () =>
      INDUSTRY_IDS.map((industryId) => ({
        id: industryId,
        label: INDUSTRY_LABELS[industryId],
        roles: INDUSTRY_ROLE_SEGMENT_IDS[industryId]
          .map((segmentId) => enabledSegments.find((segment) => segment.id === segmentId))
          .filter((segment): segment is (typeof enabledSegments)[number] => Boolean(segment)),
      })).filter((industry) => industry.roles.length > 0),
    [enabledSegments],
  );

  const activeIndustry = useMemo(() => {
    if (industryOptions.length === 0) {
      return null;
    }

    return industryOptions.find((industry) => industry.id === selectedIndustryId) ?? industryOptions[0];
  }, [industryOptions, selectedIndustryId]);

  const roleOptions = useMemo(
    () => activeIndustry?.roles ?? [],
    [activeIndustry],
  );

  const activeSegment = useMemo(() => {
    if (roleOptions.length === 0) {
      return null;
    }

    return roleOptions.find((segment) => segment.id === selectedRoleId) ?? roleOptions[0];
  }, [roleOptions, selectedRoleId]);

  const activeScenarios = useMemo(() => {
    if (!activeSegment) {
      return [] as Scenario[];
    }

    return activeSegment.scenarios.filter((scenario) => scenario.enabled !== false);
  }, [activeSegment]);

  const activeScenario = useMemo(() => {
    if (activeScenarios.length === 0) {
      return null;
    }

    return activeScenarios.find((scenario) => scenario.id === selectedScenarioId) ?? activeScenarios[0];
  }, [activeScenarios, selectedScenarioId]);

  const mergedTimezones = useMemo(
    () => dedupeTimezones([detectedTimezone, ...COMMON_TIMEZONES, ...timezones]),
    [detectedTimezone, timezones],
  );
  const theme = useMemo(() => APP_THEME_TOKENS[colorScheme], [colorScheme]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const statusBarStyle = colorScheme === "soft_light" ? "dark" : "light";
  const selectedVoiceOption = useMemo(() => getAiVoiceOption(voiceProfile), [voiceProfile]);
  const industrySelectOptions = useMemo<SelectOption[]>(
    () => industryOptions.map((industry) => ({ value: industry.id, label: industry.label })),
    [industryOptions],
  );
  const roleSelectOptions = useMemo<SelectOption[]>(
    () => roleOptions.map((role) => ({ value: role.id, label: role.label })),
    [roleOptions],
  );
  const scenarioSelectOptions = useMemo<SelectOption[]>(
    () => activeScenarios.map((scenario) => ({ value: scenario.id, label: scenario.title })),
    [activeScenarios],
  );
  const dashboardSegmentSelectOptions = useMemo<SelectOption[]>(
    () =>
      enabledSegments
        .map((segment) => ({ value: segment.id, label: segment.label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [enabledSegments],
  );
  const segmentLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const segment of enabledSegments) {
      map.set(segment.id, segment.label);
    }
    return map;
  }, [enabledSegments]);
  const scenarioTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const segment of enabledSegments) {
      for (const scenario of segment.scenarios) {
        map.set(scenario.id, scenario.title);
      }
    }
    return map;
  }, [enabledSegments]);
  const industryIdByRoleSegmentId = useMemo(() => {
    const map = new Map<string, IndustryId>();
    for (const industryId of INDUSTRY_IDS) {
      const roleIds = INDUSTRY_ROLE_SEGMENT_IDS[industryId] ?? [];
      for (const roleId of roleIds) {
        map.set(roleId, industryId);
      }
    }
    return map;
  }, []);

  const openHomeMenu = useCallback(() => {
    if (isHomeMenuMounted) {
      return;
    }

    setIsHomeMenuMounted(true);
    setIsHomeMenuOpen(true);
    homeMenuSlide.setValue(0);
    Animated.timing(homeMenuSlide, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [homeMenuSlide, isHomeMenuMounted]);

  const closeHomeMenu = useCallback(
    (nextScreen?: Screen) => {
      if (!isHomeMenuMounted) {
        setIsHomeMenuOpen(false);
        if (nextScreen) {
          setScreen(nextScreen);
        }
        return;
      }

      Animated.timing(homeMenuSlide, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(() => {
        setIsHomeMenuMounted(false);
        setIsHomeMenuOpen(false);
        if (nextScreen) {
          setScreen(nextScreen);
        }
      });
    },
    [homeMenuSlide, isHomeMenuMounted],
  );

  const refreshScoreDashboard = useCallback(async () => {
    if (!user || !mobileAuthToken) {
      return;
    }

    setDashboardLoading(true);
    setDashboardError(null);

    try {
      const payload = await fetchScoreSummary(user.id, mobileAuthToken, {
        days: dashboardDays,
        segmentId: dashboardSegmentId.trim() ? dashboardSegmentId.trim() : undefined,
      });
      setScoreSummary(payload);
    } catch (caught) {
      setDashboardError(getErrorMessage(caught, "Could not load dashboard stats."));
    } finally {
      setDashboardLoading(false);
    }
  }, [dashboardDays, dashboardSegmentId, mobileAuthToken, user]);

  const refreshOrgAdminDashboard = useCallback(async () => {
    if (!user || !mobileAuthToken) {
      return;
    }

    const actorIsOrgAdmin = user.accountType === "enterprise" && user.orgRole === "org_admin";
    if (!actorIsOrgAdmin) {
      setAdminError("Org admin access required.");
      return;
    }

    setAdminLoading(true);
    setAdminError(null);

    try {
      const [dashboardPayload, analyticsPayload] = await Promise.all([
        fetchOrgAdminDashboard(user.id, mobileAuthToken),
        fetchOrgAdminAnalytics(user.id, mobileAuthToken, { days: adminRangeDays }),
      ]);
      setOrgAdminDashboard(dashboardPayload);
      setOrgAdminAnalytics(analyticsPayload);
    } catch (caught) {
      setAdminError(getErrorMessage(caught, "Could not load org admin dashboard."));
    } finally {
      setAdminLoading(false);
    }
  }, [adminRangeDays, mobileAuthToken, user]);

  const refreshOrgAdminUsers = useCallback(async () => {
    if (!user || !mobileAuthToken) {
      return;
    }

    const actorHasAdminAccess = user.accountType === "enterprise" && (user.orgRole === "org_admin" || user.orgRole === "user_admin");
    if (!actorHasAdminAccess) {
      setAdminError("Admin access required.");
      return;
    }

    setAdminLoading(true);
    setAdminError(null);

    try {
      const payload = await fetchOrgAdminUsers(user.id, mobileAuthToken);
      setOrgAdminUsers(payload);
    } catch (caught) {
      setAdminError(getErrorMessage(caught, "Could not load organization users."));
    } finally {
      setAdminLoading(false);
    }
  }, [mobileAuthToken, user]);

  const refreshMyOrgAccessRequests = useCallback(async () => {
    if (!user || !mobileAuthToken) {
      return;
    }

    setOrgAccessRequestsLoading(true);
    try {
      const payload = await fetchMyOrgAccessRequests(user.id, mobileAuthToken);
      setMyOrgAccessRequests(
        (payload.requests ?? []).map((row) => ({
          id: row.id,
          status: row.status,
          orgName: row.orgName,
          emailDomain: row.emailDomain,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          decidedAt: row.decidedAt,
          decisionReason: row.decisionReason,
        })),
      );
    } catch {
      // Best-effort load for profile; keep existing rows.
    } finally {
      setOrgAccessRequestsLoading(false);
    }
  }, [mobileAuthToken, user]);

  const refreshOrgAdminAccessRequests = useCallback(async () => {
    if (!user || !mobileAuthToken) {
      return;
    }

    const actorIsOrgAdmin = user.accountType === "enterprise" && user.orgRole === "org_admin";
    if (!actorIsOrgAdmin) {
      return;
    }

    setAdminLoading(true);
    setAdminError(null);
    try {
      const payload = await fetchOrgAdminAccessRequests(user.id, mobileAuthToken);
      setOrgAdminAccessRequests(payload);
    } catch (caught) {
      setAdminError(getErrorMessage(caught, "Could not load org access requests."));
    } finally {
      setAdminLoading(false);
    }
  }, [mobileAuthToken, user]);

  const decideOrgAccessRequest = useCallback(
    async (requestId: string, action: "approve" | "reject") => {
      if (!user || !mobileAuthToken) {
        return;
      }

      setAdminLoading(true);
      setAdminError(null);
      try {
        await decideOrgAdminAccessRequest(user.id, requestId, action, mobileAuthToken);
        await Promise.all([refreshOrgAdminAccessRequests(), refreshOrgAdminUsers()]);
      } catch (caught) {
        setAdminError(getErrorMessage(caught, "Could not update request status."));
      } finally {
        setAdminLoading(false);
      }
    },
    [mobileAuthToken, refreshOrgAdminAccessRequests, refreshOrgAdminUsers, user],
  );

  const refreshOrgAdminUserDetail = useCallback(
    async (targetUserId: string) => {
      if (!user || !mobileAuthToken) {
        return;
      }

      const actorHasAdminAccess =
        user.accountType === "enterprise" && (user.orgRole === "org_admin" || user.orgRole === "user_admin");
      if (!actorHasAdminAccess) {
        setAdminError("Admin access required.");
        return;
      }

      setAdminLoading(true);
      setAdminError(null);

      try {
        const payload = await fetchOrgAdminUserDetail(user.id, targetUserId, mobileAuthToken, { days: 30 });
        setOrgAdminUserDetail(payload);
      } catch (caught) {
        setAdminError(getErrorMessage(caught, "Could not load user details."));
      } finally {
        setAdminLoading(false);
      }
    },
    [mobileAuthToken, user],
  );

  const setOrgUserLocked = useCallback(
    async (targetUserId: string, locked: boolean) => {
      if (!user || !mobileAuthToken) {
        return;
      }

      const actorHasAdminAccess =
        user.accountType === "enterprise" && (user.orgRole === "org_admin" || user.orgRole === "user_admin");
      if (!actorHasAdminAccess) {
        setAdminError("Admin access required.");
        return;
      }

      setAdminLoading(true);
      setAdminError(null);

      try {
        await setOrgAdminUserStatus(user.id, targetUserId, mobileAuthToken, locked ? "disabled" : "active");
        await Promise.all([refreshOrgAdminUsers(), refreshOrgAdminUserDetail(targetUserId)]);
      } catch (caught) {
        setAdminError(getErrorMessage(caught, "Could not update user status."));
      } finally {
        setAdminLoading(false);
      }
    },
    [mobileAuthToken, refreshOrgAdminUserDetail, refreshOrgAdminUsers, user],
  );

  useEffect(() => {
    if (screen !== "home" && isHomeMenuMounted) {
      homeMenuSlide.setValue(0);
      setIsHomeMenuMounted(false);
      setIsHomeMenuOpen(false);
    }
  }, [homeMenuSlide, isHomeMenuMounted, screen]);

  useEffect(() => {
    if (screen !== "usage_dashboard") {
      return;
    }

    void refreshScoreDashboard();
  }, [refreshScoreDashboard, screen]);

  useEffect(() => {
    if (screen === "admin_home" && !orgAdminUsers) {
      void refreshOrgAdminUsers();
    }

    if (screen === "admin_org_dashboard") {
      void refreshOrgAdminDashboard();
    }

    if (screen === "admin_user_list") {
      void refreshOrgAdminUsers();
    }

    if (screen === "admin_org_requests") {
      void refreshOrgAdminAccessRequests();
    }

    if (screen === "admin_user_detail" && selectedAdminUserId.trim()) {
      void refreshOrgAdminUserDetail(selectedAdminUserId.trim());
    }

    if (screen === "profile") {
      void refreshMyOrgAccessRequests();
    }
  }, [
    orgAdminUsers,
    refreshMyOrgAccessRequests,
    refreshOrgAdminAccessRequests,
    refreshOrgAdminDashboard,
    refreshOrgAdminUserDetail,
    refreshOrgAdminUsers,
    screen,
    selectedAdminUserId,
  ]);

  const resetSessionToOnboarding = useCallback(async (notice?: string) => {
    await clearUserId();
    setUser(null);
    setEntitlements(null);
    setMobileAuthToken(null);
    setPendingVerificationUserId(null);
    setVerificationCode("");
    setVerificationExpiresAt(null);
    setVerificationNotice(null);
    setVerificationError(null);
    setDomainMatch(null);
    setOrgJoinCodeInput("");
    setOrgRequestNotice(null);
    setOrgRequestError(null);
    setOnboardingEmail("");
    setOnboardingTimezone(detectedTimezone);
    setSettingsEmail("");
    setSettingsTimezone(detectedTimezone);
    setAppError(null);
    setOnboardingError(notice ?? null);
    setScreen("onboarding");
  }, [detectedTimezone]);

  const initializeApp = useCallback(async () => {
    setIsBootLoading(true);
    setAppError(null);

    let hadStoredSession = false;

    try {
      const [configPayload, timezonePayload, storedScheme, storedVoice, storedVoiceGender] = await Promise.all([
        fetchAppConfig(),
        fetchTimezones().catch(() => COMMON_TIMEZONES),
        loadColorScheme("soft_light"),
        loadVoiceProfile("balanced"),
        loadVoiceGender("female"),
      ]);

      setColorScheme(storedScheme);
      setVoiceProfile(storedVoice);
      setVoiceGender(storedVoiceGender);
      setConfig(configPayload);
      setTimezones(dedupeTimezones(timezonePayload));
      setSelectedDifficulty(configPayload.defaultDifficulty);
      setSelectedPersonaStyle(configPayload.defaultPersonaStyle);

      const preferredSegment = await loadActiveSegment(configPayload.activeSegmentId);
      const validSegment =
        configPayload.segments.find((segment) => segment.id === preferredSegment && segment.enabled) ??
        configPayload.segments.find((segment) => segment.enabled);

      if (validSegment) {
        const matchingIndustry = INDUSTRY_IDS.find((industryId) =>
          INDUSTRY_ROLE_SEGMENT_IDS[industryId].includes(validSegment.id),
        );
        setSelectedIndustryId(matchingIndustry ?? INDUSTRY_IDS[0]);
        setSelectedRoleId(validSegment.id);
        const firstScenario = validSegment.scenarios.find((scenario) => scenario.enabled !== false);
        setSelectedScenarioId(firstScenario?.id ?? "");
      }

      const [storedUserId, storedMobileToken] = await Promise.all([
        loadUserId(),
        loadMobileAuthToken(),
      ]);

      if (!storedUserId || !storedMobileToken) {
        setUser(null);
        setEntitlements(null);
        setMobileAuthToken(null);
        setScreen("onboarding");
        return;
      }

      hadStoredSession = true;
      setMobileAuthToken(storedMobileToken);
      const userPayload = await fetchMobileUser(storedUserId, storedMobileToken);

      setUser(userPayload);
      setOnboardingEmail(userPayload.email);
      setOnboardingTimezone(userPayload.timezone);
      setSettingsEmail(userPayload.email);
      setSettingsTimezone(userPayload.timezone);

      if (!userPayload.emailVerifiedAt) {
        setPendingVerificationUserId(userPayload.id);
        setVerificationCode("");
        setVerificationNotice("Check your inbox for a 6-digit code, then verify to continue.");
        setVerificationError(null);
        setScreen("verify_email");
        return;
      }

      const entitlementsPayload = await fetchEntitlements(storedUserId, storedMobileToken);
      const scopedConfig = await fetchMobileConfig(storedUserId, storedMobileToken).catch(() => configPayload);
      setConfig(scopedConfig);
      setEntitlements(entitlementsPayload);
      setScreen("home");
    } catch (caught) {
      const message = getErrorMessage(caught, "Could not initialize app.");
      const lower = message.toLowerCase();
      const shouldResetSession =
        lower.includes("mobile token") ||
        lower.includes("invalid mobile token") ||
        lower.includes("user not found") ||
        lower.includes("user doesn't exist");
      const shouldSelfHeal =
        hadStoredSession &&
        (shouldResetSession ||
          lower.includes("request timed out") ||
          lower.includes("network request failed") ||
          lower.includes("failed to fetch") ||
          lower.includes("fetch failed"));

      if (shouldSelfHeal) {
        await resetSessionToOnboarding("Session self-healed. Please sign in again.");
      } else {
        setAppError(message);
      }
    } finally {
      setIsBootLoading(false);
    }
  }, [detectedTimezone, resetSessionToOnboarding]);

  useEffect(() => {
    void initializeApp();
  }, [initializeApp]);

  useEffect(() => {
    mobileUpdatesCursorRef.current = 0;
  }, [user?.id]);

  useEffect(() => {
    if (!user || !mobileAuthToken) {
      return;
    }

    const userId = user.id;
    let cancelled = false;
    const controller = new AbortController();

    const loop = async () => {
      while (!cancelled) {
        try {
          const payload = await longPollMobileUpdates(userId, mobileAuthToken, {
            cursor: mobileUpdatesCursorRef.current,
            timeoutMs: 25_000,
            signal: controller.signal,
          });

          if (cancelled) {
            return;
          }

          mobileUpdatesCursorRef.current = payload.cursor;

          if (payload.changed) {
            if (payload.user) {
              setUser(payload.user);
            }
            if (payload.entitlements) {
              setEntitlements(payload.entitlements);
            }
            if (payload.config) {
              setConfig(payload.config);
            }
          }
        } catch (caught) {
          if (cancelled) {
            return;
          }

          const message = getErrorMessage(caught, "");
          const lower = message.toLowerCase();
          const shouldResetSession =
            lower.includes("invalid mobile token") ||
            lower.includes("missing mobile token") ||
            lower.includes("user not found") ||
            lower.includes("user doesn't exist");

          if (shouldResetSession) {
            await resetSessionToOnboarding("Session reset after account update. Please sign in again.");
            return;
          }

          if (lower.includes("abort")) {
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    };

    void loop();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mobileAuthToken, resetSessionToOnboarding, user?.id]);

  useEffect(() => {
    if (!user || user.emailVerifiedAt) {
      return;
    }

    if (screen === "onboarding" || screen === "verify_email") {
      return;
    }

    setPendingVerificationUserId(user.id);
    setVerificationCode("");
    setVerificationNotice("Verify your email to continue.");
    setVerificationError(null);
    setScreen("verify_email");
  }, [screen, user]);

  useEffect(() => {
    if (industryOptions.length === 0) {
      setSelectedIndustryId("");
      return;
    }

    if (!industryOptions.some((industry) => industry.id === selectedIndustryId)) {
      setSelectedIndustryId(industryOptions[0].id);
    }
  }, [industryOptions, selectedIndustryId]);

  useEffect(() => {
    if (!activeIndustry || activeIndustry.roles.length === 0) {
      setSelectedRoleId("");
      return;
    }

    if (!activeIndustry.roles.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(activeIndustry.roles[0].id);
    }
  }, [activeIndustry, selectedRoleId]);

  useEffect(() => {
    if (activeScenarios.length === 0) {
      setSelectedScenarioId("");
      return;
    }

    if (!activeScenarios.some((scenario) => scenario.id === selectedScenarioId)) {
      setSelectedScenarioId(activeScenarios[0].id);
    }
  }, [activeScenarios, selectedScenarioId]);

  useEffect(() => {
    if (!selectedRoleId) {
      return;
    }

    void saveActiveSegment(selectedRoleId);
  }, [selectedRoleId]);

  useEffect(() => {
    void saveColorScheme(colorScheme);
  }, [colorScheme]);

  useEffect(() => {
    void saveVoiceProfile(voiceProfile);
  }, [voiceProfile]);

  useEffect(() => {
    void saveVoiceGender(voiceGender);
  }, [voiceGender]);

  const refreshEntitlements = useCallback(async () => {
    if (!user || !mobileAuthToken) {
      return null;
    }

    const next = await fetchEntitlements(user.id, mobileAuthToken);
    setEntitlements(next);
    return next;
  }, [mobileAuthToken, user]);

  const runOnboarding = async () => {
    setOnboardingError(null);
    const normalizedEmail = onboardingEmail.trim().toLowerCase();

    if (!isEmailLike(normalizedEmail)) {
      setOnboardingError("Please enter a valid email.");
      return;
    }

    if (!onboardingTimezone.trim()) {
      setOnboardingError("Please choose a timezone.");
      return;
    }

    setIsOnboardingSaving(true);
    try {
      const onboarded = await onboardMobileUser({
        email: normalizedEmail,
        timezone: onboardingTimezone.trim(),
      });
      await Promise.all([
        saveUserId(onboarded.user.id),
        saveMobileAuthToken(onboarded.authToken),
      ]);
      setUser(onboarded.user);
      setMobileAuthToken(onboarded.authToken);
      setDomainMatch(onboarded.domainMatch ?? null);
      setSettingsEmail(onboarded.user.email);
      setSettingsTimezone(onboarded.user.timezone);

      if (onboarded.verificationRequired || !onboarded.user.emailVerifiedAt) {
        setPendingVerificationUserId(onboarded.user.id);
        setVerificationCode("");
        setVerificationExpiresAt(onboarded.verificationExpiresAt);
        setVerificationNotice("Verification email sent. Enter the 6-digit code to continue.");
        setVerificationError(null);
        setScreen("verify_email");
        return;
      }

      const nextEntitlements = await fetchEntitlements(onboarded.user.id, onboarded.authToken);
      const scopedConfig = await fetchMobileConfig(onboarded.user.id, onboarded.authToken).catch(
        async () => fetchAppConfig(),
      );

      setConfig(scopedConfig);
      setEntitlements(nextEntitlements);
      if (onboarded.domainMatch && onboarded.user.accountType === "individual") {
        setScreen("domain_match");
      } else {
        setScreen("home");
      }
    } catch (caught) {
      setOnboardingError(getErrorMessage(caught, "Could not complete onboarding."));
    } finally {
      setIsOnboardingSaving(false);
    }
  };

  const submitVerificationCode = async () => {
    if (!pendingVerificationUserId || !mobileAuthToken) {
      setVerificationError("Session expired. Restart onboarding.");
      return;
    }

    const code = verificationCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setVerificationError("Enter the 6-digit verification code.");
      return;
    }

    setVerificationError(null);
    setVerificationNotice(null);
    setIsVerificationSaving(true);
    try {
      const payload = await verifyMobileEmail(pendingVerificationUserId, code, mobileAuthToken);
      setUser(payload.user);
      setMobileAuthToken(payload.authToken);
      await saveMobileAuthToken(payload.authToken);
      setDomainMatch(payload.domainMatch ?? null);
      setVerificationCode("");
      setPendingVerificationUserId(null);
      setVerificationExpiresAt(null);
      setVerificationNotice("Email verified.");
      const nextEntitlements = await fetchEntitlements(payload.user.id, mobileAuthToken);
      const scopedConfig = await fetchMobileConfig(payload.user.id, mobileAuthToken).catch(
        async () => fetchAppConfig(),
      );
      setConfig(scopedConfig);
      setEntitlements(nextEntitlements);

      if (payload.domainMatch && payload.user.accountType === "individual") {
        setScreen("domain_match");
      } else {
        setScreen("home");
      }
    } catch (caught) {
      setVerificationError(getErrorMessage(caught, "Could not verify email."));
    } finally {
      setIsVerificationSaving(false);
    }
  };

  const resendVerificationCode = async () => {
    if (!pendingVerificationUserId || !mobileAuthToken) {
      setVerificationError("Session expired. Restart onboarding.");
      return;
    }

    setVerificationError(null);
    setVerificationNotice(null);
    setIsVerificationSaving(true);
    try {
      const payload = await resendMobileVerificationEmail(pendingVerificationUserId, mobileAuthToken);
      setVerificationExpiresAt(payload.verificationExpiresAt ?? null);
      setVerificationNotice("Verification code sent. Check your inbox.");
    } catch (caught) {
      setVerificationError(getErrorMessage(caught, "Could not resend verification email."));
    } finally {
      setIsVerificationSaving(false);
    }
  };

  const submitOrgDomainRequest = async () => {
    if (!user || !mobileAuthToken) {
      setOrgRequestError("Session expired. Please sign in again.");
      return;
    }

    const joinCode = orgJoinCodeInput.trim();
    if (!joinCode) {
      setOrgRequestError("Enter the join code from your org admin.");
      return;
    }

    setOrgRequestError(null);
    setOrgRequestNotice(null);
    setIsOrgRequestSaving(true);
    try {
      const payload = await submitOrgAccessRequest(user.id, joinCode, mobileAuthToken);
      setOrgRequestNotice(
        payload.created
          ? "Request submitted. Your org admin can approve it from the Admin section."
          : "Request already pending. Your org admin can review it in Admin.",
      );
      setOrgJoinCodeInput("");
      await refreshMyOrgAccessRequests();
    } catch (caught) {
      setOrgRequestError(getErrorMessage(caught, "Could not submit org access request."));
    } finally {
      setIsOrgRequestSaving(false);
    }
  };

  const saveSettings = async () => {
    if (!user || !mobileAuthToken) {
      setSettingsError("Session expired. Please sign in again.");
      return;
    }

    setSettingsError(null);
    setSettingsNotice(null);
    const normalizedEmail = settingsEmail.trim().toLowerCase();

    if (!isEmailLike(normalizedEmail)) {
      setSettingsError("Please enter a valid email.");
      return;
    }

    if (!settingsTimezone.trim()) {
      setSettingsError("Please choose a timezone.");
      return;
    }

    setIsSettingsSaving(true);
    try {
      const updated = await updateMobileSettings(user.id, {
        email: normalizedEmail,
        timezone: settingsTimezone.trim(),
      }, mobileAuthToken);
      setUser(updated);
      setSettingsEmail(updated.email);
      setSettingsTimezone(updated.timezone);
      await refreshEntitlements();
      if (!updated.emailVerifiedAt) {
        setPendingVerificationUserId(updated.id);
        setVerificationCode("");
        setVerificationExpiresAt(null);
        setVerificationNotice("Email changed. Enter the verification code sent to your new inbox.");
        setVerificationError(null);
        setSettingsNotice("Email updated. Verification required before continuing.");
        setScreen("verify_email");
      } else {
        setSettingsNotice("Settings saved. Timezone changes apply at the next cycle reset.");
      }
    } catch (caught) {
      setSettingsError(getErrorMessage(caught, "Could not save settings."));
    } finally {
      setIsSettingsSaving(false);
    }
  };

  const playVoiceSample = async () => {
    if (isVoiceSamplePlaying) {
      return;
    }

    setIsVoiceSamplePlaying(true);
    setSettingsNotice(null);
    setSettingsError(null);

    try {
      const sample = getAiVoiceOption(voiceProfile);
      const sampleTuning = getVoiceSpeechTuning(voiceProfile, voiceGender);
      const availableVoices = await Speech.getAvailableVoicesAsync().catch(() => []);
      if (!availableVoices || availableVoices.length === 0) {
        throw new Error("No text-to-speech voices are available on this device/emulator.");
      }

      const selectedVoiceId = selectSpeechVoiceIdentifier(availableVoices, voiceGender);

      await new Promise<void>((resolve, reject) => {
        Speech.speak("This is a sample of your selected simulator voice.", {
          language: "en-US",
          voice: selectedVoiceId,
          rate: sampleTuning.speechRate,
          pitch: sampleTuning.speechPitch,
          onDone: () => resolve(),
          onStopped: () => resolve(),
          onError: () => reject(new Error("TTS playback failed.")),
        });
      });
      const selectedGenderLabel =
        AI_VOICE_GENDER_OPTIONS.find((option) => option.id === voiceGender)?.label ?? "Female";
      setSettingsNotice(`Played sample using ${selectedGenderLabel} ${sample.label} voice style.`);
    } catch (caught) {
      setSettingsError(getErrorMessage(caught, "Could not play voice sample on this device."));
    } finally {
      setIsVoiceSamplePlaying(false);
    }
  };

  const startSimulation = async () => {
    if (!activeSegment || !activeScenario || !user || !mobileAuthToken) {
      setSetupError("Missing setup context. Please refresh and try again.");
      return;
    }

    setSetupError(null);
    try {
      const latestEntitlements = await refreshEntitlements();
      if (latestEntitlements && !latestEntitlements.canStartSimulation) {
        throw new Error(latestEntitlements.lockReason || "Daily limit reached.");
      }

      const scenario = activeScenario;
      if (!scenario) {
        throw new Error("No scenario available for this segment.");
      }

      setSimulationConfig({
        scenario,
        difficulty: selectedDifficulty,
        segmentLabel: activeSegment.label,
        personaStyle: selectedPersonaStyle,
        voiceProfile,
        voiceGender,
      });
      setScorecard(null);
      setScorecardError(null);
      setScreen("simulation");
    } catch (caught) {
      setSetupError(getErrorMessage(caught, "Could not start simulation."));
    }
  };

  const handleSessionComplete = (
    history: DialogueMessage[],
    completedConfig: SimulationConfig,
    timing: SessionTiming,
  ) => {
    setSimulationConfig(null);
    setLastCompletedConfig(completedConfig);
    setScorecard(null);
    setScorecardError(null);
    setIsScoring(true);
    setScreen("scorecard");
    setLastTranscript(() => {
      const safeTitle = completedConfig.scenario.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
      const stamp = new Date(timing.endedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const fileName = `voicepractice-transcript-${safeTitle || "session"}-${stamp}.txt`.slice(0, 120);

      const baseMeta: Record<string, unknown> = {
        scenarioTitle: completedConfig.scenario.title,
        segmentLabel: completedConfig.segmentLabel,
        difficulty: completedConfig.difficulty,
        personaStyle: completedConfig.personaStyle,
        startedAt: timing.startedAt,
        endedAt: timing.endedAt,
        model: null,
        promptVersion: null,
        rubricVersion: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      };

      const transcriptLines: string[] = [
        "Voice Practice Session Transcript",
        "",
        `Scenario: ${completedConfig.scenario.title}`,
        `Segment: ${completedConfig.segmentLabel}`,
        `Difficulty: ${DIFFICULTY_LABELS[completedConfig.difficulty]}`,
        `Persona: ${PERSONA_LABELS[completedConfig.personaStyle]}`,
        `Started At (ISO): ${timing.startedAt}`,
        `Ended At (ISO): ${timing.endedAt}`,
        `Duration (seconds): ${timing.rawDurationSeconds}`,
        "",
        "AI Details",
        "AI Model: (pending)",
        "Prompt Version: (pending)",
        "Rubric Version: (pending)",
        "Tokens (input/output/total): (pending)",
        "",
        "Conversation",
        ...history.map((message) => `${message.role === "user" ? "User" : "AI"}: ${message.content}`),
        "",
      ];

      return {
        text: transcriptLines.join("\n"),
        fileName,
        meta: baseMeta,
      };
    });

    if (user && mobileAuthToken) {
      void (async () => {
        try {
          const payload = await recordUsageSession({
            userId: user.id,
            segmentId: completedConfig.scenario.segmentId,
            scenarioId: completedConfig.scenario.id,
            startedAt: timing.startedAt,
            endedAt: timing.endedAt,
            rawDurationSeconds: timing.rawDurationSeconds,
          }, mobileAuthToken);
          setEntitlements(payload.entitlements);
        } catch (caught) {
          setScorecardError(getErrorMessage(caught, "Usage update failed after session."));
        }
      })();
    }

    void (async () => {
      let finalScorecard: SimulationScorecard;
      let scoreError: string | null = null;
      let usedServerScore = false;

      try {
        if (!apiConfigured) {
          finalScorecard = fallbackScorecard(history);
          scoreError = "Remote AI is disabled, so fallback scoring was used.";
          setLastTranscript((prev) => {
            if (!prev) {
              return prev;
            }

            const updatedMeta = { ...prev.meta, model: "local-fallback", promptVersion: "local", rubricVersion: "local" };
            const updatedText = prev.text
              .replace("AI Model: (pending)", "AI Model: local-fallback")
              .replace("Prompt Version: (pending)", "Prompt Version: local")
              .replace("Rubric Version: (pending)", "Rubric Version: local")
              .replace("Tokens (input/output/total): (pending)", "Tokens (input/output/total): n/a");
            return { ...prev, meta: updatedMeta, text: updatedText };
          });
        } else {
          if (!user || !mobileAuthToken) {
            throw new Error("Missing mobile auth context for scoring.");
          }

          const result = await evaluateSimulation({
            userId: user.id,
            authToken: mobileAuthToken,
            scenario: completedConfig.scenario,
            difficulty: completedConfig.difficulty,
            segmentLabel: completedConfig.segmentLabel,
            personaStyle: completedConfig.personaStyle,
            startedAt: timing.startedAt,
            endedAt: timing.endedAt,
            history,
          });
          finalScorecard = result.scorecard;
          usedServerScore = true;

          setLastTranscript((prev) => {
            if (!prev) {
              return prev;
            }

            const updatedMeta = {
              ...prev.meta,
              model: result.record.model,
              promptVersion: result.record.promptVersion,
              rubricVersion: result.record.rubricVersion,
              inputTokens: result.record.usage.inputTokens,
              outputTokens: result.record.usage.outputTokens,
              totalTokens: result.record.usage.totalTokens,
            };

            const updatedText = prev.text
              .replace("AI Model: (pending)", `AI Model: ${result.record.model ?? "-"}`)
              .replace("Prompt Version: (pending)", `Prompt Version: ${result.record.promptVersion ?? "-"}`)
              .replace("Rubric Version: (pending)", `Rubric Version: ${result.record.rubricVersion ?? "-"}`)
              .replace(
                "Tokens (input/output/total): (pending)",
                `Tokens (input/output/total): ${result.record.usage.inputTokens}/${result.record.usage.outputTokens}/${result.record.usage.totalTokens}`,
              );

            return { ...prev, meta: updatedMeta, text: updatedText };
          });
        }
      } catch (evaluationError) {
        finalScorecard = fallbackScorecard(history);
        scoreError = getErrorMessage(evaluationError, "Score generation failed. Fallback scoring used.");
      } finally {
        setIsScoring(false);
      }

      setScorecard(finalScorecard);
      if (scoreError) {
        setScorecardError(scoreError);
      }

      if (!usedServerScore && user && mobileAuthToken) {
        try {
          await recordSimulationScore(
            user.id,
            {
              userId: user.id,
              segmentId: completedConfig.scenario.segmentId,
              scenarioId: completedConfig.scenario.id,
              startedAt: timing.startedAt,
              endedAt: timing.endedAt,
              overallScore: finalScorecard.overallScore,
              persuasion: finalScorecard.persuasion,
              clarity: finalScorecard.clarity,
              empathy: finalScorecard.empathy,
              assertiveness: finalScorecard.assertiveness,
            },
            mobileAuthToken,
          );
        } catch (caught) {
          setScorecardError((prev) => prev ?? getErrorMessage(caught, "Could not sync score history."));
        }
      }
    })();
  };

  const downloadLastTranscript = useCallback(async (): Promise<void> => {
    const transcript = lastTranscript;
    if (!transcript) {
      throw new Error("Transcript is not available.");
    }

    if (Platform.OS === "web") {
      const blob = new Blob([transcript.text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = transcript.fileName || "transcript.txt";
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }

    const targetUri = `${FileSystem.cacheDirectory ?? ""}${transcript.fileName || "transcript.txt"}`;
    await FileSystem.writeAsStringAsync(targetUri, transcript.text, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    const sharing = await loadSharingModule();
    if (!sharing) {
      throw new Error("Transcript download is not available on this device build.");
    }

    const canShare = await sharing.isAvailableAsync();
    if (!canShare) {
      throw new Error("Sharing is not available on this device.");
    }

    await sharing.shareAsync(targetUri, {
      mimeType: "text/plain",
      dialogTitle: "Download transcript",
    });
  }, [lastTranscript]);

  const submitSupportFromScore = useCallback(async (params: {
    message: string;
    includeTranscript: boolean;
  }): Promise<{ caseId: string; transcriptRetainedUntil: string | null }> => {
    if (!user || !mobileAuthToken) {
      throw new Error("You must be signed in to submit feedback.");
    }

    if (params.includeTranscript && !lastTranscript) {
      throw new Error("Transcript is not available to attach.");
    }

    return createSupportCase({
      userId: user.id,
      authToken: mobileAuthToken,
      message: params.message,
      includeTranscript: params.includeTranscript,
      transcript:
        params.includeTranscript && lastTranscript
          ? { text: lastTranscript.text, fileName: lastTranscript.fileName, meta: lastTranscript.meta }
          : undefined,
    });
  }, [lastTranscript, mobileAuthToken, user]);

  const currentTier = useMemo(() => {
    if (!config || !user) {
      return null;
    }

    return config.tiers.find((tier) => tier.id === user.tier) ?? null;
  }, [config, user]);

  const standardTiers = useMemo(
    () => config?.tiers.filter((tier) => tier.id === "free" || tier.id === "pro" || tier.id === "pro_plus") ?? [],
    [config],
  );

  const otherPlanTiers = useMemo(() => {
    const filtered = standardTiers.filter((tier) => tier.id !== user?.tier);
    return filtered.slice(0, 2);
  }, [standardTiers, user?.tier]);

  const hasAdminAccess = Boolean(
    user?.accountType === "enterprise" && (user.orgRole === "org_admin" || user.orgRole === "user_admin"),
  );
  const isOrgAdmin = Boolean(user?.accountType === "enterprise" && user.orgRole === "org_admin");

  useEffect(() => {
    if (screen !== "scorecard" && lastTranscript) {
      setLastTranscript(null);
    }
  }, [lastTranscript, screen]);

  const renderHome = () => (
    <View style={styles.fill}>
      <View style={styles.topRow}>
        <View style={styles.spacer} />
        <Text style={styles.topTitle}>Voice Practice</Text>
        <Pressable
          style={styles.menuButton}
          onPress={() => {
            if (isHomeMenuOpen) {
              closeHomeMenu();
              return;
            }
            openHomeMenu();
          }}
        >
          <Text style={styles.menuButtonText}>Menu</Text>
        </Pressable>
      </View>
      <Modal
        transparent
        visible={isHomeMenuMounted}
        animationType="fade"
        onRequestClose={() => closeHomeMenu()}
      >
        <View style={styles.menuOverlayRoot}>
          <Pressable style={styles.menuOverlayBackdrop} onPress={() => closeHomeMenu()} />
          <Animated.View
            style={[
              styles.menuOverlayCard,
              {
                transform: [
                  {
                    translateX: homeMenuSlide.interpolate({
                      inputRange: [0, 1],
                      outputRange: [360, 0],
                    }),
                  },
                ],
                opacity: homeMenuSlide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.45, 1],
                }),
              },
            ]}
          >
            <View style={styles.menuHeaderRow}>
              <Text style={styles.menuHeading}>Profile & Usage</Text>
              <Pressable style={styles.menuCloseButton} onPress={() => closeHomeMenu()}>
                <Text style={styles.menuCloseButtonText}>X</Text>
              </Pressable>
            </View>
            <Text style={styles.menuBody}>Plan: {currentTier?.label ?? "Free"}</Text>
            <Text style={styles.menuBody}>
              {entitlements?.usage?.dailySecondsRemaining === null
                ? "Daily remaining: unlimited"
                : `Daily remaining: ${formatSecondsAsClock(entitlements?.usage?.dailySecondsRemaining ?? 0)}`}
            </Text>
            <Text style={styles.menuBody}>
              Month used: {secondsToWholeMinutes(entitlements?.usage?.billedSecondsThisMonth ?? 0)} min
            </Text>
            <Text style={styles.menuBody}>Reset: {entitlements?.usage?.nextDailyResetLabel ?? "Unavailable"}</Text>
            <View style={styles.menuSeparator} />
            <Pressable
              style={styles.menuItemButton}
              onPress={() => {
                closeHomeMenu("usage_dashboard");
              }}
            >
              <Text style={styles.menuItemText}>Usage Dashboard</Text>
            </Pressable>
            <Pressable
              style={styles.menuItemButton}
              onPress={() => {
                closeHomeMenu("settings");
              }}
            >
              <Text style={styles.menuItemText}>Settings</Text>
            </Pressable>
            <Pressable
              style={styles.menuItemButton}
              onPress={() => {
                closeHomeMenu("profile");
              }}
            >
              <Text style={styles.menuItemText}>Profile</Text>
            </Pressable>
            <Pressable
              style={styles.menuItemButton}
              onPress={() => {
                closeHomeMenu("subscription");
              }}
            >
              <Text style={styles.menuItemText}>Subscription Details</Text>
            </Pressable>

            {user?.accountType === "enterprise" && (user.orgRole === "org_admin" || user.orgRole === "user_admin") ? (
              <>
                <View style={styles.menuSeparator} />
                <Text style={styles.label}>Admin</Text>
                <Pressable
                  style={styles.menuItemButton}
                  onPress={() => {
                    closeHomeMenu("admin_home");
                  }}
                >
                  <Text style={styles.menuItemText}>Admin</Text>
                </Pressable>
              </>
            ) : null}
          </Animated.View>
        </View>
      </Modal>

      {(() => {
        const heroGradientColors: [string, string, string] =
          colorScheme === "soft_light"
            ? ["rgba(247, 251, 255, 0.99)", "rgba(225, 236, 255, 0.99)", "rgba(206, 222, 252, 0.99)"]
            : ["rgba(31, 84, 133, 0.98)", "rgba(14, 45, 77, 0.98)", "rgba(9, 30, 52, 0.98)"];

        return (
          <LinearGradient colors={heroGradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
            <View style={styles.heroGlowOne} />
            <View style={styles.heroGlowTwo} />
            <Text style={styles.heroTitle}>CounterMatch</Text>
            <Text style={styles.heroSubtitle}>Build Confidence Under Pressure</Text>
            <View style={styles.heroRule} />
            <Text style={styles.heroBody}>
              Practice high-stakes professional conversations by voice with dynamic AI role-play.
            </Text>
            <View style={styles.heroChipRow}>
              <View style={styles.heroChip}>
                <Text style={styles.heroChipText}>Live Voice</Text>
              </View>
              <View style={styles.heroChip}>
                <Text style={styles.heroChipText}>Scenario Drills</Text>
              </View>
            </View>
          </LinearGradient>
        );
      })()}

      {activeSegment ? (
        <View style={[styles.card, styles.segmentCard]}>
          <Text style={styles.segmentLabel}>Active Role</Text>
          <Text style={styles.segmentTitle}>{activeSegment.label}</Text>
          <Text style={styles.body}>{activeSegment.summary}</Text>
        </View>
      ) : null}

      {!apiConfigured ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningText}>
            Remote AI is intentionally disabled in this build. Simulation and scoring run in local mode only.
          </Text>
        </View>
      ) : null}

      {entitlements?.lockReason ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{entitlements.lockReason}</Text>
        </View>
      ) : null}

      <Pressable style={styles.primaryButton} onPress={() => setScreen("setup")}>
        <Text style={styles.primaryButtonText}>Let's get started</Text>
      </Pressable>
    </View>
  );

  const renderOnboarding = () => (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={20}
    >
      <View style={styles.topRow}>
        <View style={styles.spacer} />
        <Text style={styles.topTitle}>First-Time Setup</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.title}>Create Your Local Profile</Text>
          <Text style={styles.body}>
            This stores your email and timezone for daily reset and monthly renewal timing.
            {"\n"}
            Autodetected timezone: {detectedTimezone}
            {"\n"}
            You can change timezone now, but future timezone changes apply on the next cycle reset.
          </Text>
          <TextInput
            value={onboardingEmail}
            onChangeText={setOnboardingEmail}
            placeholder="Email address"
            placeholderTextColor={theme.hint}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />
          <Text style={styles.hintText}>Timezone</Text>
          <TimezoneDropdown
            value={onboardingTimezone}
            options={mergedTimezones}
            onChange={setOnboardingTimezone}
            placeholder="Select timezone"
            styles={styles}
          />
          {onboardingTimezone !== detectedTimezone ? (
            <Pressable style={styles.inlineActionButton} onPress={() => setOnboardingTimezone(detectedTimezone)}>
              <Text style={styles.inlineActionButtonText}>Use detected timezone: {detectedTimezone}</Text>
            </Pressable>
          ) : null}
          {onboardingError ? <Text style={styles.errorText}>{onboardingError}</Text> : null}
        </View>
      </ScrollView>
      <Pressable
        style={[styles.primaryButton, isOnboardingSaving ? styles.disabled : null]}
        disabled={isOnboardingSaving}
        onPress={() => {
          void runOnboarding();
        }}
      >
        <Text style={styles.primaryButtonText}>{isOnboardingSaving ? "Saving..." : "Continue"}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );

  const renderVerifyEmail = () => (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={20}
    >
      <View style={styles.topRow}>
        <View style={styles.spacer} />
        <Text style={styles.topTitle}>Verify Email</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.title}>Enter Verification Code</Text>
          <Text style={styles.body}>
            We sent a 6-digit code to {onboardingEmail.trim().toLowerCase() || user?.email || "your email"}.
            {"\n"}
            {verificationExpiresAt
              ? `Code expires: ${formatDateLabel(verificationExpiresAt)}`
              : "Use resend if the code has expired."}
          </Text>
          <TextInput
            value={verificationCode}
            onChangeText={setVerificationCode}
            placeholder="6-digit code"
            placeholderTextColor={theme.hint}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.input}
          />
          {verificationNotice ? <Text style={styles.successText}>{verificationNotice}</Text> : null}
          {verificationError ? <Text style={styles.errorText}>{verificationError}</Text> : null}
          <Pressable
            style={[styles.primaryButton, isVerificationSaving ? styles.disabled : null]}
            disabled={isVerificationSaving}
            onPress={() => {
              void submitVerificationCode();
            }}
          >
            <Text style={styles.primaryButtonText}>{isVerificationSaving ? "Verifying..." : "Verify & Continue"}</Text>
          </Pressable>
          <Pressable
            style={[styles.linkButton, isVerificationSaving ? styles.disabled : null]}
            disabled={isVerificationSaving}
            onPress={() => {
              void resendVerificationCode();
            }}
          >
            <Text style={styles.linkButtonText}>Resend Code</Text>
          </Pressable>
          <Pressable
            style={[styles.ghostButton, isVerificationSaving ? styles.disabled : null]}
            disabled={isVerificationSaving}
            onPress={() => {
              void resetSessionToOnboarding();
            }}
          >
            <Text style={styles.ghostButtonText}>Start Over</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderDomainMatch = () => (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={20}
    >
      <View style={styles.topRow}>
        <Pressable style={styles.ghostButton} onPress={() => setScreen("home")}>
          <Text style={styles.ghostButtonText}>Skip</Text>
        </Pressable>
        <Text style={styles.topTitle}>Org Access</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.title}>Organization Found</Text>
          <Text style={styles.body}>
            We found an enterprise account for {domainMatch?.emailDomain ?? "your domain"}:
            {"\n"}
            {domainMatch?.orgName ?? "Organization"}
            {"\n\n"}
            Enter the join code from your org admin to submit an approval request.
          </Text>
          <TextInput
            value={orgJoinCodeInput}
            onChangeText={setOrgJoinCodeInput}
            placeholder="Join code"
            placeholderTextColor={theme.hint}
            autoCapitalize="characters"
            style={styles.input}
          />
          {orgRequestNotice ? <Text style={styles.successText}>{orgRequestNotice}</Text> : null}
          {orgRequestError ? <Text style={styles.errorText}>{orgRequestError}</Text> : null}
          <Pressable
            style={[styles.primaryButton, isOrgRequestSaving ? styles.disabled : null]}
            disabled={isOrgRequestSaving}
            onPress={() => {
              void submitOrgDomainRequest();
            }}
          >
            <Text style={styles.primaryButtonText}>{isOrgRequestSaving ? "Submitting..." : "Request Org Access"}</Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={() => setScreen("home")}>
            <Text style={styles.ghostButtonText}>Skip and Continue Individual</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderSetup = () => (
    <View style={styles.fill}>
      <View style={styles.topRow}>
        <Pressable style={styles.ghostButton} onPress={() => setScreen("home")}>
          <Text style={styles.ghostButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Setup</Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Session Selection</Text>

          <Text style={styles.hintText}>Industry</Text>
          <SelectionDropdown
            title="Industry"
            value={selectedIndustryId}
            options={industrySelectOptions}
            onChange={(value) => setSelectedIndustryId(value as IndustryId)}
            placeholder="Select industry"
            styles={styles}
          />

          <Text style={styles.hintText}>Role</Text>
          <SelectionDropdown
            title="Role"
            value={selectedRoleId}
            options={roleSelectOptions}
            onChange={setSelectedRoleId}
            placeholder="Select role"
            styles={styles}
          />

          <Text style={styles.hintText}>Scenario</Text>
          <SelectionDropdown
            title="Scenario"
            value={selectedScenarioId}
            options={scenarioSelectOptions}
            onChange={setSelectedScenarioId}
            placeholder="Select scenario"
            styles={styles}
          />

          {activeSegment ? <Text style={styles.body}>{activeSegment.summary}</Text> : null}
          {activeScenario ? <Text style={styles.body}>{activeScenario.description}</Text> : null}
        </View>

        <Text style={styles.sectionTitle}>Difficulty</Text>
        {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((difficulty) => (
          <Pressable
            key={difficulty}
            style={[styles.optionCard, selectedDifficulty === difficulty ? styles.selectedCard : null]}
            onPress={() => setSelectedDifficulty(difficulty)}
          >
            <Text style={styles.optionTitle}>{DIFFICULTY_LABELS[difficulty]}</Text>
            <Text style={styles.body}>{DIFFICULTY_HINTS[difficulty]}</Text>
          </Pressable>
        ))}

        <Text style={styles.sectionTitle}>Opponent Persona Style</Text>
        {(Object.keys(PERSONA_LABELS) as PersonaStyle[]).map((personaStyle) => (
          <Pressable
            key={personaStyle}
            style={[styles.optionCard, selectedPersonaStyle === personaStyle ? styles.selectedCard : null]}
            onPress={() => setSelectedPersonaStyle(personaStyle)}
          >
            <Text style={styles.optionTitle}>{PERSONA_LABELS[personaStyle]}</Text>
            <Text style={styles.body}>{PERSONA_HINTS[personaStyle]}</Text>
          </Pressable>
        ))}

        <View style={styles.card}>
          <Text style={styles.label}>Usage Check</Text>
          <Text style={styles.body}>{entitlements?.usage?.nextDailyResetLabel ?? "Daily reset unavailable."}</Text>
          <Text style={styles.body}>
            {entitlements?.usage?.dailySecondsRemaining === null
              ? "Daily remaining: unlimited"
              : `Daily remaining: ${formatSecondsAsClock(entitlements?.usage?.dailySecondsRemaining ?? 0)}`}
          </Text>
        </View>
      </ScrollView>

      {setupError ? <Text style={styles.errorText}>{setupError}</Text> : null}

      <Pressable style={styles.primaryButton} onPress={() => void startSimulation()}>
        <Text style={styles.primaryButtonText}>Start Simulation</Text>
      </Pressable>
    </View>
  );

  const renderProfile = () => (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={20}
    >
      <View style={styles.topRow}>
        <Pressable style={styles.ghostButton} onPress={() => setScreen("home")}>
          <Text style={styles.ghostButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Profile</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.title}>Account</Text>
          <Text style={styles.body}>
            Autodetected timezone: {detectedTimezone}
            {"\n"}
            You can change timezone, but updates apply on your next cycle reset.
          </Text>
          <TextInput
            value={settingsEmail}
            onChangeText={setSettingsEmail}
            placeholder="Email address"
            placeholderTextColor={theme.hint}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />
          <Text style={styles.hintText}>Timezone</Text>
          <TimezoneDropdown
            value={settingsTimezone}
            options={mergedTimezones}
            onChange={setSettingsTimezone}
            placeholder="Select timezone"
            styles={styles}
          />
          {settingsTimezone !== detectedTimezone ? (
            <Pressable style={styles.inlineActionButton} onPress={() => setSettingsTimezone(detectedTimezone)}>
              <Text style={styles.inlineActionButtonText}>Use detected timezone: {detectedTimezone}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.body}>
            Current timezone: {user?.timezone ?? "N/A"}{"\n"}
            Pending timezone: {user?.pendingTimezone ?? "None"}{"\n"}
            Pending applies at: {formatDateLabel(user?.pendingTimezoneEffectiveAt ?? null)}
          </Text>
          <Text style={styles.body}>
            Next monthly renewal: {formatDateLabel(entitlements?.usage?.nextRenewalAt ?? null)}
          </Text>
          {settingsNotice ? <Text style={styles.successText}>{settingsNotice}</Text> : null}
          {settingsError ? <Text style={styles.errorText}>{settingsError}</Text> : null}
          <Pressable
            style={[styles.primaryButton, isSettingsSaving ? styles.disabled : null]}
            disabled={isSettingsSaving}
            onPress={() => {
              void saveSettings();
            }}
          >
            <Text style={styles.primaryButtonText}>{isSettingsSaving ? "Saving..." : "Save Profile"}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Enterprise Access</Text>
          <Text style={styles.body}>
            If your company has an enterprise subscription for your email domain, enter the org join code to request
            access. Requests expire after 7 days and can be resent.
          </Text>
          <TextInput
            value={orgJoinCodeInput}
            onChangeText={setOrgJoinCodeInput}
            placeholder="Join code"
            placeholderTextColor={theme.hint}
            autoCapitalize="characters"
            style={styles.input}
          />
          <Pressable
            style={[styles.primaryButton, isOrgRequestSaving ? styles.disabled : null]}
            disabled={isOrgRequestSaving}
            onPress={() => {
              void submitOrgDomainRequest();
            }}
          >
            <Text style={styles.primaryButtonText}>{isOrgRequestSaving ? "Submitting..." : "Request Access"}</Text>
          </Pressable>
          <Pressable
            style={[styles.ghostButton, orgAccessRequestsLoading ? styles.disabled : null]}
            disabled={orgAccessRequestsLoading}
            onPress={() => {
              void refreshMyOrgAccessRequests();
            }}
          >
            <Text style={styles.ghostButtonText}>{orgAccessRequestsLoading ? "Refreshing..." : "Refresh Requests"}</Text>
          </Pressable>

          {orgRequestNotice ? <Text style={styles.successText}>{orgRequestNotice}</Text> : null}
          {orgRequestError ? <Text style={styles.errorText}>{orgRequestError}</Text> : null}

          {myOrgAccessRequests.length === 0 ? (
            <Text style={styles.body}>(No requests yet.)</Text>
          ) : (
            <View style={{ gap: 10, marginTop: 8 }}>
              {myOrgAccessRequests.slice(0, 10).map((row) => (
                <View key={row.id} style={styles.optionCard}>
                  <Text style={styles.optionTitle}>
                    {row.orgName} - {row.status}
                  </Text>
                  <Text style={styles.body}>
                    Domain: {row.emailDomain}{"\n"}
                    Requested: {formatDateLabel(row.createdAt)}{"\n"}
                    Expires: {formatDateLabel(row.expiresAt)}{"\n"}
                    {row.decisionReason ? `Note: ${row.decisionReason}` : "Note: -"}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <Pressable
          style={[styles.ghostButton, styles.signOutButton]}
          onPress={() => {
            void resetSessionToOnboarding();
          }}
        >
          <Text style={styles.ghostButtonText}>Reset Local User</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderSettings = () => (
    <View style={styles.fill}>
      <View style={styles.topRow}>
        <Pressable style={styles.ghostButton} onPress={() => setScreen("home")}>
          <Text style={styles.ghostButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Settings</Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.title}>Appearance</Text>
          <Text style={styles.body}>Choose your app color scheme.</Text>
          {COLOR_SCHEME_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              style={[styles.optionCard, colorScheme === option.id ? styles.selectedCard : null]}
              onPress={() => setColorScheme(option.id)}
            >
              <Text style={styles.optionTitle}>{option.label}</Text>
              <Text style={styles.body}>{option.description}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>AI Voice</Text>
          <Text style={styles.body}>
            Choose the simulator voice style here. This is designed to be set outside an active session.
          </Text>
          <View style={styles.voiceToggleRow}>
            {AI_VOICE_GENDER_OPTIONS.map((option) => (
              <Pressable
                key={option.id}
                style={[
                  styles.voiceToggleButton,
                  voiceGender === option.id ? styles.selectedCard : null,
                ]}
                onPress={() => setVoiceGender(option.id)}
              >
                <Text style={styles.voiceToggleText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          {AI_VOICE_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              style={[styles.optionCard, voiceProfile === option.id ? styles.selectedCard : null]}
              onPress={() => setVoiceProfile(option.id)}
            >
              <Text style={styles.optionTitle}>{option.label}</Text>
              <Text style={styles.body}>{option.description}</Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.linkButton, isVoiceSamplePlaying ? styles.disabled : null]}
            disabled={isVoiceSamplePlaying}
            onPress={() => {
              void playVoiceSample();
            }}
          >
            <Text style={styles.linkButtonText}>
              {isVoiceSamplePlaying ? "Playing sample..." : "Play Voice Sample"}
            </Text>
          </Pressable>
          <Text style={styles.body}>
            Current voice: {voiceGender === "male" ? "Male" : "Female"} {selectedVoiceOption.label}
          </Text>
          {settingsNotice ? <Text style={styles.successText}>{settingsNotice}</Text> : null}
          {settingsError ? <Text style={styles.errorText}>{settingsError}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );

  const renderSubscription = () => (
    <View style={styles.fill}>
      <View style={styles.topRow}>
        <Pressable style={styles.ghostButton} onPress={() => setScreen("home")}>
          <Text style={styles.ghostButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Subscription Details</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.label}>Your Plan</Text>
          <Text style={styles.title}>{currentTier?.label ?? "Free"}</Text>
          <Text style={styles.body}>{currentTier?.description ?? "Basic training access."}</Text>
          <Text style={styles.body}>Price: ${(currentTier?.priceUsdMonthly ?? 0).toFixed(2)}/month</Text>
          <Text style={styles.body}>
            Daily simulation: {currentTier?.dailySecondsLimit === null
              ? "Custom"
              : `${secondsToWholeMinutes(currentTier?.dailySecondsLimit ?? 0)} minutes`}
          </Text>
          <Text style={styles.body}>Support included: {currentTier?.supportIncluded ? "Yes" : "No"}</Text>
          <Text style={styles.body}>
            Used this month: {secondsToWholeMinutes(entitlements?.usage?.billedSecondsThisMonth ?? 0)} min billed
          </Text>
          <Text style={styles.body}>
            Daily remaining: {entitlements?.usage?.dailySecondsRemaining === null
              ? "unlimited"
              : formatSecondsAsClock(entitlements?.usage?.dailySecondsRemaining ?? 0)}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Other Plans</Text>
          {otherPlanTiers.map((tier) => (
            <View key={tier.id} style={styles.optionCard}>
              <Text style={styles.optionTitle}>{tier.label} - ${tier.priceUsdMonthly.toFixed(2)}/month</Text>
              <Text style={styles.body}>{tier.description}</Text>
              <Text style={styles.body}>
                Daily simulation: {tier.dailySecondsLimit === null
                  ? "Custom"
                  : `${secondsToWholeMinutes(tier.dailySecondsLimit)} minutes`}
              </Text>
              <Text style={styles.body}>Support included: {tier.supportIncluded ? "Yes" : "No"}</Text>
            </View>
          ))}
          <Text style={styles.body}>
            Enterprise option is also available for org-level controls, custom quotas, and team rollouts.
          </Text>
        </View>
      </ScrollView>
    </View>
  );

  const renderUsageDashboard = () => {
    const showSegmentFilter = dashboardSegmentSelectOptions.length > 1;
    const segmentFilterOptions: SelectOption[] = showSegmentFilter
      ? [{ value: "", label: "All segments" }, ...dashboardSegmentSelectOptions]
      : dashboardSegmentSelectOptions;

    const avgScore = scoreSummary?.totals?.avgOverallScore ?? null;
    const sessionCount = scoreSummary?.totals?.sessions ?? 0;

    return (
      <View style={styles.fill}>
        <View style={styles.topRow}>
          <Pressable style={styles.ghostButton} onPress={() => setScreen("home")}>
            <Text style={styles.ghostButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.topTitle}>Usage Dashboard</Text>
          <Pressable
            style={[styles.ghostButton, dashboardLoading ? styles.disabled : null]}
            disabled={dashboardLoading}
            onPress={() => {
              void refreshScoreDashboard();
            }}
          >
            <Text style={styles.ghostButtonText}>{dashboardLoading ? "Loading..." : "Refresh"}</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <Text style={styles.title}>Average Score</Text>
            <Text style={styles.body}>
              See how you're trending over time. Scores are averaged across completed sessions.
            </Text>

            <Text style={styles.hintText}>Date Range</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {[7, 30, 90].map((days) => (
                <Pressable
                  key={days}
                  style={[
                    styles.timezoneChip,
                    dashboardDays === days ? styles.selectedChip : null,
                  ]}
                  onPress={() => setDashboardDays(days)}
                >
                  <Text style={styles.chipText}>{days}d</Text>
                </Pressable>
              ))}
            </ScrollView>

            {showSegmentFilter ? (
              <>
                <Text style={styles.hintText}>Segment</Text>
                <SelectionDropdown
                  value={dashboardSegmentId}
                  options={segmentFilterOptions}
                  onChange={setDashboardSegmentId}
                  placeholder="All segments"
                  title="Segment"
                  styles={styles}
                />
              </>
            ) : null}

            <View style={{ flexDirection: "row", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
              <View style={[styles.optionCard, { flex: 1, minWidth: 160 }]}>
                <Text style={styles.label}>Avg Score</Text>
                <Text style={styles.title}>{avgScore === null ? "-" : avgScore.toFixed(1)}</Text>
              </View>
              <View style={[styles.optionCard, { flex: 1, minWidth: 160 }]}>
                <Text style={styles.label}>Sessions</Text>
                <Text style={styles.title}>{sessionCount}</Text>
              </View>
            </View>

            {scoreSummary?.generatedAt ? (
              <Text style={styles.body}>Updated: {formatDateLabel(scoreSummary.generatedAt)}</Text>
            ) : null}
          </View>

          {dashboardError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{dashboardError}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.title}>Score Trend</Text>
            <Text style={styles.body}>Daily average score for the selected range.</Text>

            {dashboardLoading ? (
              <View style={styles.centered}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={styles.body}>Loading trend...</Text>
              </View>
            ) : scoreSummary && scoreSummary.byDay.length > 0 ? (
              <View style={{ gap: 10, marginTop: 4 }}>
                {scoreSummary.byDay.map((row) => {
                  const pct = Math.max(0, Math.min(1, (row.avgOverallScore ?? 0) / 100));
                  return (
                    <View key={row.dayKey} style={{ gap: 6 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                        <Text style={styles.body}>{row.dayKey}</Text>
                        <Text style={styles.body}>
                          {row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1)} ({row.sessions})
                        </Text>
                      </View>
                      <View
                        style={{
                          height: 10,
                          borderRadius: 999,
                          backgroundColor: theme.border,
                          overflow: "hidden",
                        }}
                      >
                        <View
                          style={{
                            width: `${Math.round(pct * 100)}%`,
                            height: "100%",
                            backgroundColor: theme.accent,
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.body}>(No scored sessions in this period yet.)</Text>
            )}
          </View>

          {scoreSummary && !dashboardSegmentId.trim() ? (
            <View style={styles.card}>
              <Text style={styles.title}>By Segment</Text>
              <Text style={styles.body}>Average score and session count for each segment.</Text>
              <View style={{ gap: 10, marginTop: 6 }}>
                {scoreSummary.bySegment.length === 0 ? (
                  <Text style={styles.body}>(No segment data yet.)</Text>
                ) : (
                  scoreSummary.bySegment.map((row) => (
                    <View key={row.segmentId} style={styles.optionCard}>
                      <Text style={styles.optionTitle}>{row.segmentLabel}</Text>
                      <Text style={styles.body}>
                        Avg score: {row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1)}{"\n"}
                        Sessions: {row.sessions}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          ) : null}

          {scoreSummary ? (
            <View style={styles.card}>
              <Text style={styles.title}>Recent Scores</Text>
              <Text style={styles.body}>Latest scored sessions in this range.</Text>
              <View style={{ gap: 10, marginTop: 6 }}>
                {scoreSummary.recent.length === 0 ? (
                  <Text style={styles.body}>(No recent scores.)</Text>
                ) : (
                  scoreSummary.recent.map((row) => (
                    <View key={row.id} style={styles.optionCard}>
                      <Text style={styles.optionTitle}>Score: {row.overallScore}</Text>
                      <Text style={styles.body}>
                        {formatDateLabel(row.endedAt)}{"\n"}
                        Segment: {segmentLabelById.get(row.segmentId) ?? row.segmentId}{"\n"}
                        Scenario: {scenarioTitleById.get(row.scenarioId) ?? row.scenarioId}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  };

  const renderAdminHome = () => {
    if (!user) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Missing user profile.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setScreen("home")}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </Pressable>
        </View>
      );
    }

    if (!hasAdminAccess) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Admin access required.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setScreen("home")}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </Pressable>
        </View>
      );
    }

    const orgName =
      orgAdminUsers?.org?.name ?? orgAdminDashboard?.org?.name ?? orgAdminUserDetail?.org?.name ?? "Your organization";
    const roleLabel =
      (ORG_USER_ROLE_LABELS as unknown as Record<string, string>)[user.orgRole] ?? user.orgRole ?? "user";

    return (
      <View style={styles.fill}>
        <View style={styles.topRow}>
          <Pressable style={styles.ghostButton} onPress={() => setScreen("home")}>
            <Text style={styles.ghostButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.topTitle}>Admin</Text>
          <Pressable
            style={[styles.ghostButton, adminLoading ? styles.disabled : null]}
            disabled={adminLoading}
            onPress={() => {
              if (isOrgAdmin) {
                void refreshOrgAdminDashboard();
              } else {
                void refreshOrgAdminUsers();
              }
            }}
          >
            <Text style={styles.ghostButtonText}>{adminLoading ? "Loading..." : "Refresh"}</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {adminError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{adminError}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.label}>Organization</Text>
            <Text style={styles.title}>{orgName}</Text>
            <Text style={styles.body}>Role: {roleLabel}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Tools</Text>
            <Text style={styles.body}>
              Review account performance and manage who can access the app.
            </Text>
            {isOrgAdmin ? (
              <>
                <Pressable
                  style={styles.menuItemButton}
                  onPress={() => {
                    setAdminError(null);
                    setScreen("admin_org_dashboard");
                  }}
                >
                  <Text style={styles.menuItemText}>Org Dashboard</Text>
                </Pressable>
                <Pressable
                  style={styles.menuItemButton}
                  onPress={() => {
                    setAdminError(null);
                    setScreen("admin_org_requests");
                  }}
                >
                  <Text style={styles.menuItemText}>Access Requests</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.optionCard}>
                <Text style={styles.optionTitle}>Limited Scope</Text>
                <Text style={styles.body}>
                  User Admins can lock/unlock users and review user-level activity. Contract and org-wide analytics are
                  restricted to Org Admins.
                </Text>
              </View>
            )}

            <Pressable
              style={styles.menuItemButton}
              onPress={() => {
                setAdminError(null);
                setScreen("admin_user_list");
              }}
            >
              <Text style={styles.menuItemText}>Manage Users</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderAdminOrgDashboard = () => {
    if (!hasAdminAccess || !user) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Admin access required.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setScreen("home")}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </Pressable>
        </View>
      );
    }

    if (!isOrgAdmin) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Org admin access required.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setScreen("admin_home")}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </Pressable>
        </View>
      );
    }

    const org = orgAdminDashboard?.org ?? null;
    const billing = orgAdminDashboard?.billingPeriod ?? null;
    const usage = orgAdminDashboard?.usage ?? null;

    const industriesLabel = Array.isArray(org?.activeIndustries) && org?.activeIndustries.length > 0
      ? org.activeIndustries
          .map((industryId) => INDUSTRY_LABELS[industryId as IndustryId] ?? String(industryId))
          .join(", ")
      : "-";

    const allotmentSeconds = usage?.annualizedAllotmentSeconds ?? 0;
    const usedSeconds = usage?.billedSecondsThisPeriod ?? 0;
    const usagePct = allotmentSeconds > 0 ? Math.min(1, usedSeconds / allotmentSeconds) : 0;

    const analyticsSessions = orgAdminAnalytics?.bySegment.reduce((total, row) => total + (row.sessions ?? 0), 0) ?? 0;

    const byIndustry = (() => {
      if (!orgAdminAnalytics) {
        return [] as Array<{ industryId: string; industryLabel: string; sessions: number; avgOverallScore: number | null }>;
      }
      const grouped = new Map<string, { sessions: number; totalScore: number }>();
      for (const row of orgAdminAnalytics.bySegment) {
        const industryId = industryIdByRoleSegmentId.get(row.segmentId as unknown as string);
        if (!industryId) {
          continue;
        }
        const current = grouped.get(industryId) ?? { sessions: 0, totalScore: 0 };
        const sessions = row.sessions ?? 0;
        const avg = row.avgOverallScore ?? 0;
        grouped.set(industryId, {
          sessions: current.sessions + sessions,
          totalScore: current.totalScore + avg * sessions,
        });
      }

      return Array.from(grouped.entries())
        .map(([industryId, row]) => ({
          industryId,
          industryLabel: INDUSTRY_LABELS[industryId as IndustryId] ?? industryId,
          sessions: row.sessions,
          avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null,
        }))
        .sort((a, b) => b.sessions - a.sessions);
    })();

    return (
      <View style={styles.fill}>
        <View style={styles.topRow}>
          <Pressable style={styles.ghostButton} onPress={() => setScreen("admin_home")}>
            <Text style={styles.ghostButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.topTitle}>Org Dashboard</Text>
          <Pressable
            style={[styles.ghostButton, adminLoading ? styles.disabled : null]}
            disabled={adminLoading}
            onPress={() => void refreshOrgAdminDashboard()}
          >
            <Text style={styles.ghostButtonText}>{adminLoading ? "Loading..." : "Refresh"}</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {adminError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{adminError}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.label}>Contract & Usage</Text>
            <Text style={styles.title}>{org?.name ?? "Organization"}</Text>
            <Text style={styles.body}>
              Industries: {industriesLabel}{"\n"}
              Period: {billing ? `${formatDateLabel(billing.periodStartAt)} to ${formatDateLabel(billing.periodEndAt)}` : "-"}{"\n"}
              Next renewal: {billing ? formatDateLabel(billing.nextRenewalAt) : "-"}
            </Text>

            <View style={{ gap: 10, marginTop: 6 }}>
              <View style={styles.optionCard}>
                <Text style={styles.optionTitle}>Annual Allotment</Text>
                <Text style={styles.body}>
                  Used: {formatSecondsAsClock(usedSeconds)}{"\n"}
                  Included: {formatSecondsAsClock(allotmentSeconds)}
                </Text>
                <View
                  style={{
                    height: 10,
                    borderRadius: 999,
                    backgroundColor: theme.border,
                    overflow: "hidden",
                    marginTop: 4,
                  }}
                >
                  <View
                    style={{
                      width: `${Math.round(usagePct * 100)}%`,
                      height: "100%",
                      backgroundColor: theme.accent,
                    }}
                  />
                </View>
                <Text style={styles.body}>Utilization: {Math.round(usagePct * 100)}%</Text>
              </View>

              <View style={styles.optionCard}>
                <Text style={styles.optionTitle}>Quota Rules</Text>
                <Text style={styles.body}>
                  Org daily quota: {formatSecondsAsClock(usage?.dailyQuotaSeconds ?? 0)}{"\n"}
                  Per-user daily cap: {formatSecondsAsClock(usage?.perUserDailyCapSeconds ?? 0)}{"\n"}
                  Manual bonus pool: {formatSecondsAsClock(org?.manualBonusSeconds ?? 0)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Score Analytics</Text>
            <Text style={styles.body}>Average score and trends across your organization.</Text>

            <Text style={styles.hintText}>Date Range</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {[7, 30, 90].map((days) => (
                <Pressable
                  key={days}
                  style={[styles.timezoneChip, adminRangeDays === days ? styles.selectedChip : null]}
                  onPress={() => setAdminRangeDays(days)}
                >
                  <Text style={styles.chipText}>{days}d</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
              <View style={[styles.optionCard, { flex: 1, minWidth: 160 }]}>
                <Text style={styles.label}>Avg Score</Text>
                <Text style={styles.title}>
                  {orgAdminAnalytics?.orgAvgOverallScore === null || orgAdminAnalytics?.orgAvgOverallScore === undefined
                    ? "-"
                    : orgAdminAnalytics.orgAvgOverallScore.toFixed(1)}
                </Text>
              </View>
              <View style={[styles.optionCard, { flex: 1, minWidth: 160 }]}>
                <Text style={styles.label}>Sessions</Text>
                <Text style={styles.title}>{analyticsSessions}</Text>
              </View>
            </View>

            {orgAdminAnalytics?.generatedAt ? (
              <Text style={styles.body}>Updated: {formatDateLabel(orgAdminAnalytics.generatedAt)}</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Top 5 Scorers</Text>
            <Text style={styles.body}>Averaged over the selected range.</Text>
            {adminLoading && !orgAdminAnalytics ? (
              <View style={styles.centered}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={styles.body}>Loading...</Text>
              </View>
            ) : (orgAdminAnalytics?.topUsers ?? []).length === 0 ? (
              <Text style={styles.body}>(No score data yet.)</Text>
            ) : (
              <View style={{ gap: 10, marginTop: 6 }}>
                {(orgAdminAnalytics?.topUsers ?? []).map((row) => (
                  <View key={row.userId} style={styles.optionCard}>
                    <Text style={styles.optionTitle}>{row.email}</Text>
                    <Text style={styles.body}>
                      Avg score: {row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1)}{"\n"}
                      Sessions: {row.sessions}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Trend</Text>
            <Text style={styles.body}>Daily average score in this range.</Text>
            {adminLoading && !orgAdminAnalytics ? (
              <View style={styles.centered}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={styles.body}>Loading...</Text>
              </View>
            ) : orgAdminAnalytics && orgAdminAnalytics.trendByDay.length > 0 ? (
              <View style={{ gap: 10, marginTop: 6 }}>
                {orgAdminAnalytics.trendByDay.map((row) => {
                  const pct = Math.max(0, Math.min(1, (row.avgOverallScore ?? 0) / 100));
                  return (
                    <View key={row.dayKey} style={{ gap: 6 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                        <Text style={styles.body}>{row.dayKey}</Text>
                        <Text style={styles.body}>
                          {row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1)} ({row.sessions})
                        </Text>
                      </View>
                      <View
                        style={{
                          height: 10,
                          borderRadius: 999,
                          backgroundColor: theme.border,
                          overflow: "hidden",
                        }}
                      >
                        <View
                          style={{
                            width: `${Math.round(pct * 100)}%`,
                            height: "100%",
                            backgroundColor: theme.accent,
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.body}>(No scored sessions yet.)</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>By Role</Text>
            <Text style={styles.body}>Average scores by role segment (and mapped industry).</Text>
            {(orgAdminAnalytics?.bySegment ?? []).length === 0 ? (
              <Text style={styles.body}>(No role data yet.)</Text>
            ) : (
              <View style={{ gap: 10, marginTop: 6 }}>
                {(orgAdminAnalytics?.bySegment ?? []).map((row) => {
                  const industryId = industryIdByRoleSegmentId.get(row.segmentId as unknown as string);
                  const industryLabel = industryId ? INDUSTRY_LABELS[industryId] : null;
                  return (
                    <View key={row.segmentId} style={styles.optionCard}>
                      <Text style={styles.optionTitle}>
                        {industryLabel ? `${industryLabel} - ${row.segmentLabel}` : row.segmentLabel}
                      </Text>
                      <Text style={styles.body}>
                        Avg score: {row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1)}{"\n"}
                        Sessions: {row.sessions}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>By Industry</Text>
            <Text style={styles.body}>Roll-up across roles inside each industry.</Text>
            {byIndustry.length === 0 ? (
              <Text style={styles.body}>(No industry data yet.)</Text>
            ) : (
              <View style={{ gap: 10, marginTop: 6 }}>
                {byIndustry.map((row) => (
                  <View key={row.industryId} style={styles.optionCard}>
                    <Text style={styles.optionTitle}>{row.industryLabel}</Text>
                    <Text style={styles.body}>
                      Avg score: {row.avgOverallScore === null ? "-" : row.avgOverallScore.toFixed(1)}{"\n"}
                      Sessions: {row.sessions}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <Pressable style={styles.primaryButton} onPress={() => setScreen("admin_user_list")}>
            <Text style={styles.primaryButtonText}>Manage Users</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  };

  const renderAdminOrgRequests = () => {
    if (!hasAdminAccess || !user) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Admin access required.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setScreen("home")}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </Pressable>
        </View>
      );
    }

    if (!isOrgAdmin) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Org admin access required.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setScreen("admin_home")}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </Pressable>
        </View>
      );
    }

    const rows = orgAdminAccessRequests?.requests ?? [];
    const pendingRows = rows.filter((row) => row.status === "pending");

    return (
      <View style={styles.fill}>
        <View style={styles.topRow}>
          <Pressable style={styles.ghostButton} onPress={() => setScreen("admin_home")}>
            <Text style={styles.ghostButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.topTitle}>Access Requests</Text>
          <Pressable
            style={[styles.ghostButton, adminLoading ? styles.disabled : null]}
            disabled={adminLoading}
            onPress={() => void refreshOrgAdminAccessRequests()}
          >
            <Text style={styles.ghostButtonText}>{adminLoading ? "Loading..." : "Refresh"}</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {adminError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{adminError}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.title}>
              Pending ({pendingRows.length}) - {orgAdminAccessRequests?.org?.name ?? "Organization"}
            </Text>
            <Text style={styles.body}>
              Org domain: {orgAdminAccessRequests?.org?.emailDomain ?? "-"}{"\n"}
              Join code: {orgAdminAccessRequests?.org?.joinCode ?? "-"}
            </Text>

            {pendingRows.length === 0 ? (
              <Text style={styles.body}>(No pending requests.)</Text>
            ) : (
              <View style={{ gap: 10, marginTop: 6 }}>
                {pendingRows.map((row) => (
                  <View key={row.id} style={styles.optionCard}>
                    <Text style={styles.optionTitle}>{row.email}</Text>
                    <Text style={styles.body}>
                      Requested: {formatDateLabel(row.createdAt)}{"\n"}
                      Expires: {formatDateLabel(row.expiresAt)}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                      <Pressable
                        style={[styles.primaryButton, adminLoading ? styles.disabled : null]}
                        disabled={adminLoading}
                        onPress={() => {
                          void decideOrgAccessRequest(row.id, "approve");
                        }}
                      >
                        <Text style={styles.primaryButtonText}>Approve</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.ghostButton, adminLoading ? styles.disabled : null]}
                        disabled={adminLoading}
                        onPress={() => {
                          void decideOrgAccessRequest(row.id, "reject");
                        }}
                      >
                        <Text style={styles.ghostButtonText}>Reject</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Recent Decisions</Text>
            {(rows.filter((row) => row.status !== "pending").slice(0, 20)).length === 0 ? (
              <Text style={styles.body}>(No completed decisions yet.)</Text>
            ) : (
              <View style={{ gap: 10, marginTop: 6 }}>
                {rows
                  .filter((row) => row.status !== "pending")
                  .slice(0, 20)
                  .map((row) => (
                    <View key={row.id} style={styles.optionCard}>
                      <Text style={styles.optionTitle}>
                        {row.email} - {row.status}
                      </Text>
                      <Text style={styles.body}>
                        Updated: {formatDateLabel(row.updatedAt)}{"\n"}
                        {row.decisionReason ? `Reason: ${row.decisionReason}` : "Reason: -"}
                      </Text>
                    </View>
                  ))}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderAdminUserList = () => {
    if (!hasAdminAccess || !user) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Admin access required.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setScreen("home")}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </Pressable>
        </View>
      );
    }

    const formatRole = (role: string) =>
      (ORG_USER_ROLE_LABELS as unknown as Record<string, string>)[role] ?? role;
    const formatStatus = (status: string) => (status === "disabled" ? "Locked" : "Active");

    const allUsers = orgAdminUsers?.users ?? [];
    const filteredUsers = allUsers.filter((row) => {
      if (adminUserStatusFilter === "active") {
        return row.status === "active";
      }
      if (adminUserStatusFilter === "locked") {
        return row.status !== "active";
      }
      return true;
    });

    const userOptions: SelectOption[] = filteredUsers
      .slice()
      .sort((a, b) => a.email.localeCompare(b.email))
      .map((row) => ({
        value: row.userId,
        label: `${row.email} (${formatRole(row.orgRole)} - ${formatStatus(row.status)})`,
      }));

    const goToUser = (userId: string) => {
      setSelectedAdminUserId(userId);
      setOrgAdminUserDetail(null);
      setAdminError(null);
      setScreen("admin_user_detail");
    };

    return (
      <View style={styles.fill}>
        <View style={styles.topRow}>
          <Pressable style={styles.ghostButton} onPress={() => setScreen("admin_home")}>
            <Text style={styles.ghostButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.topTitle}>Users</Text>
          <Pressable
            style={[styles.ghostButton, adminLoading ? styles.disabled : null]}
            disabled={adminLoading}
            onPress={() => void refreshOrgAdminUsers()}
          >
            <Text style={styles.ghostButtonText}>{adminLoading ? "Loading..." : "Refresh"}</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {adminError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{adminError}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.title}>Select A User</Text>
            <Text style={styles.body}>Search by email, then open their dashboard to review and lock access.</Text>

            <Text style={styles.hintText}>Filter</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {[
                { id: "active" as const, label: "Active" },
                { id: "locked" as const, label: "Locked" },
                { id: "all" as const, label: "All" },
              ].map((option) => (
                <Pressable
                  key={option.id}
                  style={[styles.timezoneChip, adminUserStatusFilter === option.id ? styles.selectedChip : null]}
                  onPress={() => setAdminUserStatusFilter(option.id)}
                >
                  <Text style={styles.chipText}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.hintText}>User</Text>
            <SearchableSelectionDropdown
              value={selectedAdminUserId}
              options={userOptions}
              onChange={(value) => goToUser(value)}
              placeholder="Select user"
              title="User"
              searchPlaceholder="Search by email..."
              styles={styles}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Directory</Text>
            <Text style={styles.body}>Tap a user to open details.</Text>

            {adminLoading && !orgAdminUsers ? (
              <View style={styles.centered}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={styles.body}>Loading users...</Text>
              </View>
            ) : filteredUsers.length === 0 ? (
              <Text style={styles.body}>(No users match this filter.)</Text>
            ) : (
              <View style={{ gap: 10, marginTop: 6 }}>
                {filteredUsers
                  .slice()
                  .sort((a, b) => a.email.localeCompare(b.email))
                  .map((row) => (
                    <Pressable key={row.userId} style={styles.optionCard} onPress={() => goToUser(row.userId)}>
                      <Text style={styles.optionTitle}>{row.email}</Text>
                      <Text style={styles.body}>
                        Role: {formatRole(row.orgRole)}{"\n"}
                        Status: {formatStatus(row.status)}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderAdminUserDetail = () => {
    if (!hasAdminAccess || !user) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Admin access required.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setScreen("home")}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </Pressable>
        </View>
      );
    }

    const targetUserId = selectedAdminUserId.trim();
    if (!targetUserId) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Select a user to view details.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setScreen("admin_user_list")}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </Pressable>
        </View>
      );
    }

    const detail = orgAdminUserDetail?.user?.userId === targetUserId ? orgAdminUserDetail : null;
    const actorIsTarget = user.id === targetUserId;
    const actorIsUserAdmin = user.orgRole === "user_admin";
    const targetIsOrgAdmin = detail ? detail.user.orgRole === "org_admin" : false;
    const locked = detail ? detail.user.status !== "active" : false;
    const roleLabel = detail
      ? (ORG_USER_ROLE_LABELS as unknown as Record<string, string>)[detail.user.orgRole] ?? detail.user.orgRole
      : "-";
    const accessControlsDisabled = actorIsTarget || (actorIsUserAdmin && targetIsOrgAdmin);

    const setLocked = (nextLocked: boolean) => {
      if (adminLoading) {
        return;
      }
      if (actorIsTarget) {
        setAdminError("You cannot lock or unlock your own account.");
        return;
      }
      if (actorIsUserAdmin && targetIsOrgAdmin) {
        setAdminError("User admins cannot lock or unlock org admins.");
        return;
      }
      if (detail && nextLocked === locked) {
        return;
      }
      void setOrgUserLocked(targetUserId, nextLocked);
    };

    return (
      <View style={styles.fill}>
        <View style={styles.topRow}>
          <Pressable style={styles.ghostButton} onPress={() => setScreen("admin_user_list")}>
            <Text style={styles.ghostButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.topTitle}>User</Text>
          <Pressable
            style={[styles.ghostButton, adminLoading ? styles.disabled : null]}
            disabled={adminLoading}
            onPress={() => void refreshOrgAdminUserDetail(targetUserId)}
          >
            <Text style={styles.ghostButtonText}>{adminLoading ? "Loading..." : "Refresh"}</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {adminError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{adminError}</Text>
            </View>
          ) : null}

          {!detail ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={theme.accent} />
              <Text style={styles.body}>Loading user details...</Text>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.label}>User</Text>
                <Text style={styles.title}>{detail.user.email}</Text>
                <Text style={styles.body}>
                  Role: {roleLabel}{"\n"}
                  Status: {detail.user.status === "disabled" ? "Locked" : "Active"}
                </Text>

                <Text style={styles.hintText}>Access</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  <Pressable
                    style={[
                      styles.timezoneChip,
                      !locked ? styles.selectedChip : null,
                      accessControlsDisabled ? styles.disabled : null,
                    ]}
                    disabled={accessControlsDisabled}
                    onPress={() => setLocked(false)}
                  >
                    <Text style={styles.chipText}>Active</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.timezoneChip,
                      locked ? styles.selectedChip : null,
                      accessControlsDisabled ? styles.disabled : null,
                    ]}
                    disabled={accessControlsDisabled}
                    onPress={() => setLocked(true)}
                  >
                    <Text style={styles.chipText}>Locked</Text>
                  </Pressable>
                </ScrollView>
                {actorIsTarget ? (
                  <Text style={styles.body}>You cannot lock yourself out from within the app.</Text>
                ) : actorIsUserAdmin && targetIsOrgAdmin ? (
                  <Text style={styles.body}>User Admins cannot lock or unlock Org Admins.</Text>
                ) : null}
              </View>

              <View style={styles.card}>
                <Text style={styles.title}>Activity</Text>
                <Text style={styles.body}>
                  Range: {formatDateLabel(detail.period.startAt)} to {formatDateLabel(detail.period.endAt)}
                </Text>
                <View style={{ flexDirection: "row", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                  <View style={[styles.optionCard, { flex: 1, minWidth: 160 }]}>
                    <Text style={styles.label}>Sessions</Text>
                    <Text style={styles.title}>{detail.usage.sessions}</Text>
                  </View>
                  <View style={[styles.optionCard, { flex: 1, minWidth: 160 }]}>
                    <Text style={styles.label}>Billed</Text>
                    <Text style={styles.title}>{secondsToWholeMinutes(detail.usage.billedSeconds)}m</Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                  <View style={[styles.optionCard, { flex: 1, minWidth: 160 }]}>
                    <Text style={styles.label}>Avg Score</Text>
                    <Text style={styles.title}>
                      {detail.scores.avgOverallScore === null ? "-" : detail.scores.avgOverallScore.toFixed(1)}
                    </Text>
                  </View>
                  <View style={[styles.optionCard, { flex: 1, minWidth: 160 }]}>
                    <Text style={styles.label}>Scored</Text>
                    <Text style={styles.title}>{detail.scores.sessions}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.title}>Recent Scores</Text>
                <Text style={styles.body}>Most recent scored sessions in the last 30 days.</Text>
                {detail.scores.recent.length === 0 ? (
                  <Text style={styles.body}>(No scored sessions in this period.)</Text>
                ) : (
                  <View style={{ gap: 10, marginTop: 6 }}>
                    {detail.scores.recent.map((row) => (
                      <View key={row.id} style={styles.optionCard}>
                        <Text style={styles.optionTitle}>Score: {row.overallScore}</Text>
                        <Text style={styles.body}>
                          {formatDateLabel(row.endedAt)}{"\n"}
                          Segment: {segmentLabelById.get(row.segmentId) ?? row.segmentId}{"\n"}
                          Scenario: {scenarioTitleById.get(row.scenarioId) ?? row.scenarioId}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    );
  };

  const renderContent = () => {
    if (isBootLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={styles.body}>Loading app...</Text>
        </View>
      );
    }

    if (appError) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{appError}</Text>
          <Pressable style={styles.primaryButton} onPress={() => { void initializeApp(); }}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={() => { void resetSessionToOnboarding(); }}>
            <Text style={styles.ghostButtonText}>Self-Heal Session</Text>
          </Pressable>
        </View>
      );
    }

    if (screen === "onboarding") {
      return renderOnboarding();
    }

    if (screen === "verify_email") {
      return renderVerifyEmail();
    }

    if (screen === "domain_match") {
      return renderDomainMatch();
    }

    if (screen === "simulation" && simulationConfig && user && mobileAuthToken) {
      return (
        <SimulationScreen
          config={simulationConfig}
          userId={user.id}
          authToken={mobileAuthToken}
          onExit={() => {
            setSimulationConfig(null);
            setScreen("setup");
          }}
          onSessionComplete={handleSessionComplete}
        />
      );
    }

    if (screen === "scorecard" && lastCompletedConfig) {
      return (
        <ScorecardView
          title={lastCompletedConfig.scenario.title}
          segmentLabel={lastCompletedConfig.segmentLabel}
          difficulty={lastCompletedConfig.difficulty}
          personaStyle={lastCompletedConfig.personaStyle}
          scorecard={scorecard}
          isLoading={isScoring}
          error={scorecardError}
          transcriptAvailable={Boolean(lastTranscript)}
          onDownloadTranscript={downloadLastTranscript}
          onSubmitSupport={submitSupportFromScore}
          onBack={() => {
            setLastTranscript(null);
            setScreen("setup");
          }}
        />
      );
    }

    if (screen === "usage_dashboard") {
      return renderUsageDashboard();
    }

    if (screen === "admin_home") {
      return renderAdminHome();
    }

    if (screen === "admin_org_dashboard") {
      return renderAdminOrgDashboard();
    }

    if (screen === "admin_org_requests") {
      return renderAdminOrgRequests();
    }

    if (screen === "admin_user_list") {
      return renderAdminUserList();
    }

    if (screen === "admin_user_detail") {
      return renderAdminUserDetail();
    }

    if (screen === "setup") {
      return renderSetup();
    }

    if (screen === "settings") {
      return renderSettings();
    }

    if (screen === "profile") {
      return renderProfile();
    }

    if (screen === "subscription") {
      return renderSubscription();
    }

    return renderHome();
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={statusBarStyle} />
      <LinearGradient colors={[theme.bgTop, theme.bgBottom]} style={styles.gradient}>
        <SafeAreaView style={styles.safeArea}>{renderContent()}</SafeAreaView>
      </LinearGradient>
    </SafeAreaProvider>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    gradient: { flex: 1 },
    safeArea: { flex: 1, paddingHorizontal: 16, paddingBottom: 12 },
    fill: { flex: 1 },
    centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
    topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    spacer: { width: 84 },
    topTitle: { color: theme.text, fontSize: 19, fontWeight: "700" },
    card: { borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.panel, padding: 15, marginBottom: 14, gap: 9 },
    heroCard: {
      borderRadius: 26,
      borderWidth: 1.5,
      borderColor: theme.accent,
      paddingHorizontal: 18,
      paddingVertical: 18,
      marginBottom: 18,
      overflow: "hidden",
      gap: 8,
      shadowColor: theme.accent,
      shadowOpacity: 0.18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 5,
    },
    heroGlowOne: {
      position: "absolute",
      width: 220,
      height: 220,
      borderRadius: 999,
      backgroundColor: "rgba(255, 255, 255, 0.16)",
      top: -110,
      right: -85,
    },
    heroGlowTwo: {
      position: "absolute",
      width: 150,
      height: 150,
      borderRadius: 999,
      backgroundColor: "rgba(53, 194, 255, 0.18)",
      bottom: -60,
      left: -45,
    },
    heroTitle: { color: theme.text, fontSize: 42, fontWeight: "900", lineHeight: 44, letterSpacing: -0.5 },
    heroRule: { width: 118, height: 4, borderRadius: 99, backgroundColor: theme.accent, opacity: 0.88, marginVertical: 2 },
    heroSubtitle: { color: theme.text, fontSize: 21, fontWeight: "800", lineHeight: 26 },
    heroBody: { color: theme.textMuted, fontSize: 14.5, lineHeight: 21 },
    heroChipRow: { flexDirection: "row", gap: 8, marginTop: 4 },
    heroChip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: "rgba(255, 255, 255, 0.28)",
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    heroChipText: { color: theme.text, fontSize: 11.5, fontWeight: "700" },
    segmentCard: { marginTop: 10, borderColor: theme.accent, backgroundColor: theme.currentPlanCardBg },
    segmentLabel: { color: theme.accent, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
    segmentTitle: { color: theme.text, fontSize: 24, fontWeight: "800", lineHeight: 28 },
    title: { color: theme.text, fontSize: 23, fontWeight: "700" },
    label: { color: theme.accent, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
    body: { color: theme.textMuted, fontSize: 14.5, lineHeight: 21 },
    hintText: { color: theme.hint, fontSize: 12, marginTop: 8 },
    sectionTitle: { color: theme.text, fontSize: 19, fontWeight: "700", marginTop: 4, marginBottom: 10 },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 24 },
    ghostButton: { minWidth: 84, height: 38, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", backgroundColor: theme.ghostButtonBg },
    ghostButtonText: { color: theme.text, fontSize: 14, fontWeight: "700" },
    menuButton: { width: 84, height: 38, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", backgroundColor: theme.ghostButtonBg },
    menuButtonText: { color: theme.text, fontSize: 14, fontWeight: "700" },
    menuOverlayRoot: { flex: 1, justifyContent: "flex-start", alignItems: "flex-end", paddingTop: 72, paddingHorizontal: 16 },
    menuOverlayBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.menuOverlayBackdrop },
    menuOverlayCard: { width: "86%", maxWidth: 360, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.menuOverlayCardBg, padding: 12, gap: 6 },
    menuHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
    menuHeading: { color: theme.text, fontSize: 15, fontWeight: "700" },
    menuCloseButton: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", backgroundColor: theme.menuCloseBg },
    menuCloseButtonText: { color: theme.text, fontSize: 13, fontWeight: "700" },
    menuBody: { color: theme.textMuted, fontSize: 13, lineHeight: 18 },
    menuSeparator: { height: 1, backgroundColor: theme.border, marginVertical: 4 },
    menuItemButton: { minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", backgroundColor: theme.menuItemBg, marginTop: 4 },
    menuItemText: { color: theme.text, fontSize: 13, fontWeight: "700" },
    optionCard: { borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.panel, padding: 12, marginBottom: 8, gap: 6 },
    selectedCard: { borderColor: theme.accent, backgroundColor: theme.selectedCardBg },
    currentPlanCard: { borderColor: theme.accent, backgroundColor: theme.currentPlanCardBg },
    planRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    planBadge: { color: theme.planBadgeText, backgroundColor: theme.accent, fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
    optionTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
    input: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.inputBg, color: theme.text, paddingHorizontal: 12, fontSize: 16, marginTop: 8 },
    inlineActionButton: { minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", backgroundColor: theme.inlineButtonBg, paddingHorizontal: 10, marginTop: 8 },
    inlineActionButtonText: { color: theme.text, fontSize: 12.5, fontWeight: "700" },
    dropdownWrapper: { marginTop: 6 },
    dropdownTrigger: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.dropdownBg, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    dropdownValue: { color: theme.text, fontSize: 15, flex: 1, paddingRight: 12 },
    dropdownChevron: { color: theme.dropdownChevron, fontSize: 18, fontWeight: "700" },
    dropdownModalRoot: { flex: 1, justifyContent: "center", paddingHorizontal: 18 },
    dropdownModalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.dropdownModalBackdrop },
    dropdownModalCard: { borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.dropdownModalCardBg, maxHeight: 460, padding: 12 },
    dropdownModalTitle: { color: theme.text, fontSize: 16, fontWeight: "700", marginBottom: 10 },
    dropdownOptionsScroll: { maxHeight: 390 },
    dropdownOptionsContent: { gap: 6 },
    dropdownOption: { borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: theme.dropdownOptionBg },
    dropdownOptionSelected: { borderColor: theme.accent, backgroundColor: theme.dropdownOptionSelectedBg },
    dropdownOptionText: { color: theme.text, fontSize: 13 },
    dropdownOptionTextSelected: { fontWeight: "700" },
    warningCard: { borderRadius: 14, borderWidth: 1, borderColor: theme.warningBorder, backgroundColor: theme.warningBg, padding: 12, marginBottom: 12 },
    warningText: { color: theme.warningText, fontSize: 13.5, lineHeight: 19 },
    errorCard: { borderRadius: 14, borderWidth: 1, borderColor: theme.errorCardBorder, backgroundColor: theme.errorCardBg, padding: 12, marginBottom: 12 },
    errorText: { color: theme.danger, fontSize: 13, marginBottom: 6 },
    successText: { color: theme.success, fontSize: 13, marginBottom: 6 },
    primaryButton: { minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent },
    primaryButtonText: { color: theme.primaryButtonText, fontSize: 16, fontWeight: "800" },
    disabled: { opacity: 0.55 },
    chipRow: { gap: 8, paddingVertical: 8 },
    timezoneChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.dropdownOptionBg },
    selectedChip: { borderColor: theme.accent, backgroundColor: theme.dropdownOptionSelectedBg },
    chipText: { color: theme.text, fontSize: 12, fontWeight: "600" },
    linkButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.linkButtonBg, alignItems: "center", justifyContent: "center", marginTop: 8, paddingHorizontal: 10 },
    linkButtonText: { color: theme.text, fontSize: 13, fontWeight: "700" },
    voiceToggleRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
    voiceToggleButton: { flex: 1, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", backgroundColor: theme.panel },
    voiceToggleText: { color: theme.text, fontSize: 13.5, fontWeight: "700" },
    signOutButton: { marginTop: 6, marginBottom: 18 },
  });
}
