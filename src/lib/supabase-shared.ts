import { createClient } from '@supabase/supabase-js';

/**
 * Creates a standard Supabase client for native Auth.
 * HIGH-001: Using sessionStorage instead of localStorage to limit XSS blast radius.
 * Sessions expire when the browser tab closes, reducing the token theft window.
 */
export const createSharedSupabaseClient = (
    supabaseUrl: string,
    supabaseAnonKey: string
) => {
    return createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: true,
            storage: window.sessionStorage, // HIGH-001: Narrower scope than localStorage
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: 'iotank_session',
            // Disable default browser lock mechanism since sessionStorage is tab-isolated
            // and locking causes 5000ms contention hangs on hot reload / React Strict Mode.
            lock: async (_name, _acquireTimeout, fn) => {
                return await fn();
            }
        }
    });
};
