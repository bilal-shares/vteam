import { describe, expect, it } from "vitest";
import { calculatePaymentStatus, formatInr, rupeesToPaise } from "../src/shared/money";
import { normalizePhone, phoneForWhatsApp } from "../src/shared/phone";
import { durationText, renderReminderTemplate, whatsappUrl } from "../src/shared/reminders";

describe("phone normalization", () => {
  it("normalizes Indian numbers by default", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("91-98765-43210")).toBe("+919876543210");
  });

  it("keeps intentional international numbers", () => {
    expect(normalizePhone("+1 202 555 0198")).toBe("+12025550198");
    expect(phoneForWhatsApp("+1 202 555 0198")).toBe("12025550198");
  });
});

describe("money and payment status", () => {
  it("stores INR as integer paise", () => {
    expect(rupeesToPaise("1000")).toBe(100000);
    expect(rupeesToPaise("99.50")).toBe(9950);
    expect(formatInr(100000)).toContain("1,000");
  });

  it("calculates outstanding statuses", () => {
    expect(calculatePaymentStatus(100000, 0)).toBe("unpaid");
    expect(calculatePaymentStatus(100000, 50000)).toBe("partial");
    expect(calculatePaymentStatus(100000, 100000)).toBe("paid");
  });
});

describe("reminder rendering", () => {
  it("interpolates member data into templates", () => {
    const message = renderReminderTemplate("Hello {name}, {duration} expires on {expiry_date}. Pay {amount} to {gym_name}.", {
      name: "Asha",
      normalizedMobile: "+919876543210",
      durationType: "monthly",
      durationValue: 1,
      startDate: "2026-05-01",
      expiryDate: "2026-05-31",
      amountPaise: 100000,
      gymName: "V Team"
    });
    expect(message).toContain("Asha");
    expect(message).toContain("monthly");
    expect(message).toContain("31 May 2026");
    expect(message).toContain("V Team");
  });

  it("builds encoded WhatsApp click-to-chat URLs", () => {
    const url = whatsappUrl("+91 98765 43210", "Hello Asha\nRenew now");
    expect(url).toBe("https://wa.me/919876543210?text=Hello%20Asha%0ARenew%20now");
  });

  it("describes custom durations clearly", () => {
    expect(durationText("custom_days", 45)).toBe("45 day");
    expect(durationText("custom_months", 2)).toBe("2 month");
  });
});
