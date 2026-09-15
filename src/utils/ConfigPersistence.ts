import { Tank } from '@/types';
import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

const STORAGE_KEY = 'iotank_tank_config';

export const ConfigPersistence = {
    /**
     * Saves configuration to LocalStorage for immediate UI responsiveness
     */
    saveToLocal: (config: Partial<Tank>) => {
        try {
            const existing = ConfigPersistence.getLocal() || {};
            const updated = { ...existing, ...config };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            return updated;
        } catch (error) {
            logger.error('[ConfigPersistence] LocalStorage write failed:', error);
            return null;
        }
    },

    /**
     * Retrieves configuration from LocalStorage
     */
    getLocal: (): Partial<Tank> | null => {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error('[ConfigPersistence] LocalStorage read failed:', error);
            return null;
        }
    },

    /**
     * Synchronizes local configuration with Supabase
     */
    syncToCloud: async (stationId: string, tankId: string, config: Partial<Tank>) => {
        try {
            const { error } = await supabase
                .from('tanks')
                .update({
                    ...config,
                    updated_at: new Date().toISOString()
                })
                .eq('id', tankId)
                .eq('station_id', stationId);

            if (error) throw error;
            return true;
        } catch (error) {
            logger.error('[ConfigPersistence] Supabase sync failed:', error);
            return false;
        }
    },

    /**
     * Fetches from Supabase and updates local cache
     */
    refreshFromCloud: async (stationId: string, tankId: string) => {
        try {
            const { data, error } = await supabase
                .from('tanks')
                .select('*')
                .eq('id', tankId)
                .eq('station_id', stationId)
                .single();

            if (error || !data) throw error || new Error('Tank not found');

            const tankData = data as unknown as Tank;
            ConfigPersistence.saveToLocal(tankData);
            return tankData;
            // NOTE: The line below was unreachable — removed (C-01)
        } catch (error) {
            logger.error('[ConfigPersistence] Refresh from Supabase failed:', error);
            return null;
        }
    }
};
