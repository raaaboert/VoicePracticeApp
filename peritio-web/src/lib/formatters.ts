import { formatSecondsAsClock } from "@voicepractice/shared";

export function formatUsageMinutes(minutes: number): string {
  return formatSecondsAsClock(Math.max(0, Math.round(minutes * 60)));
}

export function formatRawSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "-";
  }

  return formatSecondsAsClock(Math.round(seconds));
}

export function formatSignedPercent(value: number): string {
  const normalized = Math.round(value * 10) / 10;
  return `${normalized > 0 ? "+" : ""}${normalized}%`;
}

export function formatSignedScore(value: number): string {
  const normalized = Math.round(value * 10) / 10;
  return `${normalized > 0 ? "+" : ""}${normalized}`;
}

export function formatScore(value: number): string {
  return `${Math.round(value)}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}
