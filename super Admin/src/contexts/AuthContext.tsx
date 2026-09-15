import { createContext, useContext, useEffect, useState, startTransition, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';

interface SystemUser {
  id: string;
  auth_user_id?: string;
  email: string;
  full_name: string;
  role: 'super_admin' | 'admin_helper' | 'support_staff' | 'analyst';
  auth_level: number;
  is_active: boolean;
}

interface AuthContextType {
  user: User | null;
  systemUser: SystemUser | null;
  currentUser: any | null; // For shared component compatibility
  loading: boolean;
  error: string | null;
  signOut: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<any>;
  signInWithGoogle: () => Promise<any>;
  canSee: (level: number) => boolean;
  hasRole: (role: any) => boolean;
  resetPassword: (email: string) => Promise<void>;
  updateUser: (data: any) => Promise<void>;
  verifySettingsPassword: (password: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  systemUser: null,
  currentUser: null,
  loading: true,
  error: null,
  signOut: async () => {},
  signIn: async () => {},
  signInWithGoogle: async () => {},
  canSee: () => false,
  hasRole: () => false,
  resetPassword: async () => {},
  updateUser: async () => {},
  verifySettingsPassword: async () => {},
});

// useAuth moved to src/hooks/useAdminAuth.ts to avoid HMR invalidation

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [systemUser, setSystemUser] = useState<SystemUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSystemUser = async (supabaseUser: User) => {
    if (!supabaseUser) {
      setLoading(false);
      return;
    }

    // [RECOVERY BYPASS]: Do not attempt system_user mapping if we are in a recovery flow
    if (window.location.hash.includes('type=recovery') || window.location.hash.includes('recovery_token=')) {
      setLoading(false);
      return;
    }

    try {
      const isRecoveryFlow = window.location.pathname === '/reset-password';

      // 1. Query system_users table by auth_user_id
      let { data: userData, error: supaError } = await supabase
        .from('system_users')
        .select('*')
        .eq('auth_user_id', supabaseUser.id)
        .maybeSingle(); 
      
      const safeEmail = (supabaseUser.email || '').toLowerCase();

      // Fallback: Query by email ONLY if no UID match and record has no UID (unlinked account)
      if (!userData && !supaError) {
        const { data: emailMatch, error: emailErr } = await supabase
          .from('system_users')
          .select('*')
          .ilike('email', safeEmail)
          .is('auth_user_id', null)
          .maybeSingle();
        
        if (emailErr) console.error("Error fetching system user by email fallback:", emailErr);

        if (emailMatch) {
          userData = emailMatch;
        }
      }

      if (supaError || !userData) {
        console.error("System user mapping error or no record found:", supaError);
        
        // Extra diagnostics: check if record exists with ANY UID but same email
        const { data: anySysUser } = await supabase.from('system_users').select('id, auth_user_id, email').ilike('email', safeEmail).maybeSingle();
        if (anySysUser) {
            console.warn(`Record exists in system_users with email ${anySysUser.email} but DIFFERENT UID: ${anySysUser.auth_user_id}. Current UID is ${supabaseUser.id}`);
        }
        
        if (isRecoveryFlow) {
          // RECOVERY SHIELD: Never sign out if we are on the reset password page.
          setLoading(false);
          return;
        }

        // Check if this is a Client-Portal user trying to access Admin-Portal
        const { data: profileCheck } = await supabase
          .from('profiles')
          .select('id')
          .eq('auth_user_id', supabaseUser.id)
          .maybeSingle();

        if (profileCheck) {
          setError("Access Denied: Your account is for the Client Portal only. Please use the Client Login.");
        } else {
          setError("Unauthorized: Access restricted to registered system administrators.");
        }

        // Delay sign out slightly to let the error show or just handle it in UI
        await supabase.auth.signOut();
        setSystemUser(null);
        setUser(null);
        setLoading(false);
        return;
      }

      // SECURITY: Ensure active status check
      if (!userData.is_active) {
        setError("Your admin account has been suspended. Please contact the lead super admin.");
        await signOut();
        setLoading(true); // Flag to ensure transition
        setLoading(false);
        return;
      }

      // 2. Fetch auth level using the native function
      const { data: levelData, error: levelError } = await supabase.rpc('get_auth_level');

      if (levelError) {
          console.error("Error fetching auth level:", levelError);
      }

      // 3. Proactively link the session if auth_user_id is missing
      if (userData && !userData.auth_user_id) {
        const { data: updated, error: syncError } = await supabase
          .from('system_users')
          .update({ auth_user_id: supabaseUser.id })
          .eq('id', userData.id)
          .select()
          .single();
        
        if (syncError) {
          console.error("Failed to link system user:", syncError);
        } else if (updated) {
          userData = updated;
        }
      }

      setSystemUser({
        ...userData,
        auth_level: levelData || 4 
      } as SystemUser);
      setUser(supabaseUser);
    } catch (err) {
      console.error("Auth verification error:", err);
      // No automatic sign-out here to allow transient retry
    } finally {
      setLoading(false);
    }
  };

  // [RECOVERY DETECTOR]: Global catch for password recovery hashes
  useEffect(() => {
    if (window.location.hash.includes('type=recovery') || window.location.hash.includes('recovery_token=')) {
        const targetUrl = `${window.location.origin}/reset-password${window.location.hash}`;
        window.location.href = targetUrl;
    }
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSystemUser(null);
    } catch (err) {
      console.error("Error signing out:", err);
    }
  };

  const canSee = (requiredLevel: number) => {
    if (!systemUser) return false;
    return systemUser.auth_level <= requiredLevel;
  };

  const signIn = async (email: string, password: string) => {
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    // Proactively fetch the system user BEFORE returning control to the Login page.
    // This prevents the 'blink' where the app redirects before the profile is ready.
    if (data.user) {
      currentUserRef.current = data.user.id;
      try {
        await fetchSystemUser(data.user);
      } catch (enrichError) {
        console.error("Post-login system user enrichment failed:", enrichError);
        // We don't re-throw here to prevent "Incorrect credentials" from masking the real issue
      }
    }
    
    return data;
  };

  const signInWithGoogle = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) throw error;
    return data;
  };

  const hasRole = (role: any) => {
    if (!systemUser) return false;
    // Super Admins (Level 1) have all access
    if (systemUser.auth_level === 1) return true;
    return systemUser.role === role;
  };

  const resetPassword = async (email: string) => {
    // Ensure redirect URL is absolute and matches Supabase's allow-list.
    const resetUrl = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetUrl,
    });
    if (error) throw error;
  };

  const updateUser = async (data: any) => {
    const { error } = await supabase.auth.updateUser(data);
    if (error) throw error;
  };

  const verifySettingsPassword = async (password: string) => {
    if (!user?.email) throw new Error("No authenticated email found.");
    
    // Attempt a re-authentication with the current email and provided password
    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: password,
    });
    
    if (error) {
      throw new Error("Invalid administrative password. Action blocked.");
    }
    
    // If successful, we don't need to do anything with the data, 
    // the fact that it didn't throw is the verification.
  };

  const currentUserRef = useRef<string | null>(null);

  useEffect(() => {
    // [DYNAMIC RECOVERY PATH]: Check current state instead of relying on mount-time constant
    const getCurrentIsRecovery = () => window.location.pathname === '/reset-password';
    
    // 1. Check active session on mount
    const checkSession = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          const isInvalidToken = sessionError.message?.toLowerCase().includes('refresh token') || 
                                sessionError.message?.toLowerCase().includes('invalid token') ||
                                (sessionError as any).status === 400;
          
          if (isInvalidToken) {
              console.warn("[DEBUG_LOG] BOOT: Session data corrupted or expired. Performing silent purge.");
              await supabase.auth.signOut().catch(() => {});
              setUser(null);
              setSystemUser(null);
              setLoading(false);
              return;
          }
        }

        if (session?.user) {
          currentUserRef.current = session.user.id;
          
          // [RECOVERY REDIRECT]: If we are on ANY page except reset-password but have a recovery hash, MOVE.
          if (window.location.hash.includes('type=recovery') || window.location.hash.includes('recovery_token=')) {
              if (window.location.pathname !== '/reset-password') {
                  window.location.href = `${window.location.origin}/reset-password${window.location.hash}`;
                  return;
              }
              setLoading(false);
              return;
          }

          if (window.location.pathname !== '/reset-password') {
            await fetchSystemUser(session.user);
          } else {
            setLoading(false);
          }
        } else {
          setLoading(false);
        }
      } catch (err: any) {
        // Handle navigator.locks timeout or other fatal getSession errors
        if (err.message && err.message.includes('lock')) {
          console.warn("[DEBUG_LOG] Auth lock contention detected. Retrying in 1s...");
          setTimeout(checkSession, 1000);
        } else {
          setLoading(false);
        }
      }
    };

    checkSession();

    // 2. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // [RECOVERY HANDLER]: Explicitly route to reset module if events or path detect it
      if (event === 'PASSWORD_RECOVERY') {
        setLoading(false);
        if (window.location.pathname !== '/reset-password') {
            window.location.href = `${window.location.origin}/reset-password${window.location.hash}`;
            return;
        }
        return;
      }

      if (window.location.pathname === '/reset-password') {
        setLoading(false);
        return;
      }

      // Suppress events that don't require a full re-auth/profile fetch:
      // - SIGNED_IN / INITIAL_SESSION when already tracking this user
      // - TOKEN_REFRESHED  → silent background refresh, no UI change needed
      // - USER_UPDATED     → metadata update, no session change
      const isSilentEvent = event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED';
      const isSameUser = session?.user?.id === currentUserRef.current;

      if (isSilentEvent || (isSameUser && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION'))) {
        return;
      }

      startTransition(() => {
        setLoading(true);
        if (session?.user) {
          currentUserRef.current = session.user.id;
          fetchSystemUser(session.user);
        } else {
          currentUserRef.current = null;
          setUser(null);
          setSystemUser(null);
          setLoading(false);
        }
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ 
      user, 
      systemUser, 
      currentUser: systemUser, 
      loading, 
      error, 
      signOut, 
      signIn,
      signInWithGoogle,
      canSee,
      hasRole,
      resetPassword,
      updateUser,
      verifySettingsPassword
    }}>
      {children}
    </AuthContext.Provider>
  );
};
