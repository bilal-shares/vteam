import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bell,
  CalendarClock,
  Copy,
  Download,
  FileJson,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Undo2
} from "lucide-react";
import { api, ApiClientError, downloadUrl, jsonBody, setCsrfToken } from "./api";
import { Button, Dialog, EmptyState, Field, Loading, StatusBadge } from "./components";
import { formatDateForDisplay, todayInTimeZone } from "../shared/date";
import { formatInr, paiseToRupees, rupeesToPaise } from "../shared/money";
import { durationLabels, type DurationType, type Member, type MembershipHistory, type Transaction } from "../shared/types";

type View = "dashboard" | "members" | "transactions" | "reports" | "settings" | "backup";

interface SessionPayload {
  authenticated: boolean;
  user: { username: string } | null;
  csrfToken: string | null;
}

interface SettingsPayload {
  gym_name: string;
  contact_number: string;
  expiry_warning_days: number;
  date_format: string;
  time_zone: string;
  plan_prices: Record<string, number>;
  reminder_template_expired: string;
  reminder_template_upcoming: string;
  reminder_template_renewal: string;
}

interface DashboardPayload {
  counts: {
    active_members: number;
    expiring_soon: number;
    expired_last_30_days: number;
    total_members: number;
    todays_leads: number;
  };
  recent_added: Member[];
  expiring_soon: Member[];
  recently_expired: Member[];
  recent_transactions: Transaction[];
}

interface MemberDetailPayload {
  member: Member;
  history: MembershipHistory[];
  transactions: Transaction[];
}

interface MemberListPayload {
  members: Member[];
  total: number;
  page: number;
  pageSize: number;
}

interface TransactionPayload {
  transactions: Transaction[];
  total_paise: number;
}

interface ReportsPayload {
  range: { from: string; to: string };
  total_members: number;
  active_members: number;
  expired_members: number;
  expiring_soon: number;
  new_members: number;
  renewals: number;
  payments_collected_paise: number;
  outstanding_paise: number;
  method_breakdown: { payment_method: string; total_paise: number; count: number }[];
  monthly_collection: { month: string; total_paise: number }[];
}

