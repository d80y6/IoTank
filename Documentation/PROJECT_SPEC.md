# IoTank Fuel Intelligence Hub - Technical Specification (Client App)

> **CRITICAL INSTRUCTION FOR AI ASSISTANTS**: This document is the project's "memory card". Because AI assistants have context windows, this document provides the necessary architectural context across sessions. It **MUST be continuously updated** whenever there are structural, architectural, or significant database schema changes.

## 1. Architecture Overview
- **Frontend Core**: React 18 + TypeScript + Vite
- **Styling**: Vanilla CSS + Tailwind UTILITY
- **State Management**: **Zustand** + **TanStack Query** (standardized server state)
- **Database**: Supabase PostgreSQL
- **Authentication**: **Supabase Auth** (Unified layer with MFA)
- **API Layer**: Supabase Client (JS/TS SDK) + RPC Functions
- **Hosting**: Firebase Hosting (Production Edge Delivery)
- **Real-time Engine**: Supabase Real-time (Postgres Changes)
- **Cloud Logic**: Supabase Edge Functions (Deno)
- **Globalization**: DB-driven jurisdiction registry (`jurisdictions` table, `jurisdiction_config` JSONB), 8-level RBAC, multi-tenant per `station_id`, dynamic currency/locale/regulatory-body via `JurisdictionContext` + `useJurisdiction()` hook. Kenya hardcoding (EPRA, KES, Ksh, +254, Nairobi) fully removed; platform now supports arbitrary jurisdictions (KE, NG, ZA, US, etc.) with runtime config.

## 1b. Multi-App Architecture
- **Root App** (`src/`): Client fuel-monitoring platform, deploys to Firebase `the-iotank-project`.
- **Super Admin Console** (`super Admin/`): Governance console, separate `package.json`/vite/tsconfig, shares root `src/` via `@shared` alias (`@shared/*` → `../src/*`). Deploys to Firebase `the-admin-iotank`.

## 2. Multi-Tenancy & Identity
The platform is fully multi-tenant, centered around the **Station** entity.
- **Identity Unification**: All users are linked via `auth_user_id` (standardized from legacy `firebase_uid`).
- **Station Context**: Most data is partitioned by `station_id`.
- **Identity Handshake**: On login, `AuthContext` performs a handshake to verify the user's station association and permissions tier.
- **Jurisdiction Registry**: Each `fuel_station` has `jurisdiction_code` FK to `jurisdictions` table. Default `GLOBAL` jurisdiction provides USD/en-US fallbacks. Station-specific config drives currency, locale, regulatory body, phone prefix, price bands, and compliance days.

## 3. Security & RBAC Hierarchy
A unified 8-level hierarchy is enforced:
- **Level 1: System Owner** (`super_admin`) - Full platform control.
- **Level 2: Team Lead** (`admin_helper`) - Operational management.
- **Level 3: Support Staff** (`support_staff`) - Registration and client support.
- **Level 4: Analyst** (`analyst`) - Read-only platform analysis.
- **Level 5: Station Admin** (`admin`/`owner`) - Full control over the organization's station.
- **Level 6: Station Supervisor** (`supervisor`) - Operational oversight for station sites.
- **Level 7: Station Operator** (`operator`) - Monitoring of assigned sites/tanks.
- **Level 8: Viewer** (`viewer`) - Read-only access.
- **Storage buckets (migration `99999999000039`)**: `uploads` (CSV/PDF docs, delivery BOLs) and `forensic-attachments` (variance evidence) are **private**; reads go through `resolveStorageUrl()` (`src/utils/storageUrl.ts`) which returns a short-lived signed URL (and passes through legacy absolute public URLs). `profile-photos` remains public by design. Storage RLS grants SELECT/INSERT to authenticated station members (`get_station_id_from_auth()` folder match) and staff (`check_is_staff()`).

