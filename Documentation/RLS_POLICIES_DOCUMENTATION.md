# Row-Level Security (RLS) Policy Documentation

## Overview
This document details the RLS policies implemented in the IoTank V2 system to ensure multi-tenant isolation and role-based access control.

---

## Authentication Levels
Refer to `PROJECT_SPEC.md` for the full 8-level hierarchy description.

---

## Core Security Functions

### `get_station_id_from_auth()`
**Purpose**: Securely retrieves the current user's `station_id` from their profile.
**Security Tier**: `SECURITY DEFINER` (executes with database owner privileges).
**Usage**: The primary filter for all organization-owned records.

### `is_admin()`
**Purpose**: Checks if the `auth.uid()` exists in the `system_users` table with an active admin role (Levels 1-4).
**Usage**: Allows platform oversight bypass.

---

## Data Access Policies by Table

### `fuel_stations` (Core Organization)
**RLS**: Enabled.
- **SELECT**: Users can only see their own station record where `id = get_station_id_from_auth()`.
- **INSERT/UPDATE**: Highly restricted to System Admins (Levels 1-2).

### `tanks` & `sites`
**RLS**: Enabled.
- **SELECT**: Filtered by `station_id = get_station_id_from_auth()`.
- **Operators (Level 7)**: Restricted to tanks/sites listed in their `profiles.site_ids` array.

### `sensor_readings`
**RLS**: Enabled.
- **SELECT**: Access granted if the linked `tank_id` belongs to the user's `station_id`.
- **INSERT**: Device keys only or specific device-role identities.

### `unified_events` (Forensic Stream)
**RLS**: Enabled.
- **SELECT**: Organization members can view events where `station_id = get_station_id_from_auth()`.
- **INSERT**: All authenticated actions trigger a log, but direct INSERT is restricted.

### `device_commands`
**RLS**: Enabled.
- **SELECT**: Viewable by Station Admins/Supervisors. `devices can view their station commands` (`TO device`, `auth.jwt()->>'station_id'` match).
- **INSERT**: Restricted to Level 6 (Supervisor) or higher (`TO authenticated`).
- **UPDATE**: Devices may ack their own station's commands (`TO device`).

### Hardware `device` role (migration `99999999000038`)
- Postgres role `device` (NOLOGIN, member of `authenticator`) so PostgREST can `SET ROLE` for `issue-device-token` JWTs.
- Table grants: `device_commands` SELECT/UPDATE; `sensor_readings`/`telemetry_history` INSERT; `tanks`/`volume_lookup_tables` SELECT.
- Policies `TO device`: `device_commands` SELECT (station-scoped), `tanks` SELECT (station-scoped), `volume_lookup_tables` SELECT (global).

### `telemetry_history` / `edge_rate_limits` / `scraper_rate_limits` (migration `99999999000037`)
- Staff (`check_is_staff()`) SELECT policies added so the Super Admin console can inspect them; inserts remain device/service-only.

### Storage buckets (migration `99999999000039`)
- `uploads` and `forensic-attachments` flipped to **private** (`storage.buckets.public = false`).
- `storage.objects` SELECT (and forensic INSERT) policies added `TO authenticated`, scoped by `get_station_id_from_auth()` folder match or `check_is_staff()`; app reads use `createSignedUrl` via `resolveStorageUrl()`.
- `profile-photos` stays public (branding/avatars).

---

## Privileged Operations (RPC)

Critical actions bypass RLS via `SECURITY DEFINER` logic but implement internal permission checks:

1. **`get_station_dashboard_summary(UUID)`**: Aggregates identity and station data in a single transactional call.
2. **`admin_adjust_station_debt(...)`**: Requires Level 1 or 2 system access.
3. **`admin_suspend_station(...)`**: Global suspension capability for administrators.

### Guards added in migration `99999999000037`
`get_business_kpis_v2`, `get_supplier_reliability_score`, `cleanup_old_events`, `cleanup_old_rss_cache`, `check_index_exists`, `detect_theft_anomaly`, `refresh_tank_analytics` now require staff/ownership; EXECUTE was revoked from PUBLIC/anon and granted to `authenticated`/`service_role`. `detect_theft_anomaly` was also fixed to use `captured_at` (the partitioned column).

---

## Policy Versions

| Version | Date | Changes |
|---------|------|---------|
| 1.3 | 2026-04-14 | **Major Refactor**: Transitioned from `client_id` to `station_id` and added `DeviceCommand` isolation. |
| 1.4 | 2026-09-17 | Migrations `00033`–`00039`: device-role wiring + grants, staff SELECT policies, orphan-RPC guards, partition maintenance/realtime, jurisdiction config + billing plan access, private document buckets + storage read policies. |

---
**Last Updated**: April 14, 2026