function formText(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function paiseFromForm(form: FormData, key: string): number {
  const value = formText(form, key);
  return value ? rupeesToPaise(value) : 0;
}

function durationValue(type: DurationType, value: string): number | undefined {
  if (type === "monthly") return 1;
  if (type === "quarterly") return 3;
  if (type === "half_yearly") return 6;
  if (type === "yearly") return 12;
  return Number(value || "1");
}

function planOptions() {
  return Object.entries(durationLabels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

function quickDate(): string {
  return todayInTimeZone();
}

export function AuthPage({ onAuth }: { onAuth: (session: SessionPayload) => void }) {
  const [setupMode, setSetupMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body = setupMode
      ? {
          username: formText(form, "username"),
          password: formText(form, "password"),
          setupSecret: formText(form, "setupSecret")
        }
      : {
          username: formText(form, "username"),
          password: formText(form, "password")
        };
    try {
      const data = await api<{ user: { username: string }; csrfToken: string }>(setupMode ? "/api/setup" : "/api/auth/login", {
        method: "POST",
        body: jsonBody(body)
      });
      setCsrfToken(data.csrfToken);
      onAuth({ authenticated: true, user: data.user, csrfToken: data.csrfToken });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">V Team Fitness Hub</p>
          <h1>{setupMode ? "Owner setup" : "Owner login"}</h1>
          <p className="muted">
            {setupMode
              ? "Create the only owner account using the temporary setup secret."
              : "Sign in to manage members, payments, reminders and reports."}
          </p>
        </div>
        <form className="stack" onSubmit={submit}>
          {setupMode ? (
            <Field label="Setup secret">
              <input name="setupSecret" type="password" autoComplete="one-time-code" required minLength={16} />
            </Field>
          ) : null}
          <Field label="Username">
            <input name="username" autoComplete="username" required minLength={2} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" autoComplete={setupMode ? "new-password" : "current-password"} required minLength={8} />
          </Field>
          {error ? <p className="form-error">{error}</p> : null}
          <Button type="submit" disabled={loading}>
            {loading ? "Please wait..." : setupMode ? "Create owner" : "Login"}
          </Button>
        </form>
        <button type="button" className="link-btn" onClick={() => setSetupMode((value) => !value)}>
          {setupMode ? "Back to login" : "First-time owner setup"}
        </button>
      </section>
    </main>
  );
}

export function DashboardPage({
  onOpenMembers,
  onQuickAdd
}: {
  onOpenMembers: (status: string) => void;
  onQuickAdd: () => void;
}) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setData(await api<DashboardPayload>("/api/dashboard"));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading && !data) return <Loading label="Loading dashboard" />;
  if (!data) return null;

  const cards = [
    ["Active Members", data.counts.active_members, "active", "blue"],
    ["Expiring in 10 Days", data.counts.expiring_soon, "expiring", "amber"],
    ["Expired Last 30 Days", data.counts.expired_last_30_days, "expired", "rose"],
    ["Total Members", data.counts.total_members, "all", "slate"],
    ["Today's Leads", data.counts.todays_leads, "leads", "green"]
  ] as const;

  return (
    <div className="page-grid">
      <section className="stat-grid">
        {cards.map(([label, count, status, tone]) => (
          <button key={label} type="button" className={`stat-card ${tone}`} onClick={() => onOpenMembers(status)}>
            <span>{label}</span>
            <strong>{count}</strong>
          </button>
        ))}
      </section>

      <section className="panel action-panel">
        <div>
          <h2>Quick add</h2>
          <p className="muted">Add a new member with membership dates, price and optional payment.</p>
        </div>
        <Button onClick={onQuickAdd}>
          <Plus size={18} /> Add member
        </Button>
      </section>

      <MemberStrip title="Recently Added" members={data.recent_added} />
      <MemberStrip title="Expiring Soon" members={data.expiring_soon} />
      <MemberStrip title="Recently Expired" members={data.recently_expired} />

      <section className="panel">
        <div className="section-header">
          <h2>Recent Transactions</h2>
          <button className="icon-btn" onClick={load} aria-label="Refresh dashboard">
            <RefreshCw size={18} />
          </button>
        </div>
        {data.recent_transactions.length === 0 ? (
          <p className="muted">No payments recorded yet.</p>
        ) : (
          <div className="compact-list">
            {data.recent_transactions.map((transaction) => (
              <div key={transaction.id} className="compact-row">
                <span>{transaction.member_name}</span>
                <strong>{formatInr(transaction.amount_paise)}</strong>
                <small>{formatDateForDisplay(transaction.transaction_date)}</small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MemberStrip({ title, members }: { title: string; members: Member[] }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {members.length === 0 ? (
        <p className="muted">Nothing to show.</p>
      ) : (
        <div className="compact-list">
          {members.map((member) => (
            <div key={member.id} className="compact-row">
              <span>{member.full_name}</span>
              <StatusBadge status={member.computed_status} />
              <small>{formatDateForDisplay(member.membership_expiry_date)}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function MembersPage({
  initialStatus,
  openAdd,
  onAddHandled
}: {
  initialStatus: string;
  openAdd: boolean;
  onAddHandled: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus || "all");
  const [sort, setSort] = useState("joining_desc");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(openAdd);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => {
    if (initialStatus && initialStatus !== "leads") setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (openAdd) {
      setShowForm(true);
      onAddHandled();
    }
  }, [openAdd, onAddHandled]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ search, status, sort, pageSize: "60" });
    const data = await api<MemberListPayload>(`/api/members?${params}`);
    setMembers(data.members);
    setTotal(data.total);
    setSelectedBulkIds((current) => new Set([...current].filter((id) => data.members.some((member) => member.id === id))));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [search, status, sort]);

  return (
    <div className="page-grid">
      <section className="toolbar panel">
        <div className="search-box">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone or ID" />
        </div>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All Members</option>
          <option value="active">Active</option>
          <option value="expiring">Expiring Soon</option>
          <option value="expired">Expired</option>
          <option value="archived">Archived</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="joining_desc">Newest</option>
          <option value="joining_asc">Oldest</option>
          <option value="name">Name</option>
          <option value="expiry">Expiry</option>
        </select>
        <Button variant="secondary" disabled={selectedBulkIds.size === 0} onClick={() => setBulkOpen(true)}>
          <MessageCircle size={18} /> Bulk
        </Button>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={18} /> Add
        </Button>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Members</h2>
          <span className="muted">{total} records</span>
        </div>
        {loading ? <Loading /> : null}
        {!loading && members.length === 0 ? (
          <EmptyState title="No members found" body="Try a different search or add the first member." action={<Button onClick={() => setShowForm(true)}>Add member</Button>} />
        ) : (
          <div className="member-list">
            {members.map((member) => (
              <div key={member.id} className="member-card" role="button" tabIndex={0} onClick={() => setSelectedId(member.id)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(member.id); }}>
                <label className="select-cell" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedBulkIds.has(member.id)}
                    onChange={(event) => {
                      setSelectedBulkIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(member.id);
                        else next.delete(member.id);
                        return next;
                      });
                    }}
                    aria-label={`Select ${member.full_name}`}
                  />
                </label>
                <span>
                  <strong>{member.full_name}</strong>
                  <small>{member.membership_number} · {member.mobile_number}</small>
                </span>
                <span>
                  <StatusBadge status={member.computed_status} />
                  <small>{formatDateForDisplay(member.membership_expiry_date)}</small>
                </span>
                <span className="money-stack">
                  <strong>{formatInr(member.membership_price_paise)}</strong>
                  <small>{member.payment_status}</small>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <MemberFormDialog open={showForm} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); void load(); }} />
      <MemberDetailDialog id={selectedId} onClose={() => setSelectedId(null)} onChanged={() => void load()} />
      <BulkReminderDialog members={members.filter((member) => selectedBulkIds.has(member.id))} open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  );
}

function MemberFormDialog({
  open,
  onClose,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const today = quickDate();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const durationType = formText(form, "duration_type") as DurationType;
    const body = {
      full_name: formText(form, "full_name"),
      mobile_number: formText(form, "mobile_number"),
      email: formText(form, "email"),
      gender: formText(form, "gender"),
      joining_date: formText(form, "joining_date"),
      duration_type: durationType,
      duration_value: durationValue(durationType, formText(form, "duration_value")),
      membership_start_date: formText(form, "membership_start_date"),
      membership_price_paise: paiseFromForm(form, "membership_price"),
      notes: formText(form, "notes"),
      initial_payment_paise: paiseFromForm(form, "initial_payment"),
      payment_method: formText(form, "payment_method") || "cash",
      allow_duplicate_mobile: allowDuplicate
    };
    try {
      await api("/api/members", { method: "POST", body: jsonBody(body) });
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 409) setAllowDuplicate(true);
      setError(caught instanceof Error ? caught.message : "Could not save member.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Add member" open={open} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Full name"><input name="full_name" required autoFocus /></Field>
        <Field label="Mobile number"><input name="mobile_number" required inputMode="tel" /></Field>
        <Field label="Email"><input name="email" type="email" /></Field>
        <Field label="Gender"><input name="gender" /></Field>
        <Field label="Joining date"><input name="joining_date" type="date" defaultValue={today} required /></Field>
        <Field label="Plan"><select name="duration_type" defaultValue="monthly">{planOptions()}</select></Field>
        <Field label="Custom duration"><input name="duration_value" type="number" min="1" defaultValue="1" /></Field>
        <Field label="Start date"><input name="membership_start_date" type="date" defaultValue={today} required /></Field>
        <Field label="Price (INR)"><input name="membership_price" inputMode="decimal" defaultValue="1000" required /></Field>
        <Field label="Initial payment (INR)"><input name="initial_payment" inputMode="decimal" defaultValue="0" /></Field>
        <Field label="Payment method">
          <select name="payment_method" defaultValue="cash">
            <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option>
          </select>
        </Field>
        <Field label="Notes"><textarea name="notes" rows={3} /></Field>
        {allowDuplicate ? <label className="check-row"><input type="checkbox" checked={allowDuplicate} onChange={(event) => setAllowDuplicate(event.target.checked)} /> Save anyway with duplicate mobile warning</label> : null}
        {error ? <p className="form-error full">{error}</p> : null}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}><Save size={18} /> Save member</Button>
        </div>
      </form>
    </Dialog>
  );
}

function MemberDetailDialog({
  id,
  onClose,
  onChanged
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<MemberDetailPayload | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);

  async function load() {
    if (!id) return;
    setDetail(await api<MemberDetailPayload>(`/api/members/${id}`));
  }

  useEffect(() => {
    setDetail(null);
    void load();
  }, [id]);

  async function action(path: string, method = "POST") {
    if (!id) return;
    await api(path, { method });
    await load();
    onChanged();
  }

  async function deleteMember(memberId: string) {
    await api(`/api/members/${memberId}/delete`, { method: "DELETE" });
    onChanged();
    onClose();
  }

  return (
    <Dialog title={detail?.member.full_name ?? "Member details"} open={Boolean(id)} onClose={onClose}>
      {!detail ? <Loading /> : (
        <div className="detail-stack">
          <div className="detail-hero">
            <div>
              <p className="eyebrow">{detail.member.membership_number}</p>
              <h2>{detail.member.full_name}</h2>
              <p className="muted">{detail.member.mobile_number}</p>
            </div>
            <StatusBadge status={detail.member.computed_status} />
          </div>
          <div className="info-grid">
            <Info label="Plan" value={durationLabels[detail.member.duration_type]} />
            <Info label="Start" value={formatDateForDisplay(detail.member.membership_start_date)} />
            <Info label="Expiry" value={formatDateForDisplay(detail.member.membership_expiry_date)} />
            <Info label="Price" value={formatInr(detail.member.membership_price_paise)} />
            <Info label="Paid" value={formatInr(detail.member.paid_paise ?? 0)} />
            <Info label="Outstanding" value={formatInr(detail.member.outstanding_paise ?? 0)} />
          </div>
          <div className="button-row">
            <Button variant="secondary" onClick={() => setEditOpen(true)}><Pencil size={18} /> Edit</Button>
            <Button onClick={() => setRenewOpen(true)}><RefreshCw size={18} /> Renew</Button>
            <Button variant="secondary" onClick={() => setReminderOpen(true)}><MessageCircle size={18} /> WhatsApp</Button>
            {detail.member.archived_at ? (
              <Button variant="secondary" onClick={() => action(`/api/members/${detail.member.id}/restore`)}><Undo2 size={18} /> Restore</Button>
            ) : (
              <Button variant="secondary" onClick={() => action(`/api/members/${detail.member.id}/archive`)}><Archive size={18} /> Archive</Button>
            )}
            <Button variant="danger" onClick={() => { if (confirm("Permanently mark this member deleted?")) void deleteMember(detail.member.id); }}><Trash2 size={18} /> Delete</Button>
          </div>
          <HistoryList history={detail.history} />
          <TransactionMiniList transactions={detail.transactions} />
          <MemberEditDialog member={detail.member} open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); void load(); onChanged(); }} />
          <RenewDialog member={detail.member} open={renewOpen} onClose={() => setRenewOpen(false)} onSaved={() => { setRenewOpen(false); void load(); onChanged(); }} />
          <ReminderDialog member={detail.member} open={reminderOpen} onClose={() => setReminderOpen(false)} />
        </div>
      )}
    </Dialog>
  );
}

function MemberEditDialog({ member, open, onClose, onSaved }: { member: Member; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const durationType = formText(form, "duration_type") as DurationType;
    setSaving(true);
    setError("");
    try {
      await api(`/api/members/${member.id}`, {
        method: "PUT",
        body: jsonBody({
          full_name: formText(form, "full_name"),
          mobile_number: formText(form, "mobile_number"),
          email: formText(form, "email"),
          gender: formText(form, "gender"),
          joining_date: formText(form, "joining_date"),
          duration_type: durationType,
          duration_value: durationValue(durationType, formText(form, "duration_value")),
          membership_start_date: formText(form, "membership_start_date"),
          membership_price_paise: paiseFromForm(form, "membership_price"),
          notes: formText(form, "notes")
        })
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update member.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Edit member" open={open} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Full name"><input name="full_name" required defaultValue={member.full_name} /></Field>
        <Field label="Mobile number"><input name="mobile_number" required inputMode="tel" defaultValue={member.mobile_number} /></Field>
        <Field label="Email"><input name="email" type="email" defaultValue={member.email ?? ""} /></Field>
        <Field label="Gender"><input name="gender" defaultValue={member.gender ?? ""} /></Field>
        <Field label="Joining date"><input name="joining_date" type="date" defaultValue={member.joining_date} required /></Field>
        <Field label="Plan"><select name="duration_type" defaultValue={member.duration_type}>{planOptions()}</select></Field>
        <Field label="Custom duration"><input name="duration_value" type="number" min="1" defaultValue={member.duration_value} /></Field>
        <Field label="Start date"><input name="membership_start_date" type="date" defaultValue={member.membership_start_date} required /></Field>
        <Field label="Price (INR)"><input name="membership_price" inputMode="decimal" defaultValue={paiseToRupees(member.membership_price_paise)} required /></Field>
        <Field label="Notes"><textarea name="notes" rows={3} defaultValue={member.notes ?? ""} /></Field>
        {error ? <p className="form-error full">{error}</p> : null}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}><Save size={18} /> Save changes</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="info"><span>{label}</span><strong>{value}</strong></div>;
}

function HistoryList({ history }: { history: MembershipHistory[] }) {
  return (
    <section>
      <h3>Membership history</h3>
      <div className="compact-list">
        {history.map((item) => (
          <div className="compact-row" key={item.id}>
            <span>{durationLabels[item.duration_type]}</span>
            <small>{formatDateForDisplay(item.start_date)} to {formatDateForDisplay(item.expiry_date)}</small>
            <strong>{formatInr(item.price_paise)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function TransactionMiniList({ transactions }: { transactions: Transaction[] }) {
  return (
    <section>
      <h3>Payments</h3>
      {transactions.length === 0 ? <p className="muted">No payments yet.</p> : (
        <div className="compact-list">
          {transactions.map((item) => (
            <div className="compact-row" key={item.id}>
              <span>{item.payment_method}</span>
              <small>{formatDateForDisplay(item.transaction_date)}</small>
              <strong>{formatInr(item.amount_paise)}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RenewDialog({ member, open, onClose, onSaved }: { member: Member; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const durationType = formText(form, "duration_type") as DurationType;
    setSaving(true);
    setError("");
    try {
      await api(`/api/members/${member.id}/renew`, {
        method: "POST",
        body: jsonBody({
          start_mode: formText(form, "start_mode"),
          custom_start_date: formText(form, "custom_start_date") || undefined,
          duration_type: durationType,
          duration_value: durationValue(durationType, formText(form, "duration_value")),
          membership_price_paise: paiseFromForm(form, "membership_price"),
          payment_paise: paiseFromForm(form, "payment"),
          payment_method: formText(form, "payment_method") || "cash",
          reference: formText(form, "reference")
        })
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Renewal failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Renew membership" open={open} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Start mode">
          <select name="start_mode" defaultValue="after_expiry">
            <option value="after_expiry">Start after current expiry</option>
            <option value="today">Start today</option>
            <option value="custom">Custom date</option>
          </select>
        </Field>
        <Field label="Custom start"><input name="custom_start_date" type="date" /></Field>
        <Field label="Plan"><select name="duration_type" defaultValue={member.duration_type}>{planOptions()}</select></Field>
        <Field label="Custom duration"><input name="duration_value" type="number" min="1" defaultValue={member.duration_value} /></Field>
        <Field label="Price (INR)"><input name="membership_price" defaultValue={paiseToRupees(member.membership_price_paise)} /></Field>
        <Field label="Payment now (INR)"><input name="payment" defaultValue="0" /></Field>
        <Field label="Payment method"><select name="payment_method" defaultValue="cash"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select></Field>
        <Field label="Reference"><input name="reference" /></Field>
        {error ? <p className="form-error full">{error}</p> : null}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>Renew</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReminderDialog({ member, open, onClose }: { member: Member; open: boolean; onClose: () => void }) {
  const [type, setType] = useState("expired");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function prepare() {
    setError("");
    const data = await api<{ message: string; whatsapp_url: string | null }>("/api/reminders/preview", {
      method: "POST",
      body: jsonBody({ member_id: member.id, template_type: type })
    });
    setMessage(data.message);
    setUrl(data.whatsapp_url);
  }

  useEffect(() => {
    if (open) void prepare().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not prepare reminder."));
  }, [open, type]);

  return (
    <Dialog title="WhatsApp reminder" open={open} onClose={onClose}>
      <div className="stack">
        <Field label="Template">
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="expired">Expired</option>
            <option value="upcoming">Upcoming expiry</option>
            <option value="renewal">Renewal</option>
          </select>
        </Field>
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={9} />
        {error ? <p className="form-error">{error}</p> : null}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => navigator.clipboard.writeText(message)}><Copy size={18} /> Copy</Button>
          <Button disabled={!url} onClick={() => { if (url) window.open(url, "_blank", "noopener,noreferrer"); }}><MessageCircle size={18} /> Open WhatsApp</Button>
        </div>
        <p className="muted">Opening WhatsApp only prepares the chat. It does not prove delivery or read status.</p>
      </div>
    </Dialog>
  );
}

function BulkReminderDialog({ members, open, onClose }: { members: Member[]; open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<{ member: Member; message: string; whatsapp_url: string | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<"expired" | "upcoming" | "renewal">("upcoming");
  const [error, setError] = useState("");

  async function prepare() {
    setLoading(true);
    setError("");
    try {
      const prepared = [];
      for (const member of members) {
        const data = await api<{ message: string; whatsapp_url: string | null }>("/api/reminders/preview", {
          method: "POST",
          body: jsonBody({ member_id: member.id, template_type: type })
        });
        prepared.push({ member, ...data });
      }
      setItems(prepared);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare reminders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && members.length > 0) void prepare();
  }, [open, type, members.length]);

  return (
    <Dialog title="Bulk WhatsApp reminders" open={open} onClose={onClose}>
      <div className="stack">
        <Field label="Template">
          <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            <option value="upcoming">Upcoming expiry</option>
            <option value="expired">Expired</option>
            <option value="renewal">Renewal</option>
          </select>
        </Field>
        {loading ? <Loading label="Preparing reminders" /> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {!loading && items.length === 0 ? <p className="muted">Select members from the Members screen first.</p> : null}
        <div className="compact-list">
          {items.map((item) => (
            <div key={item.member.id} className="bulk-reminder">
              <div>
                <strong>{item.member.full_name}</strong>
                <small>{item.member.mobile_number}</small>
              </div>
              <textarea value={item.message} readOnly rows={5} />
              <div className="button-row">
                <Button variant="secondary" onClick={() => navigator.clipboard.writeText(item.message)}>
                  <Copy size={18} /> Copy
                </Button>
                <Button disabled={!item.whatsapp_url} onClick={() => { if (item.whatsapp_url) window.open(item.whatsapp_url, "_blank", "noopener,noreferrer"); }}>
                  <MessageCircle size={18} /> Open
                </Button>
              </div>
            </div>
          ))}
        </div>
        <p className="muted">Each WhatsApp chat must be reviewed and opened manually. The app records preparation, not delivery.</p>
      </div>
    </Dialog>
  );
}

export function TransactionsPage() {
  const [data, setData] = useState<TransactionPayload | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Transaction | null>(null);

  async function load() {
    const [transactions, memberData] = await Promise.all([
      api<TransactionPayload>("/api/transactions"),
      api<MemberListPayload>("/api/members?pageSize=100")
    ]);
    setData(transactions);
    setMembers(memberData.members);
  }

  useEffect(() => { void load(); }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await api("/api/transactions", {
        method: "POST",
        body: jsonBody({
          member_id: formText(form, "member_id"),
          amount_paise: paiseFromForm(form, "amount"),
          transaction_date: formText(form, "transaction_date"),
          payment_method: formText(form, "payment_method"),
          transaction_type: formText(form, "transaction_type"),
          reference: formText(form, "reference"),
          note: formText(form, "note")
        })
      });
      event.currentTarget.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record payment.");
    }
  }

  async function deleteTransaction(transaction: Transaction) {
    if (!confirm("Delete this transaction? It will be voided for audit history.")) return;
    await api(`/api/transactions/${transaction.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="page-grid">
      <section className="panel">
        <h2>Record payment</h2>
        <form className="form-grid" onSubmit={submit}>
          <Field label="Member"><select name="member_id" required>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name} · {member.membership_number}</option>)}</select></Field>
          <Field label="Amount (INR)"><input name="amount" inputMode="decimal" required /></Field>
          <Field label="Date"><input name="transaction_date" type="date" defaultValue={quickDate()} required /></Field>
          <Field label="Method"><select name="payment_method" defaultValue="cash"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select></Field>
          <Field label="Type"><select name="transaction_type" defaultValue="membership_payment"><option value="membership_payment">Membership payment</option><option value="renewal_payment">Renewal payment</option><option value="correction">Correction</option><option value="refund">Refund</option></select></Field>
          <Field label="Reference"><input name="reference" /></Field>
          <Field label="Note"><input name="note" /></Field>
          {error ? <p className="form-error full">{error}</p> : null}
          <div className="dialog-actions"><Button type="submit">Record payment</Button></div>
        </form>
      </section>
      <section className="panel">
        <div className="section-header">
          <h2>Transactions</h2>
          <strong>{data ? formatInr(data.total_paise) : ""}</strong>
        </div>
        {!data ? <Loading /> : data.transactions.length === 0 ? <p className="muted">No transactions yet.</p> : (
          <div className="table-list">
            {data.transactions.map((transaction) => (
              <div key={transaction.id} className="table-row">
                <span>{transaction.member_name}</span>
                <span>{formatDateForDisplay(transaction.transaction_date)}</span>
                <span>{transaction.payment_method}</span>
                <strong>{formatInr(transaction.amount_paise)}</strong>
                <span className="row-actions">
                  <button type="button" className="mini-btn" onClick={() => setEditing(transaction)} aria-label="Edit transaction"><Pencil size={15} /></button>
                  <button type="button" className="mini-btn danger" onClick={() => void deleteTransaction(transaction)} aria-label="Delete transaction"><Trash2 size={15} /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <TransactionEditDialog transaction={editing} members={members} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
    </div>
  );
}

function TransactionEditDialog({
  transaction,
  members,
  onClose,
  onSaved
}: {
  transaction: Transaction | null;
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState("");
  if (!transaction) return null;
  const currentTransaction = transaction;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await api(`/api/transactions/${currentTransaction.id}`, {
        method: "PUT",
        body: jsonBody({
          member_id: formText(form, "member_id"),
          membership_id: currentTransaction.membership_id,
          amount_paise: paiseFromForm(form, "amount"),
          transaction_date: formText(form, "transaction_date"),
          payment_method: formText(form, "payment_method"),
          transaction_type: formText(form, "transaction_type"),
          reference: formText(form, "reference"),
          note: formText(form, "note")
        })
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update transaction.");
    }
  }

  return (
    <Dialog title="Correct transaction" open={Boolean(transaction)} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Member"><select name="member_id" defaultValue={transaction.member_id} required>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name} · {member.membership_number}</option>)}</select></Field>
        <Field label="Amount (INR)"><input name="amount" inputMode="decimal" defaultValue={paiseToRupees(transaction.amount_paise)} required /></Field>
        <Field label="Date"><input name="transaction_date" type="date" defaultValue={transaction.transaction_date} required /></Field>
        <Field label="Method"><select name="payment_method" defaultValue={transaction.payment_method}><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select></Field>
        <Field label="Type"><select name="transaction_type" defaultValue={transaction.transaction_type}><option value="membership_payment">Membership payment</option><option value="renewal_payment">Renewal payment</option><option value="correction">Correction</option><option value="refund">Refund</option></select></Field>
        <Field label="Reference"><input name="reference" defaultValue={transaction.reference ?? ""} /></Field>
        <Field label="Note"><input name="note" defaultValue={transaction.note ?? ""} /></Field>
        {error ? <p className="form-error full">{error}</p> : null}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit"><Save size={18} /> Save correction</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ReportsPage() {
  const [from, setFrom] = useState(`${quickDate().slice(0, 7)}-01`);
  const [to, setTo] = useState(quickDate());
  const [data, setData] = useState<ReportsPayload | null>(null);

  async function load() {
    setData(await api<ReportsPayload>(`/api/reports?from=${from}&to=${to}`));
  }

  useEffect(() => { void load(); }, [from, to]);

  return (
    <div className="page-grid">
      <section className="toolbar panel">
        <Field label="From"><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
      </section>
      {!data ? <Loading /> : (
        <>
          <section className="stat-grid">
            <ReportCard label="Members" value={data.total_members} />
            <ReportCard label="Active" value={data.active_members} />
            <ReportCard label="Expired" value={data.expired_members} />
            <ReportCard label="Collected" value={formatInr(data.payments_collected_paise)} />
            <ReportCard label="Outstanding" value={formatInr(data.outstanding_paise)} />
            <ReportCard label="Renewals" value={data.renewals} />
          </section>
          <section className="panel">
            <h2>Payment methods</h2>
            <div className="compact-list">
              {data.method_breakdown.map((item) => <div className="compact-row" key={item.payment_method}><span>{item.payment_method}</span><small>{item.count} payments</small><strong>{formatInr(item.total_paise)}</strong></div>)}
            </div>
          </section>
          <section className="panel">
            <h2>Monthly collection</h2>
            <div className="bar-list">
              {data.monthly_collection.map((item) => <div key={item.month}><span>{item.month}</span><strong>{formatInr(item.total_paise)}</strong></div>)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ReportCard({ label, value }: { label: string; value: string | number }) {
  return <div className="stat-card slate"><span>{label}</span><strong>{value}</strong></div>;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [message, setMessage] = useState("");
  const priceDefaults = useMemo(() => settings?.plan_prices ?? { monthly: 0, quarterly: 0, half_yearly: 0, yearly: 0 }, [settings]);

  useEffect(() => { void api<SettingsPayload>("/api/settings").then(setSettings); }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      gym_name: formText(form, "gym_name"),
      contact_number: formText(form, "contact_number"),
      expiry_warning_days: Number(formText(form, "expiry_warning_days")),
      date_format: formText(form, "date_format"),
      time_zone: formText(form, "time_zone"),
      plan_prices: {
        monthly: paiseFromForm(form, "monthly"),
        quarterly: paiseFromForm(form, "quarterly"),
        half_yearly: paiseFromForm(form, "half_yearly"),
        yearly: paiseFromForm(form, "yearly")
      },
      reminder_template_expired: formText(form, "reminder_template_expired"),
      reminder_template_upcoming: formText(form, "reminder_template_upcoming"),
      reminder_template_renewal: formText(form, "reminder_template_renewal")
    };
    setSettings(await api<SettingsPayload>("/api/settings", { method: "PUT", body: jsonBody(body) }));
    setMessage("Settings saved.");
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/settings/password", {
      method: "POST",
      body: jsonBody({ currentPassword: formText(form, "currentPassword"), newPassword: formText(form, "newPassword") })
    });
    event.currentTarget.reset();
    setMessage("Password changed. Other sessions were signed out.");
  }

  if (!settings) return <Loading label="Loading settings" />;

  return (
    <div className="page-grid">
      <section className="panel">
        <h2>Gym settings</h2>
        <form className="form-grid" onSubmit={submit}>
          <Field label="Gym name"><input name="gym_name" defaultValue={settings.gym_name} /></Field>
          <Field label="Contact number"><input name="contact_number" defaultValue={settings.contact_number} /></Field>
          <Field label="Expiry warning days"><input name="expiry_warning_days" type="number" min="1" max="60" defaultValue={settings.expiry_warning_days} /></Field>
          <Field label="Date format"><input name="date_format" defaultValue={settings.date_format} /></Field>
          <Field label="Time zone"><input name="time_zone" defaultValue={settings.time_zone} /></Field>
          <Field label="Monthly price"><input name="monthly" defaultValue={paiseToRupees(priceDefaults.monthly)} /></Field>
          <Field label="Quarterly price"><input name="quarterly" defaultValue={paiseToRupees(priceDefaults.quarterly)} /></Field>
          <Field label="Half-yearly price"><input name="half_yearly" defaultValue={paiseToRupees(priceDefaults.half_yearly)} /></Field>
          <Field label="Yearly price"><input name="yearly" defaultValue={paiseToRupees(priceDefaults.yearly)} /></Field>
          <Field label="Expired template"><textarea name="reminder_template_expired" rows={5} defaultValue={settings.reminder_template_expired} /></Field>
          <Field label="Upcoming template"><textarea name="reminder_template_upcoming" rows={5} defaultValue={settings.reminder_template_upcoming} /></Field>
          <Field label="Renewal template"><textarea name="reminder_template_renewal" rows={5} defaultValue={settings.reminder_template_renewal} /></Field>
          <div className="dialog-actions"><Button type="submit"><Save size={18} /> Save settings</Button></div>
        </form>
      </section>
      <section className="panel">
        <h2>Change password</h2>
        <form className="form-grid" onSubmit={changePassword}>
          <Field label="Current password"><input name="currentPassword" type="password" required /></Field>
          <Field label="New password"><input name="newPassword" type="password" required minLength={10} /></Field>
          <div className="dialog-actions"><Button type="submit">Update password</Button></div>
        </form>
        {message ? <p className="success-text">{message}</p> : null}
      </section>
    </div>
  );
}

export function BackupPage() {
  const exports = [
    ["Members CSV", "/api/export/members", Download],
    ["Membership History CSV", "/api/export/membership-history", CalendarClock],
    ["Transactions CSV", "/api/export/transactions", Download],
    ["Report CSV", "/api/export/report", Download],
    ["Full JSON Backup", "/api/export/backup", FileJson]
  ] as const;

  return (
    <div className="page-grid">
      <section className="panel">
        <h2>Backup and export</h2>
        <p className="muted">Exports require login. The full JSON backup includes the schema version and all app-owned records.</p>
        <div className="export-grid">
          {exports.map(([label, path, Icon]) => (
            <button key={path} type="button" className="export-card" onClick={() => downloadUrl(path)}>
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>D1 independent backup</h2>
        <pre>npx wrangler d1 export vteam-fitness-hub --remote --output backup.sql</pre>
      </section>
    </div>
  );
}

export type { View, SessionPayload, SettingsPayload };
