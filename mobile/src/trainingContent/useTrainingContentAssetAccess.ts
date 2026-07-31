import { useCallback, useEffect, useRef, useState } from "react";

import type { MobileTrainingContentAssetAccessResponse } from "@voicepractice/shared";

import { fetchTrainingContentAssetAccess } from "./api";
import {
  isTrainingContentItemRemoval,
  isTrainingContentModuleRemoval,
  trainingContentErrorMessage,
} from "./model";
import {
  activateViewerRequestLifecycle,
  beginViewerRequest,
  cancelViewerRequests,
  createViewerRequestLifecycle,
  disposeViewerRequestLifecycle,
  getAssetAccessRenewalDelayMs,
  isViewerRequestCurrent,
} from "./nativeViewerLifecycle";

type AssetAccess = MobileTrainingContentAssetAccessResponse["access"];

export function useTrainingContentAssetAccess(params: {
  userId: string;
  contentId: string;
  authToken: string;
  onModuleRemoved: (message: string) => void;
  onItemRemoved: (message: string) => void;
}) {
  const [access, setAccess] = useState<AssetAccess | null>(null);
  const [accessRevision, setAccessRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestLifecycle = useRef(createViewerRequestLifecycle());

  useEffect(() => {
    activateViewerRequestLifecycle(requestLifecycle.current);
    return () => {
      disposeViewerRequestLifecycle(requestLifecycle.current);
    };
  }, []);

  const load = useCallback(async () => {
    const generation = beginViewerRequest(requestLifecycle.current);
    if (generation === null) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchTrainingContentAssetAccess(
        params.userId,
        params.contentId,
        params.authToken
      );
      if (isViewerRequestCurrent(requestLifecycle.current, generation)) {
        setAccess(response.access);
        setAccessRevision((current) => current + 1);
      }
    } catch (caught) {
      if (!isViewerRequestCurrent(requestLifecycle.current, generation)) {
        return;
      }
      setAccess(null);
      const message = trainingContentErrorMessage(
        caught,
        "This resource could not be opened."
      );
      if (isTrainingContentModuleRemoval(caught)) {
        params.onModuleRemoved(message);
        return;
      }
      if (isTrainingContentItemRemoval(caught)) {
        params.onItemRemoved(message);
        return;
      }
      setError(message);
    } finally {
      if (isViewerRequestCurrent(requestLifecycle.current, generation)) {
        setLoading(false);
      }
    }
  }, [
    params.authToken,
    params.contentId,
    params.onItemRemoved,
    params.onModuleRemoved,
    params.userId,
  ]);

  useEffect(() => {
    void load();
    return () => {
      cancelViewerRequests(requestLifecycle.current);
    };
  }, [load]);

  useEffect(() => {
    if (!access) {
      return;
    }
    const refreshInMs = getAssetAccessRenewalDelayMs(access.expiresAt);
    if (refreshInMs === null) {
      return;
    }
    const timer = setTimeout(() => {
      void load();
    }, refreshInMs);
    return () => clearTimeout(timer);
  }, [access, load]);

  return { access, accessRevision, loading, error, refresh: load };
}
