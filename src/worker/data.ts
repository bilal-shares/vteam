import { calculateExpiryDate, isExpiredInLastDays, memberStatus, nextRenewalStartFromExpiry, nowIso, todayInTimeZone } from "../shared/date";
import { calculatePaymentStatus } from "../shared/money";
import { renderReminderTemplate, templateKey, whatsappUrl } from "../shared/reminders";
import { toCsv, type CsvRecord } from "../shared/csv";
import {
  leadSchema,
  memberInputSchema,
  memberUpdateSchema,
  reminderPreviewSchema,
  renewSchema,
  settingsSchema,
  transactionSchema
} from "../shared/schemas";
import type {
  DashboardCounts,
  DurationType,
  Member,
  MembershipHistory,
  PaymentStatus,
  SettingsMap,
  Transaction
} from "../shared/types";
import type { AppEnv } from "./app-env";
import { HttpError, csv, json, parseJson, rawJson } from "./http";

type MemberRow = Member & { paid_paise?: number };

const SETTING_KEYS: (keyof SettingsMap)[] = [
  "gym_name",
  "contact_number",
  "currency",
  "date_format",
  "time_zone",
  "expiry_warning_days",
  "plan_prices",
  "reminder_template_expired",
  "reminder_template_upcoming",
  "reminder_template_renewal"
];

function safeNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function settingsMap(env: AppEnv): Promise<SettingsMap> {
  const result = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: keyof SettingsMap; value: string }>();
  const settings = Object.fromEntries(result.results.map((row) => [row.key, row.value])) as Partial<SettingsMap>;
  return {
    gym_name: settings.gym_name ?? "V Team Fitness Hub",
    contact_number: settings.contact_number ?? "",
    currency: settings.currency ?? "INR",
    date_format: settings.date_format ?? "dd MMM yyyy",
    time_zone: settings.time_zone ?? "Asia/Kolkata",
    expiry_warning_days: settings.expiry_warning_days ?? "10",
    plan_prices: settings.plan_prices ?? "{}",
    reminder_template_expired: settings.reminder_template_expired ?? "",
    reminder_template_upcoming: settings.reminder_template_upcoming ?? "",
    reminder_template_renewal: settings.reminder_template_renewal ?? ""
  };
}

async function warningDays(env: AppEnv): Promise<number> {
  const settings = await settingsMap(env);
  return safeNumber(settings.expiry_warning_days, 10);
}

function enrichMember(row: MemberRow, today: string, warningWindow: number): Member {
  const paid = safeNumber(row.paid_paise);
  return {
    ...row,
    computed_status: memberStatus(row.membership_expiry_date, today, warningWindow, row.archived_at),
    paid_paise: paid,
    outstanding_paise: Math.max(0, row.membership_price_paise - paid)
  };
}

