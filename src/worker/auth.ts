import { loginSchema, passwordChangeSchema, setupSchema } from "../shared/schemas";
import { nowIso } from "../shared/date";
import type { AppEnv } from "./app-env";
import { HttpError, json, parseJson } from "./http";

const SESSION_COOKIE = "vteam_session";
const SESSION_DAYS = 7;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const PASSWORD_ITERATIONS = 210_000;

interface OwnerRow {
  id: string;
  username: string;
  password_hash: string;
}

interface SessionRow {
  id: string;
  owner_id: string;
  username: string;
  csrf_token: string;
  expires_at: string;
}

interface LoginAttemptRow {
  ip: string;
  attempts: number;
  window_started_at: string;
  locked_until: string | null;
}

export interface AuthSession {
  sessionId: string;
  ownerId: string;
  username: string;
  csrfToken: string;
}

function textEncoder(): TextEncoder {
  return new TextEncoder();
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function secureBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomBytesHex(length: number): string {
  const bytes = secureBytes(length);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", textEncoder().encode(value));
  return bufferToHex(hash);
}

async function timingSafeTextEqual(a: string, b: string): Promise<boolean> {
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder().encode(a)),
    crypto.subtle.digest("SHA-256", textEncoder().encode(b))
  ]);
  return constantTimeEqual(new Uint8Array(aHash), new Uint8Array(bHash));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = secureBytes(16);
  const key = await crypto.subtle.importKey("raw", textEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, expectedText] = storedHash.split("$");
  if (algorithm !== "pbkdf2-sha256" || !iterationsText || !saltText || !expectedText) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;
  const salt = base64ToBytes(saltText);
  const expected = base64ToBytes(expectedText);
  const key = await crypto.subtle.importKey("raw", textEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return constantTimeEqual(new Uint8Array(bits), expected);
}

function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  const header = request.headers.get("cookie");
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName) cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }
  return cookies;
}

function sessionCookie(token: string, request: Request, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function expiredSessionCookie(request: Request): string {
  return sessionCookie("", request, 0);
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

async function ownerCount(env: AppEnv): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM owners").first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function checkLoginThrottle(env: AppEnv, request: Request): Promise<void> {
  const ip = clientIp(request);
  const row = await env.DB.prepare("SELECT * FROM login_attempts WHERE ip = ?").bind(ip).first<LoginAttemptRow>();
  const now = Date.now();
  if (row?.locked_until && Date.parse(row.locked_until) > now) {
    throw new HttpError(429, "Too many login attempts. Try again later.");
  }
}

async function recordLoginFailure(env: AppEnv, request: Request): Promise<void> {
  const ip = clientIp(request);
  const now = Date.now();
  const row = await env.DB.prepare("SELECT * FROM login_attempts WHERE ip = ?").bind(ip).first<LoginAttemptRow>();
  const windowStarted = row ? Date.parse(row.window_started_at) : 0;
  const resetWindow = !row || now - windowStarted > LOGIN_WINDOW_MS;
  const attempts = resetWindow ? 1 : row.attempts + 1;
  const lockedUntil = attempts >= MAX_LOGIN_ATTEMPTS ? new Date(now + LOGIN_LOCK_MS).toISOString() : null;

  await env.DB.prepare(
    `INSERT INTO login_attempts (ip, attempts, window_started_at, locked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at, locked_until = excluded.locked_until`
  )
    .bind(ip, attempts, resetWindow ? new Date(now).toISOString() : row?.window_started_at ?? new Date(now).toISOString(), lockedUntil)
    .run();
}

async function clearLoginFailures(env: AppEnv, request: Request): Promise<void> {
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(clientIp(request)).run();
}

export async function getSession(request: Request, env: AppEnv, ctx?: ExecutionContext): Promise<AuthSession | null> {
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT sessions.id, sessions.owner_id, sessions.csrf_token, sessions.expires_at, owners.username
     FROM sessions
     JOIN owners ON owners.id = sessions.owner_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
  )
    .bind(tokenHash, nowIso())
    .first<SessionRow>();

  if (!row) return null;
  ctx?.waitUntil(env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(nowIso(), row.id).run());
  return { sessionId: row.id, ownerId: row.owner_id, username: row.username, csrfToken: row.csrf_token };
}

