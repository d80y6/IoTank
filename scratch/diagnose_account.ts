
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function diagnose() {
    console.log('--- IoTank Account Diagnostic ---');
    console.log('Target Email:', 'joereademm@gmail.com');

    // 1. Check Profiles table
    const { data: profile, error: pError } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', 'joereademm@gmail.com')
        .maybeSingle();

    if (pError) {
        console.error('Profile query error:', pError.message);
    } else if (profile) {
        console.log('Profile Found:');
        console.log('- Station ID:', profile.station_id || 'MISSING');
        console.log('- Role:', profile.role);
        
        if (profile.station_id) {
            // 2. Check Station
            const { data: station, error: sError } = await supabase
                .from('stations')
                .select('*')
                .eq('id', profile.station_id)
                .maybeSingle();
            
            if (sError) console.error('Station query error:', sError.message);
            else if (station) console.log('- Station Name:', station.station_name);
            else console.log('- Station record NOT FOUND in stations table.');

            // 3. Check Tanks
            const { data: tanks, error: tError } = await supabase
                .from('tanks')
                .select('id, tank_name')
                .eq('station_id', profile.station_id);
            
            if (tError) console.error('Tanks query error:', tError.message);
            else console.log(`- Tanks Found: ${tanks?.length || 0}`);
        }
    } else {
        console.log('Profile NOT FOUND in profiles table.');
    }
}

diagnose();
