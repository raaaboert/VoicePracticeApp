import AsyncStorage from "@react-native-async-storage/async-storage";

const AI_PROCESSING_CONSENT_KEY_PREFIX = "@voice_practice_ai_processing_consent_v1:";

export interface AiProcessingConsentStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function getAiProcessingConsentStorageKey(userId: string): string {
  return `${AI_PROCESSING_CONSENT_KEY_PREFIX}${encodeURIComponent(userId.trim())}`;
}

export async function hasAiProcessingConsent(
  userId: string,
  storage: AiProcessingConsentStorage = AsyncStorage,
): Promise<boolean> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return false;
  }
  try {
    return await storage.getItem(getAiProcessingConsentStorageKey(normalizedUserId)) === "accepted";
  } catch {
    return false;
  }
}

export async function recordAiProcessingConsent(
  userId: string,
  storage: AiProcessingConsentStorage = AsyncStorage,
): Promise<void> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("A user is required to record AI processing consent.");
  }
  await storage.setItem(getAiProcessingConsentStorageKey(normalizedUserId), "accepted");
}

export async function clearAiProcessingConsent(
  userId: string,
  storage: AiProcessingConsentStorage = AsyncStorage,
): Promise<void> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return;
  }
  await storage.removeItem(getAiProcessingConsentStorageKey(normalizedUserId));
}
