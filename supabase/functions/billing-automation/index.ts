import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') || '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
        )

        console.log('[Billing] Starting automated cycle...');

        // 1. Run Monthly Billing RPC
        const { data: billedStations, error: billingError } = await supabase.rpc('apply_monthly_billing');
        if (billingError) throw billingError;

        console.log(`[Billing] Applied monthly billing to ${billedStations?.length || 0} stations.`);

        // 2. Run Suspension Enforcement RPC
        const { data: suspendedStations, error: suspensionError } = await supabase.rpc('enforce_billing_suspensions');
        if (suspensionError) throw suspensionError;

        console.log(`[Billing] Suspended ${suspendedStations?.length || 0} delinquent stations.`);

        // 3. Dispatch Emails for Billed Stations
        if (billedStations && billedStations.length > 0) {
            for (const station of billedStations) {
                // Fetch station admin email
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('email, full_name')
                    .eq('station_id', station.station_id)
                    .eq('role', 'owner')
                    .maybeSingle();

                if (profile?.email) {
                    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/dispatch-critical-alerts`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                        },
                        body: JSON.stringify({
                            cmd: 'direct_transactional_email',
                            to: profile.email,
                            params: {
                                type: 'BILLING_NOTICE',
                                recipientName: profile.full_name || 'Station Manager',
                                stationName: station.station_name,
                                billingAmount: 'KSh 5,000.00',
                                dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString(),
                                loginUrl: 'https://the-iotank-project.web.app/billing'
                            }
                        })
                    });
                }
            }
        }

        // 4. Dispatch Emails for Suspended Stations
        if (suspendedStations && suspendedStations.length > 0) {
            for (const station of suspendedStations) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('email, full_name')
                    .eq('station_id', station.station_id)
                    .eq('role', 'owner')
                    .maybeSingle();

                if (profile?.email) {
                    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/dispatch-critical-alerts`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                        },
                        body: JSON.stringify({
                            cmd: 'direct_transactional_email',
                            to: profile.email,
                            params: {
                                type: 'SUSPENSION_WARNING',
                                recipientName: profile.full_name || 'Station Manager',
                                stationName: station.station_name,
                                loginUrl: 'https://the-iotank-project.web.app/billing'
                            }
                        })
                    });
                }
            }
        }

        return new Response(JSON.stringify({ 
            status: 'success', 
            billed: billedStations?.length || 0,
            suspended: suspendedStations?.length || 0
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('[Billing] Fatal Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500
        });
    }
})
