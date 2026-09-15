import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"
import { getCorsHeaders } from '../_shared/cors.ts'
import { requireAdminOrCron } from "../_shared/auth.ts"
import { THRESHOLDS, calculateTimeBasedSlope } from "../_shared/algorithms.ts"

declare const Deno: any;

serve(async (req) => {
    const corsHeaders = getCorsHeaders(req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    // CRIT-001: Authenticate caller using shared helper
    const auth = await requireAdminOrCron(req, corsHeaders);
    if ('response' in auth) return auth.response;
    const { supabaseAdmin: supabase } = auth;

    try {
        console.log('[AlertEngine] Starting forensic heuristic scan...');
        
        // 1. Fetch active tanks and their station data
        const { data: tanks, error: tanksError } = await supabase
            .from('tanks')
            .select(`
                *,
                station:fuel_stations(email, station_name)
            `);

        if (tanksError || !tanks) throw tanksError;

        // 2. Fetch all current shift statuses in bulk
        const stationIds = [...new Set(tanks.map(t => t.station_id))];
        const { data: shiftStatuses } = await supabase
            .from('current_station_shifts')
            .select('station_id, status')
            .in('station_id', stationIds);
        
        const shiftMap = new Map(shiftStatuses?.map(s => [s.station_id, s.status]) || []);

        const results = [];
        const chunkSize = 10;

        for (let i = 0; i < tanks.length; i += chunkSize) {
            const chunk = tanks.slice(i, i + chunkSize);
            
            const chunkPromises = chunk.map(async (tank) => {
                const shiftStatus = shiftMap.get(tank.station_id) || 'CLOSED';
                const stationEmail = (tank as any).station?.email || 'admin@iotank.com';
                const stationName = (tank as any).station?.station_name || tank.tank_name;
                const tankReport: any = { tank_id: tank.id, name: tank.tank_name, incidents: [], shift: shiftStatus };
                
                // 3. Fetch latest two readings for delta analysis
                const { data: readings } = await supabase
                    .from('sensor_readings')
                    .select('volume, timestamp')
                    .eq('tank_id', tank.id)
                    .order('timestamp', { ascending: false })
                    .limit(2);

                const lastReading = readings?.[0];
                const prevReading = readings?.[1];

                // 4. INSTANT ANOMALY DETECTION (Discharge & Refill)
                if (lastReading && prevReading) {
                    const delta = lastReading.volume - prevReading.volume;
                    const isClosed = shiftStatus === 'CLOSED';
                    
                    if (delta < -THRESHOLDS.FORENSICS.MIN_THEFT_VOLUME_L) {
                        // DISCHARGE DETECTED
                        if (isClosed) {
                            tankReport.incidents.push({
                                type: 'theft_detected',
                                severity: 'critical',
                                title: 'UNAUTHORIZED DISCHARGE',
                                message: `Alert: ${Math.abs(delta).toFixed(1)}L loss detected while station is CLOSED. Potential theft in progress.`
                            });
                        }
                    } else if (delta > THRESHOLDS.FORENSICS.MIN_THEFT_VOLUME_L) {
                        // REFILL DETECTED
                        if (isClosed) {
                            tankReport.incidents.push({
                                type: 'unauthorized_refill',
                                severity: 'critical',
                                title: 'UNAUTHORIZED REFILL',
                                message: `SECURITY BREACH: Fuel inflow of ${delta.toFixed(1)}L detected while shift is CLOSED. Out-of-hours delivery requires immediate verification.`
                            });
                        }
                    }
                }

                // 5. Connectivity Check
                const offlineWarningMs = THRESHOLDS.TELEMETRY.OFFLINE_WARNING_MINS * 60 * 1000;
                const offlineCriticalMs = THRESHOLDS.TELEMETRY.OFFLINE_CRITICAL_MINS * 60 * 1000;
                
                if (!lastReading || (Date.now() - new Date(lastReading.timestamp).getTime()) > offlineWarningMs) {
                    const gapMs = lastReading ? (Date.now() - new Date(lastReading.timestamp).getTime()) : Infinity;
                    const isCritical = gapMs > offlineCriticalMs;

                    tankReport.incidents.push({
                        type: 'connectivity_lost',
                        severity: isCritical ? 'critical' : 'warning',
                        title: isCritical ? 'CRITICAL: Sensor Offline' : 'Telemetry Connection Lost',
                        message: isCritical 
                            ? `Tank "${tank.tank_name}" has been unreachable for over ${THRESHOLDS.TELEMETRY.OFFLINE_CRITICAL_MINS} minutes.`
                            : `Station node has not reported data since ${lastReading ? new Date(lastReading.timestamp).toLocaleTimeString() : 'Unknown'}.`
                    });
                }

                // 6. Inventory Level Breaches
                if (lastReading) {
                    const percentage = (lastReading.volume / tank.tank_capacity) * 100;
                    
                    if (percentage <= THRESHOLDS.LEVEL.CRITICAL_LOW) {
                        tankReport.incidents.push({
                            type: 'low_level',
                            severity: 'critical',
                            title: 'EMERGENCY STOP (LOW)',
                            message: `Critical: Tank reached ${THRESHOLDS.LEVEL.CRITICAL_LOW}% emergency threshold. Volume: ${lastReading.volume.toFixed(0)}L.`
                        });
                    } else if (percentage <= THRESHOLDS.LEVEL.WARNING_LOW) {
                        tankReport.incidents.push({
                            type: 'low_level',
                            severity: 'warning',
                            title: 'REORDER POINT',
                            message: `Inventory reached ${THRESHOLDS.LEVEL.WARNING_LOW}% reorder point. Current: ${percentage.toFixed(1)}%.`
                        });
                    } else if (percentage >= THRESHOLDS.LEVEL.CRITICAL_HIGH) {
                        tankReport.incidents.push({
                            type: 'overfill',
                            severity: 'critical',
                            title: 'CRITICAL OVERFILL',
                            message: `Max capacity (${THRESHOLDS.LEVEL.CRITICAL_HIGH}%) reached. Cease all deliveries to tank ${tank.tank_name}.`
                        });
                    } else if (percentage >= THRESHOLDS.LEVEL.WARNING_HIGH) {
                        tankReport.incidents.push({
                            type: 'warning_high',
                            severity: 'warning',
                            title: 'OPERATOR WARNING (HIGH)',
                            message: `High volume alert (${THRESHOLDS.LEVEL.WARNING_HIGH}%). Monitoring required.`
                        });
                    }
                }

                // 7. Advanced Slope Analysis (Leak & Parallel Pull)
                const twoHoursAgo = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();
                const { data: trendData } = await supabase
                    .from('sensor_readings')
                    .select('volume, timestamp')
                    .eq('tank_id', tank.id)
                    .gt('timestamp', twoHoursAgo)
                    .order('timestamp', { ascending: true });

                if (trendData && trendData.length > 5) {
                    const points = trendData.map(d => ({
                        x: new Date(d.timestamp).getTime(),
                        y: d.volume as number
                    }));

                    const slopeLhr = calculateTimeBasedSlope(points);
                    const dropRate = -slopeLhr; // Positive value for volume loss
                    
                    if (shiftStatus === 'OPEN') {
                        // Parallel Pull Detection (Theft during operations)
                        const maxPumpFlowRateLhr = THRESHOLDS.FORENSICS.MAX_PUMP_FLOW_LPM * 60;
                        if (dropRate > maxPumpFlowRateLhr) {
                            tankReport.incidents.push({
                                type: 'theft_detected',
                                severity: 'critical',
                                title: 'PARALLEL PULL DETECTED',
                                message: `Critical Alert: Discharge rate (${dropRate.toFixed(0)}L/hr) exceeds physical pump capacity (${maxPumpFlowRateLhr}L/hr). Siphoning suspected.`
                            });
                        }
                    } else {
                        // Leak Detection during closed shift
                        if (dropRate > THRESHOLDS.FORENSICS.LEAK_DETECTION_LHR) {
                            tankReport.incidents.push({
                                type: 'leak_detected',
                                severity: 'warning',
                                title: 'Forensic Leak Detected',
                                message: `Sustained unusual loss of ${dropRate.toFixed(1)}L/hr detected while station is CLOSED.`
                            });
                        }
                    }
                }

                // 8. Commit Alerts to Database
                for (const incident of tankReport.incidents) {
                    const { count } = await supabase
                        .from('alerts')
                        .select('*', { count: 'exact', head: true })
                        .eq('tank_id', tank.id)
                        .eq('alert_type', incident.type)
                        .eq('is_resolved', false);

                    if (count === 0) {
                        await supabase.from('alerts').insert({
                            station_id: tank.station_id,
                            tank_id: tank.id,
                            alert_type: incident.type,
                            severity: incident.severity,
                            title: incident.title,
                            message: incident.message,
                            metadata: { source: 'ServerEngine', shiftStatus, timestamp: new Date().toISOString() }
                        });
                        
                        if (incident.severity === 'critical') {
                            // Check if any station user has email alerts enabled
                            const { data: stationUsers } = await supabase
                                .from('profiles')
                                .select('auth_user_id')
                                .eq('station_id', tank.station_id);

                            let shouldSendEmail = false;
                            if (stationUsers && stationUsers.length > 0) {
                                for (const user of stationUsers) {
                                    const { data: prefs } = await supabase
                                        .from('user_preferences')
                                        .select('preferences')
                                        .eq('user_id', user.auth_user_id)
                                        .maybeSingle();

                                    if (prefs?.preferences?.email_alerts !== false) {
                                        shouldSendEmail = true;
                                        break;
                                    }
                                }
                            } else {
                                // No users found, send anyway (fallback)
                                shouldSendEmail = true;
                            }

                            if (shouldSendEmail) {
                                const DISPATCH_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/dispatch-critical-alerts`;
                                await fetch(DISPATCH_URL, {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({
                                        cmd: 'direct_security_alert',
                                        // Assistance recipient: josephvundi26@gmail.com
                                        to: `${stationEmail}, josephvundi26@gmail.com`,
                                        params: {
                                            type: incident.title,
                                            siteName: stationName,
                                            details: { description: incident.message, timestamp: new Date().toISOString() }
                                        }
                                    })
                                }).catch(e => console.error('[AlertEngine] Dispatch trigger failed:', e));
                            } else {
                                console.log('[AlertEngine] Email alert suppressed by user preferences for station:', tank.station_id);
                            }
                        }
                    }
                }
                return tankReport;
            });

            const chunkResults = await Promise.allSettled(chunkPromises);
            for (const res of chunkResults) {
                if (res.status === 'fulfilled') results.push(res.value);
            }
        }

        return new Response(JSON.stringify({ 
            status: 'success', 
            tanks_processed: tanks.length,
            results
        }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });

    } catch (error) {
        console.error('[AlertEngine] Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500 
        });
    }

})
