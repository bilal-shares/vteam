import { formatDateForDisplay } from "./date";
import { formatInr } from "./money";
import { phoneForWhatsApp } from "./phone";
import { durationLabels, type DurationType, type ReminderTemplateType } from "./types";

export interface ReminderData {
  name: string;
  normalizedMobile: string;
  durationType: DurationType;
  durationValue: number;
  startDate: string;
  expiryDate: string;
  amountPaise: number;
  gymName: string;
}

export function durationText(durationType: DurationType, durationValue: number): string {
  if (durationType === "custom_days") return `${durationValue} day`;
  if (durationType === "custom_months") return `${durationValue} month`;
  return durationLabels[durationType].toLowerCase();
}

export function renderReminderTemplate(template: string, data: ReminderData): string {
  const replacements: Record<string, string> = {
    name: data.name,
    duration: durationText(data.durationType, data.durationValue),
    expiry_date: formatDateForDisplay(data.expiryDate),
    start_date: formatDateForDisplay(data.startDate),
    gym_name: data.gymName,
    amount: formatInr(data.amountPaise)
  };

  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) => replacements[key] ?? match);
}

export function whatsappUrl(phone: string, message: string): string | null {
  const normalized = phoneForWhatsApp(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function templateKey(type: ReminderTemplateType): string {
  if (type === "expired") return "reminder_template_expired";
  if (type === "upcoming") return "reminder_template_upcoming";
  return "reminder_template_renewal";
}
