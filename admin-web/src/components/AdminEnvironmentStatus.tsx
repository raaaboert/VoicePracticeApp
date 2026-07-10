"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ApiEnvironmentMetadata,
  fetchApiEnvironmentMetadata,
  getApiBaseUrl,
} from "../lib/api";
import {
  getConfiguredAdminEnvironment,
  getEnvironmentLabel,
  getShortGitSha,
  isApiBaseLocalhost,
  isBrowserDeployedHost,
  normalizePeritioEnvironment,
} from "../lib/adminEnvironment";

interface AdminEnvironmentStatusProps {
  compact?: boolean;
}

export function AdminEnvironmentStatus({ compact = false }: AdminEnvironmentStatusProps) {
  const apiBaseUrl = getApiBaseUrl();
  const expectedEnvironment = getConfiguredAdminEnvironment(apiBaseUrl);
  const [apiMetadata, setApiMetadata] = useState<ApiEnvironmentMetadata | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [deployedBrowserHost, setDeployedBrowserHost] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDeployedBrowserHost(isBrowserDeployedHost(window.location.hostname));
    }

    let cancelled = false;
    void (async () => {
      try {
        const metadata = await fetchApiEnvironmentMetadata();
        if (!cancelled) {
          setApiMetadata(metadata);
          setMetadataError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setApiMetadata(null);
          setMetadataError(caught instanceof Error ? caught.message : "Could not read API environment metadata.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const apiEnvironment = normalizePeritioEnvironment(apiMetadata?.PERITIO_ENV);
  const warnings = useMemo(() => {
    const nextWarnings: string[] = [];
    if (deployedBrowserHost && isApiBaseLocalhost(apiBaseUrl)) {
      nextWarnings.push("This deployed admin is pointing at localhost. Set API_BASE_URL in Vercel and redeploy.");
    }
    if (apiEnvironment && apiEnvironment !== expectedEnvironment) {
      nextWarnings.push(
        `Admin is configured for ${getEnvironmentLabel(expectedEnvironment)}, but the API reports ${getEnvironmentLabel(apiEnvironment)}.`
      );
    }
    if (metadataError) {
      nextWarnings.push(`API environment check unavailable: ${metadataError}`);
    }
    return nextWarnings;
  }, [apiBaseUrl, apiEnvironment, deployedBrowserHost, expectedEnvironment, metadataError]);

  const expectedLabel = getEnvironmentLabel(expectedEnvironment);
  const apiLabel = apiEnvironment ? getEnvironmentLabel(apiEnvironment) : "unknown";
  const gitSha = getShortGitSha(apiMetadata?.gitSha);

  return (
    <div className={`environment-status ${compact ? "environment-status-compact" : ""}`}>
      <div className="environment-status-main">
        <span className={`environment-pill environment-pill-${expectedEnvironment}`}>
          {expectedLabel}
        </span>
        <span className="environment-api-base">
          <span>API</span>
          <code>{apiBaseUrl}</code>
        </span>
      </div>
      <div className="environment-status-detail">
        {apiMetadata ? (
          <>
            API reports {apiLabel}
            {apiMetadata.NODE_ENV ? ` / NODE_ENV ${apiMetadata.NODE_ENV}` : ""}
            {gitSha !== "unknown" ? ` / commit ${gitSha}` : ""}
          </>
        ) : (
          "Checking API environment metadata..."
        )}
      </div>
      {warnings.length > 0 ? (
        <div className="environment-warnings">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
