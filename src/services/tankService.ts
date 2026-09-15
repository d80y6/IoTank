import { supabase } from '../config/supabase';
import { validateUUID } from '../utils/sanitization';
import { logger } from '../utils/logger';

export const tankService = {
  /**
   * Fetches all tanks belonging to the current user
   */
  async getTanks(stationId: string) {
    if (!validateUUID(stationId)) return null;
    try {
      const { data, error } = await supabase
        .from('tanks')
        .select('*')
        .eq('station_id', stationId)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error fetching tanks:', error);
      return null;
    }
  },

  /**
   * Fetches a specific tank by ID
   */
  async getTankById(id: string) {
    if (!validateUUID(id)) return null;
    try {
      const { data, error } = await supabase
        .from('tanks')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error fetching tank details:', error);
      return null;
    }
  },

  /**
   * Fetches recent sensor readings for a given tank
   */
  async getSensorReadings(tankId: string, limit = 50) {
    if (!validateUUID(tankId)) return null;
    try {
      const { data, error } = await supabase
        .from('sensor_readings')
        .select('*')
        .eq('tank_id', tankId)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error fetching sensor readings:', error);
      return null;
    }
  }
};
