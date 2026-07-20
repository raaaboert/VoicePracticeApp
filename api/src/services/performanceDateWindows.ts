import { getDatePartsInTimeZone } from "@voicepractice/shared";

export interface PlanWindowInput {
  startDate: string;
  endDate: string;
  timeZone: string;
  effectiveAt: string;
  capAt?: string | null;
}

export interface PlanWindow {
  startAt: string;
  endAt: string;
  planStartAt: string;
  planEndAt: string;
}

export interface BaselineWindow {
  startAt: string;
  endAt: string;
}

export interface PlanWeekWindow {
  index: number;
  startAt: string;
  endAt: string;
  includedStartAt: string;
  includedEndAt: string;
  proratedFraction: number;
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function assertValidIanaTimeZone(timeZone: string): void {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error("A valid IANA timezone is required.");
  }
}

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseDateKey(value: string): { year: number; month: number; day: number } {
  if (!isDateKey(value)) {
    throw new Error("Date must use YYYY-MM-DD format.");
  }
  const [year, month, day] = value.split("-").map((entry) => Number(entry));
  if (!isValidLocalDate(year, month, day)) {
    throw new Error("Date is not a valid calendar day.");
  }
  return { year, month, day };
}

export function compareDateKeys(left: string, right: string): number {
  parseDateKey(left);
  parseDateKey(right);
  return left.localeCompare(right);
}

export function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = getDatePartsInTimeZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addDaysToDateKey(dateKey: string, daysToAdd: number): string {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return date.toISOString().slice(0, 10);
}

export function localDateMidnightToUtc(dateKey: string, timeZone: string): Date {
  const parts = parseDateKey(dateKey);
  return localDateTimeToUtc(
    {
      ...parts,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0
    },
    timeZone
  );
}

export function buildPlanWindow(input: PlanWindowInput): PlanWindow {
  assertValidIanaTimeZone(input.timeZone);
  if (compareDateKeys(input.startDate, input.endDate) > 0) {
    throw new Error("Plan start date must be on or before end date.");
  }

  const planStart = localDateMidnightToUtc(input.startDate, input.timeZone);
  const planEnd = localDateMidnightToUtc(addDaysToDateKey(input.endDate, 1), input.timeZone);
  const effectiveAt = parseIsoDate(input.effectiveAt, "effectiveAt");
  const capAt = input.capAt ? parseIsoDate(input.capAt, "capAt") : null;
  const startAt = new Date(Math.max(planStart.getTime(), effectiveAt.getTime()));
  const endAt = new Date(Math.min(planEnd.getTime(), capAt?.getTime() ?? planEnd.getTime()));

  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    planStartAt: planStart.toISOString(),
    planEndAt: planEnd.toISOString()
  };
}

export function buildBaselineWindow(params: {
  effectiveAt: string;
  timeZone: string;
  comparisonMonthCount: 1 | 2 | 3 | 6;
}): BaselineWindow {
  assertValidIanaTimeZone(params.timeZone);
  const effectiveAt = parseIsoDate(params.effectiveAt, "effectiveAt");
  const localParts = getLocalDateTimeParts(effectiveAt, params.timeZone);
  const startLocalParts = addMonthsClamped(localParts, -params.comparisonMonthCount);
  return {
    startAt: localDateTimeToUtc(startLocalParts, params.timeZone).toISOString(),
    endAt: effectiveAt.toISOString()
  };
}

export function buildPlanWeekWindows(params: {
  startDate: string;
  endDate: string;
  timeZone: string;
  effectiveAt: string;
  capAt: string;
}): PlanWeekWindow[] {
  const window = buildPlanWindow({
    startDate: params.startDate,
    endDate: params.endDate,
    timeZone: params.timeZone,
    effectiveAt: params.effectiveAt,
    capAt: params.capAt
  });
  const planEndMs = new Date(window.planEndAt).getTime();
  const windowStartMs = new Date(window.startAt).getTime();
  const windowEndMs = new Date(window.endAt).getTime();
  const windows: PlanWeekWindow[] = [];
  let weekStartDate = params.startDate;
  let index = 0;

  while (true) {
    const weekStart = localDateMidnightToUtc(weekStartDate, params.timeZone);
    if (weekStart.getTime() >= planEndMs) {
      break;
    }
    const weekEndDate = addDaysToDateKey(weekStartDate, 7);
    const weekEnd = localDateMidnightToUtc(weekEndDate, params.timeZone);
    const boundedWeekEndMs = Math.min(weekEnd.getTime(), planEndMs);
    const includedStartMs = Math.max(weekStart.getTime(), windowStartMs);
    const includedEndMs = Math.min(boundedWeekEndMs, windowEndMs);
    if (includedEndMs > includedStartMs) {
      windows.push({
        index,
        startAt: weekStart.toISOString(),
        endAt: new Date(boundedWeekEndMs).toISOString(),
        includedStartAt: new Date(includedStartMs).toISOString(),
        includedEndAt: new Date(includedEndMs).toISOString(),
        proratedFraction: Math.max(0, Math.min(1, (includedEndMs - includedStartMs) / (weekEnd.getTime() - weekStart.getTime())))
      });
    }
    weekStartDate = weekEndDate;
    index += 1;
  }

  return windows;
}

function parseIsoDate(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  return parsed;
}

function isValidLocalDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonthsClamped(parts: LocalDateTimeParts, monthsToAdd: number): LocalDateTimeParts {
  const monthIndex = parts.month - 1 + monthsToAdd;
  const candidate = new Date(Date.UTC(parts.year, monthIndex, 1));
  const year = candidate.getUTCFullYear();
  const month = candidate.getUTCMonth() + 1;
  const day = Math.min(parts.day, daysInMonth(year, month));
  return {
    ...parts,
    year,
    month,
    day
  };
}

function getLocalDateTimeParts(date: Date, timeZone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    millisecond: date.getUTCMilliseconds()
  };
}

function getOffsetMs(date: Date, timeZone: string): number {
  const local = getLocalDateTimeParts(date, timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.millisecond);
  return asUtc - date.getTime();
}

function localDateTimeToUtc(parts: LocalDateTimeParts, timeZone: string): Date {
  assertValidIanaTimeZone(timeZone);
  let utcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );
  for (let index = 0; index < 4; index += 1) {
    utcMs =
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond) -
      getOffsetMs(new Date(utcMs), timeZone);
  }
  return new Date(utcMs);
}
