import type { DurationType, MemberStatus } from "./types";

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateOnly(value: string): void {
  if (!ISO_DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Invalid date-only value: ${value}`);
  }
}

export function todayInTimeZone(timeZone = "Asia/Kolkata", now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function toUtcDate(value: string): Date {
  assertDateOnly(value);
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysInMonth(year: number, monthOneBased: number): number {
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();
}

function addDays(value: string, days: number): string {
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtcDate(date);
}

export function diffDays(from: string, to: string): number {
  const fromMs = toUtcDate(from).getTime();
  const toMs = toUtcDate(to).getTime();
  return Math.round((toMs - fromMs) / 86_400_000);
}

export function addCalendarMonthsExclusiveBoundary(startDate: string, months: number): string {
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error("Calendar-month duration must be a positive integer.");
  }

  const start = toUtcDate(startDate);
  const originalDay = start.getUTCDate();
  const targetMonthIndex = start.getUTCMonth() + months;
  const targetYear = start.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonthZeroBased = ((targetMonthIndex % 12) + 12) % 12;
  const targetMonthOneBased = targetMonthZeroBased + 1;
  const targetMonthDays = daysInMonth(targetYear, targetMonthOneBased);

  if (originalDay <= targetMonthDays) {
    return fromUtcDate(new Date(Date.UTC(targetYear, targetMonthZeroBased, originalDay)));
  }

  return fromUtcDate(new Date(Date.UTC(targetYear, targetMonthZeroBased + 1, 1)));
}

export function calculateExpiryDate(startDate: string, durationType: DurationType, durationValue: number): string {
  assertDateOnly(startDate);
  const calendarMonthsByType: Partial<Record<DurationType, number>> = {
    monthly: 1,
    quarterly: 3,
    half_yearly: 6,
    yearly: 12
  };

  if (durationType === "custom_days") {
    if (!Number.isInteger(durationValue) || durationValue <= 0) {
      throw new Error("Custom day duration must be a positive integer.");
    }
    return addDays(startDate, durationValue - 1);
  }

  const months = durationType === "custom_months" ? durationValue : calendarMonthsByType[durationType];
  if (!months || !Number.isInteger(months) || months <= 0) {
    throw new Error("Calendar-month duration must be a positive integer.");
  }
  return addDays(addCalendarMonthsExclusiveBoundary(startDate, months), -1);
}

export function defaultDurationValue(durationType: DurationType, explicitValue?: number): number {
  if (durationType === "monthly") return 1;
  if (durationType === "quarterly") return 3;
  if (durationType === "half_yearly") return 6;
  if (durationType === "yearly") return 12;
  return explicitValue && explicitValue > 0 ? explicitValue : 1;
}

export function memberStatus(
  expiryDate: string,
  today: string,
  warningDays: number,
  archivedAt?: string | null
): MemberStatus {
  if (archivedAt) return "archived";
  const daysUntilExpiry = diffDays(today, expiryDate);
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry <= warningDays) return "expiring";
  return "active";
}

export function isExpiredInLastDays(expiryDate: string, today: string, days: number): boolean {
  const age = diffDays(expiryDate, today);
  return age >= 1 && age <= days;
}

export function nextRenewalStartFromExpiry(expiryDate: string): string {
  return addDays(expiryDate, 1);
}

export function formatDateForDisplay(value: string): string {
  if (!value) return "";
  assertDateOnly(value);
  const date = toUtcDate(value);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export function nowIso(): string {
  return new Date().toISOString();
}
