# IoTank Globalization & Production-Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Purge committed secrets, close RLS exposure, introduce a DB-driven jurisdiction registry, complete the Super Admin console, fix Firebase deployment, and leave both apps lint/type-check/test/build-green.

**Architecture:** DB-driven jurisdiction registry (Supabase tables + RPC → TanStack Query → `JurisdictionContext`) replaces hardcoded EPRA/KES/+254 logic; authority integrations move to pluggable edge adapters; Super Admin surfaces are wired to real RPCs/tables; RLS partitions are hardened with reusable helpers.

**Tech Stack:** React 18, TypeScript, Vite, Supabase (Postgres RLS, Deno Edge Functions), TanStack Query, Zustand, i18next, Firebase Hosting, jest.

**Reference:** `docs/superpowers/specs/2026-09-15-globalization-design.md` (approved). All audit evidence/line refs come from the Part A report.

**Baseline (verified):** `npm run lint`, `npm run type-check`, `npm test`, `npm run build` and `npm run --prefix "super Admin" lint/type-check` all green before work starts.

---

## Phase 0 — Secrets & deployment stop-the-bleeding (no architecture change)

### Task 0.1: Strip service-role secrets from firmware

**Files:**
- Modify: `firmware/Frustum_Content_Monitor.ino:14`
- Modify: `firmware/supabase_simulation/supabase_simulation.ino:22`
- Modify: `firmware/secrets.example.h`

**Steps:**
- [ ] Replace the inline `SUPABASE_SERVICE_ROLE_KEY` literal in both `.ino` files with `#include "secrets.h"` + a `SUPABASE_SERVICE_ROLE_KEY` extern (only where the sketch already includes Supabase.hpp), and reference the header constant. `firmware/secrets.h` is already git-ignored (copy from `secrets.example.h`).
- [ ] Update `secrets.example.h` to add a `SUPABASE_SERVICE_ROLE_KEY` placeholder line so the build pattern is documented.
- [ ] Verify: `rg -n "eyJhbGci|service_role|sb_secret" firmware/` returns only `secrets.example.h` placeholders.

### Task 0.2: Remove Paystack live keys from committed source

**Files:**
- Modify: `super Admin/src/components/Settings/ApiKeyManager.tsx:15-18`

**Steps:**
- [ ] Delete the hardcoded `sk_live_…` / `pk_live_…` literals; load from `import.meta.env.VITE_PAYSTACK_PUBLIC_KEY` / `VITE_PAYSTACK_SECRET_KEY` with placeholder display and a "configure via env" note when absent.
- [ ] Verify: `rg -n "sk_live|pk_live" "super Admin/src/"` → no matches.

### Task 0.3: Harden `.gitignore`, delete tracked debug artifacts

**Files:**
- Modify: `.gitignore`
- Delete (via `git rm`): root debug dumps, `.vs/`, `scratch/`, `supabase/.temp/`, `src/legacy_audit.csv`, `functions_backup.zip`, `super Admin/{build_output.txt,ts_errors.txt,fresh_ts_errors.txt,check_columns.js}`
- Archive (move off-repo, keep copy) BEFORE any delete: `migrations_backup.zip`
- `git rm --cached`: `sync_log.txt`, `sync_log_v2…v11.txt`, `push_debug.log`

**Steps:**
- [ ] Add to `.gitignore`: `*.zip`, `final_*`, `push_out.txt`, `local_schema_check*.txt`, `migration_error.txt`, `root_build_output.txt`, `ts_errors.txt`, `tsc_output.txt`, `schema.sql`, `scratch/`, `.vs/`, `supabase/.temp/`, `legacy_audit.csv`, `*.tsbuildinfo`.
- [ ] `cp migrations_backup.zip /tmp/opencode/` (off-repo archive), then remove from repo.
- [ ] `git rm --cached` the already-ignored logs; `git rm` the tracked dumps.
- [ ] Verify: `git status --short` shows only AGENTS.md/design/plan + in-work changes (no `sync_log*`, no dumps).

### Task 0.4: Firebase deploy determinism + CSP + cache

**Files:**
- Create: `.firebaserc`
- Modify: `firebase.json`
- Modify: root `package.json` (deploy scripts)

