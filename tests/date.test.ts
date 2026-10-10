import { describe, expect, it } from "vitest";
import {
  calculateExpiryDate,
  diffDays,
  isExpiredInLastDays,
  memberStatus,
  nextRenewalStartFromExpiry
} from "../src/shared/date";

describe("membership date calculations", () => {
  it("calculates one calendar month inclusively", () => {
    expect(calculateExpiryDate("2026-05-01", "monthly", 1)).toBe("2026-05-31");
    expect(calculateExpiryDate("2026-05-15", "monthly", 1)).toBe("2026-06-14");
  });

  it("calculates standard calendar-month plans", () => {
    expect(calculateExpiryDate("2026-05-01", "quarterly", 3)).toBe("2026-07-31");
    expect(calculateExpiryDate("2026-05-01", "half_yearly", 6)).toBe("2026-10-31");
    expect(calculateExpiryDate("2026-05-01", "yearly", 12)).toBe("2027-04-30");
  });

  it("handles custom day-based duration with inclusive expiry", () => {
    expect(calculateExpiryDate("2026-05-01", "custom_days", 30)).toBe("2026-05-30");
  });

  it("handles month-end and leap-year February safely", () => {
    expect(calculateExpiryDate("2024-01-31", "monthly", 1)).toBe("2024-02-29");
    expect(calculateExpiryDate("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(calculateExpiryDate("2024-02-29", "yearly", 12)).toBe("2025-02-28");
  });

  it("keeps memberships active through expiry date", () => {
    expect(memberStatus("2026-10-11", "2026-10-11", 10)).toBe("expiring");
    expect(memberStatus("2026-10-10", "2026-10-11", 10)).toBe("expired");
  });

  it("applies upcoming and expired dashboard boundaries", () => {
    expect(memberStatus("2026-10-21", "2026-10-11", 10)).toBe("expiring");
    expect(memberStatus("2026-10-22", "2026-10-11", 10)).toBe("active");
    expect(isExpiredInLastDays("2026-09-11", "2026-10-11", 30)).toBe(true);
    expect(isExpiredInLastDays("2026-09-10", "2026-10-11", 30)).toBe(false);
  });

  it("supports renewal from previous expiry and today/custom choices", () => {
    expect(nextRenewalStartFromExpiry("2026-05-31")).toBe("2026-06-01");
    expect(diffDays("2026-05-31", "2026-06-01")).toBe(1);
  });
});
