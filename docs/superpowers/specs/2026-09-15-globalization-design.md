# IoTank Globalization & Production-Readiness — Design Spec

Date: 2026-09-15. Status: Approved (config architecture = DB-driven registry; ship direct on master; one pass).

## 1. Goals

1. Stop the bleeding: purge tracked secrets, RLS exposure, blocked deploy pipeline.
2. Globalize: externalize all Kenya-specific (EPRA, KES, county, +254, M-Pesa, EAT) logic/data into a runtime jurisdiction registry.
3. Complete the Super Admin governance console (missing RPCs, tables, wiring, no fabricated metrics).
4. Ship clean: docs, tests, lint/type-check/build green for both apps.

## 2. Jurisdiction configuration system (Approach A: DB-driven)

- **Tables** (new migration `99999999000022_…`):
  - `jurisdictions(id uuid pk, code text unique, name text, currency_code text, currency_symbol text, locale text, timezone text, phone_prefix text, units text default 'liters', regulatory_body jsonb, pricing jsonb, tax jsonb, report_meta jsonb, created_at, updated_at)`
  - `jurisdiction_configs(jurisdiction_id fk, key text, value jsonb, primary key (jurisdiction_id,key))` — free-form overrides.
  - `report_templates(id, jurisdiction_id nullable, code, name, schema jsonb, version, active)` — JSON compliance templates.
  - Seed a default `GLOBAL` record plus `KE` Kenya-record carrying current values.
- **Access**: `internal.get_jurisdiction_by_code(code)` + public wrapper RPC `get_jurisdiction_config(p_code)` (SECURITY DEFINER, search_path locked); only static non-secret config exposed to client.
- **Client**: `src/contexts/JurisdictionContext.tsx` provider + `useJurisdiction()` hook; TanStack Query caches; currency/date formatting via `Intl` from `locale`/`currency_code`. i18n: extend existing `src/config/i18n.ts` (i18next already in the stack); default locale from jurisdiction.
- **Edge adapters**: `supabase/functions/_shared/price-authorities/{generic,epra,eia}.ts` implementing `{ id, fetchLatestPrices(), mapRow() }`; a registry picks the adapter from `jurisdiction_configs.regulatory.adapter`. `official-scraper` becomes an adapter consumer. `gemini/groq/deepseek/news` proxies keep working, only prompts/context become config-driven (no hardcoded "Kenya", "+254", "KES").
- **Currency/payment**: payment-provider list from config; `MPESA` provider only active when jurisdiction config lists it; `transactions`/`billing_*` CHECK constraints relaxed to `accepted` enum set + new values, currency validated at app layer.
- **Super Admin**: new `Jurisdictions.tsx` page (list/create/edit/activate + config editor + template editor) gated to levels 1-2.

## 3. RLS / schema hardening (same migration train)

- Enable RLS on `sensor_readings` parent; apply select/insert policies matching partition policies.
- Add RLS to `unified_events_2026_08…11` partitions with the same per-partition policies as 03-06/pre_partition.
- Fix `loss_reviews` policy (use `auth.uid()` → profiles → station_id, not a nonexistent JWT claim).
- Bridge 00018: revoke `internal` USAGE/EXECUTE from `anon` (retain for `authenticated` only where actually needed).
- New partitions: add a helper `internal.apply_partition_security(p_table)` documented for the monthly partition routine; relax market_prices source CHECK to include future sources; keep the outstanding `realtime.subscription_check_filters` bug OUT of migrations (per AGENTS.md).

## 4. Missing backend surfaces (Super Admin)

- **RPCs** (internal + public wrappers, SECURITY DEFINER, RLS-safe): `admin_suspend_station`, `admin_reactivate_station`, `admin_update_station_profile`, `admin_record_external_payment`, `admin_update_profile` (p_full_name one already referenced by `systemUsersService`).
- **Tables**: `admin_logs` (id, actor auth_user_id, action, target, detail jsonb, created_at), `firmware_releases` (id, version, file_url, notes, released_at), `financial_reports` (id, station_id, period, kind, data jsonb, created_at), `scheduled_reports` (id, station_id nullable, kind, cron, config jsonb, last_run_at, next_run_at).
- Fix `unified_events.event_category` writes (`FINANCE`, not `FINANCIAL`; no HARDWARE — map to SYSTEM) in `hardwareService`/`adminAuditService`.
- Fix `support_tickets`: add `ticket_no`, `sla_deadline`; fix joins (`fuel_stations.station_name`, assignee from `system_users`); `SupportTickets` uses real columns; seed SLA response stats from DB query.
- Fix `BillingList` embed alias mismatch (`station` vs `fuel_stations`).
- Repair `epra-compliance-generator` → generic `compliance-report-generator` aligned to actual schema (`daily_summaries.station_id` add + `profiles.display_name` + `reports.generated_by uuid` + template-driven).
- `tank_analytics_30d`: point at partitioned `sensor_readings`; `detect-leaks`/`dispatch-forensic-report`/`connectivity-watchdog` column fixes.
- Replace fabricated metrics with real aggregates in `analyticsService`, `AuditCompliance`, `Announcements`, `Sidebar`, `HardwareMonitoring` (or honest empty states when no data).

## 5. Deployment / DevOps

- Add `.firebaserc` (`default: the-iotank-project`); pin `--project` in deploy scripts.
- CSP: add `https://js.paystack.co` (script-src), `https://checkout.paystack.com` (frame-src), `https://api.paystack.co` (connect-src). Prune dead origins; dedupe `css` glob; add admin-site immutable cache header; drop deprecated `X-XSS-Protection`.
- `.env.example`: document all live vars (`VITE_PAYSTACK_PUBLIC_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_JURISDICTION`, `VITE_ENABLE_*`, `VITE_MASTER_ACCESS_PASSWORD`); remove stale LLM keys.
- Secrets: replace service-role literals in `firmware/*.ino` with `secrets.h` includes; remove Paystack live keys from `ApiKeyManager.tsx` (env + placeholder only); delete/untrack `supabase/.temp`, `scratch/`, `legacy_audit.csv`, and all tracked debug dumps; archive `migrations_backup.zip` off-repo (keep as recovery source); add `*.zip`, `final_*`, `scratch/`, `supabase/.temp/`, `.vs/` to `.gitignore`.

## 6. Non-goals (deferred, noted only)

- Do not implement Firebase Cloud Functions (architecture is Supabase-centric; functions_backup.zip is redundant).
- Do not "fix" `realtime.subscription_check_filters` in local migrations (Supabase-side issue, tracked in SUPABASE_FOLLOWUP_TICKET.md).
- Keep `dataconnect/` vestigial experiment untouched.