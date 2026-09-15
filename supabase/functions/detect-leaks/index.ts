import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"
import { corsHeaders } from "../_shared/cors.ts"
import { requireAdminOrCron } from "../_shared/auth.ts"
import { THRESHOLDS, calculateTimeBasedSlope } from "../_shared/algorithms.ts"

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    // CRIT-001: Authenticate caller using shared helper
    const auth = await requireAdminOrCron(req, corsHeaders);
    if ('response' in auth) return auth.response;
    const { supabaseAdmin: supabase } = auth;

    try {
        console.log('[LeakDetection] Starting forensic analysis cycle...');
        
        // 1. Fetch tanks and station data
        const { data: tanks, error: tanksError } = await supabase.from('tanks').select('*');
        if (tanksError || !tanks) throw tanksError;

        // 2. Fetch shift statuses
        const stationIds = [...new Set(tanks.map(t => t.station_id))];
        const { data: shiftStatuses } = await supabase
            .from('current_station_shifts')
            .select('station_id, status')
            .in('station_id', stationIds);
        
        const shiftMap = new Map(shiftStatuses?.map(s => [s.station_id, s.status]) || []);

        for (const tank of tanks) {
            // Only analyze if station is CLOSED (best time for leak detection)
            const shiftStatus = shiftMap.get(tank.station_id) || 'CLOSED';
            if (shiftStatus !== 'CLOSED') continue;

            const twoHoursAgo = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();
            const { data: readingsData, error: readingsError } = await supabase
                .from('sensor_readings')
                .select('volume, timestamp')
                .eq('tank_id', tank.id)
                .gt('timestamp', twoHoursAgo)
                .order('timestamp', { ascending: true });

            if (readingsError || !readingsData || readingsData.length < 5) continue;

            const points = readingsData.map(d => ({
                x: new Date(d.timestamp).getTime(),
                y: d.volume as number
            }));

            const slopeLhr = calculateTimeBasedSlope(points);
            const dropRate = -slopeLhr; // Positive value for volume loss
            const LEAK_THRESHOLD_LHR = THRESHOLDS.FORENSICS.LEAK_DETECTION_LHR;

            if (dropRate > LEAK_THRESHOLD_LHR) {
                // 3. Deduplication: Check for unresolved leak alerts
                const { count } = await supabase
                    .from('alerts')
                    .select('*', { count: 'exact', head: true })
                    .eq('tank_id', tank.id)
                    .eq('alert_type', 'leak_detected')
                    .eq('is_resolved', false);

                if (count === 0) {
                    console.warn(`[LeakDetection] Potential leak in Tank ${tank.id}: slope ${slopeLhr.toFixed(4)} L/hr`);

                    await supabase.from('alerts').insert({
                        station_id: tank.station_id,
                        tank_id: tank.id,
                        alert_type: 'leak_detected',
                        severity: 'critical',
                        title: 'Forensic Inventory Leak Detected',
                        message: `System identified a sustained loss of ${dropRate.toFixed(2)} L/hr while station is CLOSED.`,
                        metadata: { dropRate, readingsCount: points.length, durationHrs: 2, shiftStatus }
                    });

                    // 🛠️ Update Tank Status
                    await supabase.from('tanks').update({
                        has_active_leak_alert: true,
                        leak_confidence: 0.95 
                    }).eq('id', tank.id);
                }
            }
        }

        return new Response(JSON.stringify({ status: 'success' }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });

    } catch (error) {
        console.error('[LeakDetection] Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
        });
    }

})