**Steps:**
- [ ] Create `.firebaserc`: `{ "projects": { "default": "the-iotank-project" } }`
- [ ] Pin deploy scripts: `deploy:client` → `firebase deploy --only hosting:the-iotank-project --project the-iotank-project`; same for admin site.
- [ ] firebase.json: add `https://js.paystack.co` to `script-src`/`script-src-elem`; add `https://checkout.paystack.com` to `frame-src`; add `https://api.paystack.co` to `connect-src`; remove deprecated `X-XSS-Protection`; dedupe `css` in the asset glob; add the `Cache-Control immutable` rule to the admin site.
- [ ] Verify: `node -e "JSON.parse(require('fs').readFileSync('firebase.json')); "` parses; `npm run type-check` still green.

### Task 0.5: `.env.example` doc sync

**Files:**
- Modify: `.env.example`

**Steps:**
- [ ] Add missing read-by-code vars: `VITE_PAYSTACK_PUBLIC_KEY`, `VITE_PAYSTACK_SECRET_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_DISABLE_REALTIME`, `VITE_ENABLE_DEBUG_TOOLS`, `VITE_ENABLE_GOVERNANCE_CONSOLE`, `VITE_MASTER_ACCESS_PASSWORD`, `VITE_JURISDICTION`.
- [ ] Remove stale keys: `VITE_GEMINI_API_KEY`, `VITE_GROQ_API_KEY`, `VITE_DEEPSEEK_API_KEY` (AI is server-side proxied).
- [ ] Verify: every `import.meta.env.VITE_*` read in `src/` and `super Admin/src/` has a documented entry (or is intentionally optional with a code default).

---

## Phase 1 — RLS hardening + jurisdiction schema (migration)

### Task 1.1: Write the hardening migration

**Files:**
- Create: `supabase/migrations/99999999000022_global_rls_jurisdiction.sql`

