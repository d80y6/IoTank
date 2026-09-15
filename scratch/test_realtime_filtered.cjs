const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://suifvborodwergtrbjez.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjA3NDAsImV4cCI6MjA4OTMzNjc0MH0.MNRIzdkr3w7AbhYcp7zdDT4waltCMO33e_vTxZtu8W0';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('Testing FILTERED Supabase Realtime WebSocket Connection...');

// Use a mock/valid format UUID for station_id
const mockStationId = '6c8b9392-f7b5-4a57-8973-c15c8227bda4';

const channel = supabase
  .channel('test-filtered-channel')
  .on('postgres_changes', { 
    event: '*', 
    schema: 'public', 
    table: 'tanks',
    filter: `station_id=eq.${mockStationId}` 
  }, (payload) => {
    console.log('Change received!', payload);
  })
  .subscribe((status, err) => {
    console.log(`Subscription Status: ${status}`);
    if (err) {
      console.error('Subscription Error:', err);
    }
    if (status === 'SUBSCRIBED') {
      console.log('✓ Successfully connected to real-time with filter!');
      process.exit(0);
    } else if (status === 'CHANNEL_ERROR') {
      console.error('✗ Channel error occurred');
      process.exit(1);
    } else if (status === 'TIMED_OUT') {
      console.error('✗ Connection timed out');
      process.exit(1);
    }
  });

setTimeout(() => {
  console.log('Timeout after 10s...');
  process.exit(1);
}, 10000);