async function getCurrentMembership(env: AppEnv, memberId: string): Promise<MembershipHistory | null> {
  return env.DB.prepare("SELECT * FROM membership_history WHERE member_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(memberId)
    .first<MembershipHistory>();
}

async function recalculatePaymentStatus(env: AppEnv, memberId: string): Promise<PaymentStatus> {
  const member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(memberId).first<Member>();
  if (!member) throw new HttpError(404, "Member not found.");
  const current = await getCurrentMembership(env, memberId);
  const paidRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_paise), 0) AS paid
     FROM transactions
     WHERE member_id = ? AND voided_at IS NULL AND (? IS NULL OR membership_id = ?)`
  )
    .bind(memberId, current?.id ?? null, current?.id ?? null)
    .first<{ paid: number }>();
  const status = calculatePaymentStatus(member.membership_price_paise, safeNumber(paidRow?.paid));
  await env.DB.prepare("UPDATE members SET payment_status = ?, updated_at = ? WHERE id = ?").bind(status, nowIso(), memberId).run();
  return status;
}

async function nextMembershipNumber(env: AppEnv): Promise<string> {
  const row = await env.DB.prepare(
    `INSERT INTO id_counters (name, value)
     VALUES ('member_number', 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1
     RETURNING value`
  ).first<{ value: number }>();
  const value = row?.value ?? Date.now();
  return `VTF${String(value).padStart(4, "0")}`;
}

async function requireMember(env: AppEnv, id: string): Promise<Member> {
  const member = await env.DB.prepare("SELECT * FROM members WHERE id = ? AND deleted_at IS NULL").bind(id).first<Member>();
  if (!member) throw new HttpError(404, "Member not found.");
  return member;
}

async function duplicatePhone(env: AppEnv, normalizedMobile: string, exceptMemberId?: string): Promise<Member[]> {
  const query = exceptMemberId
    ? "SELECT * FROM members WHERE normalized_mobile = ? AND id <> ? AND deleted_at IS NULL LIMIT 5"
    : "SELECT * FROM members WHERE normalized_mobile = ? AND deleted_at IS NULL LIMIT 5";
  const statement = exceptMemberId ? env.DB.prepare(query).bind(normalizedMobile, exceptMemberId) : env.DB.prepare(query).bind(normalizedMobile);
  const result = await statement.all<Member>();
  return result.results;
}

function queryParam(url: URL, key: string): string {
  return url.searchParams.get(key)?.trim() ?? "";
}

export async function handleSettingsGet(env: AppEnv): Promise<Response> {
  const settings = await settingsMap(env);
  return json({
    ...settings,
    expiry_warning_days: Number(settings.expiry_warning_days),
    plan_prices: JSON.parse(settings.plan_prices) as Record<string, number>
  });
}

export async function handleSettingsUpdate(request: Request, env: AppEnv): Promise<Response> {
  const payload = await parseJson(request, settingsSchema);
  const rows: [string, string][] = [
    ["gym_name", payload.gym_name],
    ["contact_number", payload.contact_number],
    ["expiry_warning_days", String(payload.expiry_warning_days)],
    ["date_format", payload.date_format],
    ["time_zone", payload.time_zone],
    ["plan_prices", JSON.stringify(payload.plan_prices)],
    ["reminder_template_expired", payload.reminder_template_expired],
    ["reminder_template_upcoming", payload.reminder_template_upcoming],
    ["reminder_template_renewal", payload.reminder_template_renewal]
  ];
  await env.DB.batch(
    rows.map(([key, value]) =>
      env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(key, value, nowIso())
    )
  );
  return handleSettingsGet(env);
}

export async function handleDashboard(url: URL, env: AppEnv): Promise<Response> {
  const settings = await settingsMap(env);
  const today = todayInTimeZone(settings.time_zone);
  const warningWindow = safeNumber(settings.expiry_warning_days, 10);
  const membersResult = await env.DB.prepare(
    `SELECT m.*, COALESCE(SUM(CASE WHEN t.voided_at IS NULL THEN t.amount_paise ELSE 0 END), 0) AS paid_paise
     FROM members m
     LEFT JOIN transactions t ON t.member_id = m.id
     WHERE m.deleted_at IS NULL
     GROUP BY m.id`
  ).all<MemberRow>();
  const members = membersResult.results.map((row) => enrichMember(row, today, warningWindow));
  const counts: DashboardCounts = {
    active_members: members.filter((member) => member.computed_status === "active" || member.computed_status === "expiring").length,
    expiring_soon: members.filter((member) => member.computed_status === "expiring").length,
    expired_last_30_days: members.filter((member) => isExpiredInLastDays(member.membership_expiry_date, today, 30) && !member.archived_at).length,
    total_members: members.filter((member) => !member.archived_at).length,
    todays_leads: 0
  };
  const leads = await env.DB.prepare("SELECT COUNT(*) AS count FROM leads WHERE substr(created_at, 1, 10) = ?").bind(today).first<{ count: number }>();
  counts.todays_leads = safeNumber(leads?.count);

  const recentTransactions = await env.DB.prepare(
    `SELECT t.*, m.full_name AS member_name, m.membership_number
     FROM transactions t
     JOIN members m ON m.id = t.member_id
     WHERE t.voided_at IS NULL
     ORDER BY t.transaction_date DESC, t.created_at DESC
     LIMIT 6`
  ).all<Transaction>();

  const focus = url.searchParams.get("focus") ?? "";
  return json({
    counts,
    focus,
    recent_added: members.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6),
    expiring_soon: members.filter((member) => member.computed_status === "expiring").sort((a, b) => a.membership_expiry_date.localeCompare(b.membership_expiry_date)).slice(0, 8),
    recently_expired: members.filter((member) => member.computed_status === "expired").sort((a, b) => b.membership_expiry_date.localeCompare(a.membership_expiry_date)).slice(0, 8),
    recent_transactions: recentTransactions.results
  });
}

export async function handleMembersList(url: URL, env: AppEnv): Promise<Response> {
  const settings = await settingsMap(env);
  const today = todayInTimeZone(settings.time_zone);
  const warningWindow = safeNumber(settings.expiry_warning_days, 10);
  const search = queryParam(url, "search");
  const status = queryParam(url, "status") || "all";
  const sort = queryParam(url, "sort") || "joining_desc";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") ?? "30")));

  const where = ["m.deleted_at IS NULL"];
  const binds: string[] = [];
  if (search) {
    where.push("(m.full_name LIKE ? OR m.mobile_number LIKE ? OR m.normalized_mobile LIKE ? OR m.membership_number LIKE ?)");
    const like = `%${search}%`;
    binds.push(like, like, like, like);
  }

  const orderBy =
    sort === "name"
      ? "m.full_name ASC"
      : sort === "expiry"
        ? "m.membership_expiry_date ASC"
        : sort === "joining_asc"
          ? "m.joining_date ASC"
          : "m.joining_date DESC";

  const result = await env.DB.prepare(
    `SELECT m.*, COALESCE(SUM(CASE WHEN t.voided_at IS NULL THEN t.amount_paise ELSE 0 END), 0) AS paid_paise
     FROM members m
     LEFT JOIN transactions t ON t.member_id = m.id
     WHERE ${where.join(" AND ")}
     GROUP BY m.id
     ORDER BY ${orderBy}`
  )
    .bind(...binds)
    .all<MemberRow>();

  let members = result.results.map((row) => enrichMember(row, today, warningWindow));
  if (status !== "all") {
    members = members.filter((member) => member.computed_status === status);
  }
  const total = members.length;
  const offset = (page - 1) * pageSize;
  return json({ members: members.slice(offset, offset + pageSize), total, page, pageSize });
}

export async function handleMemberCreate(request: Request, env: AppEnv): Promise<Response> {
  const payload = await parseJson(request, memberInputSchema);
  const duplicates = await duplicatePhone(env, payload.normalized_mobile);
  if (duplicates.length > 0 && !payload.allow_duplicate_mobile) {
    throw new HttpError(409, "A member with this mobile number already exists.", { duplicates });
  }

  const memberId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const membershipNumber = await nextMembershipNumber(env);
  const expiryDate = calculateExpiryDate(payload.membership_start_date, payload.duration_type, payload.duration_value);
  const paymentStatus = calculatePaymentStatus(payload.membership_price_paise, payload.initial_payment_paise);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO members (
        id, membership_number, full_name, mobile_number, normalized_mobile, email, gender, joining_date,
        duration_type, duration_value, membership_start_date, membership_expiry_date, membership_price_paise,
        payment_status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      memberId,
      membershipNumber,
      payload.full_name,
      payload.mobile_number,
      payload.normalized_mobile,
      payload.email,
      payload.gender,
      payload.joining_date,
      payload.duration_type,
      payload.duration_value,
      payload.membership_start_date,
      expiryDate,
      payload.membership_price_paise,
      paymentStatus,
      payload.notes,
      nowIso(),
      nowIso()
    ),
    env.DB.prepare(
      `INSERT INTO membership_history (id, member_id, start_date, expiry_date, duration_type, duration_value, price_paise, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
    ).bind(membershipId, memberId, payload.membership_start_date, expiryDate, payload.duration_type, payload.duration_value, payload.membership_price_paise)
  ];

  if (payload.initial_payment_paise > 0) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO transactions (id, member_id, membership_id, amount_paise, transaction_date, payment_method, transaction_type)
         VALUES (?, ?, ?, ?, ?, ?, 'membership_payment')`
      ).bind(crypto.randomUUID(), memberId, membershipId, payload.initial_payment_paise, payload.joining_date, payload.payment_method)
    );
  }

  await env.DB.batch(statements);
  return handleMemberDetail(env, memberId);
}

export async function handleMemberDetail(env: AppEnv, id: string): Promise<Response> {
  const settings = await settingsMap(env);
  const today = todayInTimeZone(settings.time_zone);
  const warningWindow = safeNumber(settings.expiry_warning_days, 10);
  const member = await env.DB.prepare(
    `SELECT m.*, COALESCE(SUM(CASE WHEN t.voided_at IS NULL THEN t.amount_paise ELSE 0 END), 0) AS paid_paise
     FROM members m
     LEFT JOIN transactions t ON t.member_id = m.id
     WHERE m.id = ? AND m.deleted_at IS NULL
     GROUP BY m.id`
  )
    .bind(id)
    .first<MemberRow>();
  if (!member) throw new HttpError(404, "Member not found.");
  const history = await env.DB.prepare("SELECT * FROM membership_history WHERE member_id = ? ORDER BY start_date DESC").bind(id).all<MembershipHistory>();
  const transactions = await env.DB.prepare("SELECT * FROM transactions WHERE member_id = ? ORDER BY transaction_date DESC, created_at DESC").bind(id).all<Transaction>();
  return json({ member: enrichMember(member, today, warningWindow), history: history.results, transactions: transactions.results });
}

export async function handleMemberUpdate(request: Request, env: AppEnv, id: string): Promise<Response> {
  const existing = await requireMember(env, id);
  const payload = await parseJson(request, memberUpdateSchema);
  const normalizedMobile = payload.normalized_mobile ?? existing.normalized_mobile;
  const duplicates = await duplicatePhone(env, normalizedMobile, id);
  if (duplicates.length > 0) {
    throw new HttpError(409, "Another member already uses this mobile number.", { duplicates });
  }

  const durationType = (payload.duration_type ?? existing.duration_type) as DurationType;
  const durationValue = payload.duration_value ?? existing.duration_value;
  const startDate = payload.membership_start_date ?? existing.membership_start_date;
  const expiryDate = calculateExpiryDate(startDate, durationType, durationValue);
  await env.DB.prepare(
    `UPDATE members SET
      full_name = ?, mobile_number = ?, normalized_mobile = ?, email = ?, gender = ?, joining_date = ?,
      duration_type = ?, duration_value = ?, membership_start_date = ?, membership_expiry_date = ?,
      membership_price_paise = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      payload.full_name ?? existing.full_name,
      payload.mobile_number ?? existing.mobile_number,
      normalizedMobile,
      payload.email === undefined ? existing.email : payload.email,
      payload.gender === undefined ? existing.gender : payload.gender,
      payload.joining_date ?? existing.joining_date,
      durationType,
      durationValue,
      startDate,
      expiryDate,
      payload.membership_price_paise ?? existing.membership_price_paise,
      payload.notes === undefined ? existing.notes : payload.notes,
      nowIso(),
      id
    )
    .run();
  await recalculatePaymentStatus(env, id);
  return handleMemberDetail(env, id);
}