export async function requireSession(request: Request, env: AppEnv, ctx?: ExecutionContext): Promise<AuthSession> {
  const session = await getSession(request, env, ctx);
  if (!session) throw new HttpError(401, "Authentication required.");
  return session;
}

export function requireCsrf(request: Request, session: AuthSession): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const provided = request.headers.get("x-csrf-token");
  if (!provided || provided !== session.csrfToken) {
    throw new HttpError(403, "CSRF token is missing or invalid.");
  }
}

async function createSessionResponse(request: Request, env: AppEnv, owner: OwnerRow): Promise<Response> {
  const token = randomBytesHex(32);
  const csrfToken = randomBytesHex(32);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (id, owner_id, token_hash, csrf_token, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(sessionId, owner.id, await sha256Hex(token), csrfToken, expiresAt, request.headers.get("user-agent") ?? "")
    .run();

  return json(
    { user: { username: owner.username }, csrfToken },
    200,
    { "Set-Cookie": sessionCookie(token, request, SESSION_DAYS * 24 * 60 * 60) }
  );
}

export async function handleSetup(request: Request, env: AppEnv): Promise<Response> {
  const count = await ownerCount(env);
  if (count > 0) {
    throw new HttpError(409, "Owner setup has already been completed.");
  }
  if (!env.OWNER_SETUP_SECRET) {
    throw new HttpError(503, "Owner setup secret is not configured.");
  }
  const payload = await parseJson(request, setupSchema);
  if (!(await timingSafeTextEqual(payload.setupSecret, env.OWNER_SETUP_SECRET))) {
    throw new HttpError(403, "Invalid setup secret.");
  }

  const owner: OwnerRow = {
    id: crypto.randomUUID(),
    username: payload.username,
    password_hash: await hashPassword(payload.password)
  };
  await env.DB.prepare("INSERT INTO owners (id, username, password_hash) VALUES (?, ?, ?)")
    .bind(owner.id, owner.username, owner.password_hash)
    .run();
  return createSessionResponse(request, env, owner);
}

export async function handleLogin(request: Request, env: AppEnv): Promise<Response> {
  await checkLoginThrottle(env, request);
  const payload = await parseJson(request, loginSchema);
  const owner = await env.DB.prepare("SELECT * FROM owners WHERE username = ?").bind(payload.username).first<OwnerRow>();
  if (!owner || !(await verifyPassword(payload.password, owner.password_hash))) {
    await recordLoginFailure(env, request);
    throw new HttpError(401, "Invalid username or password.");
  }
  await clearLoginFailures(env, request);
  await env.DB.prepare("DELETE FROM sessions WHERE owner_id = ? AND expires_at <= ?").bind(owner.id, nowIso()).run();
  return createSessionResponse(request, env, owner);
}

export async function handleLogout(request: Request, env: AppEnv, session: AuthSession): Promise<Response> {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(session.sessionId).run();
  return json({ ok: true }, 200, { "Set-Cookie": expiredSessionCookie(request) });
}

export async function handleMe(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  const session = await getSession(request, env, ctx);
  return json({ authenticated: Boolean(session), user: session ? { username: session.username } : null, csrfToken: session?.csrfToken ?? null });
}

export async function handlePasswordChange(request: Request, env: AppEnv, session: AuthSession): Promise<Response> {
  const payload = await parseJson(request, passwordChangeSchema);
  const owner = await env.DB.prepare("SELECT * FROM owners WHERE id = ?").bind(session.ownerId).first<OwnerRow>();
  if (!owner || !(await verifyPassword(payload.currentPassword, owner.password_hash))) {
    throw new HttpError(403, "Current password is incorrect.");
  }
  await env.DB.prepare("UPDATE owners SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(await hashPassword(payload.newPassword), nowIso(), session.ownerId)
    .run();
  await env.DB.prepare("DELETE FROM sessions WHERE owner_id = ? AND id <> ?").bind(session.ownerId, session.sessionId).run();
  return json({ ok: true });
}
