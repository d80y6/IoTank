import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://suifvborodwergtrbjez.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjA3NDAsImV4cCI6MjA4OTMzNjc0MH0.MNRIzdkr3w7AbhYcp7zdDT4waltCMO33e_vTxZtu8W0';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
    console.log('Logging in to get JWT token...');
    const { data, error } = await supabase.auth.signInWithPassword({
        email: 'joereademm@gmail.com',
        password: 'Joe@26$.s'
    });

    if (error) {
        console.error('Login failed:', error);
        return;
    }

    const token = data.session.access_token;
    console.log('Login successful! JWT Token acquired.');

    const url = `${SUPABASE_URL}/functions/v1/official-scraper`;
    console.log('Invoking official-scraper at:', url);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            source: 'EPRA'
        })
    });
    
    console.log('Status:', response.status);
    const result = await response.json();
    console.log('Response:', JSON.stringify(result, null, 2));
}

run().catch(console.error);
