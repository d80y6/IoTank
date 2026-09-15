
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL as string
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY as string

const supabase = createClient(supabaseUrl, supabaseKey)

async function verifyIdentity() {
    console.log('--- Identity Verification Script ---')
    
    // 1. Check if we can call the fixed internal function via an RPC that uses it
    // Note: is_admin() is a security definer, so we can't call it directly as anon unless granted.
    // But we can check if system_users is readable if we have a session.
    
    // Since this script runs outside the browser, I'll just check the schema/functions if possible.
    
    const { data: functions, error: funcError } = await supabase
        .rpc('get_auth_level') 
    
    if (funcError) {
        console.error('Error calling get_auth_level:', funcError.message)
    } else {
        console.log('get_auth_level response:', functions)
    }

    // 2. Check system_users table access
    const { data: users, error: userError } = await supabase
        .from('system_users')
        .select('*')
        .limit(1)
    
    if (userError) {
        console.log('system_users access (expected to fail if not logged in):', userError.message)
    } else {
        console.log('system_users sample:', users)
    }
}

verifyIdentity()
