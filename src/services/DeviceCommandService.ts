import { supabase } from '@/config/supabase';

export interface DeviceCommand {
    id: string;
    station_id: string;
    device_id: string;
    command: string;
    payload: any;
    status: 'pending' | 'sent' | 'processed' | 'failed';
    created_at: string;
}

const PENDING_COMMANDS_KEY = 'iotank_pending_commands';

export class DeviceCommandService {
    /**
     * Get IDs of commands sent from this client that are still awaiting processing
     */
    static getLocalPendingIds(): string[] {
        try {
            const raw = localStorage.getItem(PENDING_COMMANDS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    /**
     * Mark a command as tracked locally
     */
    private static trackLocally(id: string) {
        const ids = this.getLocalPendingIds();
        if (!ids.includes(id)) {
            localStorage.setItem(PENDING_COMMANDS_KEY, JSON.stringify([...ids, id]));
        }
    }

    /**
     * Remove a command from local tracking once processed/failed
     */
    static resolveLocally(id: string) {
        const ids = this.getLocalPendingIds();
        localStorage.setItem(PENDING_COMMANDS_KEY, JSON.stringify(ids.filter(i => i !== id)));
    }

    /**
     * Sends a command to a specific device.
     */
    static async sendCommand(stationId: string, deviceId: string, command: string, payload: any = {}) {
        const { data, error } = await supabase
            .from('device_commands')
            .insert({
                station_id: stationId,
                device_id: deviceId,
                command,
                payload,
                status: 'pending'
            })
            .select()
            .single();

        if (error) throw error;
        
        // Track this command locally so we can show a "Pending" warning if the user refreshes
        if (data?.id) {
            this.trackLocally(data.id);
        }

        return data;
    }

    /**
     * Subscribes to commands for a specific station.
     */
static subscribeToCommands(stationId: string, onUpdate: (payload: any) => void) {
        // M-07 FIX: Removed _${Date.now()} suffix — unstable names leak Supabase connection slots on re-renders.
        const channelName = `device_commands_channel_${stationId}`;
        // WORKAROUND (SUPABASE_FOLLOWUP_TICKET): production
        // realtime.subscription_check_filters has invalid syntax, so server-side
        // `filter:` clauses can silently drop the subscription. Subscribe to the
        // whole table and filter by station_id client-side instead.
        return supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'device_commands'
                },
                (payload) => {
                    const newRecord = payload.new as any;
                    const oldRecord = payload.old as any;
                    const rowStationId = newRecord?.station_id ?? oldRecord?.station_id;
                    if (rowStationId && rowStationId !== stationId) return;

                    // If the command is now processed or failed, remove from local tracking
                    if (newRecord && (newRecord.status === 'processed' || newRecord.status === 'failed')) {
                        this.resolveLocally(newRecord.id);
                    }
                    onUpdate(payload);
                }
            )
            .subscribe();
    }
                    onUpdate(payload);
                }
            )
            .subscribe();
    }

    /**
     * Fetches recent commands for a station.
     */
    static async getRecentCommands(stationId: string, limit = 10) {
        const { data, error } = await supabase
            .from('device_commands')
            .select('*')
            .eq('station_id', stationId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    }
}
