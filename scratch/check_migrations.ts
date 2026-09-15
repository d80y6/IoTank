
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

async function checkMigrations() {
  // Try to query the internal migrations table if accessible (might not be for anon)
  // Instead, we check for a table created in a specific migration
  const { error: error1 } = await supabase.from('billing_transactions').select('*').limit(0);
  const { error: error2 } = await supabase.from('unified_events').select('*').limit(0);

  console.log('--- Migration Status Check ---');
  console.log('billing_transactions (from 20260601000000):', error1 ? `❌ ${error1.message}` : '✅ Applied');
  console.log('unified_events (from earlier):', error2 ? `❌ ${error2.message}` : '✅ Applied');

  // Check for a specific column added in 20260601000007
  const { error: error3 } = await supabase.from('fuel_stations').select('current_debt').limit(0);
  console.log('fuel_stations.current_debt (from 20260601000007 logic):', error3 ? `❌ ${error3.message}` : '✅ Applied');
}

checkMigrations().catch(console.error);
