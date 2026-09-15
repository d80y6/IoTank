const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://suifvborodwergtrbjez.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjA3NDAsImV4cCI6MjA4OTMzNjc0MH0.MNRIzdkr3w7AbhYcp7zdDT4waltCMO33e_vTxZtu8W0';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function removeMFA() {
    console.log('[1] Logging in...');
    const { data, error } = await supabase.auth.signInWithPassword({
        email: 'joereademm@gmail.com',
        password: 'Joe@26$.s'
    });
    if (error) return console.error('Login failed:', error);
    
    console.log('[2] Fetching factors...');
    const { data: factors } = await supabase.auth.mfa.listFactors();
    
    for (const factor of (factors?.totp || [])) {
        console.log('[3] Unenrolling factor:', factor.id);
        const { error: unenrollErr } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (unenrollErr) console.error('Failed to unenroll:', unenrollErr);
        else console.log('Successfully unenrolled!');
    }
}
removeMFA();
