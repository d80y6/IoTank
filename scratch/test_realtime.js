const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://suifvborodwergtrbjez.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjA3NDAsImV4cCI6MjA4OTMzNjc0MH0.MNRIzdkr3w7AbhYcp7zdDT4waltCMO33e_vTxZtu8W0';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('Testing Supabase Realtime WebSocket Connection...');

const channel = supabase
  .channel('test-channel')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'tanks' }, (payload) => {
    console.log('Change received!', payload);
  })
  .subscribe((status, err) => {
    console.log(`Subscription Status: ${status}`);
    if (err) {
      console.error('Subscription Error:', err);
    }
    if (status === 'SUBSCRIBED') {
      console.log('✓ Successfully connected to real-time!');
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
