const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://suifvborodwergtrbjez.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjA3NDAsImV4cCI6MjA4OTMzNjc0MH0.MNRIzdkr3w7AbhYcp7zdDT4waltCMO33e_vTxZtu8W0';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function verifyMfaCode(mfaCode) {
    console.log('[1] Logging in...');
    const { data, error } = await supabase.auth.signInWithPassword({
        email: 'joereademm@gmail.com',
        password: 'Joe@26$.s'
    });
    if (error) return console.error('Login failed:', error);
    
    console.log('[2] Fetching factors...');
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totpFactor = factors?.totp?.find(f => f.status === 'verified');
    
    if (!totpFactor) return console.error('No verified TOTP factor found.');

    console.log('[3] Creating challenge...');
    const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
    if (challengeErr) return console.error('CHALLENGE FAILED:', challengeErr);

    console.log(`[4] Verifying code ${mfaCode}...`);
    const { data: verifyData, error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: totpFactor.id,
        challengeId: challenge.id,
        code: mfaCode
    });

    if (verifyErr) {
        console.error('VERIFY FAILED:', verifyErr.message);
    } else {
        console.log('VERIFY SUCCESS! Fully authenticated.');
        
        console.log('[5] Checking AAL status...');
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        console.log('AAL Level:', aal.currentLevel);
    }
}

const code = process.argv[2];
if (!code) {
    console.error('Please provide a 6-digit code as an argument.');
    process.exit(1);
}
verifyMfaCode(code);
