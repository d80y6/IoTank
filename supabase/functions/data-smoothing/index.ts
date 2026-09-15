import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"
import { corsHeaders } from "../_shared/cors.ts"

/**
 * 1-Dimensional Kalman Filter for sensor data smoothing.
 */
function kalmanFilter(z: number, x_est_prev: number, P_prev: number, Q: number = 0.01, R: number = 0.1) {
    const x_pred = x_est_prev;
    const P_pred = P_prev + Q;
    const K = P_pred / (P_pred + R);
    const x_est = x_pred + K * (z - x_pred);
    const P = (1 - K) * P_pred;
    return { x_est, P };
}

serve(async (req) => {
    // 🟢 CORS Control
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    // CRIT-001: Authenticate caller — support both apikey (from triggers) and Authorization (standard)
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

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        // Basic verification of incoming data (Supabase Webhook format)
        const body = await req.json();
        const record = body.record;

        if (!record || typeof record.volume !== 'number') {
            return new Response(JSON.stringify({ error: 'Invalid record format' }), { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400 
            });
        }

        const { tank_id, volume, timestamp } = record;

        // Fetch current tank state for filter
        const { data: tank, error: tankError } = await supabase
            .from('tanks')
            .select('last_smoothed_level, filter_covariance, outlier_count')
            .eq('id', tank_id)
            .single();

        if (tankError || !tank) throw new Error(`Tank ${tank_id} not found`);

        const prevEstimate = tank.last_smoothed_level || volume;
        const prevCovariance = tank.filter_covariance || 1.0;

        // 🛡️ Outlier Rejection Layer (Refill-Aware)
        const deviation = Math.abs(volume - prevEstimate);
        const isRefill = volume > prevEstimate; 
        const outlierThreshold = isRefill ? (0.8 * prevEstimate) : (0.3 * prevEstimate);
        const minDeviationFloor = 15; // Litres

        if (tank.last_smoothed_level !== undefined && deviation > outlierThreshold && deviation > minDeviationFloor) {
            const newOutlierCount = (tank.outlier_count || 0) + 1;
            const updatePayload: any = {
                last_reading_at: timestamp,
                outlier_count: newOutlierCount
            };

            if (newOutlierCount >= 5) {
                updatePayload.last_smoothed_level = volume;
                updatePayload.filter_covariance = 1.0;
                updatePayload.outlier_count = 0;
            }

            await supabase.from('tanks').update(updatePayload).eq('id', tank_id);
            return new Response(JSON.stringify({ status: 'Outlier handled', count: newOutlierCount }), { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            });
        }

        // 🧠 Apply Kalman Filter
        const { x_est: newSmoothedLevel, P: newCovariance } = kalmanFilter(
            volume,
            prevEstimate,
            prevCovariance,
            0.01, // Process noise
            0.5   // Measurement noise
        );

        // 💾 Update Tank State
        const { error: updateError } = await supabase
            .from('tanks')
            .update({
                last_smoothed_level: newSmoothedLevel,
                filter_covariance: newCovariance,
                last_reading_at: timestamp,
                current_volume: newSmoothedLevel,
                outlier_count: 0
            })

            .eq('id', tank_id);

        if (updateError) throw updateError;


        return new Response(JSON.stringify({ status: 'success', smoothed: newSmoothedLevel }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });

    } catch (error) {
        console.error('[Smoothing] Critical Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
        });
    }
})