**Steps:**
- [ ] Enable RLS on `sensor_readings` parent + add same SELECT/INSERT policies as its partitions.
- [ ] Enable RLS on `unified_events_2026_08`…`2026_11` + attach the same station-scoped policies as `2026_03`.
- [ ] Fix `loss_reviews` select policy to resolve station membership via `auth.uid()` → `profiles` (replace the dead `auth.jwt()->>'station_id'` check).
- [ ] Revoke `internal` USAGE/EXECUTE from `anon` (keep `authenticated`).
- [ ] Add `internal.apply_partition_security(p_table regclass)` helper that enables RLS + attaches the canonical policy set (used by the monthly partition routine).
- [ ] Relax `market_prices_source_check` to include `'jurisdiction'`; add `ALTER TABLE` defaults for new jurisdiction columns below.
- [ ] Create `jurisdictions`, `jurisdiction_configs`, `report_templates` per spec §2 with RLS (SELECT for authenticated; admin-only via permissive function checks).
- [ ] Create `internal.get_jurisdiction_by_code(p_code text)` (SECURITY DEFINER, `SET search_path=`), returns the jurisdiction row; public wrapper RPC `get_jurisdiction_config(p_code text)` returning config JSONB + row.
- [ ] Add `daily_summaries.station_id uuid null` column; add `support_tickets.ticket_no text` + `support_tickets.sla_deadline timestamptz`; add `fuel_stations.region_code text`; add FK `daily_summaries.station_id → fuel_stations`.
- [ ] Seed `jurisdictions` (`GLOBAL` default + `KE`) and `jurisdiction_configs` rows (currency KES, locale en-KE, timezone EAT, regulatory body EPRA, pricing/price-cycle JSON from the audit's hardcoded values).
- [ ] `report_templates` seed row `epra_compliance_pack` as a JSON template snapshot.

**Python/JS not used — SQL only.** Verify syntax with `supabase db lint` locally against the stack if a local stack is up; otherwise confirm with `psql` parse or a reviewer.

### Task 1.2: Repair broken edge functions against real schema

**Files:**
- Modify: `supabase/functions/compliance-report-generator/index.ts` (rename + fix from `epra-compliance-generator`)
- Modify: `supabase/functions/dispatch-forensic-report/index.ts` (`.eq('id',…)` → `.eq('station_id',…)`, `display_name`)
- Modify: `supabase/functions/detect-leaks/index.ts` (drop `has_active_leak_alert`/`leak_confidence` writes or write to metadata JSONB added in bridge 00021)
- Modify: `supabase/functions/connectivity-watchdog/index.ts` (use `tank_name`/`sensor_id`)
- Modify: `supabase/functions/billing-automation/index.ts` (`profiles.display_name`)
- Modify: `supabase/functions/epra-compliance-generator` → replaced by `compliance-report-generator` (template-driven, `generated_by` uuid, `daily_summaries.station_id`, `profiles.display_name`)

**Steps:**
- [ ] Rewrite the compliance generator to read the active jurisdiction's `report_templates` row and write `reports(generated_by := auth_uid_or_null, report_type := template.code)`.
- [ ] Verify column/table references against the migration snapshot; no `full_name`, no fake columns.
- [ ] Delete the old `epra-compliance-generator/index.ts` (supabase CLI deploys from `functions/` dirs).

### Task 1.3: Edge price-authority adapters

**Files:**
- Create: `supabase/functions/_shared/price-authorities/types.ts`
- Create: `supabase/functions/_shared/price-authorities/generic.ts`
- Create: `supabase/functions/_shared/price-authorities/epra.ts`
- Create: `supabase/functions/_shared/price-authorities/eia.ts`
- Modify: `supabase/functions/official-scraper/index.ts` (consume `epra` adapter; remove hardcoded Ksh regex/price bands → config)
- Modify: `supabase/functions/exchange-rate-proxy/index.ts` (currency pair from `jurisdiction_configs`)

**Steps:**
- [ ] Define `interface PriceAuthorityAdapter { code: string; fetchLatestPrices(ctx): Promise<PriceRow[]>; mapRow(raw): PriceRow }`.
- [ ] `epra.ts` extracts the current URL/regex/band logic from `official-scraper` (gated by config `regulatory.price_cycle`).
- [ ] `generic.ts` returns empty/placeholder rows with clear logging.
- [ ] `official-scraper` reads `regulatory.adapter` from `get_jurisdiction_config` and dispatches; no hardcoded `epra.go.ke`/KES literal outside the adapter.
- [ ] Verify with `deno check` on functions (or `npx supabase functions serve` if stack up).

---

## Phase 2 — Client jurisdiction system

### Task 2.1: Jurisdiction context + hook (TDD)

**Files:**
- Create: `src/contexts/JurisdictionContext.tsx`
- Create: `src/hooks/useJurisdiction.ts`
- Create: `src/lib/jurisdiction.ts` (formatting helpers: money, locale, units, phone prefix)
- Test: `__tests__/jurisdiction.test.js`

**Steps:**
- [ ] Write failing test for formatting helpers (currency symbol/locale/phone prefix from a config object).
- [ ] Implement `jurisdiction.ts` pure helpers.
- [ ] Implement context: loads `get_jurisdiction_config` via `supabase.rpc`, caches in `queryClient`, exposes `{ config, jurisdiction, loading, error, isGlobal }`.
- [ ] Provider wraps `App` (inside `AuthProvider`); default to `GLOBAL` when unset.
- [ ] Run `npm test`; pass.

### Task 2.2: Swap currency formatting across both apps

**Files:**
- Modify: `src/utils/formatUtils.ts`, `src/utils/exportUtils.ts`, dashboard/analytics/billing/inventory components (all `KSh`/`KES` literals), `super Admin/src/pages/ClientDetails.tsx:330-342` (`Intl.NumberFormat('en-KE'…`)

**Steps:**
- [ ] Export `formatMoney(amount, cfg)` from `jest`-impplemented `jurisdiction.ts`; replace hardcoded `KSh`/`KES` JSX spans with `formatMoney` from `useJurisdiction()` (fallback default when config absent).
- [ ] `rg -n "KSh|KES" src super\ Admin/src` → wire each into the helper (keep `transactions` DB display parsed via currency field when present).
- [ ] `npm run type-check` green; `npm test` green.

### Task 2.3: De-Kenya market/news/intelligence logic

**Files:**
- Modify: `src/hooks/useMarketNews.ts` (source registry, `hl/gl/ceid` from config, price sanity band)
- Modify: `src/hooks/useMarketIntelligence.ts` (base prices from `jurisdiction_configs.pricing`)
- Modify: `src/hooks/useEPRANotifier.ts` (rename generic: regulatory notifier, name from config)
- Modify: `src/utils/directiveEngine.ts` (generic recommendation text, currency via helper)
- Modify: `src/services/MarketIntelligenceService.ts`, `src/services/ChatAIService.ts`, `src/services/TankIQService.ts`, `src/services/TankIQToolset.ts`, `src/components/Market/MarketConstants.ts`
- Modify: `supabase/functions/_shared/prompts.ts` (remove hardcoded Kenya/+254/KES; inject jurisdiction context)

**Steps:**
- [ ] `MarketConstants` reads registry/sub-sources from config with `GLOBAL` fallback (EIA/Reuters still fine).
- [ ] News locale params + sanity band come from config, not literals.
- [ ] Base price seeding: `useMarketIntelligence` seeds only from config; remove hardcoded price arrays.
- [ ] Rename `useEPRANotifier` → keep filename but read authority name/label from config (or introduce `useRegulatoryNotifier` and re-export for compat).
- [ ] Prompts: template strings get `${jurisdiction.regulatoryBody}` / currency; no more literal Kenya/+254.
- [ ] Verify: `rg -in "epra|kenya|KSh|KES|254" src --type ts --type tsx` reduced to config/seed/comment-only or i18n keys.

### Task 2.4: i18n wiring for UI strings

**Files:**
- Modify: `src/config/i18n.ts`, `src/i18n/en.json` (or existing translation resource), add `LANGUAGE` config-driven load.

**Steps:**
- [ ] Confirm i18next resource shape; add jurisdiction locale override (default `en`).
- [ ] Move the top ~20 marketing/legal/SEO strings into `en` resource keys; reference `useTranslation()`.
- [ ] `index.html` SEO: replace hardcoded Kenya SEO copy with `seo.ts` env/config-driven values.
- [ ] Verify default-appearance across pages (build + manual smoke via dev server if available).

---

## Phase 3 — Super Admin completion

### Task 3.1: Missing RPCs + tables (migration addendum `99999999000023_admin_rpcs.sql`)

**Files:**
- Create: `supabase/migrations/99999999000023_admin_rpcs.sql`

**Steps:**
- [ ] `internal.admin_suspend_station`, `admin_reactivate_station`, `admin_update_station_profile`, `admin_record_external_payment`, plus `p_full_name` admin self-update used by `systemUsersService`. All SECURITY DEFINER, `check level <= 4`, explicit search_path, no RLS-table self-selects (54001-safe).
- [ ] Public wrappers in the same names.
- [ ] Create `admin_logs`, `firmware_releases`, `financial_reports`, `scheduled_reports` per spec §4 with RLS (admin-level insert via helper; rows readable to levels 1-4).
- [ ] Verify: `rg -rn "admin_logs|firmware_releases|financial_reports|scheduled_reports" supabase/migrations` present; RPC declarations match `clientsService`/`systemUsersService` call signatures exactly.

### Task 3.2: Service fixes (Super Admin)

**Files:**
- Modify: `super Admin/src/services/clientsService.ts` (align to new RPCs, error surface)
- Modify: `super Admin/src/services/supportService.ts` (real columns/joins: `station_name`, assignee via `system_users`, SLA from `sla_deadline`) 
- Modify: `super Admin/src/services/hardwareService.ts` (event_category `SYSTEM`, firmware from `firmware_releases`)
- Modify: `super Admin/src/services/adminAuditService.ts` (`FINANCE`), `systemUsersService.ts` (drop `admin_logs` dependency → real table now), `analyticsService.ts` (real aggregates or honest empty), `billingService.ts` (embed alias `fuel_stations`, date-window filter), `dashboardService.ts` (surface errors)

**Steps:**
- [ ] Fix each divergence line from the audit table (Part A §3).
- [ ] Verify no fabricated metrics remain: `rg -n "50000|\\* 10|10000|Math.random" "super Admin/src/services/"` → clean.

### Task 3.3: Page wiring (Super Admin)

**Files:**
- Modify: `super Admin/src/pages/BillingList.tsx`, `ClientDetails.tsx`, `AuditCompliance.tsx`, `Announcements.tsx`, `HardwareMonitoring.tsx`, `SettingsPage.tsx`, `SupportTickets.tsx`, `AnalyticsReports.tsx`, `SystemUsers.tsx`, `AdminLogs.tsx`, `Dashboard.tsx`, `Sidebar.tsx` (in `components/Layout/`)

**Steps:**
- [ ] Wire the ~40 audit-listed buttons to their services; where a destination backend does not exist, replace the control with a clear "Coming soon" disabled state rather than a silent no-op.
- [ ] Remove `tactical map` fake coords & `last pulse` fake timestamps (derive from `devices`/`telemetry_history` or honest empty).
- [ ] `BillingList` renders the fetched transactions (fix alias + station name display + date filter).
- [ ] `Sidebar` "320 hubs / 99.9%" → real counts from `dashboardService` or honest empty.
- [ ] `AdminLogs` renders `admin_logs` rows (actor from `system_users`).
- [ ] `npm run --prefix "super Admin" lint && type-check` green.

### Task 3.4: Jurisdictions admin page

**Files:**
- Create: `super Admin/src/pages/Jurisdictions.tsx` (+ `.css` co-located)
- Create: `super Admin/src/services/jurisdictionService.ts`
- Modify: `super Admin/src/App.tsx` (add route, level 1-2 gate)

**Steps:**
- [ ] CRUD list/create/edit/activate jurisdictions + config key/value editor (JSONB) + report-template preview.
- [ ] Route `/jurisdictions` behind `ProtectedRoute requiredLevel={2}`.
- [ ] Wire via `supabase.rpc`/direct `admin_*` RPCs added in Task 3.1 (or SECURITY DEFINER CRUD helpers).
- [ ] `type-check` green.

---

## Phase 4 — Docs, tests, final verification

### Task 4.1: Tests

**Files:**
- Create: `__tests__/jurisdiction.test.js` (already in Task 2.1)
- Create: `__tests__/super-admin-contracts.test.js` (RLS/RPC contract stubs mirroring `security-abuse.test.js`: tenant-scoping, level gating, no password in payloads)

**Steps:**
- [ ] Write tests; `npm test` green (edge suite remains skipped).

### Task 4.2: Documentation

**Files:**
- Modify: `README.md`, `Documentation/PROJECT_SPEC.md`, `Documentation/EPRA_COMPLIANCE_GUIDE.md` (→ generic compliance guide + jurisdiction section), `AGENTS.md`, `docs/superpowers/specs/2026-09-15-globalization-design.md` (no change needed), add `Documentation/DEPLOYMENT_GUIDE.md` (new-country setup: add jurisdiction row, adapter, Firebase project, Supabase project)

**Steps:**
- [ ] Remove Kenya-only claims; describe jurisdiction-driven behavior; document `.env` matrix; document archive/rotation note for `migrations_backup.zip`.

### Task 4.3: Final verification gate

- [ ] `npm run lint && npm run type-check && npm test && npm run build`
- [ ] `npm run --prefix "super Admin" lint && npm run --prefix "super Admin" type-check && npm run build:admin`
- [ ] `git status` — expected: seed/migration/config/source changes only; no debug artifacts, no secrets new.
- [ ] `rg -n "sk_live|sb_secret|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSI" . --glob '!node_modules' --glob '!dist'` → no matches.

---

## Execution notes

- Commit per Task (frequent, small); working directly on `master` per user preference.
- Do NOT run `supabase db push`/`db reset` against remote; migrations are delivered as files + verified by static review (`supabase db lint` against local stack only if running).
- Do NOT touch `realtime.subscription_check_filters`, `dataconnect/`, or the Firebase Data Connect experiment.
- Migrations numbered `9999999900002x` must sort after existing `…00021` (per AGENTS.md).