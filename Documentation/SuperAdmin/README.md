# IoTank Governance Console (Super Admin) - Documentation Root

Welcome to the technical documentation for the Super Admin platform.

## 📁 Related Documents

- **[Technical Specification](file:///c:/Users/josep/Documents/The%20IoTank%20V2.0.0/Documentation/SuperAdmin/PROJECT_SPEC.md)**: Admin-specific architecture and RPC suites.
- **[Component Template](file:///c:/Users/josep/Documents/The%20IoTank%20V2.0.0/Documentation/SuperAdmin/COMPONENT_TEMPLATE.md)**: Standards for building administrative features.

## 🚀 Purpose

The Super Admin Console (Governance Console) serves as the control room for the IoTank ecosystem. It is responsible for:

1. **Station Onboarding**: Approving `pending_registrations`.
2. **Global Monitoring**: Tracking health and connectivity across all client stations.
3. **Fiscal Control**: Managing station standing, debt, and credit limits.
4. **Security Auditing**: Reviewing the global forensic stream (`unified_events`) and admin change logs (`audit_logs`).

# IoTank Governance Console (Super Admin) - Documentation Root

Welcome to the technical documentation for the Super Admin platform.

## 📁 Related Documents

- **[Technical Specification](file:///c:/Users/josep/Documents/The%20IoTank%20V2.0.0/Documentation/SuperAdmin/PROJECT_SPEC.md)**: Admin-specific architecture and RPC suites.
- **[Component Template](file:///c:/Users/josep/Documents/The%20IoTank%20V2.0.0/Documentation/SuperAdmin/COMPONENT_TEMPLATE.md)**: Standards for building administrative features.

## 🚀 Purpose

The Super Admin Console (Governance Console) serves as the control room for the IoTank ecosystem. It is responsible for:

1. **Station Onboarding**: Approving `pending_registrations`.
2. **Global Monitoring**: Tracking health and connectivity across all client stations.
3. **Fiscal Control**: Managing station standing, debt, and credit limits.
4. **Security Auditing**: Reviewing the global forensic stream (`unified_events`) and admin change logs (`audit_logs`).
5. **Jurisdiction Registry** (`/jurisdictions`): Managing the global `jurisdictions` table — CRUD for regulatory jurisdictions, currencies, locales, and compliance config. Level 1 only.

## 🛠️ Tech Stack & Aliases

- **Core**: React 18, TypeScript, Vite.
- **Backend**: Supabase (utilizing `service_role` equivalent access via secure RPCs).
- **Shared Access**: The console uses the `@shared` alias to reference root `src/` modules, ensuring identity and data logic consistency. Key shared imports:
  - `@shared/lib/jurisdiction` — `JurisdictionConfig`, `formatMoney`, `normalizeJurisdiction`, etc.
  - `@shared/hooks/useJurisdiction` — React hook for jurisdiction context.
  - `@shared/types` — `JurisdictionConfig`, `RegulatoryNotice`, etc.

## 🆕 New in v2.1 — Jurisdiction Registry

The `/jurisdictions` route (Level 1 only) provides a full CRUD UI for the `jurisdictions` table via `jurisdictionsService.ts`. Features:
- List all jurisdictions with code, name, regulatory body, currency, locale, phone prefix, active/global status.
- Create new jurisdiction with code, name, currency, symbol, locale, timezone, phone prefix, regulatory body, country code, config JSON.
- Edit existing (code immutable).
- Delete (disabled for global default).
- Type-safe service layer with Supabase queries.

---
**Last Updated**: September 16, 2026
