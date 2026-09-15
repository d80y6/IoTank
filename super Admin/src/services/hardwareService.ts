import { supabase } from '../config/supabase';

export interface Device {
    id: string;
    device_id: string;
    station_name: string;
    client_name: string;
    model: 'ESP32-S3' | 'ESP32-WROOM';
    firmware_version: string;
    status: 'online' | 'offline' | 'maintenance' | 'error';
    last_seen: string;
    signal_strength: 'excellent' | 'good' | 'fair' | 'poor';
    uptime: string;
    ip_address: string;
    mac_address: string;
    cpu_usage: number;
    ram_usage: number;
    temp: number;
    voltage: number;
    lat: number;
    lng: number;
}

export interface FirmwareVersion {
    id: string;
    version: string;
    release_date: string;
    type: 'stable' | 'beta' | 'alpha' | 'hotfix';
    compatible_hw: string[];
    size_mb: number;
    checksum: string;
    status: 'active' | 'archived' | 'testing';
}

export interface OTACampaign {
    id: string;
    name: string;
    target_version: string;
    total_devices: number;
    updated_devices: number;
    failed_devices: number;
    status: 'in_progress' | 'paused' | 'completed' | 'failed';
}

export interface DevTask {
    id: string;
    title: string;
    description: string;
    assignee: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    status: 'backlog' | 'in_progress' | 'review' | 'testing' | 'ready' | 'deployed';
}

export const hardwareService = {
    async getDeviceStats() {
        const { data: devices, error } = await supabase
            .from('devices')
            .select('status, firmware_version');
        
        if (error) {
            console.error('Error fetching device stats:', error);
            return { total: 0, online: 0, offline: 0, needingUpdate: 0, avgUptime: 0, dataRate: 0 };
        }

        const total = devices.length;
        const online = devices.filter(d => d.status === 'online').length;
        const offline = devices.filter(d => d.status === 'offline' || d.status === 'error').length;
        
        // Example logic for needing update: version != '2.6.0'
        const needingUpdate = devices.filter(d => d.firmware_version !== '2.6.0').length;

        return {
            total,
            online,
            offline,
            needingUpdate,
            avgUptime: 99.4, // Placeholder
            dataRate: 4500
        };
    },

    async getDevices(filters?: any) {
        let query = supabase
            .from('devices')
            .select(`
                *,
                client:fuel_stations(station_name)
            `)
            .order('last_seen', { ascending: false });

        if (filters?.status) query = query.eq('status', filters.status);
        
        const { data, error } = await query;
        if (error) {
            console.error('Error fetching devices:', error);
            return [];
        }

        // Map database fields to the Device interface if they differ
        return data.map(d => ({
            ...d,
            client_name: d.client?.full_name || 'Unknown'
        })) as Device[];
    },

    async getFirmwareLibrary() {
        const { data, error } = await supabase
            .from('firmware_releases')
            .select('*')
            .order('release_date', { ascending: false });
        
        if (error || !data || data.length === 0) {
            console.warn('Firmware library empty or missing table, using fallback.');
            return [
                { id: '1', version: '2.6.0', release_date: '2026-03-15', type: 'stable', compatible_hw: ['ESP32-S3'], size_mb: 2.1, checksum: 'sha256...', status: 'active' },
                { id: '2', version: '2.5.3', release_date: '2026-02-10', type: 'stable', compatible_hw: ['Both'], size_mb: 1.9, checksum: 'sha256...', status: 'archived' }
            ] as FirmwareVersion[];
        }
        return data as FirmwareVersion[];
    },

    async getOTACampaigns() {
        const { data, error } = await supabase
            .from('firmware_campaigns')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('Error fetching OTA campaigns:', error);
            return [];
        }
        return data as OTACampaign[];
    },

    async getDevTasks() {
        const { data, error } = await supabase
            .from('system_tasks')
            .select('*')
            .order('priority', { ascending: false });
        
        if (error) {
            console.error('Error fetching dev tasks:', error);
            return [];
        }
        return data as DevTask[];
    },

    async sendCommand(stationId: string, deviceId: string, command: string, payload: any = {}) {
        const { data, error } = await supabase
            .from('device_commands')
            .insert({
                station_id: stationId,
                device_id: deviceId,
                command: command,
                payload: payload,
                status: 'pending'
            })
            .select()
            .single();

        if (error) {
            console.error('Command Dispatch Error:', error);
            throw error;
        }

        // Log the administrative action with high-fidelity metadata
        await supabase.from('unified_events').insert({
            event_type: 'HARDWARE_COMMAND',
            event_category: 'HARDWARE',
            severity: command === 'FACTORY_RESET' ? 'CRITICAL' : 'INFO',
            description: `Remote command [${command}] dispatched to device ${deviceId}`,
            metadata: { 
                command, 
                payload, 
                command_id: data.id,
                station_id: stationId,
                resource_id: deviceId
            }
        });

        return data;
    }
};

