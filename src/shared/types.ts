export const durationLabels = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  yearly: "Yearly",
  custom_days: "Custom days",
  custom_months: "Custom months"
} as const;

export type DurationType = keyof typeof durationLabels;
export type MemberStatus = "active" | "expiring" | "expired" | "archived";
export type PaymentStatus = "paid" | "partial" | "unpaid";
export type PaymentMethod = "cash" | "upi" | "bank_transfer" | "card" | "other";
export type TransactionType = "membership_payment" | "renewal_payment" | "correction" | "refund";
export type ReminderTemplateType = "expired" | "upcoming" | "renewal";

export interface SettingsMap {
  gym_name: string;
  contact_number: string;
  currency: string;
  date_format: string;
  time_zone: string;
  expiry_warning_days: string;
  plan_prices: string;
  reminder_template_expired: string;
  reminder_template_upcoming: string;
  reminder_template_renewal: string;
}

export interface Member {
  id: string;
  membership_number: string;
  full_name: string;
  mobile_number: string;
  normalized_mobile: string;
  email: string | null;
  gender: string | null;
  joining_date: string;
  duration_type: DurationType;
  duration_value: number;
  membership_start_date: string;
  membership_expiry_date: string;
  membership_price_paise: number;
  payment_status: PaymentStatus;
  notes: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  computed_status?: MemberStatus;
  paid_paise?: number;
  outstanding_paise?: number;
}

export interface MembershipHistory {
  id: string;
  member_id: string;
  start_date: string;
  expiry_date: string;
  duration_type: DurationType;
  duration_value: number;
  price_paise: number;
  status: string;
  created_at: string;
}

export interface Transaction {
  id: string;
  member_id: string;
  membership_id: string | null;
  amount_paise: number;
  transaction_date: string;
  payment_method: PaymentMethod;
  transaction_type: TransactionType;
  reference: string | null;
  note: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
  member_name?: string;
  membership_number?: string;
}

export interface DashboardCounts {
  active_members: number;
  expiring_soon: number;
  expired_last_30_days: number;
  total_members: number;
  todays_leads: number;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}
