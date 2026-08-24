import type {
  MobileModuleAvailabilityResponse,
  MobileRelatedPracticeScenariosResponse,
  MobileTrainingContentAssetAccessResponse,
  MobileTrainingContentDetailResponse,
  MobileTrainingContentLibraryResponse,
} from "@voicepractice/shared";

import { requestJson } from "../lib/api";
import { relatedTrainingContentPath } from "./relatedTrainingContent";
import { relatedPracticeScenariosPath } from "./relatedPracticeScenarios";

function userPath(userId: string): string {
  return `/mobile/users/${encodeURIComponent(userId)}`;
}

export function fetchMobileModules(
  userId: string,
  authToken: string
): Promise<MobileModuleAvailabilityResponse> {
  return requestJson<MobileModuleAvailabilityResponse>(
    `${userPath(userId)}/modules`,
    { method: "GET" },
    authToken
  );
}

export function fetchTrainingContentLibrary(
  userId: string,
  authToken: string
): Promise<MobileTrainingContentLibraryResponse> {
  return requestJson<MobileTrainingContentLibraryResponse>(
    `${userPath(userId)}/training-content`,
    { method: "GET" },
    authToken
  );
}

export function fetchRelatedTrainingContent(
  userId: string,
  scenarioId: string,
  authToken: string,
  trainingId?: string | null
): Promise<MobileTrainingContentLibraryResponse> {
  return requestJson<MobileTrainingContentLibraryResponse>(
    relatedTrainingContentPath(userId, scenarioId, trainingId),
    { method: "GET" },
    authToken
  );
}

export function fetchTrainingContentDetail(
  userId: string,
  contentId: string,
  authToken: string
): Promise<MobileTrainingContentDetailResponse> {
  return requestJson<MobileTrainingContentDetailResponse>(
    `${userPath(userId)}/training-content/${encodeURIComponent(contentId)}`,
    { method: "GET" },
    authToken
  );
}

export function fetchRelatedPracticeScenarios(
  userId: string,
  contentId: string,
  authToken: string
): Promise<MobileRelatedPracticeScenariosResponse> {
  return requestJson<MobileRelatedPracticeScenariosResponse>(
    relatedPracticeScenariosPath(userId, contentId),
    { method: "GET" },
    authToken
  );
}

export function fetchTrainingContentAssetAccess(
  userId: string,
  contentId: string,
  authToken: string
): Promise<MobileTrainingContentAssetAccessResponse> {
  return requestJson<MobileTrainingContentAssetAccessResponse>(
    `${userPath(userId)}/training-content/${encodeURIComponent(contentId)}/asset-access`,
    { method: "POST" },
    authToken
  );
}
