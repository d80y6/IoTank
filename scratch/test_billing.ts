
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

async function testBillingFeature() {
  console.log('--- Testing Billing Feature ---');

  // Note: we can't insert into fuel_stations directly via anon key unless RLS allows it.
  // We'll check if we can insert a test station.
  const testStationId = '11111111-1111-1111-1111-111111111111';
  
  console.log('1. Creating test station...');
  const { error: insertError } = await supabase.from('fuel_stations').upsert({
    station_id: testStationId,
    station_name: 'Feature Test Station',
    current_debt: 5000,
    total_paid: 0,
    account_status: 'active'
  });

  if (insertError) {
    console.error('❌ Failed to create test station (likely RLS):', insertError.message);
    // If we can't insert, we can't test the RPC as it requires a station.
    return;
  }
  console.log('✅ Test station created/verified.');

  console.log('2. Calling process_payment RPC...');
  // process_payment(p_station_id UUID, p_amount DECIMAL, p_payment_method TEXT, p_payment_reference TEXT, p_description TEXT)
  const { error: rpcError } = await supabase.rpc('process_payment', {
    p_station_id: testStationId,
    p_amount: 1500.50,
    p_payment_method: 'M-PESA',
    p_payment_reference: 'TEST_REF_123',
    p_description: 'Feature test payment'
  });

  if (rpcError) {
    console.error('❌ RPC process_payment failed:', rpcError.message);
  } else {
    console.log('✅ RPC process_payment executed successfully.');
  }

  console.log('3. Verifying updates...');
  const { data: station, error: fetchError } = await supabase
    .from('fuel_stations')
    .select('current_debt, total_paid')
    .eq('station_id', testStationId)
    .single();

  if (fetchError) {
    console.error('❌ Failed to fetch updated station:', fetchError.message);
  } else {
    console.log(`📊 Updated Station: Debt=${station.current_debt}, Total Paid=${station.total_paid}`);
    if (station.current_debt === 3499.50) {
      console.log('✨ SUCCESS: Debt correctly calculated!');
    } else {
      console.log('⚠️ Warning: Debt mismatch. Expected 3499.50');
    }
  }

  // Check transaction log
  const { data: tx, error: txError } = await supabase
    .from('transactions')
    .select('*')
    .eq('station_id', testStationId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (txError) {
    console.error('❌ Failed to fetch transaction log:', txError.message);
  } else if (tx && tx.length > 0) {
    console.log('✅ Transaction recorded:', tx[0].payment_reference);
  } else {
    console.error('❌ No transaction found!');
  }
}

testBillingFeature().catch(console.error);
