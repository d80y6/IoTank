import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://suifvborodwergtrbjez.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjA3NDAsImV4cCI6MjA4OTMzNjc0MH0.MNRIzdkr3w7AbhYcp7zdDT4waltCMO33e_vTxZtu8W0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// EPRA Official Prices: May 15, 2026 – June 14, 2026 (Nairobi)
// Source: EPRA Statement May 14, 2026
const CURRENT_EPRA_PRICES = [
  { fuel_type: 'PMS',      price_per_liter: 214.25, label: 'Super Petrol' },
  { fuel_type: 'AGO',      price_per_liter: 242.92, label: 'Diesel' },
  { fuel_type: 'IK',       price_per_liter: 152.78, label: 'Kerosene' },
  // Keep common aliases too
  { fuel_type: 'petrol',   price_per_liter: 214.25, label: 'Super Petrol (alias)' },
  { fuel_type: 'diesel',   price_per_liter: 242.92, label: 'Diesel (alias)' },
  { fuel_type: 'kerosene', price_per_liter: 152.78, label: 'Kerosene (alias)' },
];

const EFFECTIVE_DATE = '2026-05-15';
const SOURCE_URL = 'https://www.epra.go.ke/petroleum-prices/';

async function run() {
  console.log('Logging in as authenticated user...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'joereademm@gmail.com',
    password: 'Joe@26$.s'
  });

  if (authError) {
    console.error('Authentication failed:', authError.message);
    return;
  }
  console.log('Login successful! User ID:', authData.user.id);

  console.log('Upserting current EPRA prices into market_prices table...\n');

  for (const p of CURRENT_EPRA_PRICES) {
    const { data, error } = await supabase
      .from('market_prices')
      .upsert({
        fuel_type: p.fuel_type,
        price_per_liter: p.price_per_liter,
        currency: 'KES',
        source: 'epra',
        region: 'kenya',
        effective_date: EFFECTIVE_DATE,
        metadata: {
          is_official: true,
          source_url: SOURCE_URL,
          review_period: 'May 15 - June 14, 2026',
          label: p.label,
          manually_verified: true,
          verified_at: new Date().toISOString()
        }
      }, {
        // Try to upsert on fuel_type + source + region + effective_date
        onConflict: 'fuel_type,source,region,effective_date',
        ignoreDuplicates: false
      });

    if (error) {
      // If unique constraint doesn't match, try a direct update of the latest
      console.warn(`Upsert conflict for ${p.fuel_type}, trying update...`, error.message);
      
      // Try calling the forensic RPC instead
      const { error: rpcError } = await supabase.rpc('forensic_update_market_price', {
        p_fuel_type: p.fuel_type,
        p_new_price: p.price_per_liter,
        p_effective_date: new Date(EFFECTIVE_DATE).toISOString(),
        p_source_url: SOURCE_URL,
        p_is_official: true,
        p_signal_id: `manual-epra-sync-${p.fuel_type}-20260515`
      });
      
      if (rpcError) {
        console.error(`  ✗ RPC also failed for ${p.fuel_type}:`, rpcError.message);
      } else {
        console.log(`  ✓ RPC success for ${p.label}: KES ${p.price_per_liter}`);
      }
    } else {
      console.log(`  ✓ Upserted ${p.label} (${p.fuel_type}): KES ${p.price_per_liter}`);
    }
  }

  // Read back the final state
  console.log('\nFinal market_prices:');
  const { data: final } = await supabase
    .from('market_prices')
    .select('fuel_type, price_per_liter, effective_date, source')
    .order('effective_date', { ascending: false });
  console.table(final);
}

run();