## 4. Database Schema (Primary Tables)
- **`fuel_stations`**: Core organization metadata (formerly `client_billing`). Has `jurisdiction_code` FK to `jurisdictions`.
- **`jurisdictions`**: Global registry of regulatory jurisdictions. Columns: `code` (PK), `name`, `currency`, `currency_symbol`, `locale`, `timezone`, `phone_prefix`, `regulatory_body`, `country_code`, `is_active`, `is_global`, `config` (JSONB for pricing/regulatory adapters).
- **`profiles`**: User management linked to `auth_user_id` and `station_id`.
- **`sites`**: Multi-location mapping for station operations.
- **`tanks`**: Physical configuration, dimensions, and calibration.
- **`sensor_readings`**: High-frequency time-series data.
- **`alerts`**: System-generated events with severity levels.
- **`unified_events`**: Centralized forensic event stream for auditing.
- **`device_commands`**: Two-way IoT bridge for remote hardware control.
- **Telemetry wiring (migration 99999999000036)**: `sensor_readings` (partitioned, `captured_at` RANGE) is the LIVE firmware path — ESP32 sketches POST there (rssi inside `metadata`, no top-level `rssi` column). `latest_sensor_readings` view + triggers (`validate_reading_station_match`, `internal.validate_sensor_reading`, `update_tank_from_reading`) now run on the partitioned table; firmware-ack PATCHes (`status='processed'|'failed'`) are timestamped into `processed_at` by `internal.stamp_device_command_processed_at`. The legacy `sensor_readings_legacy` path and `handle_data_smoothing` (hardcoded prod URL) are kept for back-compat but are NOT the ingestion path.
- **`transactions`**: Immutable fiscal ledger.
- **`deliveries`**: Digital BOL tracking for reconciliation.
- **`shift_closures`**: Operational reconciliation records.
- **`security_telemetry_events`**: Critical-alert lifecycle consumed by the `dispatch-critical-alerts` Edge Function via PUBLIC wrappers `claim_pending_critical_alert_events` / `complete_critical_alert_event` (the internal-schema functions are NOT exposed by PostgREST; wrappers delegate as `service_role`).
- **Hardware device auth (migration 99999999000038)**: `issue-device-token` signs a JWT whose `role` claim is `device`, so a matching Postgres role `device` (NOLOGIN, member of `authenticator`) must exist for PostgREST `SET ROLE`. Grants: `device_commands` SELECT/UPDATE, `sensor_readings`/`telemetry_history` INSERT, `tanks`/`volume_lookup_tables` SELECT. RLS policies target `TO device` (station-scoped via `auth.jwt() ->> 'station_id'`); the legacy command policies are scoped `TO authenticated` so their `profiles` subselect is never evaluated for devices. Local tokens: `scripts/issue-device-token.sh` (calls the Edge Function, or signs directly with `JWT_SECRET`).
- **`volume_lookup_tables`**: Global dip→volume strap table keyed by `tank_type`; firmware fetches it after WiFi connect (`fetchVolumeLookup()` in `IoTank_ESP32_Template.ino`) and interpolates, with a linear fallback.
- **Orphan-endpoint wiring (migration 99999999000037)**: Previously dead RPCs/tables are now guarded and surfaced in the apps — data tools + diagnostics in the Super Admin `SystemUtilities` page (`/system`): `migrate_legacy_sensor_readings`, `backfill_events_pre_partition`, `cleanup_old_events`, `cleanup_old_rss_cache`, `refresh_tank_analytics`, identity probes (`check_is_staff`, `check_station_active`, …). `get_business_kpis_v2` backs Analytics KPIs; `tank_analytics_30d` (matview over partitioned `sensor_readings`) + `ai_recommendations` + `get_supplier_reliability_score` feed the "System Analytics" tab; `auth_events`/`edge_rate_limits`/`scraper_rate_limits`/`internal_api_keys` are viewable as staff; `detect_theft_anomaly` (fixed to `captured_at`) runs from Hardware Monitoring; `add_debt_to_client` from the client Billing page; `log_registration_event` from Pending Registrations; `log_auth_event` from the client sign-in flow; `delete_user_safely` from System Users; `jurisdiction_configs` CRUD on the Jurisdiction Registry; `billing_plans`/`billing_subscriptions` on the admin Billing "Plans & Subs" tab.
- **Partition maintenance**: cron `manage-sensor-readings-partitions` (`0 4 1 * *`, `internal.manage_sensor_readings_partitions()`), cron `refresh-tank-analytics` (`0 3 * * *`), and `sensor_readings` added to the `supabase_realtime` publication.

## 5. Service Engines (`src/services/`)
- **AlertDetectionEngine**: Forensic heuristics for theft (Open/Closed shifts) and telemetry gaps.
- **ExportService**: PDF/CSV generation including **Regulatory Compliance Packs** (jurisdiction-aware: `${regulatoryBody} Compliance Pack`, `${complianceDays}-Day`) and Delivery Audits.
- **DeviceCommandService**: Orchestrates hardware status changes and calibrations.
- **IntelligenceAIService**: Gemini-powered reconciliation and risk analysis.
- **AuditService**: Writes forensic logs to the `unified_events` stream.
- **Price Authority Adapter** (`_shared/price-authorities/`): Pluggable scrapers (EPRA, EIA, Generic) keyed by `jurisdiction.config.regulatory.adapter`. Edge Function `official-scraper` dispatches dynamically.

## 5b. Key Client Hooks & Utilities
- **`useJurisdiction()`**: Returns `{ jurisdiction, config, currencySymbol, currency, locale, phonePrefix, formatMoney }`. Wraps `JurisdictionContext` + React Query.
- **`formatMoney(amount, config)`**: Locale-aware currency formatting via `Intl.NumberFormat`.
- **`useMarketNews` / `useMarketIntelligence`**: Jurisdiction-parameterized news feeds and price extraction (`extractPricesFromText(text, basePrices?, currency='USD', band=[0,1000])`).
- **`useEPRANotifier`**: Realtime subscription on `market_prices` filtered by `jurisdiction.config.regulatory.adapter` (default 'epra').

## 5c. Super Admin Console (`super Admin/`)
- **Jurisdiction Registry** (`/jurisdictions`): CRUD for `jurisdictions` table via `jurisdictionsService.ts`.
- **Navigation**: Sidebar entry "jurisdictions" (Level 1 only).
- **Shared Imports**: Uses `@shared/*` → `../src/*` for jurisdiction lib, types, hooks.

## 6. Naming Conventions & Best Practices
- **DB Columns**: snake_case (always use `station_id` for organization links).
- **Functions**: camelCase.
- **Identity**: Always reference `auth_user_id` for forensic consistency.
- **Data Flow**: Use React Query for caching to minimize Supabase egress.
- **Globalization**: Never hardcode `KES`, `Ksh`, `EPRA`, `Kenya`, `Nairobi`, `+254`. Use `jurisdiction.currency`, `jurisdiction.currencySymbol`, `jurisdiction.regulatoryBody`, `jurisdiction.name`, `jurisdiction.phonePrefix`.

---
*Last Updated: September 16, 2026*
