PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  user_agent TEXT,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_owner_expires ON sessions(owner_id, expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  membership_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  mobile_number TEXT NOT NULL,
  normalized_mobile TEXT NOT NULL,
  email TEXT,
  gender TEXT,
  joining_date TEXT NOT NULL,
  duration_type TEXT NOT NULL,
  duration_value INTEGER NOT NULL,
  membership_start_date TEXT NOT NULL,
  membership_expiry_date TEXT NOT NULL,
  membership_price_paise INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  notes TEXT,
  archived_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_members_name ON members(full_name);
CREATE INDEX IF NOT EXISTS idx_members_mobile ON members(normalized_mobile);
CREATE INDEX IF NOT EXISTS idx_members_expiry ON members(membership_expiry_date);
CREATE INDEX IF NOT EXISTS idx_members_archived ON members(archived_at);
CREATE INDEX IF NOT EXISTS idx_members_deleted ON members(deleted_at);

CREATE TABLE IF NOT EXISTS membership_history (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  duration_type TEXT NOT NULL,
  duration_value INTEGER NOT NULL,
  price_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_membership_history_member ON membership_history(member_id);
CREATE INDEX IF NOT EXISTS idx_membership_history_expiry ON membership_history(expiry_date);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  membership_id TEXT,
  amount_paise INTEGER NOT NULL,
  transaction_date TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  reference TEXT,
  note TEXT,
  voided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id) REFERENCES membership_history(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_member ON transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_method ON transactions(payment_method);
CREATE INDEX IF NOT EXISTS idx_transactions_voided ON transactions(voided_at);

CREATE TABLE IF NOT EXISTS reminder_history (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  membership_id TEXT,
  template_type TEXT NOT NULL,
  message TEXT NOT NULL,
  whatsapp_url TEXT,
  prepared_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id) REFERENCES membership_history(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_member ON reminder_history(member_id);
CREATE INDEX IF NOT EXISTS idx_reminders_prepared ON reminder_history(prepared_at);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mobile_number TEXT,
  normalized_mobile TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS id_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT OR IGNORE INTO id_counters (name, value) VALUES ('member_number', 0);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('gym_name', 'V Team Fitness Hub'),
  ('contact_number', ''),
  ('currency', 'INR'),
  ('date_format', 'dd MMM yyyy'),
  ('time_zone', 'Asia/Kolkata'),
  ('expiry_warning_days', '10'),
  ('plan_prices', '{"monthly":100000,"quarterly":270000,"half_yearly":500000,"yearly":900000}'),
  ('reminder_template_expired', 'Hello {name},\n\nYour {duration} gym membership expired on {expiry_date}.\n\nPlease renew your membership as soon as possible.\n\nThank you,\n{gym_name}'),
  ('reminder_template_upcoming', 'Hello {name},\n\nYour {duration} gym membership will expire on {expiry_date}.\n\nPlease renew your membership to continue without interruption.\n\nThank you,\n{gym_name}'),
  ('reminder_template_renewal', 'Hello {name},\n\nYour {duration} gym membership is active from {start_date} to {expiry_date}.\nAmount: {amount}.\n\nThank you,\n{gym_name}');
