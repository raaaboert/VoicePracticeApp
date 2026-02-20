import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { AiVoiceGender, AiVoiceProfile, AppColorScheme, TrainingSegmentId } from "../types";

const ACTIVE_SEGMENT_STORAGE_KEY = "@voice_practice_active_segment";
const USER_ID_STORAGE_KEY = "@voice_practice_user_id";
const MOBILE_AUTH_TOKEN_STORAGE_KEY = "@voice_practice_mobile_auth_token";
const MOBILE_AUTH_TOKEN_SECURE_STORAGE_KEY = "voice_practice_mobile_auth_token";
const COLOR_SCHEME_STORAGE_KEY = "@voice_practice_color_scheme";
const VOICE_PROFILE_STORAGE_KEY = "@voice_practice_voice_profile";
const VOICE_GENDER_STORAGE_KEY = "@voice_practice_voice_gender";
const SECURE_STORE_TIMEOUT_MS = 4_000;

const COLOR_SCHEME_VALUES = ["soft_light", "classic_blue"] as const;
const VOICE_PROFILE_VALUES = ["balanced", "warm", "bright"] as const;
const VOICE_GENDER_VALUES = ["female", "male"] as const;

function canUseSecureStore(): boolean {
  return Platform.OS === "android" || Platform.OS === "ios";
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("Secure storage timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function loadLegacyMobileAuthToken(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(MOBILE_AUTH_TOKEN_STORAGE_KEY);
    return stored && stored.trim() ? stored : null;
  } catch {
    return null;
  }
}

export async function loadActiveSegment(defaultSegmentId: TrainingSegmentId): Promise<TrainingSegmentId> {
  try {
    const storedValue = await AsyncStorage.getItem(ACTIVE_SEGMENT_STORAGE_KEY);
    if (storedValue) {
      return storedValue as TrainingSegmentId;
    }
  } catch {
    // Falls back to default segment if storage cannot be read.
  }

  return defaultSegmentId;
}

export async function saveActiveSegment(segmentId: TrainingSegmentId): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_SEGMENT_STORAGE_KEY, segmentId);
}

export async function loadUserId(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(USER_ID_STORAGE_KEY);
    return stored && stored.trim() ? stored : null;
  } catch {
    return null;
  }
}

export async function saveUserId(userId: string): Promise<void> {
  await AsyncStorage.setItem(USER_ID_STORAGE_KEY, userId);
}

export async function loadMobileAuthToken(): Promise<string | null> {
  if (canUseSecureStore()) {
    try {
      const secureValue = await withTimeout(
        SecureStore.getItemAsync(MOBILE_AUTH_TOKEN_SECURE_STORAGE_KEY),
        SECURE_STORE_TIMEOUT_MS
      );
      if (secureValue && secureValue.trim()) {
        return secureValue;
      }
    } catch {
      // Falls back to legacy AsyncStorage lookup.
    }

    const legacy = await loadLegacyMobileAuthToken();
    if (!legacy) {
      return null;
    }

    try {
      await withTimeout(
        SecureStore.setItemAsync(MOBILE_AUTH_TOKEN_SECURE_STORAGE_KEY, legacy),
        SECURE_STORE_TIMEOUT_MS
      );
      await AsyncStorage.removeItem(MOBILE_AUTH_TOKEN_STORAGE_KEY);
    } catch {
      // If migration fails, still return the legacy value for this session.
    }

    return legacy;
  }

  return loadLegacyMobileAuthToken();
}

export async function saveMobileAuthToken(token: string): Promise<void> {
  if (canUseSecureStore()) {
    try {
      await withTimeout(
        SecureStore.setItemAsync(MOBILE_AUTH_TOKEN_SECURE_STORAGE_KEY, token),
        SECURE_STORE_TIMEOUT_MS
      );
      await AsyncStorage.removeItem(MOBILE_AUTH_TOKEN_STORAGE_KEY);
      return;
    } catch {
      // Falls back to AsyncStorage when secure storage is unavailable or unresponsive.
    }
  }

  await AsyncStorage.setItem(MOBILE_AUTH_TOKEN_STORAGE_KEY, token);
}

export async function clearMobileAuthToken(): Promise<void> {
  if (canUseSecureStore()) {
    await Promise.allSettled([
      withTimeout(
        SecureStore.deleteItemAsync(MOBILE_AUTH_TOKEN_SECURE_STORAGE_KEY),
        SECURE_STORE_TIMEOUT_MS
      ),
      AsyncStorage.removeItem(MOBILE_AUTH_TOKEN_STORAGE_KEY)
    ]);
    return;
  }

  await AsyncStorage.removeItem(MOBILE_AUTH_TOKEN_STORAGE_KEY);
}

export async function clearUserId(): Promise<void> {
  await AsyncStorage.removeItem(USER_ID_STORAGE_KEY);
  await clearMobileAuthToken();
}

export async function loadColorScheme(defaultValue: AppColorScheme = "soft_light"): Promise<AppColorScheme> {
  try {
    const stored = await AsyncStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
    if (stored && COLOR_SCHEME_VALUES.includes(stored as (typeof COLOR_SCHEME_VALUES)[number])) {
      return stored as AppColorScheme;
    }
  } catch {
    // Falls back to default if storage cannot be read.
  }

  return defaultValue;
}

export async function saveColorScheme(value: AppColorScheme): Promise<void> {
  await AsyncStorage.setItem(COLOR_SCHEME_STORAGE_KEY, value);
}

export async function loadVoiceProfile(defaultValue: AiVoiceProfile = "balanced"): Promise<AiVoiceProfile> {
  try {
    const stored = await AsyncStorage.getItem(VOICE_PROFILE_STORAGE_KEY);
    if (stored && VOICE_PROFILE_VALUES.includes(stored as (typeof VOICE_PROFILE_VALUES)[number])) {
      return stored as AiVoiceProfile;
    }
  } catch {
    // Falls back to default if storage cannot be read.
  }

  return defaultValue;
}

export async function saveVoiceProfile(value: AiVoiceProfile): Promise<void> {
  await AsyncStorage.setItem(VOICE_PROFILE_STORAGE_KEY, value);
}

export async function loadVoiceGender(defaultValue: AiVoiceGender = "female"): Promise<AiVoiceGender> {
  try {
    const stored = await AsyncStorage.getItem(VOICE_GENDER_STORAGE_KEY);
    if (stored && VOICE_GENDER_VALUES.includes(stored as (typeof VOICE_GENDER_VALUES)[number])) {
      return stored as AiVoiceGender;
    }
  } catch {
    // Falls back to default if storage cannot be read.
  }

  return defaultValue;
}

export async function saveVoiceGender(value: AiVoiceGender): Promise<void> {
  await AsyncStorage.setItem(VOICE_GENDER_STORAGE_KEY, value);
}
