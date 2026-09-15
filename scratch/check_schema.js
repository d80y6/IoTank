
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.VITE_SUPABASE_ANON_KEY || ''
);

async function checkSchema() {
  console.log('--- Checking alerts table ---');
  const { data: alertData, error: alertError } = await supabase.from('alerts').select('*').limit(1);
  if (alertError) console.error('Alerts Error:', alertError);
  else console.log('Alerts columns:', Object.keys(alertData[0] || {}));
  
  // Check for unique index
  const { data: indexData, error: indexError } = await supabase.rpc('check_index_exists', { p_index_name: 'idx_alerts_active_dedupe' });
  if (indexError) console.error('Index Check Error:', indexError);
  else console.log('Index idx_alerts_active_dedupe exists:', indexData);

  console.log('\n--- Checking sensor_readings table ---');
  const { data: readingData, error: readingError } = await supabase.from('sensor_readings').select('*').limit(1);
  if (readingError) console.error('Sensor Readings Error:', readingError);
  else console.log('Sensor Readings columns:', Object.keys(readingData[0] || {}));
}

checkSchema();
