export declare function getDatePartsInTimeZone(date: Date, timeZone: string): {
    year: number;
    month: number;
    day: number;
};
export declare function getDayKey(date: Date, timeZone: string): string;
export declare function getMonthKey(date: Date, timeZone: string): string;
export declare function addMonthsKeepingUtcAnchor(isoTimestamp: string, monthsToAdd: number): string;
export declare function computeNextRenewalAt(planAnchorAt: string, now: Date): string;
export declare function computeNextAnnualRenewalAt(anchorAt: string, now: Date): string;
export declare function computeAnnualPeriodBounds(anchorAt: string, now: Date): {
    periodStartAt: string;
    periodEndAt: string;
    nextRenewalAt: string;
};
export declare function humanDailyResetLabel(timeZone: string): string;
