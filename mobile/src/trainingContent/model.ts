import type {
  MobileTrainingContentLibraryResponse,
  MobileTrainingContentSummary,
  UserProfile,
} from "@voicepractice/shared";

export const TRAINING_CONTENT_EMPTY_MESSAGE =
  "No training content is available to you yet.";

export function canRequestTrainingContentModule(user: UserProfile | null): boolean {
  return Boolean(
    user
    && user.accountType === "enterprise"
    && user.orgId
    && user.status === "active"
    && user.emailVerifiedAt
    && user.firstName?.trim()
    && user.lastName?.trim()
    && user.mobileProfileReonboardingRequired !== true
  );
}

export function searchTrainingContent(
  items: readonly MobileTrainingContentSummary[],
  rawQuery: string
): MobileTrainingContentSummary[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) {
    return [...items];
  }
  return items.filter((item) =>
    [
      item.title,
      item.description,
      item.category.name,
      item.relatedFocusTopic ?? "",
    ].some((value) => value.toLocaleLowerCase().includes(query))
  );
}

export function listCategoryItems(
  library: MobileTrainingContentLibraryResponse,
  categoryId: string | null
): MobileTrainingContentSummary[] {
  if (!categoryId) {
    return [...library.items];
  }
  return library.items.filter((item) => item.category.id === categoryId);
}

export function isTrainingContentModuleRemoval(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (
      (error as { code?: unknown }).code === "module_disabled"
      || (error as { code?: unknown }).code === "training_content_access_denied"
    )
  );
}

export function isTrainingContentItemRemoval(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "training_content_not_found"
  );
}

export function trainingContentErrorMessage(
  error: unknown,
  fallback: string
): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "training_content_storage_unavailable") {
      return "This resource is temporarily unavailable. Please try again.";
    }
    if (code === "training_content_asset_not_available") {
      return "This resource is not available right now.";
    }
    if (code === "training_content_not_found") {
      return "This resource is no longer available to you.";
    }
  }
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}
