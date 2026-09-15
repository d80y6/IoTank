const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://suifvborodwergtrbjez.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjA3NDAsImV4cCI6MjA4OTMzNjc0MH0.MNRIzdkr3w7AbhYcp7zdDT4waltCMO33e_vTxZtu8W0';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testLogin() {
    console.log('[1] Logging in...');
    const { data, error } = await supabase.auth.signInWithPassword({
        email: 'joereademm@gmail.com',
        password: 'Joe@26$.s'
    });

    if (error) {
        console.error('Login failed:', error);
        return;
    }

    console.log('[2] Login successful! User ID:', data.user.id);
    
    console.time('get_user_bundle_v2');
    console.log('[3] Fetching get_user_bundle_v2...');
    const { data: bundle, error: bundleError } = await supabase.rpc('get_user_bundle_v2');
    console.timeEnd('get_user_bundle_v2');

    if (bundleError) {
        console.error('RPC failed:', bundleError);
    } else {
        console.log('[4] RPC returned successfully! Identity Type:', bundle?.identity_type);
    }

    console.log('[4.5] Calling get_station_dashboard_summary...');
    const { data: dashboard, error: dashError } = await supabase.rpc('get_station_dashboard_summary', {
        p_station_id: '9a594b8e-15b2-48a8-b17d-7ef7fa5e9b8a'
    });
    if (dashError) {
        console.error('get_station_dashboard_summary failed:', dashError);
    } else {
        console.log('[4.6] get_station_dashboard_summary succeeded! Data:', JSON.stringify(dashboard, null, 2));
    }

    console.log('[4.7] Testing process_payment...');
    const { error: payError } = await supabase.rpc('process_payment', {
        p_station_id: '9a594b8e-15b2-48a8-b17d-7ef7fa5e9b8a',
        p_amount: 10,
        p_payment_method: 'MPESA',
        p_payment_reference: 'TESTREF1234',
        p_description: 'Test payment'
    });
    if (payError) {
        console.error('[4.8] process_payment failed:', payError);
    } else {
        console.log('[4.8] process_payment succeeded!');
    }

    console.time('listFactors');
    console.log('[5] Fetching MFA listFactors...');
    const { data: factors, error: mfaError } = await supabase.auth.mfa.listFactors();
    console.timeEnd('listFactors');

    if (mfaError) {
        console.error('MFA listFactors failed:', mfaError);
    } else {
        console.log('[6] MFA listFactors returned successfully! Found factors:', factors?.totp?.length || 0);
    }
}

testLogin();
