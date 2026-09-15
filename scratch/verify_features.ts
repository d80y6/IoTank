
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env from root
dotenv.config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function verifyDatabaseState() {
  console.log('--- Database Verification ---');
  
  // 1. Check for core tables
  const tables = ['fuel_stations', 'profiles', 'tanks', 'unified_events', 'sensor_readings'];
  for (const table of tables) {
    const { error } = await supabase.from(table).select('*').limit(0);
    if (error) {
      console.error(`❌ Table ${table} check failed:`, error.message);
    } else {
      console.log(`✅ Table ${table} exists and is accessible.`);
    }
  }

  // 2. Check for critical RPCs
  const rpcs = [
    { name: 'get_user_bundle_v2', args: {} },
    { name: 'check_my_identity', args: {} },
    { name: 'get_tankiq_station_summary', args: { p_station_id: '00000000-0000-0000-0000-000000000000' } },
    { name: 'get_station_dashboard_summary', args: { p_station_id: '00000000-0000-0000-0000-000000000000' } }
  ];

  for (const rpc of rpcs) {
    const { data, error } = await supabase.rpc(rpc.name, rpc.args);
    if (error) {
      if (error.message.includes('not found') || error.message.includes('does not exist') || error.message.includes('Could not find')) {
        console.error(`❌ RPC ${rpc.name} check failed:`, error.message);
      } else {
        console.log(`✅ RPC ${rpc.name} detected (Auth/Args issue): ${error.message}`);
      }
    } else {
      console.log(`✅ RPC ${rpc.name} exists and returned:`, JSON.stringify(data).substring(0, 100));
    }
  }

  // 3. Check for alerts and events
  const { count: alertCount, error: aError } = await supabase.from('alerts').select('*', { count: 'exact', head: true });
  if (aError) {
    console.error(`❌ Alert check failed:`, aError.message);
  } else {
    console.log(`✅ Total active/inactive alerts: ${alertCount}`);
  }

  const { count: eventCount, error: eError } = await supabase.from('unified_events').select('*', { count: 'exact', head: true });
  if (eError) {
    console.error(`❌ Unified events check failed:`, eError.message);
  } else {
    console.log(`✅ Total forensic events recorded: ${eventCount}`);
  }

  const { count: stationCount, error: sError } = await supabase.from('fuel_stations').select('*', { count: 'exact', head: true });
  if (sError) {
    console.error(`❌ Fuel Stations check failed:`, sError.message);
  } else {
    console.log(`✅ Total stations in system: ${stationCount}`);
  }

  const { count: readingCount, error: rError } = await supabase.from('sensor_readings').select('*', { count: 'exact', head: true });
  if (rError) {
    console.error(`❌ Sensor Readings check failed:`, rError.message);
  } else {
    console.log(`✅ Total sensor readings in system: ${readingCount}`);
  }
}

verifyDatabaseState().catch(console.error);
