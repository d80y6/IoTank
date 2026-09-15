
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkAuthUser() {
  const email = 'josezvundi@gmail.com';
  // Note: we can't query auth.users directly via anon key, but we can try to sign in or check if a profile exists
  const { data, error } = await supabase.from('profiles').select('*').eq('email', email).single();
  if (error) {
    console.log(`ℹ️ Profile for ${email} check: ${error.message}`);
  } else {
    console.log(`✅ Profile for ${email} exists:`, data);
  }

  const { data: systemUser, error: suError } = await supabase.from('system_users').select('*').eq('email', email).single();
  if (suError) {
    console.log(`ℹ️ System User for ${email} check: ${suError.message}`);
  } else {
    console.log(`✅ System User for ${email} exists:`, systemUser);
  }
}

checkAuthUser().catch(console.error);
