import { z } from "zod";
import { defaultDurationValue } from "./date";
import { normalizePhone } from "./phone";
import type { DurationType } from "./types";

export const durationTypeSchema = z.enum([
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
  "custom_days",
  "custom_months"
]);

export const paymentMethodSchema = z.enum(["cash", "upi", "bank_transfer", "card", "other"]);
export const transactionTypeSchema = z.enum(["membership_payment", "renewal_payment", "correction", "refund"]);
export const reminderTypeSchema = z.enum(["expired", "upcoming", "renewal"]);

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const loginSchema = z.object({
  username: z.string().trim().min(2).max(80),
  password: z.string().min(8).max(256)
});

export const setupSchema = loginSchema.extend({
  setupSecret: z.string().min(16).max(512)
});

const memberBaseSchema = z.object({
  full_name: z.string().trim().min(2).max(140),
  mobile_number: z.string().trim().min(6).max(32).transform((value, ctx) => {
    try {
      normalizePhone(value);
      return value.trim();
    } catch (error) {
      ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid mobile number." });
      return z.NEVER;
    }
  }),
  email: z.string().trim().email().max(160).optional().or(z.literal("")).transform((value) => value || null),
  gender: z.string().trim().max(40).optional().or(z.literal("")).transform((value) => value || null),
  joining_date: dateOnlySchema,
  duration_type: durationTypeSchema,
  duration_value: z.coerce.number().int().positive().max(3650).optional(),
  membership_start_date: dateOnlySchema,
  membership_price_paise: z.coerce.number().int().min(0).max(99_999_999),
  notes: z.string().trim().max(2000).optional().or(z.literal("")).transform((value) => value || null),
  initial_payment_paise: z.coerce.number().int().min(0).max(99_999_999).default(0),
  payment_method: paymentMethodSchema.default("cash"),
  allow_duplicate_mobile: z.boolean().default(false)
});

export const memberInputSchema = memberBaseSchema.transform((value) => ({
  ...value,
  normalized_mobile: normalizePhone(value.mobile_number),
  duration_value: defaultDurationValue(value.duration_type as DurationType, value.duration_value)
}));

export const memberUpdateSchema = memberBaseSchema.omit({
  initial_payment_paise: true,
  payment_method: true,
  allow_duplicate_mobile: true
}).partial({
  duration_type: true,
  duration_value: true,
  joining_date: true,
  membership_start_date: true,
  membership_price_paise: true
}).transform((value) => ({
  ...value,
  normalized_mobile: value.mobile_number ? normalizePhone(value.mobile_number) : undefined,
  duration_value: value.duration_type ? defaultDurationValue(value.duration_type as DurationType, value.duration_value) : value.duration_value
}));

export const renewSchema = z.object({
  start_mode: z.enum(["after_expiry", "today", "custom"]),
  custom_start_date: dateOnlySchema.optional(),
  duration_type: durationTypeSchema,
  duration_value: z.coerce.number().int().positive().max(3650).optional(),
  membership_price_paise: z.coerce.number().int().min(0).max(99_999_999),
  payment_paise: z.coerce.number().int().min(0).max(99_999_999).default(0),
  payment_method: paymentMethodSchema.default("cash"),
  reference: z.string().trim().max(160).optional().or(z.literal("")).transform((value) => value || null)
}).transform((value) => ({
  ...value,
  duration_value: defaultDurationValue(value.duration_type as DurationType, value.duration_value)
}));

export const transactionSchema = z.object({
  member_id: z.string().min(8),
  membership_id: z.string().min(8).optional().or(z.literal("")).transform((value) => value || null),
  amount_paise: z.coerce.number().int().min(1).max(99_999_999),
  transaction_date: dateOnlySchema,
  payment_method: paymentMethodSchema,
  transaction_type: transactionTypeSchema,
  reference: z.string().trim().max(160).optional().or(z.literal("")).transform((value) => value || null),
  note: z.string().trim().max(500).optional().or(z.literal("")).transform((value) => value || null)
});

export const settingsSchema = z.object({
  gym_name: z.string().trim().min(2).max(120),
  contact_number: z.string().trim().max(32),
  expiry_warning_days: z.coerce.number().int().min(1).max(60),
  date_format: z.string().trim().min(3).max(40),
  time_zone: z.string().trim().min(3).max(80),
  plan_prices: z.object({
    monthly: z.coerce.number().int().min(0),
    quarterly: z.coerce.number().int().min(0),
    half_yearly: z.coerce.number().int().min(0),
    yearly: z.coerce.number().int().min(0)
  }),
  reminder_template_expired: z.string().trim().min(10).max(2000),
  reminder_template_upcoming: z.string().trim().min(10).max(2000),
  reminder_template_renewal: z.string().trim().min(10).max(2000)
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(8).max(256),
  newPassword: z.string().min(10).max(256)
});

export const reminderPreviewSchema = z.object({
  member_id: z.string().min(8),
  template_type: reminderTypeSchema
});

export const leadSchema = z.object({
  name: z.string().trim().min(2).max(140),
  mobile_number: z.string().trim().max(32).optional().or(z.literal("")).transform((value) => value || null),
  note: z.string().trim().max(500).optional().or(z.literal("")).transform((value) => value || null)
}).transform((value) => ({
  ...value,
  normalized_mobile: value.mobile_number ? normalizePhone(value.mobile_number) : null
}));
