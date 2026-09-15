import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"
import { corsHeaders } from "../_shared/cors.ts"
import { enforceDurableRateLimit, requireProxyScope } from "../_shared/auth.ts"

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
        const authHeader = req.headers.get('Authorization') || '';
        const apiKeyHeader = req.headers.get('apikey') || '';
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const cronSecret = Deno.env.get('CRON_SECRET') || '';

        const isAuthorized =
            (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
            (serviceKey && authHeader === `Bearer ${serviceKey}`) ||
            (serviceKey && apiKeyHeader === serviceKey);

        if (!isAuthorized) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') || '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
        );

        console.log('[Rollup] Starting daily aggregation cycle...');
        
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const startTime = yesterday.toISOString();
        const endTime = new Date(yesterday.getTime() + 24 * 60 * 60 * 1000).toISOString();
        const dateStr = yesterday.toISOString().split('T')[0];

        const { data: tanks, error: tanksError } = await supabase.from('tanks').select('id');
        if (tanksError || !tanks) throw tanksError;

        for (const tank of tanks) {
            const { data: readings, error: readingsError } = await supabase
                .from('sensor_readings')
                .select('volume, temperature')
                .eq('tank_id', tank.id)
                .gte('timestamp', startTime)
                .lt('timestamp', endTime);

            if (readingsError || !readings || readings.length === 0) continue;

            let sumVol = 0, sumTemp = 0, count = 0;
            readings.forEach(data => {
                if (typeof data.volume === 'number') {
                    sumVol += data.volume;
                    if (typeof data.temperature === 'number') sumTemp += data.temperature;
                    count++;
                }
            });

            if (count > 0) {
                const { error: insertError } = await supabase
                    .from('daily_summaries')
                    .upsert({
                        tank_id: tank.id,
                        date: dateStr,
                        avg_volume: sumVol / count, // DB column name standardized to avg_volume
                        avg_temperature: sumTemp / count,

                        reading_count: count,
                        timestamp: startTime
                    }, { onConflict: 'tank_id, date' });

                if (insertError) console.error(`[Rollup] Error for Tank ${tank.id}:`, insertError.message);
            }
        }


        return new Response(JSON.stringify({ status: 'Daily rollup completed' }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });

    } catch (error) {
        console.error('[Rollup] Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
        });
    }
})