export async function handleMemberArchive(env: AppEnv, id: string, archived: boolean): Promise<Response> {
  await requireMember(env, id);
  await env.DB.prepare("UPDATE members SET archived_at = ?, updated_at = ? WHERE id = ?").bind(archived ? nowIso() : null, nowIso(), id).run();
  return handleMemberDetail(env, id);
}

export async function handleMemberDelete(env: AppEnv, id: string): Promise<Response> {
  await requireMember(env, id);
  await env.DB.prepare("UPDATE members SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(nowIso(), nowIso(), id).run();
  return json({ ok: true });
}

export async function handleMemberRenew(request: Request, env: AppEnv, id: string): Promise<Response> {
  const member = await requireMember(env, id);
  const settings = await settingsMap(env);
  const payload = await parseJson(request, renewSchema);
  const startDate =
    payload.start_mode === "after_expiry"
      ? nextRenewalStartFromExpiry(member.membership_expiry_date)
      : payload.start_mode === "today"
        ? todayInTimeZone(settings.time_zone)
        : payload.custom_start_date;
  if (!startDate) throw new HttpError(422, "Custom renewal start date is required.");
  const expiryDate = calculateExpiryDate(startDate, payload.duration_type, payload.duration_value);
  const membershipId = crypto.randomUUID();
  const paymentStatus = calculatePaymentStatus(payload.membership_price_paise, payload.payment_paise);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO membership_history (id, member_id, start_date, expiry_date, duration_type, duration_value, price_paise, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
    ).bind(membershipId, id, startDate, expiryDate, payload.duration_type, payload.duration_value, payload.membership_price_paise),
    env.DB.prepare(
      `UPDATE members SET duration_type = ?, duration_value = ?, membership_start_date = ?, membership_expiry_date = ?,
       membership_price_paise = ?, payment_status = ?, archived_at = NULL, updated_at = ? WHERE id = ?`
    ).bind(payload.duration_type, payload.duration_value, startDate, expiryDate, payload.membership_price_paise, paymentStatus, nowIso(), id)
  ];
  if (payload.payment_paise > 0) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO transactions (id, member_id, membership_id, amount_paise, transaction_date, payment_method, transaction_type, reference)
         VALUES (?, ?, ?, ?, ?, ?, 'renewal_payment', ?)`
      ).bind(crypto.randomUUID(), id, membershipId, payload.payment_paise, startDate, payload.payment_method, payload.reference)
    );
  }
  await env.DB.batch(statements);
  return handleMemberDetail(env, id);
}

export async function handleTransactionsList(url: URL, env: AppEnv): Promise<Response> {
  const where = ["t.voided_at IS NULL"];
  const binds: string[] = [];
  const from = queryParam(url, "from");
  const to = queryParam(url, "to");
  const memberId = queryParam(url, "memberId");
  const method = queryParam(url, "method");
  if (from) {
    where.push("t.transaction_date >= ?");
    binds.push(from);
  }
  if (to) {
    where.push("t.transaction_date <= ?");
    binds.push(to);
  }
  if (memberId) {
    where.push("t.member_id = ?");
    binds.push(memberId);
  }
  if (method) {
    where.push("t.payment_method = ?");
    binds.push(method);
  }
  const result = await env.DB.prepare(
    `SELECT t.*, m.full_name AS member_name, m.membership_number
     FROM transactions t
     JOIN members m ON m.id = t.member_id
     WHERE ${where.join(" AND ")}
     ORDER BY t.transaction_date DESC, t.created_at DESC`
  )
    .bind(...binds)
    .all<Transaction>();
  const total = result.results.reduce((sum, item) => sum + item.amount_paise, 0);
  return json({ transactions: result.results, total_paise: total });
}

export async function handleTransactionCreate(request: Request, env: AppEnv): Promise<Response> {
  const payload = await parseJson(request, transactionSchema);
  await requireMember(env, payload.member_id);
  const current = await getCurrentMembership(env, payload.member_id);
  const membershipId = payload.membership_id ?? current?.id ?? null;
  await env.DB.prepare(
    `INSERT INTO transactions (id, member_id, membership_id, amount_paise, transaction_date, payment_method, transaction_type, reference, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), payload.member_id, membershipId, payload.amount_paise, payload.transaction_date, payload.payment_method, payload.transaction_type, payload.reference, payload.note)
    .run();
  await recalculatePaymentStatus(env, payload.member_id);
  return handleTransactionsList(new URL("/api/transactions", "https://local"), env);
}

