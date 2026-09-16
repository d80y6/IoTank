import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_JURISDICTION = 'GLOBAL'

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

        console.log(`[compliance] Generating compliance packs for ${monthLabel}...`);

        // Fetch all active stations with their regional classification.
        const { data: stations } = await supabase
            .from('fuel_stations')
            .select('station_id, station_name, owner_id, region_code')
            .eq('account_status', 'active');

        if (!stations) throw new Error('No active stations found.');

        // Cache jurisdiction templates so we only hit the RPC once per code.
        const templateCache = new Map<string, any>();

        async function resolveTemplate(jurisdictionCode: string | null) {
            const code = jurisdictionCode || DEFAULT_JURISDICTION;
            if (templateCache.has(code)) return templateCache.get(code);

            const { data: cfg } = await supabase
                .rpc('get_jurisdiction_config', { p_code: code });

            let template = null;
            if (cfg && cfg.template) {
                template = cfg.template;
            } else {
                // Fall back to an explicitly-registered template row.
                const { data: tpl } = await supabase
                    .from('report_templates')
                    .select('*')
                    .eq('jurisdiction_code', code)
                    .eq('is_active', true)
                    .order('schema_version', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                template = tpl || null;
            }
            templateCache.set(code, template);
            return template;
        }

        for (const station of stations) {
            try {
                const template = await resolveTemplate(station.region_code || null);
                const templateCode = template?.template_code || 'compliance_pack';
                const reportName = template?.name || 'Compliance Pack';

                // 1. Fetch deliveries for the month
                const { data: deliveries } = await supabase
                    .from('deliveries')
                    .select('*')
                    .eq('station_id', station.station_id)
                    .gte('delivery_date', startOfMonth)
                    .lte('delivery_date', endOfMonth);

                // 2. Fetch daily summaries (aggregated per station/day)
                const { data: summaries } = await supabase
                    .from('daily_summaries')
                    .select('*')
                    .eq('station_id', station.station_id)
                    .gte('date', startOfMonth.split('T')[0])
                    .lte('date', endOfMonth.split('T')[0]);

                // 3. Aggregate metrics
                const totalThroughput = deliveries?.reduce((acc, d) => acc + (d.actual_received_volume || 0), 0) || 0;
                const totalDeliveries = deliveries?.length || 0;

                const reportData = {
                    jurisdiction: station.region_code || DEFAULT_JURISDICTION,
                    template: templateCode,
                    period: { start: startOfMonth, end: endOfMonth, label: monthLabel },
                    metrics: {
                        totalThroughput,
                        totalDeliveries,
                        incidentCount: 0,
                        avgVariancePct: 0
                    },
                    deliveries: deliveries || [],
                    dailyLogs: summaries || [],
                    generated_at: new Date().toISOString()
                };

                // 4. Save to reports (generated_by is uuid; system automation writes NULL)
                await supabase.from('reports').insert([{
                    station_id: station.station_id,
                    name: `${reportName} - ${monthLabel}`,
                    report_type: templateCode,
                    report_data: reportData,
                    generated_by: null
                }]);

                // 5. Notify owner (profiles uses display_name, not full_name)
                const { data: owner } = await supabase
                    .from('profiles')
                    .select('email, display_name')
                    .eq('station_id', station.station_id)
                    .eq('role', 'owner')
                    .maybeSingle();

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
                                type: 'BILLING_NOTICE',
                                recipientName: owner.display_name || 'Station Owner',
                                stationName: station.station_name,
                                billingAmount: 'COMPLIANCE PACK READY',
                                dueDate: monthLabel,
                                loginUrl: 'https://the-iotank-project.web.app/reporting'
                            }
                        })
                    });
                }

                console.log(`[compliance] Pack generated for ${station.station_name}`);

            } catch (stationErr) {
                console.error(`[compliance] Error for ${station.station_name}:`, stationErr.message);
            }
        }

        return new Response(JSON.stringify({ status: 'Compliance automation cycle complete' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('[compliance] Fatal Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500
        });
    }
})