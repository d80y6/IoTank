// @ts-ignore Deno edge import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.40.0'
// @ts-ignore Deno edge import
import { SmtpClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { renderSecurityEmail } from '../_shared/SecurityEmailTemplate.ts'
import { renderTransactionalEmail } from '../_shared/TransactionalEmailTemplate.ts'
// @ts-ignore Deno edge import
import webpush from 'https://esm.sh/web-push@3.6.7?target=deno'

declare const Deno: any;

// Polyfill for Deno.writeAll which was removed in recent Deno versions but is required by deno-smtp
if (typeof (Deno as any).writeAll === 'undefined') {
  Object.defineProperty(Deno, "writeAll", {
    value: async (w: any, data: Uint8Array) => {
      let nwritten = 0;
      while (nwritten < data.length) {
        nwritten += await w.write(data.subarray(nwritten));
      }
    },
    writable: true,
    configurable: true,
  });
}


type ClaimedEvent = {
  id: string;
  event_type: string;
  severity: string;
  source: string;
  endpoint: string | null;
  actor_uid: string | null;
  actor_email: string | null;
  actor_role: string | null;
  actor_auth_level: number | null;
  station_id: string | null;
  scope_key: string | null;
  status_code: number | null;
  reason: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  alert_attempts: number;
};

async function isAuthorized(req: Request, supabaseAdmin: any) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    console.warn('[isAuthorized] Missing or invalid Authorization header');
    return false;
  }
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    console.warn('[isAuthorized] Empty token');
    return false;
  }

  const cronSecret = Deno.env.get('SECURITY_ALERTS_CRON_SECRET');
  if (cronSecret && token === cronSecret) return true;

  if (token.split('.').length !== 3) {
    console.warn('[isAuthorized] Token is not a JWT');
    return false;
  }
  
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    console.warn('[isAuthorized] Failed to get user from token:', error?.message);
    return false;
  }

  // 1. Check if System Admin
  const { data: systemUser } = await supabaseAdmin
    .from('system_users')
    .select('role, is_active')
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email || ''}`)
    .maybeSingle();

  if (systemUser?.is_active && ['super_admin', 'admin_helper'].includes(systemUser.role)) {
      console.log('[isAuthorized] Authorized as System Admin:', systemUser.role);
      return true;
  }

  // 2. Check if Station Admin
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, station_id')
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email || ''}`)
    .maybeSingle();

  if (profile && ['owner', 'admin'].includes(profile.role)) {
      console.log('[isAuthorized] Authorized as Station Admin:', profile.role);
      return true;
  }

  console.warn('[isAuthorized] Denied: User has no authorized role in system_users or profiles', user.email);
  return false;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  // SMTP Secrets from your Supabase Dashboard
  const SMTP_HOSTNAME = Deno.env.get('SMTP_HOSTNAME') || 'smtp.gmail.com';
  const SMTP_PORT = Number(Deno.env.get('SMTP_PORT')) || 465;
  const SMTP_USERNAME = Deno.env.get('SMTP_USERNAME') || 'iotank.com@gmail.com';
  const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD'); 
  const SEND_FROM_EMAIL = Deno.env.get('SEND_FROM_EMAIL') || SMTP_USERNAME;

  if (!SMTP_PASSWORD) {
    console.warn('[dispatch] SMTP_PASSWORD not configured. Emails will likely fail if authentication is required.');
  }

  // Twilio Secrets
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const TWILIO_FROM_NUMBER = Deno.env.get('TWILIO_FROM_NUMBER');
  const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.warn('[dispatch] Twilio credentials not configured. SMS will fail.');
  }

  // VAPID Secrets
  const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
  const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');

  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      `mailto:${SMTP_USERNAME}`,
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
  } else {
    console.warn('[dispatch] VAPID keys not configured. Push notifications will fail.');
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing Supabase URL/Key' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (!(await isAuthorized(req, supabaseAdmin))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

    try {
      const body = await req.json().catch(() => ({}));

      const smtpClient = new SmtpClient();

      const connectSMTP = async () => {
        console.log(`[SMTP] Initiating connection to ${SMTP_HOSTNAME}:${SMTP_PORT}...`);
        
        try {
          if (SMTP_PORT === 465) {
            // Port 465: Implicit TLS — must use connectTLS, NOT connect(tls:true)
            await smtpClient.connectTLS({
              hostname: SMTP_HOSTNAME,
              port: SMTP_PORT,
              username: SMTP_USERNAME,
              password: SMTP_PASSWORD,
            });
          } else {
            // Port 587: STARTTLS — plain connect, TLS is negotiated post-handshake
            await smtpClient.connect({
              hostname: SMTP_HOSTNAME,
              port: SMTP_PORT,
              username: SMTP_USERNAME,
              password: SMTP_PASSWORD,
            });
          }
          
          console.log(`[SMTP] Handshake stabilized. Connected to ${SMTP_HOSTNAME}`);
        } catch (connErr: any) {
          console.error(`[SMTP] Protocol Error at ${SMTP_HOSTNAME}:${SMTP_PORT}:`, connErr.message);
          throw new Error(`SMTP connection failed: ${connErr.message}`);
        }
      };

      // ── CASE 1: DIRECT SMTP DISPATCH (Secure Server-Side Render) ───
      if (body.cmd === 'direct_security_alert' && body.to && body.params) {
        await connectSMTP();
        const generatedHtml = renderSecurityEmail(body.params);
        const subjectPrefix = body.params.type === 'SHIFT_REPORT' ? '📊 IOTANK OPERATIONS' : '🚨 IOTANK SECURITY';
        
        // Sanitize subject to prevent SMTP injection/errors
        const rawSubject = `${subjectPrefix}: ${body.params.type.replace('_', ' ')} at ${body.params.siteName}`;
        const sanitizedSubject = rawSubject.replace(/[\r\n]/g, '').slice(0, 200);

        try {
          await smtpClient.send({
            from: SEND_FROM_EMAIL,
            to: body.to,
            subject: sanitizedSubject,
            content: generatedHtml,
            html: generatedHtml,
          });
        } catch (sendErr: any) {
          console.error('[SMTP] Dispatch failed:', sendErr.message);
          throw sendErr;
        } finally {
          try { await smtpClient.close(); } catch { /* ignore close error */ }
        }

        return new Response(JSON.stringify({ success: true, method: 'direct_smtp_secure' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

    // ── CASE 1.5: DIRECT TRANSACTIONAL DISPATCH (Welcome/Invite) ──
    if (body.cmd === 'direct_transactional_email' && body.to && body.params) {
      await connectSMTP();
      const generatedHtml = renderTransactionalEmail(body.params);
      
      const rawSubject = body.params.type === 'INVITATION' ? `🛡️ Team Invitation: IoTank Fuel Intelligence` : `🚀 Welcome to IoTank: ${body.params.stationName}`;
      const sanitizedSubject = rawSubject.replace(/[\r\n]/g, '').slice(0, 200);

      try {
        await smtpClient.send({
          from: SEND_FROM_EMAIL,
          to: body.to,
          subject: sanitizedSubject,
          content: generatedHtml,
          html: generatedHtml,
        });
      } catch (sendErr: any) {
        console.error('[SMTP] Transactional Dispatch failed:', sendErr.message);
        throw sendErr;
      } finally {
        try { await smtpClient.close(); } catch { /* ignore close error */ }
      }

      return new Response(JSON.stringify({ success: true, method: 'direct_transactional_secure' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── CASE 1.7: DIRECT SMS DISPATCH (Twilio REST) ───────────────
    if (body.cmd === 'direct_sms_alert' && body.to && body.message) {
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || (!TWILIO_FROM_NUMBER && !TWILIO_MESSAGING_SERVICE_SID)) {
        throw new Error('Twilio configuration (Account SID, Auth Token, and From Number/Service SID) missing on server');
      }

      console.log(`[Twilio] Dispatching SMS to ${body.to}...`);
      
      const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
      const smsPayload: Record<string, string> = {
        To: body.to,
        Body: body.message,
      };

      // [INTELLIGENT ROUTING]: Prefer Messaging Service SID to handle International Alpha ID rules
      if (TWILIO_MESSAGING_SERVICE_SID) {
        smsPayload.MessagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
      } else {
        smsPayload.From = TWILIO_FROM_NUMBER!;
      }

      const twilioResponse = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${auth}`,
          },
          body: new URLSearchParams(smsPayload).toString(),
        }
      );

      if (!twilioResponse.ok) {
        const twilioErr = await twilioResponse.json();
        throw new Error(`Twilio API Error: ${twilioErr.message || twilioResponse.statusText}`);
      }

      console.log(`[Twilio] SMS sent successfully to ${body.to}`);

      return new Response(JSON.stringify({ success: true, method: 'direct_sms_twilio' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── CASE 2: AUTOMATED QUEUE PROCESSING ───────────────────────────────────
    const requestedLimit = Number(body?.limit ?? 20);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, requestedLimit)) : 20;

    const { data, error } = await supabaseAdmin.rpc('claim_pending_critical_alert_events', { p_limit: limit });
    if (error) throw new Error(`Queue claim failed: ${error.message}`);

    const events = (data || []) as ClaimedEvent[];
    if (events.length === 0) {
      return new Response(JSON.stringify({ success: true, claimed: 0, sent: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await connectSMTP();

    let sentCount = 0;
    let pushCount = 0;

    for (const event of events) {
      try {
        // 1. Send Email (Rich HTML instead of plain text)
        const generatedHtml = renderSecurityEmail({
          type: event.event_type as any,
          siteName: event.station_id || 'Unknown Facility',
          tankName: event.scope_key || 'Facility-wide',
          timestamp: event.created_at,
          details: event.reason || 'An anomaly was detected. Review telemetry for more details.',
        });
        
        const rawSubject = `🚨 CRITICAL SECURITY: ${event.event_type.replace('_', ' ')} at ${event.station_id || 'Facility'}`;
        const sanitizedSubject = rawSubject.replace(/[\r\n]/g, '').slice(0, 200);

        await smtpClient.send({
          from: SEND_FROM_EMAIL,
          to: event.actor_email || SEND_FROM_EMAIL, 
          subject: sanitizedSubject,
          content: generatedHtml,
          html: generatedHtml,
        });
        sentCount++;

        // 2. Send Web Push
        if (event.station_id && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
          // Fetch all users associated with this station who have push tokens
          const { data: tokens } = await supabaseAdmin
            .from('user_push_tokens')
            .select('token, auth_user_id')
            .in('auth_user_id', 
              (await supabaseAdmin
                .from('profiles')
                .select('auth_user_id')
                .eq('station_id', event.station_id)
              ).data?.map(p => p.auth_user_id) || []
            );

          if (tokens && tokens.length > 0) {
            console.log(`[Push] Dispatching to ${tokens.length} tokens for station ${event.station_id}...`);
            const payload = JSON.stringify({
              title: `🚨 IoTank Security Alert`,
              body: `${event.event_type}: ${event.reason || 'Anomaly detected'}`,
              icon: '/favicon.ico',
              data: {
                stationId: event.station_id,
                eventId: event.id
              }
            });

            for (const tokenRecord of tokens) {
              try {
                const subscription = JSON.parse(tokenRecord.token);
                await webpush.sendNotification(subscription, payload);
                pushCount++;
              } catch (pushErr: any) {
                console.warn(`[Push] Failed for user ${tokenRecord.auth_user_id}:`, pushErr.message);
                // If 410 Gone, we should delete the token
                if (pushErr.statusCode === 410) {
                  await supabaseAdmin
                    .from('user_push_tokens')
                    .delete()
                    .eq('auth_user_id', tokenRecord.auth_user_id)
                    .eq('token', tokenRecord.token);
                }
              }
            }
          }
        }

        await supabaseAdmin.rpc('complete_critical_alert_event', {
          p_event_id: event.id,
          p_sent: true,
          p_error: null,
        });
      } catch (sendErr: any) {
        console.error('[dispatch] Dispatch loop error:', sendErr.message);
        await supabaseAdmin.rpc('complete_critical_alert_event', {
          p_event_id: event.id,
          p_sent: false,
          p_error: `DISPATCH ERROR: ${sendErr?.message || 'unknown'}`,
        });
      }
    }

    await smtpClient.close();

    return new Response(JSON.stringify({
      success: true,
      claimed: events.length,
      sent: sentCount,
      push: pushCount
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[dispatch] ERROR:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
