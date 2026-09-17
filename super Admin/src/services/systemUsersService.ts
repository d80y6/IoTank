import { supabase } from '../config/supabase';

export interface SystemUser {
  id: string;
  email: string;
  full_name: string;
  role: 'super_admin' | 'admin_helper' | 'support_staff' | 'analyst';
  is_active: boolean;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  last_login?: string;
}

export const systemUsersService = {
  async getAllSystemUsers() {
    const { data, error } = await supabase
      .from('system_users')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data as SystemUser[];
  },

  async inviteSystemUser(payload: { email: string; full_name: string; role: SystemUser['role']; portal_link: string }) {
    const { data, error } = await supabase.functions.invoke('invite-system-staff', {
      body: payload
    });

    if (error) throw error;
    return data;
  },

  async createSystemUser(payload: Partial<SystemUser>) {
    if (payload.role === 'super_admin') {
      throw new Error('Super admin accounts must be created via secured bootstrap flow.');
    }

    const normalizedPayload = {
      ...payload,
      email: payload.email?.trim().toLowerCase(),
      full_name: payload.full_name?.trim()
    };

    const { data, error } = await supabase
      .from('system_users')
      .insert([normalizedPayload])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async updateSystemUser(id: string, updates: Partial<SystemUser>) {
    const { data, error } = await supabase
      .from('system_users')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async deleteSystemUser(id: string) {
    const attemptDeletion = async () => {
      const { error } = await supabase
        .from('system_users')
        .delete()
        .eq('id', id);
      return error;
    };

    // Prefer the guarded RPC: it closes out related rows (profiles,
    // financial_trails, auth) atomically and never hits a raw FK wall.
    const { error: rpcError } = await supabase.rpc('delete_user_safely', {
      target_user_id: id
    });
    if (!rpcError) return true;

    let error: { message: string } | null = rpcError;

    if (error) {
      const message = (error.message || '').toLowerCase();

      if (message.includes('foreign key') || message.includes('constraint')) {
        // Clean up dependent refs when DB constraints are strict.
        await supabase.from('admin_logs').update({ system_user_id: null }).eq('system_user_id', id);
        await supabase.from('system_users').update({ created_by: null }).eq('created_by', id);

        error = await attemptDeletion();
      }
    }

    if (error) throw error;
    return true;
  },

  async bootstrapSuperAdmin(payload: { email: string; full_name: string; auth_user_id: string }) {
    const { data, error } = await supabase.rpc('bootstrap_super_admin', {
      p_email: payload.email.trim().toLowerCase(),
      p_full_name: payload.full_name.trim(),
      p_auth_user_id: payload.auth_user_id.trim()
    });

    if (error) throw error;
    return data;
  },

  async getAdminLogs() {
    const { data, error } = await supabase
      .from('admin_logs')
      .select('*, system_users(full_name, role), fuel_stations(station_name)')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async getClientAdmins() {
    // This joins profiles (role=admin/owner) with fuel_stations and includes counts
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        *,
        fuel_stations:station_id (
          station_name,
          current_debt,
          total_paid,
          last_login,
          created_at
        )
      `)
      .or('role.eq.admin,role.eq.owner')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Enhance with counts
    const enhanced = await Promise.all((data || []).map(async (owner: any) => {
      const { count: tankCount } = await supabase
        .from('tanks')
        .select('*', { count: 'exact', head: true })
        .eq('station_id', owner.station_id);

      const { count: workerCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('station_id', owner.station_id)
        .not('role', 'in', '("admin","owner")');

      return {
        ...owner,
        tank_count: tankCount || 0,
        worker_count: workerCount || 0
      };
    }));

    return enhanced;
  },

  async getAllWorkers() {
    // Fetch all profiles that are NOT admins/owners (supervisors, operators, etc.)
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        *,
        fuel_stations:station_id (
          station_name,
          last_login
        )
      `)
      .not('role', 'in', '("admin","owner")')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }
};
