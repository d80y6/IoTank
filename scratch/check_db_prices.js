import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://suifvborodwergtrbjez.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjA3NDAsImV4cCI6MjA4OTMzNjc0MH0.MNRIzdkr3w7AbhYcp7zdDT4waltCMO33e_vTxZtu8W0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const { data, error } = await supabase
    .from('market_prices')
    .select('*')
    .order('effective_date', { ascending: false });
    
  if (error) {
    console.error('Error fetching market_prices:', error);
  } else {
    console.log('Current market_prices table contents:');
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
