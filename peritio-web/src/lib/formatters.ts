import { formatSecondsAsClock } from "@voicepractice/shared";

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

  const dateKey = formatDateKey(value);
  if (dateKey) {
    return dateKey;
  }

  if (DATE_KEY_PATTERN.test(value)) {
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

function formatDateKey(value: string): string | null {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth
  ) {
    return null;
  }
  return `${MONTH_LABELS[month - 1]} ${String(day).padStart(2, "0")}, ${year}`;
}
