Auth remediation: leaked-password protection & MFA
=================================================

Recommendations to address the auth warnings from the DB linter.

- Leaked password protection
  - Purpose: Prevent users from signing up or using known-compromised passwords
    (via HaveIBeenPwned).
  - How to enable: Open the Supabase Dashboard → Authentication → Settings
    → Password & security and enable leaked-password protection / block
    compromised passwords. See: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

- Multi-factor authentication (MFA)
  - Purpose: Add a second factor (TOTP / WebAuthn) to reduce account compromise.
  - How to enable: Open Supabase Dashboard → Authentication → Settings →
    Multi-factor authentication. Enable the needed methods (TOTP, WebAuthn) and
    consider enforcing for high-privilege roles.
    See: https://supabase.com/docs/guides/auth/auth-mfa

- Suggested checklist
  - Enable leaked-password protection (HaveIBeenPwned) immediately.
  - Enable at least one additional MFA method (TOTP or WebAuthn).
  - Audit admin/super-admin accounts and require MFA for them.
  - Communicate any login flow changes to users and provide setup docs.

- Automation / infra notes
  - Dashboard UI is the primary way to toggle these settings. If you manage
    Supabase via an infra pipeline or provider API, add a step to ensure the
    same settings are enabled in production.

- Compliance/rollout guidance
  - Roll out MFA for admins first, then incentivize or require MFA for other
    users based on risk. Monitor support load and provide user help docs.