export async function handleTransactionUpdate(request: Request, env: AppEnv, id: string): Promise<Response> {
  const existing = await env.DB.prepare("SELECT * FROM transactions WHERE id = ? AND voided_at IS NULL").bind(id).first<Transaction>();
  if (!existing) throw new HttpError(404, "Transaction not found.");
  const payload = await parseJson(request, transactionSchema);
  await requireMember(env, payload.member_id);
  const current = await getCurrentMembership(env, payload.member_id);
  await env.DB.prepare(
    `UPDATE transactions SET member_id = ?, membership_id = ?, amount_paise = ?, transaction_date = ?, payment_method = ?,
     transaction_type = ?, reference = ?, note = ?, updated_at = ? WHERE id = ?`
  )
    .bind(payload.member_id, payload.membership_id ?? current?.id ?? null, payload.amount_paise, payload.transaction_date, payload.payment_method, payload.transaction_type, payload.reference, payload.note, nowIso(), id)
    .run();
  await recalculatePaymentStatus(env, existing.member_id);
  if (existing.member_id !== payload.member_id) await recalculatePaymentStatus(env, payload.member_id);
  return json({ ok: true });
}

export async function handleTransactionDelete(env: AppEnv, id: string): Promise<Response> {
  const existing = await env.DB.prepare("SELECT * FROM transactions WHERE id = ? AND voided_at IS NULL").bind(id).first<Transaction>();
  if (!existing) throw new HttpError(404, "Transaction not found.");
  await env.DB.prepare("UPDATE transactions SET voided_at = ?, updated_at = ? WHERE id = ?").bind(nowIso(), nowIso(), id).run();
  await recalculatePaymentStatus(env, existing.member_id);
  return json({ ok: true });
}

