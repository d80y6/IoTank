# AGENTS.md — IoTank Fuel Intelligence Hub

React 18 + TypeScript + Vite fuel-tank monitoring platform. Multi-tenant (per-`station_id`), 8-level RBAC, Supabase backend (Postgres + RLS + Realtime + Deno Edge Functions), hosted on Firebase. Read `Documentation/PROJECT_SPEC.md` first — it is the project's AI "memory card" and is maintained on schema/architecture changes.

## Repo layout

- **Root = client app** (`src/`), routed via `src/App.tsx` with lazy pages + `ProtectedRoute requiredLevel`. Deploys to Firebase site `the-iotank-project`.
- **`super Admin/` = separate governance console** (docs call it the Super Admin console, see `Documentation/SuperAdmin/README.md`). Own `package.json`/vite/tsconfig; shares root `src/` code through the `@shared` alias (`vite.config.ts` maps `@shared` → `../src`, tsconfig too). Deploys to Firebase site `the-admin-iotank`. Run its scripts with `--prefix "super Admin"`.
- **`supabase/`**: `functions/<name>/index.ts` (Deno Edge Functions), `migrations/`, `seed.sql`, local CLI config (`project_id = iotank-v2`).
- **`firmware/`**: ESP32 Arduino sketches — telemetry push and a Realtime C2 listener on the `device_commands` table.
- **`dataconnect/` + `src/dataconnect-generated/`**: vestigial Firebase Data Connect experiment. The `@dataconnect/generated` dep is unused by app code; leave alone. The **real backend is Supabase**, not Firebase (Firebase is only hosting + legacy admin login keys).
- **`Documentation/`** also holds `RLS_POLICIES_DOCUMENTATION.md`, `EPRA_COMPLIANCE_GUIDE.md`, `FORENSIC_THEFT_DETECTION.md`, `SUPABASE_RUNBOOK_RLS_STACKDEPTH.md`, and `SuperAdmin/README.md`.

## Commands

```bash
npm install                      # root install
npm run dev                      # client on http://localhost:3001
npm run dev --prefix "super Admin"   # admin console on http://localhost:5174
npm run lint && npm run type-check && npm run test && npm run build   # verify client
npm run --prefix "super Admin" lint && npm run --prefix "super Admin" type-check   # verify admin
```

Root aliases exist: `dev:admin`, `build:admin`, `pre-deploy` (= type-check && test && build), `deploy:client` / `deploy:admin` / `deploy:all` (Firebase hosting). All of lint, type-check (both apps), jest, and `vite build` currently pass.

- **Tests**: jest with no config file; default discovery covers `__tests__/*.test.js`. The edge-runtime suite is skipped unless `RUN_EDGE_INTEGRATION=1 npm run test:integration:edge`, which requires a local Supabase stack on port 54321 plus `TEST_ADMIN_*` env.
- **Supabase CLI** is installed and seeded for local work: `supabase start`, then `scripts/dev-setup.sh` provisions `admin@iotank.local` / `test1234` as `super_admin`+`owner` with a test station. `npm run db:migrate` = `supabase db push`, `db:reset`, `db:seed` exist.
- **`scripts/dev-setup.sh`, `supabase/functions/.env`** hold local-only secrets and are git-ignored — never commit real secrets; never put secrets in committed files.

## Architecture facts

- Single Supabase client: `src/config/supabase.ts` (also `super Admin/src/config/supabase.ts`). It persists auth to `sessionStorage` (key `iotank_session`) for XSS containment (HIGH-001) — do not switch to localStorage or create ad-hoc clients. Early logout on hot-reload has been mitigated via a no-op `lock`; preserve that.
- Identity column is `auth_user_id` (migrated from legacy `firebase_uid`). Most tables are partitioned by `station_id`. RBAC is an 8-level hierarchy, enforced in RLS + `ProtectedRoute requiredLevel`; the concept of "levels 1-8" is defined in `Documentation/PROJECT_SPEC.md`.
- **Globalization / Jurisdiction Registry**: DB-driven `jurisdictions` table (migration `99999999000022`). Each `fuel_station` has `jurisdiction_code` FK. `JurisdictionContext` + `useJurisdiction()` hook provides `{ jurisdiction, config, currencySymbol, currency, locale, phonePrefix, formatMoney }`. All Kenya hardcoding (EPRA, KES, Ksh, +254, Nairobi) removed — platform now supports arbitrary jurisdictions (KE, NG, ZA, US, etc.) with runtime config. Key de-Kenya patterns: `jurisdiction.regulatoryBody` replaces 'EPRA', `currencySymbol` replaces 'Ksh', `formatMoney()` replaces `toLocaleString('en-KE', {currency: 'KES'})`.
- Server state uses TanStack Query; UI state uses Zustand (`src/lib/queryClient.ts`). Business logic lives in `src/services/` (AlertDetectionEngine, ExportService for Regulatory Compliance Packs, DeviceCommandService, IntelligenceAIService via Gemini, AuditService writing to `unified_events`).
- Edge Functions are Deno, importing deps from `https://esm.sh/...`, reading secrets from `Deno.env.*`. Several LLM/news proxies (gemini-, groq-, deepseek-, news-api-proxy…) run `verify_jwt = false` in `supabase/config.toml` by design; the client owns key handling/rate limiting.
- Styling is primarily plain CSS (`src/styles/*.css` + co-located `*.css` in `super Admin/src/pages`), not Tailwind utilities.
- Path aliases in the client: `@/*`, `@components/*`, `@hooks/*`, `@utils/*`, `@contexts/*`, `@config/*`, `@types/*` → `src/`. In `super Admin`: `@/*` → both `super Admin/src` and `../src`, `@shared/*` → `../src`.

## Database / migrations quirks

- The `20260317*` migration files were **deleted from git** during the 20260428 RLS hardening and replaced with a full schema snapshot, `99999999000017_fix_alerts_unified_events_indexes.sql` (creates the `internal` schema and SECURITY DEFINER helpers), plus small "bridge" migrations `99999999000018…00021`. The remote already has the older migrations applied, so `supabase db push` only applies locals the remote hasn't seen. Author new migrations to sort after `99999999000021`; do not try to reconstruct the deleted history.
- RLS gotchas and the 54001 stack-depth / 403 playbook: `Documentation/SUPABASE_RUNBOOK_RLS_STACKDEPTH.md`. Avoid policy subselects; guard against `SECURITY DEFINER` functions re-querying RLS-protected tables.
- **Outstanding production issue**: `realtime.subscription_check_filters` has invalid syntax (Supabase-side, unfixed — see `SUPABASE_FOLLOWUP_TICKET.md`); realtime subscriptions *with filters* may fail. Don't "fix" this in local migrations.

## Gotchas

- `eslint.config.js` deliberately disables many rules (`no-explicit-any`, `no-unused-vars`, react-hooks reactivity rules) — lint passing is the bar; don't re-enable those.
- Client `vite build` runs Brotli compression except on Windows (check in `vite.config.ts`); CI/Linux emits `.br` assets.
- PWA is injectManifest with `src/sw.js`; hard-refresh/clear cache when behavior looks stale after changes.
- The repo tracks many historic debug artifacts at the root (`sync_log*.txt`, `*.json` lint dumps, `final_*` check files, `*_backup.zip`). Don't add new ones; treat them as noise.