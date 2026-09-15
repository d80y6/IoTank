// supabase/functions/dispatch-forensic-report/index.ts

// @ts-ignore Deno edge import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.40.0'
// @ts-ignore Deno edge import
import { SmtpClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { renderForensicReport } from '../_shared/ForensicReportTemplate.ts'

declare const Deno: any;

// Polyfill for Deno.writeAll
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

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders(req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD');
    const SMTP_USERNAME = Deno.env.get('SMTP_USERNAME') || 'iotank.com@gmail.com';
    const SUPPORT_RECIPIENT = 'josephvundi26@gmail.com'; // User requested hardcoded assistant email

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return new Response(JSON.stringify({ error: 'Missing Supabase URL/Key' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        const body = await req.json().catch(() => ({}));
        const { station_id } = body;

        if (!station_id) {
            return new Response(JSON.stringify({ error: 'station_id is required' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        console.log(`[ForensicReport] Generating 3-day report for Station: ${station_id}...`);

        // 1. Fetch Station Data
        const { data: station, error: stationError } = await supabaseAdmin
            .from('fuel_stations')
            .select('*')
            .eq('id', station_id)
            .single();

        if (stationError || !station) throw new Error(`Station not found: ${station_id}`);

        // 2. Fetch Station Admin Email
        const { data: admins } = await supabaseAdmin
            .from('profiles')
            .select('email')
            .eq('station_id', station_id)
            .in('role', ['owner', 'admin']);

        const adminEmails = admins?.map(a => a.email).filter(Boolean) || [];
        const stationEmail = station.email || adminEmails[0] || 'support@iotank.com';

        // 3. Fetch Data for Last 3 Days
        const threeDaysAgo = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)).toISOString();
        
        // Fetch Critical Alerts
        const { data: alerts } = await supabaseAdmin
            .from('alerts')
            .select('*')
            .eq('station_id', station_id)
            .gte('created_at', threeDaysAgo)
            .order('created_at', { ascending: false });

        // Fetch Tanks and Latest Readings
        const { data: tanks } = await supabaseAdmin
            .from('tanks')
            .select('*')
            .eq('station_id', station_id);

        const processedTanks = tanks?.map(tank => {
            const lastUpdate = tank.last_reading_at ? new Date(tank.last_reading_at).getTime() : 0;
            const isOffline = (Date.now() - lastUpdate) > 60 * 60 * 1000;
            return {
                name: tank.tank_name || tank.name,
                currentVolume: tank.current_volume || 0,
                isOffline,
                lastSeen: tank.last_reading_at ? new Date(tank.last_reading_at).toLocaleString() : 'Never'
            };
        }) || [];

        // 4. Calculate Aggregate Stats
        const criticalAlerts = alerts?.filter(a => a.severity === 'critical') || [];
        const avgVolume = processedTanks.reduce((acc, t) => acc + t.currentVolume, 0) / (processedTanks.length || 1);
        const onlineCount = processedTanks.filter(t => !t.isOffline).length;
        const connectivityScore = Math.round((onlineCount / (processedTanks.length || 1)) * 100);

        // 5. Generate Email HTML
        const reportHtml = renderForensicReport({
            stationName: station.station_name || 'IoTank Facility',
            periodDays: 3,
            supportEmail: SUPPORT_RECIPIENT,
            criticalAlerts: criticalAlerts.slice(0, 5), // Top 5 critical issues
            telemetryStats: {
                avgVolume,
                connectivityScore,
                totalIncidents: alerts?.length || 0
            },
            tanks: processedTanks
        });

        // 6. SMTP Dispatch
        const smtpClient = new SmtpClient();
        const SMTP_HOSTNAME = Deno.env.get('SMTP_HOSTNAME') || 'smtp.gmail.com';
        const SMTP_PORT = Number(Deno.env.get('SMTP_PORT')) || 465;

        console.log(`[SMTP] Connecting to ${SMTP_HOSTNAME}...`);
        
        if (SMTP_PORT === 465) {
            await smtpClient.connectTLS({
                hostname: SMTP_HOSTNAME,
                port: SMTP_PORT,
                username: SMTP_USERNAME,
                password: SMTP_PASSWORD,
            });
        } else {
            await smtpClient.connect({
                hostname: SMTP_HOSTNAME,
                port: SMTP_PORT,
                username: SMTP_USERNAME,
                password: SMTP_PASSWORD,
            });
        }

        const recipients = [SUPPORT_RECIPIENT, ...adminEmails];
        const uniqueRecipients = [...new Set(recipients)];

        console.log(`[ForensicReport] Dispatching to: ${uniqueRecipients.join(', ')}`);

        for (const recipient of uniqueRecipients) {
            await smtpClient.send({
                from: SMTP_USERNAME,
                to: recipient,
                subject: `📊 3-DAY FORENSIC REPORT: ${station.station_name || 'Asset Summary'}`,
                content: reportHtml,
                html: reportHtml,
            });
        }

        await smtpClient.close();

        return new Response(JSON.stringify({ 
            success: true, 
            message: 'Forensic report dispatched successfully',
            recipients: uniqueRecipients
        }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error('[ForensicReport] Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