export async function handleReports(url: URL, env: AppEnv): Promise<Response> {
  const settings = await settingsMap(env);
  const today = todayInTimeZone(settings.time_zone);
  const warningWindow = safeNumber(settings.expiry_warning_days, 10);
  const from = queryParam(url, "from") || `${today.slice(0, 7)}-01`;
  const to = queryParam(url, "to") || today;
  const memberResult = await env.DB.prepare(
    `SELECT m.*, COALESCE(SUM(CASE WHEN t.voided_at IS NULL AND t.membership_id = mh.id THEN t.amount_paise ELSE 0 END), 0) AS paid_paise
     FROM members m
     LEFT JOIN membership_history mh ON mh.member_id = m.id AND mh.id = (SELECT id FROM membership_history WHERE member_id = m.id ORDER BY created_at DESC LIMIT 1)
     LEFT JOIN transactions t ON t.member_id = m.id
     WHERE m.deleted_at IS NULL
     GROUP BY m.id`
  ).all<MemberRow>();
  const members = memberResult.results.map((row) => enrichMember(row, today, warningWindow));
  const payments = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_paise), 0) AS total FROM transactions WHERE voided_at IS NULL AND transaction_date BETWEEN ? AND ?`
  )
    .bind(from, to)
    .first<{ total: number }>();
  const methods = await env.DB.prepare(
    `SELECT payment_method, COALESCE(SUM(amount_paise), 0) AS total_paise, COUNT(*) AS count
     FROM transactions WHERE voided_at IS NULL AND transaction_date BETWEEN ? AND ?
     GROUP BY payment_method ORDER BY total_paise DESC`
  )
    .bind(from, to)
    .all<{ payment_method: string; total_paise: number; count: number }>();
  const monthly = await env.DB.prepare(
    `SELECT substr(transaction_date, 1, 7) AS month, COALESCE(SUM(amount_paise), 0) AS total_paise
     FROM transactions WHERE voided_at IS NULL
     GROUP BY month ORDER BY month DESC LIMIT 12`
  ).all<{ month: string; total_paise: number }>();
  const renewals = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM membership_history WHERE start_date BETWEEN ? AND ?`
  )
    .bind(from, to)
    .first<{ count: number }>();

  return json({
    range: { from, to },
    total_members: members.filter((member) => !member.archived_at).length,
    active_members: members.filter((member) => member.computed_status === "active" || member.computed_status === "expiring").length,
    expired_members: members.filter((member) => member.computed_status === "expired").length,
    expiring_soon: members.filter((member) => member.computed_status === "expiring").length,
    new_members: members.filter((member) => member.joining_date >= from && member.joining_date <= to).length,
    renewals: safeNumber(renewals?.count),
    payments_collected_paise: safeNumber(payments?.total),
    outstanding_paise: members.reduce((sum, member) => sum + (member.outstanding_paise ?? 0), 0),
    method_breakdown: methods.results,
    monthly_collection: monthly.results
  });
}

