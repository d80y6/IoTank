const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://suifvborodwergtrbjez.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjA3NDAsImV4cCI6MjA4OTMzNjc0MH0.MNRIzdkr3w7AbhYcp7zdDT4waltCMO33e_vTxZtu8W0';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testChallenge() {
    const { data, error } = await supabase.auth.signInWithPassword({
        email: 'joereademm@gmail.com',
        password: 'Joe@26$.s'
    });
    if (error) return console.error('Login failed:', error);
    
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totpFactor = factors?.totp?.find(f => f.status === 'verified');
    
    if (totpFactor) {
        console.log('Found verified factor:', totpFactor.id);
        const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
        if (challengeErr) {
            console.error('CHALLENGE FAILED:', challengeErr);
        } else {
            console.log('CHALLENGE SUCCESS:', challenge.id);
        }
    } else {
        console.log('No verified factors found.');
    }
}
testChallenge();
