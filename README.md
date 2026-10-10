# V Team Fitness Hub

V Team Fitness Hub is a small-gym membership management PWA built for Cloudflare Workers Static Assets and Cloudflare D1. It is designed for one gym owner/admin, 50-200 members, manual WhatsApp reminders, and free-tier-friendly hosting on a `*.workers.dev` URL.

## What Is Included

- React + TypeScript + Vite frontend
- Cloudflare Worker API served with the static frontend in one Worker
- Cloudflare D1 SQLite schema and migrations
- Secure owner setup, login, HttpOnly session cookies, CSRF protection, and password hashing
- Member CRUD, archive/restore/delete, membership renewal, membership history, and payments
- Dashboard counts, member filters, reports, CSV export, and full JSON backup export
- Editable gym settings and WhatsApp reminder templates
- PWA manifest, service worker, offline page, and install support

## Architecture

This project uses one Cloudflare Worker with Static Assets:

- Static app files are built to `dist/`.
- API requests under `/api/*` run through `src/worker/index.ts`.
- Persistent data is stored in D1 through the `DB` binding.
- Static assets use `assets.not_found_handling = "single-page-application"` so app routes work after refresh.

The configuration follows the current Cloudflare Workers Static Assets and D1 documentation:

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/d1/wrangler-commands/

No Firebase, Supabase, paid APIs, SMS providers, payment gateways, or WhatsApp Business API are used.

## Local Setup

Install dependencies:

```bash
npm install
```

Copy the local env example:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and set a long random `OWNER_SETUP_SECRET`.

Apply D1 migrations locally:

```bash
npm run db:migrate:local
```

Start local development:

```bash
npm run dev
```

Open the local URL shown by Wrangler, usually `http://localhost:8787`.

## First-Time Owner Setup

The app has no default password.

1. Set `OWNER_SETUP_SECRET` locally in `.dev.vars` or in production with `wrangler secret put OWNER_SETUP_SECRET`.
2. Open the app and choose "First-time owner setup" from the login screen.
3. Enter the setup secret, owner username, and a strong password.
4. After setup succeeds, remove local setup access by deleting or changing `OWNER_SETUP_SECRET` in `.dev.vars`.
5. In production, you may remove the secret after setup:

```bash
npx wrangler secret delete OWNER_SETUP_SECRET
```

The setup endpoint refuses to create another owner after an owner account exists.

## Cloudflare Deployment

Log in to Cloudflare:

```bash
npx wrangler login
```

Create the D1 database:

```bash
npx wrangler d1 create vteam-fitness-hub
```

Copy the returned `database_id` into `wrangler.jsonc` under `d1_databases[0].database_id`.

Set the setup secret:

```bash
npx wrangler secret put OWNER_SETUP_SECRET
```

Apply production migrations:

```bash
npm run db:migrate:remote
```

Build and deploy:

```bash
npm run build
npm run deploy
```

Expected deployed URL format:

```text
https://vteam-fitness-hub.<your-workers-subdomain>.workers.dev
```

## Backups

Use the in-app Backup screen for CSV exports and full JSON export. The export endpoints require login and CSRF protection.

For an independent D1 backup, use Wrangler:

```bash
npx wrangler d1 export vteam-fitness-hub --remote --output backup.sql
```

Verify the backup file exists and contains schema/data before making destructive changes.

## Scripts

```bash
npm run dev                # Wrangler dev server with static assets and API
npm run build              # TypeScript check and Vite production build
npm run test               # Vitest unit tests
npm run typecheck          # TypeScript check only
npm run wrangler:types     # Generate Cloudflare binding types
npm run db:migrate:local   # Apply D1 migrations locally
npm run db:migrate:remote  # Apply D1 migrations to production D1
npm run deploy             # Deploy to Cloudflare Workers
```

## Date and Money Rules

- Membership dates are stored as date-only `YYYY-MM-DD` strings.
- Calendar-month plans expire one day before the same calendar day after adding the plan months.
- Month-end starts are handled by using the first day of the following month as the exclusive boundary, so `2024-01-31` for one calendar month expires on `2024-02-29`.
- Day-based plans are inclusive, so a 30-day plan starting `2026-05-01` expires on `2026-05-30`.
- A membership is active through its expiry date and expired on the following local calendar day.
- Money is stored as integer paise and displayed as INR.

## Remaining Limitations

- Restore/import is intentionally not automatic. Full JSON backup export is implemented, but production restore should be reviewed before applying data.
- WhatsApp messages are prepared and opened manually. The app does not send, deliver, or read WhatsApp messages.
- Offline mode caches only safe static assets and an offline page. Private member/payment/report data is not cached for offline access.
- Deployment still requires the owner to run Cloudflare login, create the D1 database, set the setup secret, and deploy from their account.
