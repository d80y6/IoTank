// supabase/functions/submit-registration/index.ts

import { getCorsHeaders } from '../_shared/cors.ts'
// @ts-ignore Deno edge import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"

declare const Deno: any;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const RECAPTCHA_SECRET_KEY = Deno.env.get('RECAPTCHA_SECRET_KEY');

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RECAPTCHA_SECRET_KEY) {
      throw new Error('Environment configuration missing');
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();
    const { 
      full_name, 
      email, 
      phone, 
      station_name, 
      county, 
      notes, 
      recaptcha_token 
    } = body;

    // 1. MANDATORY RECAPTCHA VERIFICATION (SERVER-SIDE)
    if (!recaptcha_token) {
      throw new Error('Security verification token is missing');
    }

    const verifyRes = await fetch(
      'https://www.google.com/recaptcha/api/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${RECAPTCHA_SECRET_KEY}&response=${recaptcha_token}`
      }
    );

    const verifyData = await verifyRes.json();
    if (!verifyData.success || (verifyData.score !== undefined && verifyData.score < 0.5)) {
      console.warn('[reCAPTCHA FAIL]:', verifyData);
      throw new Error('Security verification failed (Bot detection)');
    }

    // 2. DATA SANITIZATION (Secondary check)
    if (!full_name || !email || !station_name) {
      throw new Error('Missing required identity fields');
    }
    
    const normalizedEmail = email.toLowerCase().trim();

    // 2.5 CHECK IF EMAIL EXISTS
    const [{ data: profileExists }, { data: sysUserExists }, { data: pendingExists }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id').eq('email', normalizedEmail).maybeSingle(),
      supabaseAdmin.from('system_users').select('id').eq('email', normalizedEmail).maybeSingle(),
      supabaseAdmin.from('pending_registrations').select('id').eq('email', normalizedEmail).maybeSingle()
    ]);

    if (profileExists || sysUserExists) {
      throw new Error('Email already exists in the system');
    }
    
    if (pendingExists) {
      throw new Error('A pending request for this email already exists');
    }

    // 3. SECURE INSERTION (Using Service Role to bypass table RLS restricting public INSERT)
    const { data: registration, error: dbError } = await supabaseAdmin
      .from('pending_registrations')
      .insert([{
        full_name,
        email: email.toLowerCase().trim(),
        phone,
        station_name,
        county,
        notes,
        status: 'pending',
        email_verified: false,
        recaptcha_token,
        verification_token_expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }])
      .select('id')
      .single();

    if (dbError) {
        console.error('DB_INSERT_ERROR:', dbError);
        throw new Error(`Registration capture failed: ${dbError.message}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Registration request captured successfully',
        id: registration.id 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Registration processing error:', error.message);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
