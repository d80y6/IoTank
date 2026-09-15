export const SECURITY_CONFIG = {
    // Master Access Password used for Settings admin gate.
    // MUST be set in .env — falls back to a secure sentinel that will never match any user input.
    MASTER_ACCESS_PASSWORD: (() => {
        const pw = import.meta.env.VITE_MASTER_ACCESS_PASSWORD;
        if (!pw || pw.trim() === '') {
            // Warn loudly in dev; in production this means the gate is effectively locked.
            if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.warn('[SECURITY] VITE_MASTER_ACCESS_PASSWORD is not set in .env. Admin gates are locked until configured.');
            }
            return '__UNCONFIGURED_MASTER_PW__'; // Non-empty sentinel that never matches real input
        }
        return pw;
    })(),

    // MED-006: Hardcoded fallback removed — key MUST be set in .env / .env.production.
    // If missing in production, reCAPTCHA will fail and the login form will surface an error.
    RECAPTCHA_V3_SITEKEY: import.meta.env.VITE_RECAPTCHA_V3_SITEKEY as string,
    RECAPTCHA_V3_SCORE_THRESHOLD: 0.5, // Score 0.0 - 1.0, reject if below this

    // Future security configurations can be added here
    MAX_LOGIN_ATTEMPTS: 5,
    SESSION_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
};