export async function handleReminderPreview(request: Request, env: AppEnv): Promise<Response> {
  const payload = await parseJson(request, reminderPreviewSchema);
  const settings = await settingsMap(env);
  const member = await requireMember(env, payload.member_id);
  const history = await getCurrentMembership(env, member.id);
  const template = settings[templateKey(payload.template_type) as keyof SettingsMap];
  const message = renderReminderTemplate(template, {
    name: member.full_name,
    normalizedMobile: member.normalized_mobile,
    durationType: member.duration_type,
    durationValue: member.duration_value,
    startDate: history?.start_date ?? member.membership_start_date,
    expiryDate: history?.expiry_date ?? member.membership_expiry_date,
    amountPaise: history?.price_paise ?? member.membership_price_paise,
    gymName: settings.gym_name
  });
  const url = whatsappUrl(member.normalized_mobile, message);
  await env.DB.prepare(
    `INSERT INTO reminder_history (id, member_id, membership_id, template_type, message, whatsapp_url)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), member.id, history?.id ?? null, payload.template_type, message, url)
    .run();
  return json({ message, whatsapp_url: url });
}

export async function handleLeadCreate(request: Request, env: AppEnv): Promise<Response> {
  const payload = await parseJson(request, leadSchema);
  await env.DB.prepare(
    `INSERT INTO leads (id, name, mobile_number, normalized_mobile, note)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), payload.name, payload.mobile_number, payload.normalized_mobile, payload.note)
    .run();
  return json({ ok: true }, 201);
}

