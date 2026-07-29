import { useCallback, useEffect, useRef, useState } from "react";

import type { MobileTrainingContentAssetAccessResponse } from "@voicepractice/shared";

import { fetchTrainingContentAssetAccess } from "./api";
import {
  isTrainingContentItemRemoval,
  isTrainingContentModuleRemoval,
  trainingContentErrorMessage,
} from "./model";

type AssetAccess = MobileTrainingContentAssetAccessResponse["access"];

export function useTrainingContentAssetAccess(params: {
  userId: string;
  contentId: string;
  authToken: string;
  onModuleRemoved: (message: string) => void;
  onItemRemoved: (message: string) => void;
}) {
  const [access, setAccess] = useState<AssetAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchTrainingContentAssetAccess(
        params.userId,
        params.contentId,
        params.authToken
      );
      if (requestGeneration.current === generation) {
        setAccess(response.access);
      }
    } catch (caught) {
      if (requestGeneration.current !== generation) {
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
      if (requestGeneration.current === generation) {
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
      requestGeneration.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!access) {
      return;
    }
    const expiresAtMs = new Date(access.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }
    const refreshInMs = Math.max(1_000, expiresAtMs - Date.now() - 15_000);
    const timer = setTimeout(() => {
      void load();
    }, refreshInMs);
    return () => clearTimeout(timer);
  }, [access, load]);

  return { access, loading, error, refresh: load };
}
