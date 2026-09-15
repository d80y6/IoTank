// @ts-ignore Deno edge import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.40.0'
// @ts-ignore Deno edge import
import * as jose from 'https://esm.sh/jose@5.2.3'

declare const Deno: any;

Deno.serve(async (req) => {
  const { method, url } = req;
  const urlPath = new URL(url).pathname;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // DIAGNOSTIC PING
  if (urlPath.endsWith('/ping')) {
    return new Response(JSON.stringify({ 
        success: true, 
        message: 'Provisioning Hub Online',
        timestamp: new Date().toISOString()
    }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
    })
  }

  const errorResponse = (message: string, statusCode: number = 400, detail?: any) => {
    const errorBody = { success: false, error: message, detail, timestamp: new Date().toISOString() };
    console.error(`[PROVISIONING_ERROR] ${message}`, JSON.stringify(detail));
    return new Response(JSON.stringify(errorBody), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: statusCode, 
    });
  };

  try {
    console.log(`[PROVISIONING_START] Request received at ${new Date().toISOString()}`);
    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) return errorResponse('Auth header missing', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
        return errorResponse('Internal Config Error: Supabase credentials missing (URL or Key).', 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey, { 
        auth: { persistSession: false } 
    });

    const token = authHeader.replace('Bearer ', '').trim();
    let adminUser: any = null;

    // STEP 0: PRIMARY AUTH (Standard Supabase getUser)
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (user) {
        adminUser = user;
        console.log(`[PROVISIONING_AUTH_OK] Verified via standard RPC: ${adminUser.email}`);
    } else {
        // STEP 0.1: FALLBACK AUTH (JWKS for ES256 algorithm support)
        console.warn(`[PROVISIONING_AUTH_FALLBACK] RPC failed (Code: ${authError?.code || 'None'}). Attempting JWKS verification...`);
        
        try {
            const JWKS = jose.createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/jwks`));
            const { payload } = await jose.jwtVerify(token, JWKS, {
                issuer: `${supabaseUrl}/auth/v1`,
                audience: 'authenticated'
            });

            if (payload && payload.sub) {
                // Fetch the actual user data from Supabase using Service Role to confirm they exist
                const { data: suUser, error: suError } = await supabaseAdmin.auth.admin.getUserById(payload.sub as string);
                
                if (suUser && suUser.user) {
                    adminUser = suUser.user;
                    console.log(`[PROVISIONING_JWKS_OK] Verified via JWKS Fallback: ${adminUser.email}`);
                } else {
                    console.error(`[PROVISIONING_JWKS_VERIFIED_BUT_NOT_FOUND] User ID ${payload.sub} not in database.`, suError);
                }
            }
        } catch (jwksErr: any) {
            console.error(`[PROVISIONING_JWKS_FAIL] Verification failed: ${jwksErr.message}`);
            
            // If it's a known algorithm issue, provide the hint
            const isAlgError = authError?.message?.includes('algorithm') || jwksErr.message?.includes('algorithm');
            
            return errorResponse(`Unauthorized: Identity Verification Failed`, 401, {
                hint: isAlgError ? "Security token algorithm mismatch (ES256 detected). Please sign out and sign back in to refresh your session." : "Security token mismatch. Check if your project URL is correct.",
                system_error: authError?.message || jwksErr.message,
                code: authError?.code || 'JWT_VERIFICATION_FAILED'
            });
        }
    }

    if (!adminUser) {
        return errorResponse('Unauthorized: Valid administrator session required.', 401);
    }

    // ROLE ENFORCEMENT: Strictly require Super Admin (Level 1)
    const { data: sysUser, error: sysError } = await supabaseAdmin
        .from('system_users')
        .select('role, is_active')
        .eq('auth_user_id', adminUser.id)
        .maybeSingle();

    if (sysError || !sysUser || sysUser.role !== 'super_admin' || !sysUser.is_active) {
        console.warn(`[PROVISIONING_BLOCK] Unauthorized attempt by ${adminUser.email} (Role: ${sysUser?.role || 'none'})`);
        return errorResponse('Permission Denied: Only active Super Admins can finalize station provisioning.', 403, {
            hint: "Administrative provisioning is a Level 1 clearance operation."
        });
    }

    console.log(`[PROVISIONING_AUTH_OK] Authorized by Super Admin: ${adminUser.email}`);

    const body = await req.json().catch(() => ({}));
    const { registrationId } = body;
    if (!registrationId) return errorResponse('registrationId required', 400);

    console.log(`[PROVISIONING_FETCH] Registration ID: ${registrationId}`);

    // FETCH REGISTRATION
    const { data: reg, error: regError } = await supabaseAdmin
      .from('pending_registrations')
      .select('*')
      .eq('id', registrationId)
      .maybeSingle();

    if (regError) return errorResponse(`Database fetch failed: ${regError.message}`, 500);
    if (!reg) return errorResponse('Registration record not found.', 404);

    // STEP 1: IDENTITY (Atomic Auth Invitation)
    console.log(`[PROVISIONING_IDENTITY] Checking email: ${reg.email}`);
    const { data: existingUserId, error: lookupError } = await supabaseAdmin.rpc('get_auth_user_id_by_email', { p_email: reg.email });
    
    if (lookupError) {
        console.warn(`[PROVISIONING_LOOKUP_WARN] Auth lookup failed for ${reg.email}, proceeding with invitation. Error:`, lookupError);
    }

    let targetUserId = existingUserId;

    if (!targetUserId) {
        console.log(`[PROVISIONING_INVITE] Calling auth.admin.inviteUserByEmail for: ${reg.email}`);
        const { data: invitation, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
            reg.email,
            { redirectTo: 'https://the-iotank-project.web.app/reset-password' }
        );
        
        if (inviteError) {
            console.error(`[PROVISIONING_INVITE_FAIL]`, inviteError);
            return errorResponse(`Identity creation failed: ${inviteError.message}`, 500);
        }
        targetUserId = invitation.user.id;
        console.log(`[PROVISIONING_INVITE_SUCCESS] User ID: ${targetUserId}`);
    } else {
        console.log(`[PROVISIONING_IDENTITY_EXIST] Found existing user: ${targetUserId}`);
    }

    // STEP 2: ATOMIC PROVISIONING
    console.log(`[PROVISIONING_RPC_START] Calling provision_registration_v2 for UID: ${targetUserId}`);
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('provision_registration_v2', {
        p_registration_id: registrationId,
        p_auth_user_id: targetUserId
    });

    if (rpcError) {
        console.error(`[PROVISIONING_RPC_ERROR] Execution failed for UID: ${targetUserId}`, rpcError);
        return errorResponse(`Database RPC Error: ${rpcError.message} (${rpcError.code})`, 500, {
            ...rpcError,
            step: 'RPC_EXECUTION',
            userId: targetUserId,
            registrationId
        });
    }

    if (!rpcResult || rpcResult.success === false) {
        console.error(`[PROVISIONING_RPC_FAIL]`, rpcResult);
        return errorResponse(`Provisioning logic reported failure: ${rpcResult?.error || 'Unknown Error'}`, 500, rpcResult);
    }

    console.log(`[PROVISIONING_COMPLETE] Successfully provisioned: ${registrationId}`);

    // STEP 3: TRANSACTIONAL WELCOME EMAIL
    try {
        console.log(`[PROVISIONING_EMAIL] Dispatching welcome email to ${reg.email}`);
        await fetch(`${supabaseUrl}/functions/v1/dispatch-critical-alerts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cmd: 'direct_transactional_email',
                to: reg.email,
                params: {
                    type: 'TRIAL_WELCOME',
                    recipientName: reg.contact_person || 'Station Admin',
                    stationName: reg.station_name,
                    trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString(),
                    loginUrl: 'https://the-iotank-project.web.app/login'
                }
            })
        });
    } catch (emailErr) {
        console.warn(`[PROVISIONING_EMAIL_WARN] Failed to dispatch welcome email:`, emailErr);
    }
    return new Response(JSON.stringify({
        success: true, 
        message: 'Client provisioned and linked successfully.',
        data: rpcResult,
        timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error(`[PROVISIONING_FATAL]`, error);
    return errorResponse(`Server Fatal Error: ${error.message}`, 500);
  }
})
