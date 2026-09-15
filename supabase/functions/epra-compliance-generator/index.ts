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

        const now = new Date();
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const startOfMonth = lastMonth.toISOString();
        const endOfMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
        const monthLabel = lastMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

        console.log(`[EPRA] Generating compliance packs for ${monthLabel}...`);

        // Fetch all active stations
        const { data: stations } = await supabase
            .from('fuel_stations')
            .select('station_id, station_name, owner_id')
            .eq('account_status', 'active');

        if (!stations) throw new Error('No active stations found.');

        for (const station of stations) {
            try {
                // 1. Fetch Deliveries for the month
                const { data: deliveries } = await supabase
                    .from('deliveries')
                    .select('*')
                    .eq('station_id', station.station_id)
                    .gte('delivery_date', startOfMonth)
                    .lte('delivery_date', endOfMonth);

                // 2. Fetch daily summaries (assuming they exist in daily_summaries or similar)
                // If not, we could aggregate from sensor_readings, but daily_summaries is more efficient.
                const { data: summaries } = await supabase
                    .from('daily_summaries')
                    .select('*')
                    .eq('station_id', station.station_id)
                    .gte('date', startOfMonth.split('T')[0])
                    .lte('date', endOfMonth.split('T')[0]);

                // 3. Aggregate Metrics
                const totalThroughput = deliveries?.reduce((acc, d) => acc + (d.actual_received_volume || 0), 0) || 0;
                const totalDeliveries = deliveries?.length || 0;
                
                const reportData = {
                    period: { start: startOfMonth, end: endOfMonth, label: monthLabel },
                    metrics: {
                        totalThroughput,
                        totalDeliveries,
                        incidentCount: 0, // Placeholder
                        avgVariancePct: 0 // Placeholder
                    },
                    deliveries: deliveries || [],
                    dailyLogs: summaries || [],
                    generated_at: new Date().toISOString()
                };

                // 4. Save to Reports
                await supabase.from('reports').insert([{
                    station_id: station.station_id,
                    name: `EPRA Compliance Pack - ${monthLabel}`,
                    report_type: 'epra_compliance_pack',
                    report_data: reportData,
                    generated_by: 'SYSTEM_AUTOMATION'
                }]);

                // 5. Notify Owner
                const { data: owner } = await supabase
                    .from('profiles')
                    .select('email, full_name')
                    .eq('station_id', station.station_id)
                    .eq('role', 'owner')
                    .single();

                if (owner?.email) {
                    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/dispatch-critical-alerts`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                        },
                        body: JSON.stringify({
                            cmd: 'direct_transactional_email',
                            to: owner.email,
                            params: {
                                type: 'BILLING_NOTICE', // Reusing the branded template but with custom message
                                recipientName: owner.full_name || 'Station Owner',
                                stationName: station.station_name,
                                billingAmount: 'COMPLIANCE PACK READY',
                                dueDate: monthLabel,
                                loginUrl: 'https://the-iotank-project.web.app/reporting'
                            }
                        })
                    });
                }

                console.log(`[EPRA] Pack generated for ${station.station_name}`);

            } catch (stationErr) {
                console.error(`[EPRA] Error for ${station.station_name}:`, stationErr.message);
            }
        }

        return new Response(JSON.stringify({ status: 'EPRA automation cycle complete' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('[EPRA] Fatal Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500
        });
    }
})
