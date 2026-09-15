// supabase/functions/invite-station-staff/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.40.0'
import { getCorsHeaders } from '../_shared/cors.ts'

// @ts-ignore Deno edge import
declare const Deno: any;

Deno.serve(async (req: Request) => {
  const { method } = req;
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  if (method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const errorResponse = (message: string, status = 400, extra?: Record<string, any>) => {
    console.error(`[invite-station-staff] FAIL ${status}:`, message, extra || '');
    return new Response(JSON.stringify({ error: message, ...extra }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    });
  };

  try {
    const supabaseUrl = 'https://suifvborodwergtrbjez.supabase.co';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      return errorResponse('Internal Config Error: Supabase credentials missing.', 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });

    // 1. Authenticate Caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Auth header missing', 401);

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user: adminUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !adminUser) {
      console.error(`[INVITE_STAFF_AUTH_FAIL]`, authError);
      return errorResponse(`Unauthorized: ${authError?.message || 'Invalid Session'}`, 401);
    }

    const { email, full_name, role, station_id } = await req.json();
    if (!email || !full_name || !role || !station_id) {
      return errorResponse('email, full_name, role, and station_id are required.');
    }

    // 2. Verify Caller Authorization for this station
    // Caller must be owner/admin of the station they are inviting to
    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, station_id')
      .eq('auth_user_id', adminUser.id)
      .maybeSingle();

    if (profileError || !callerProfile) {
      return errorResponse('Caller profile not found.', 403);
    }

    const isSystemAdmin = ['super_admin', 'admin_helper'].includes((callerProfile as any).role);
    const isStationAdmin = callerProfile.station_id === station_id && ['owner', 'admin', 'supervisor'].includes(callerProfile.role);

    if (!isSystemAdmin && !isStationAdmin) {
      return errorResponse('Permission denied: You do not have authority to invite staff to this station.', 403);
    }

    // 3. Resolve Auth Identity (Idempotent)
    let targetAuthUserId: string;
    
    // Check if user already exists in auth
    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;
    
    const existingEntry = users.users.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (existingEntry) {
      targetAuthUserId = existingEntry.id;
      console.log(`[invite-station-staff] Reusing existing user: ${targetAuthUserId}`);
    } else {
      console.log(`[invite-station-staff] Inviting new staff member: ${email}`);
      const { data: invitation, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        email,
        {
          redirectTo: 'https://the-iotank-project.web.app/reset-password',
          data: { 
            full_name, 
            station_id, 
            role: 'station_staff',
            invited_by: adminUser.id 
          }
        }
      );

      if (inviteError) {
          if (inviteError.message.includes('already')) {
               return errorResponse('Identity Conflict: User already exists but not visible.', 409);
          }
          throw inviteError;
      }
      targetAuthUserId = invitation.user.id;
    }

    // 4. Provision Profile (UPSERT)
    const { error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        auth_user_id: targetAuthUserId,
        station_id: station_id,
        email: email.toLowerCase(),
        display_name: full_name,
        role: role.toLowerCase(),
        site_ids: []
      }, { onConflict: 'auth_user_id' });

    if (upsertError) throw upsertError;

    // 5. Create Audit History in team_member_requests
    await supabaseAdmin.from('team_member_requests').insert({
        station_id: station_id,
        station_name: 'Direct Invite', // Optional: could fetch real name
        full_name: full_name,
        email: email.toLowerCase(),
        role: role.toLowerCase(),
        status: 'approved',
        requested_by: adminUser.id,
        reviewed_at: new Date().toISOString()
    });

    // 6. Log specific audit entry
    await supabaseAdmin.from('audit_logs').insert({
        station_id: station_id,
        auth_user_id: adminUser.id,
        action_type: 'MEMBER_INVITED',
        details: `Directly invited ${full_name} (${role}) to the team.`
    });

    // 7. DISPATCH BRANDED INVITATION EMAIL
    try {
        const { data: station } = await supabaseAdmin.from('fuel_stations').select('station_name').eq('id', station_id).single();
        
        await fetch(`${supabaseUrl}/functions/v1/dispatch-critical-alerts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'direct_transactional_email',
                to: email,
                params: {
                    type: 'INVITATION',
                    recipientName: full_name,
                    stationName: station?.station_name || 'Your Station',
                    senderName: adminUser.email,
                    loginUrl: 'https://the-iotank-project.web.app/reset-password'
                }
            })
        });
    } catch (emailErr) {
        console.warn(`[invite-station-staff] Email dispatch failed:`, emailErr);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Staff member invited and provisioned successfully.',
      data: { auth_user_id: targetAuthUserId }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err: any) {
    console.error('[invite-station-staff] FATAL ERROR:', err.message);
    return errorResponse(err.message || 'Internal Server Error', 500);
  }
})
