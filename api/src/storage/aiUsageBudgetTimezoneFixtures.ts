// Independent reference: the pre-9F.2B.1 Node date-parts algorithm, with only
// formatter allocation hoisted. Do not use PostgreSQL or the production factory
// as the expected answer in the semantic-equivalence tests.
export function legacyDayKeyFormatter(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (date: Date) => {
    const parts = formatter.formatToParts(date);
    const year = Number(parts.find(p => p.type === "year")?.value ?? "0");
    const month = Number(parts.find(p => p.type === "month")?.value ?? "0");
    const day = Number(parts.find(p => p.type === "day")?.value ?? "0");
    return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  };
}

export const explicitBudgetTimezones = ["+14:00", "-12:00", "+05:30", "+0530", "US/Pacific-New", "Pacific/Kiritimati",
  "America/New_York", "Africa/Casablanca", "Africa/El_Aaiun", "America/Edmonton"];
export const budgetTimezones = [...new Set([...Intl.supportedValuesOf("timeZone"), ...explicitBudgetTimezones,
  "UTC", "GMT", "Etc/UTC", "Etc/GMT+12", "Etc/GMT-14", "US/Eastern", "US/Pacific", "Canada/Mountain",
  "Asia/Calcutta", "Europe/Kiev", "NZ", "GB", "Japan", "Australia/ACT", "Zulu", "+00:00", "-00:00", "+23:45", "-23:45"])]
  .filter(zone => { try { legacyDayKeyFormatter(zone); return true; } catch { return false; } });

export const budgetCutoffs = [
  "2026-03-08T06:59:59.999Z", "2026-03-08T07:00:00Z", "2026-03-08T09:59:59.999Z", "2026-03-08T10:00:00Z",
  "2026-03-29T00:59:59.999Z", "2026-03-29T01:00:00Z", "2026-10-25T00:59:59.999Z", "2026-10-25T01:00:00Z",
  "2026-11-01T04:30:00Z", "2026-11-01T05:30:00Z", "2026-11-01T07:30:00Z", "2026-11-01T08:30:00Z",
  "2026-12-31T23:59:59.999Z", "2027-01-01T00:00:00Z", "2027-01-01T12:00:00Z", "2027-02-07T01:59:59.999Z",
  "2027-02-07T02:00:00Z", "2027-03-07T01:59:59.999Z", "2027-03-07T02:00:00Z", "2027-03-14T08:59:59.999Z",
  "2027-03-14T09:00:00Z", "2027-03-28T00:59:59.999Z", "2027-03-28T01:00:00Z", "2027-04-04T15:00:00Z",
  "2027-07-01T00:00:00Z", "2027-07-01T12:00:00Z", "2027-11-07T07:59:59.999Z", "2027-11-07T08:00:00Z",
  "2027-12-01T00:00:00Z", "2028-02-27T02:00:00Z", "2028-03-26T01:00:00Z", "2028-11-05T08:00:00Z",
];
