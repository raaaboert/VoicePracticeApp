import { USAGE_BILLING_INCREMENT_SECONDS } from "./contracts.js";
export function calculateBilledSecondsFromRaw(rawSeconds) {
    const safeRaw = Math.max(0, Math.floor(rawSeconds));
    return Math.floor(safeRaw / USAGE_BILLING_INCREMENT_SECONDS) * USAGE_BILLING_INCREMENT_SECONDS;
}
export function sumRawSeconds(values) {
    return values.reduce((total, item) => total + Math.max(0, Math.floor(item.rawDurationSeconds)), 0);
}
