
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

async function testRegistrationFeature() {
  console.log('--- Testing Registration Feature ---');

  const testEmail = `test_${Date.now()}@example.com`;
  
  console.log(`1. Submitting registration for ${testEmail}...`);
  const { error } = await supabase.from('pending_registrations').insert({
    email: testEmail,
    full_name: 'Test Feature User',
    station_name: 'Feature Test Station',
    phone: '+254700000000',
    notes: 'Testing registration feature'
  });

  if (error) {
    console.error('❌ Registration submission failed:', error.message);
  } else {
    console.log('✅ Registration submitted successfully.');
  }

  console.log('2. Verifying in unified_events (Audit Service test)...');
  // Usually, a trigger or the service would log this.
  // We check if any new event appeared.
  const { data: events, error: evError } = await supabase
    .from('unified_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (evError) {
    console.error('❌ Failed to fetch events:', evError.message);
  } else {
    console.log(`✅ Found ${events?.length} recent events.`);
    events?.forEach(e => console.log(` - [${e.event_type}] ${e.description}`));
  }
}

testRegistrationFeature().catch(console.error);
