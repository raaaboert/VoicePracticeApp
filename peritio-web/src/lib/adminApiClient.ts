export class AdminApiClientError extends Error {
  status: number | null;
  code: string | null;
  url: string;
  details: Record<string, unknown> | null;

  constructor(params: {
    message: string;
    status: number | null;
    code?: string | null;
    url: string;
    details?: Record<string, unknown> | null;
  }) {
    super(params.message);
    this.name = "AdminApiClientError";
    this.status = params.status;
    this.code = params.code ?? null;
    this.url = params.url;
    this.details = params.details ?? null;
  }
}

async function readResponsePayload(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function errorMessageForResponse(response: Response, payload: Record<string, unknown> | null): string {
  const serverMessage = typeof payload?.error === "string" && payload.error.trim()
    ? payload.error.trim()
    : `Request failed`;
  return `${serverMessage} (${response.status}).`;
}

export async function fetchAdminApiResponse(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new AdminApiClientError({
      message: `The admin request to ${url} did not receive an HTTP response. Check your connection and retry.`,
      status: null,
      url,
    });
  }
}

export async function assertAdminApiOk(response: Response, url: string): Promise<void> {
  if (response.ok) {
    return;
  }

  const payload = await readResponsePayload(response);
  throw new AdminApiClientError({
    message: errorMessageForResponse(response, payload),
    status: response.status,
    code: typeof payload?.code === "string" ? payload.code : null,
    details: payload,
    url,
  });
}

export async function readAdminApiJson<T>(response: Response, url: string): Promise<T> {
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new AdminApiClientError({
      message: errorMessageForResponse(response, payload),
      status: response.status,
      code: typeof payload?.code === "string" ? payload.code : null,
      details: payload,
      url,
    });
  }

  return payload as T;
}

export async function fetchAdminApiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchAdminApiResponse(url, init);
  return readAdminApiJson<T>(response, url);
}

export function getDownloadFilenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) {
    return fallback;
  }

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }

  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}
