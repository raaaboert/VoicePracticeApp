export function getDatePartsInTimeZone(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");

  return { year, month, day };
}

export function getDayKey(date: Date, timeZone: string): string {
  const parts = getDatePartsInTimeZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getMonthKey(date: Date, timeZone: string): string {
  const parts = getDatePartsInTimeZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

export function addMonthsKeepingUtcAnchor(isoTimestamp: string, monthsToAdd: number): string {
  const date = new Date(isoTimestamp);
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + monthsToAdd);
  return copy.toISOString();
}

export function computeNextRenewalAt(planAnchorAt: string, now: Date): string {
  let candidate = planAnchorAt;

  while (new Date(candidate).getTime() <= now.getTime()) {
    candidate = addMonthsKeepingUtcAnchor(candidate, 1);
  }

  return candidate;
}

export function computeNextAnnualRenewalAt(anchorAt: string, now: Date): string {
  let candidate = anchorAt;

  while (new Date(candidate).getTime() <= now.getTime()) {
    candidate = addMonthsKeepingUtcAnchor(candidate, 12);
  }

  return candidate;
}

export function computeAnnualPeriodBounds(anchorAt: string, now: Date): {
  periodStartAt: string;
  periodEndAt: string;
  nextRenewalAt: string;
} {
  const nextRenewalAt = computeNextAnnualRenewalAt(anchorAt, now);
  const periodStartAt = addMonthsKeepingUtcAnchor(nextRenewalAt, -12);
  return {
    periodStartAt,
    periodEndAt: nextRenewalAt,
    nextRenewalAt
  };
}

export function humanDailyResetLabel(timeZone: string): string {
  const now = new Date();
  return `Resets daily at 12:00 AM (${timeZone})`;
}
