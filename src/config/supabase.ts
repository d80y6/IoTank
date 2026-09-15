import { createSharedSupabaseClient } from '@/lib/supabase-shared';


const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // INTENTIONAL: logger not available at module init
  console.warn('Supabase credentials missing in environment variables.');
}

// Export the singleton Supabase client
export const supabase = createSharedSupabaseClient(
    supabaseUrl || '',
    supabaseAnonKey || ''
);

export const enableDebugTools = import.meta.env.VITE_ENABLE_DEBUG_TOOLS === 'true';
export const enableGovernanceConsole = import.meta.env.VITE_ENABLE_GOVERNANCE_CONSOLE === 'true';