export async function handleExport(url: URL, env: AppEnv, kind: string): Promise<Response> {
  if (kind === "members") {
    const result = await env.DB.prepare("SELECT * FROM members WHERE deleted_at IS NULL ORDER BY full_name").all<CsvRecord>();
    return csv(toCsv(result.results), "vteam-members.csv");
  }
  if (kind === "membership-history") {
    const result = await env.DB.prepare("SELECT * FROM membership_history ORDER BY created_at DESC").all<CsvRecord>();
    return csv(toCsv(result.results), "vteam-membership-history.csv");
  }
  if (kind === "transactions") {
    const result = await env.DB.prepare("SELECT * FROM transactions ORDER BY transaction_date DESC").all<CsvRecord>();
    return csv(toCsv(result.results), "vteam-transactions.csv");
  }
  if (kind === "report") {
    const report = await handleReports(url, env);
    const body = (await report.json()) as { data: Record<string, unknown> };
    const flat: CsvRecord = {};
    for (const [key, value] of Object.entries(body.data)) {
      if (typeof value !== "object" || value === null) flat[key] = String(value);
    }
    return csv(toCsv([flat]), "vteam-report.csv");
  }
  if (kind === "backup") {
    const [settings, members, history, transactions, reminders, leads] = await Promise.all([
      env.DB.prepare("SELECT * FROM settings ORDER BY key").all(),
      env.DB.prepare("SELECT * FROM members ORDER BY created_at").all(),
      env.DB.prepare("SELECT * FROM membership_history ORDER BY created_at").all(),
      env.DB.prepare("SELECT * FROM transactions ORDER BY created_at").all(),
      env.DB.prepare("SELECT * FROM reminder_history ORDER BY prepared_at").all(),
      env.DB.prepare("SELECT * FROM leads ORDER BY created_at").all()
    ]);
    return rawJson({
      schema_version: 1,
      exported_at: nowIso(),
      tables: {
        settings: settings.results,
        members: members.results,
        membership_history: history.results,
        transactions: transactions.results,
        reminder_history: reminders.results,
        leads: leads.results
      }
    });
  }
  throw new HttpError(404, "Unknown export type.");
}

export async function cleanupKnownSettings(env: AppEnv): Promise<void> {
  await env.DB.prepare(`DELETE FROM settings WHERE key NOT IN (${SETTING_KEYS.map(() => "?").join(", ")})`).bind(...SETTING_KEYS).run();
}
