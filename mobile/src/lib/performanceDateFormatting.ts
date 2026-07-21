const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatPerformanceDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const dateKeyLabel = formatDateKey(value, false);
  if (dateKeyLabel) {
    return dateKeyLabel;
  }
  if (DATE_KEY_PATTERN.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function getRemainingPerformancePlanDays(endDate: string, now: Date = new Date()): number | null {
  const end = parseDateKeyToLocalEndOfDay(endDate);
  if (!end) {
    return null;
  }
  const remainingMs = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

function parseDateKeyToLocalEndOfDay(value: string): Date | null {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateKeyParts(year, month, day)) {
    return null;
  }
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function formatDateKey(value: string, padDay: boolean): string | null {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateKeyParts(year, month, day)) {
    return null;
  }
  return `${MONTH_LABELS[month - 1]} ${padDay ? String(day).padStart(2, "0") : day}, ${year}`;
}

function isValidDateKeyParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}
