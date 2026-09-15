/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { createContext, useState, useEffect, ReactNode, useRef } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '@/config/supabase';
import { User, UserRole } from '@/types';
import { AuditService } from '@/services/AuditService';
import { NewsService } from '@/services/NewsService';

import { logger } from '@/utils/logger';

// HIGH-003: Only emit debug logs in development — never in production
const debugLog = (msg: string, ctx?: any) => logger.info(msg, ctx, 'AUTH_CONTEXT_TRACE');

const CACHE_KEY = 'IOTANK_USER_CACHE_V2.5'; // [VERSIONED]: Invalidate stale schemas
// HIGH-001: Fields stored in the localStorage cache — sensitive auth fields (role, authLevel)
// are intentionally excluded; they are always re-derived from the DB on enrichment.
const SAFE_CACHE_FIELDS = [
    'authUserId', 'email', 'displayName', 'photoURL', 'role', 'authLevel', 
    'stationId', 'companyName', 'logoUrl', 'siteIds', 'mfaEnabled', 
    'securityPinEnabled', 'isSystemAccount', 'stationEmail'
];

export interface EnrollMFAResult {
    factorId: string;
    qrCode: string;   // otpauth:// URI for QR code display
    secret: string;   // Plain text secret for manual entry
}

export interface AuthContextType {
    currentUser: User | null;
    loading: boolean;
    mfaChallengeRequired: boolean;
    mfaFactorId: string | null;
    signIn: (email: string, password: string) => Promise<any>;
    signUp: (email: string, password: string, displayName: string, stationId: string) => Promise<void>;
    signInWithGoogle: () => Promise<void>;
    signOut: () => Promise<void>;
    enrichUserFromSupabase: (sbUser?: any) => Promise<boolean>;
    resetPassword: (email: string) => Promise<void>;
    hasRole: (requiredRole: UserRole | UserRole[]) => boolean;
    canSee: (level: number) => boolean;
    updateMasterPassword: (password: string) => Promise<void>;
    verifySettingsPassword: (password: string) => Promise<void>;
    updateUser: (data: Partial<User>) => Promise<void>;
    enrollMFA: () => Promise<EnrollMFAResult>;
    verifyMFARegistration: (factorId: string, code: string) => Promise<void>;
    verifyMFA: (code: string) => Promise<void>;
    unenrollMFA: () => Promise<void>;
    cancelMFAChallenge: () => void;
    checkMFAChallenge: () => Promise<boolean>;
    setupSecurityPin: (pin: string) => Promise<void>;
    disableSecurityPin: () => Promise<void>;
    verifySecurityPin: (pin: string) => Promise<boolean>;
    mfaFailures: number;
    resetMfaFailures: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(() => {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                // Preliminary check: if we have a cached user, we can assume authenticated for the first frame
                parsed.isProvisional = true;
                parsed.role = 'viewer';
                parsed.authLevel = 8;
                return parsed;
            } catch { return null; }
        }
        return null;
    });
    const [loading, setLoading] = useState(!localStorage.getItem(CACHE_KEY));
    const [mfaChallengeRequired, setMfaChallengeRequired] = useState(false);
    const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
    // Stores the pending Supabase challenge ID during an MFA flow
    const mfaChallengeIdRef = useRef<string | null>(null);
    const mfaChallengeInProgressRef = useRef(false);
    const [mfaFailures, setMfaFailures] = useState(0);
    
    // Concurrency Lock: Prevent multiple enrichment calls from overlapping
    const isEnrichingRef = useRef<string | null>(null);
    const currentUserAuthIdRef = useRef<string | null>(null);
    const lastEnrichmentAttemptRef = useRef<number>(0);
    const enrichmentLockRef = useRef<boolean>(false);
    const handshakeInProgressRef = useRef(false);
    const isProvisionedRef = useRef<boolean>(false);
    const isLoadingRef = useRef<boolean>(true);
    const mfaFactorsRef = useRef<any>(null); // [OPTIMIZATION]: Cache factors during handshake
    const pinIntentRef = useRef<{ enabled: boolean, ts: number } | null>(null); // [RESILIENCE]: Prevent refresh-induced PIN resets

    const updateLoadingState = (val: boolean) => {
        setLoading(val);
        isLoadingRef.current = val;
    };
    const mapToUnprovisionedUser = (sbUser: SupabaseUser): User => {
        return {
            authUserId: sbUser.id,
            email: sbUser.email || '',
            displayName: sbUser.user_metadata?.full_name || 'Provisioning User',
            role: 'viewer', // Minimum level role
            authLevel: 8,   // Minimum level (Viewer)
            stationId: '',  // Triggers ProvisioningGuard
            siteIds: [],
            mfaEnabled: false,
            securityPinEnabled: false,
            isProvisional: false, // [FIX] Ensure provisional is false for unprovisioned state
            createdAt: Date.now(),
            lastLoginAt: Date.now()
        };
    };

    const enrichUserFromSupabase = async (sbUser: any, force: boolean = false) => {
        if (!sbUser?.id) return false;
        
        // Cooldown check: Prevent re-enriching the same user within 15s if we already tried
        // EXCEPTION: If 'force' is true (e.g. after MFA update), bypass the cooldown.
        const now = Date.now();
        if (!force && currentUserAuthIdRef.current === sbUser.id && (now - lastEnrichmentAttemptRef.current < 15000)) {
            debugLog(`[DEBUG_LOG] Enrichment cooldown active for ${sbUser.id}. Skipping.`);
            updateLoadingState(false);
            return false;
        }

        if (enrichmentLockRef.current && !force) {
            // Always ensure loading clears even on skipped enrichment
            updateLoadingState(false);
            return false; // Indicating skipped
        }
        
        isEnrichingRef.current = sbUser.id;
        
        try {
            debugLog(`[DEBUG_LOG] PROFILE: Launching optimized identity bundle handshake...`);
            let handshakeTimedOut = false;
            
            // TIMEOUT PROTECTION: Force-fail if a query hangs more than 15s (Safe for slow DB cold starts)
            // TIMEOUT PROTECTION: Force-fail if a query hangs more than 15s (Safe for slow DB cold starts)
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => {
                    handshakeTimedOut = true;
                    reject(new Error("Supabase query timeout"));
                }, 15000)
            );
            
            const runQuery = async () => {
                debugLog(`[DEBUG_LOG] ENRICHMENT STEP 1: Starting query for ${sbUser.id}`);
                lastEnrichmentAttemptRef.current = Date.now(); // Record attempt start
                enrichmentLockRef.current = true; // [FIX] Lock enrichment to prevent concurrent overlaps
                
                // [RECOVERY PANIC BYPASS]: If we detect a recovery link, we MUST NOT enrich or check boundaries.
                // Doing so might trigger a sign-out for System-Admins landing on the Client portal.
                if (window.location.hash.includes('type=recovery') || window.location.hash.includes('recovery_token=')) {
                    debugLog("[DEBUG_LOG] ENRICHMENT: Recovery detected. Postponing enrichment to allow password reset.");
                    return false;
                }

                // [PARALLEL ENRICHMENT]: Fetch DB bundle and MFA factors in parallel to reduce latency.
                // The RPC call doesn't use the Auth Lock, so it's safe to run alongside listFactors.
                debugLog(`[DEBUG_LOG] ENRICHMENT: Launching parallel DB + MFA fetch...`);
                
                const [bundleResult, mfaResult] = await Promise.all([
                    supabase.rpc('get_user_bundle_v2'),
                    // [OPTIMIZATION]: Only list factors if we don't already have them in a ref 
                    // from a preceding checkAndTriggerMFA call, AND the user actually has MFA enrolled.
                    mfaFactorsRef.current ? Promise.resolve({ data: mfaFactorsRef.current, error: null }) : 
                    (!sbUser?.app_metadata?.mfa_enrolled) ? Promise.resolve({ data: { totp: [] }, error: null }) :
                    Promise.race([
                        supabase.auth.mfa.listFactors(),
                        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('MFA Timeout')), 5000)) // Increased from 3s to 5s for reliability
                    ]).catch(e => {
                        logger.warn('[MFA] Factor list deferred or timed out. Falling back to cache/current state.', e);
                        return { data: null, error: e };
                    })
                ]);

                debugLog(`[DEBUG_LOG] ENRICHMENT: Parallel fetch complete.`);

                const { data: bundle, error } = bundleResult;
                const { data: factors } = mfaResult;
                
                // [FIX]: If MFA list timed out or returned null, fallback to metadata, current state, or cache.
                // We use a strict check to ensure we don't accidentally flip to 'false' on a network hiccup.
                let hasVerifiedMfa = factors?.totp?.some((f: any) => f.status === 'verified');
                
                if (factors === null || factors === undefined) {
                    // Fallback to source of truth: app_metadata or current state
                    hasVerifiedMfa = (sbUser?.app_metadata?.mfa_enrolled === true) || 
                                     (currentUser?.mfaEnabled === true);
                    debugLog(`[MFA] Factor list unavailable. Falling back to mfaEnabled: ${hasVerifiedMfa}`);
                }

                if (error) {
                    logger.error(`FATAL: RPC Request failed for ${sbUser.email}:`, error, 'AUTH_HANDSHAKE');
                    
                    // [RESILIENCE]: If we already have a user state (from cache or previous enrichment), 
                    // DO NOT overwrite it with unprovisioned state on a transient network error.
                    if (currentUser && currentUser.authUserId === sbUser.id && !currentUser.isProvisional) {
                        debugLog("[DEBUG_LOG] RPC failed but preserving existing identity state.");
                        updateLoadingState(false);
                        return true;
                    }

                    // Forensic Log for failed handshake (Fire-and-forget to avoid blocking UI)
                    AuditService.log(
                        'SECURITY',
                        'IDENTITY_MUTATION_ATTEMPT',
                        '',
                        `Identity handshake failed for ${sbUser.email}: RPC Error`,
                        'CRITICAL',
                        { error: error.message, code: error.code }
                    ).catch(err => logger.warn('[Audit Log Failed]', err));

                    setCurrentUser(mapToUnprovisionedUser(sbUser)); 
                    updateLoadingState(false);
                    return true;
                }

                if (bundle?.identity_type === 'error') {
                    logger.error(`400 ERROR DETAIL: Schema mismatch or recursive RLS detected.`, null, 'AUTH_HANDSHAKE');
                    
                    AuditService.log(
                        'SECURITY',
                        'IDENTITY_MUTATION_ATTEMPT',
                        '',
                        `Identity handshake protocol error for ${sbUser.email}`,
                        'CRITICAL',
                        { error_message: bundle.error_message, error_code: bundle.error_code }
                    ).catch(err => logger.warn('[Audit Log Failed]', err));

                    // Set provisional to trigger ProvisioningGuard, which can show the DB error now.
                    const errorUser = mapToUnprovisionedUser(sbUser);
                    errorUser.companyName = `DB_ERR: ${bundle.error_message}`; 
                    setCurrentUser(errorUser); 
                    updateLoadingState(false);
                    return true;
                }

                if (!bundle) {
                    logger.warn(`PERFORMANCE_WARN: Zero-Identity for ${sbUser.email}. Running provisional resolution.`, null, 'AUTH_HANDSHAKE');
                    setCurrentUser(mapToUnprovisionedUser(sbUser)); 
                    updateLoadingState(false);
                    return true;
                }

                debugLog("[DEBUG_LOG] User Identity Bundle Received:", {
                    station_id: bundle.station_id,
                    identity_type: bundle.identity_type,
                    role: bundle.role
                });

                const isSystemUser = bundle.identity_type === 'system';

                // 2. SECURITY: Hard Application Boundary - Block System Users from Client Portal
                // EXCEPTION: Allow recovery sessions to bypass the boundary so Admins can reset passwords.
                const isRecoveryPath = window.location.pathname === '/reset-password' || window.location.hash.includes('type=recovery');
                
                if (isSystemUser && !isRecoveryPath) {
                    await AuditService.log(
                        'SECURITY',
                        'UNAUTHORIZED_ACCESS_ATTEMPT',
                        '',
                        `Blocked: System Administrator (${sbUser.email}) attempted to load the Client Portal.`,
                        'WARNING',
                        { auth_id: sbUser.id }
                    );
                    
                    logger.error("SECURITY: Application Boundary Enforced. System users cannot access the Client Portal. Forcing instant sign-out.", { auth_id: sbUser.id }, 'AUTH_BOUNDARY');
                    await supabase.auth.signOut();
                    setCurrentUser(null);
                    updateLoadingState(false);
                    return true;
                }

                // 2.1 SECURITY: Check is_active (Legacy check fallback)
                if (isSystemUser && !bundle.is_active) {
                    await AuditService.log(
                        'SECURITY',
                        'UNAUTHORIZED_ACCESS_ATTEMPT',
                        '',
                        `Blocked login attempt for deactivated administrator: ${sbUser.email}`,
                        'CRITICAL',
                        { auth_id: sbUser.id }
                    );
                    
                    logger.error("SECURITY: Account is deactivated. Signing out.", { auth_id: sbUser.id }, 'AUTH_BOUNDARY');
                    await supabase.auth.signOut();
                    setCurrentUser(null);
                    updateLoadingState(false);
                    return true;
                }

                // 3. MAP IDENTITY FROM BUNDLE
                const finalUser: User = {
                    authUserId: sbUser.id,
                    email: sbUser.email || bundle.email || '',
                    displayName: bundle.display_name || (isSystemUser ? 'System Guardian' : 'Portal User'),
                    photoURL: bundle.photo_url,
                    role: bundle.role,
                    authLevel: bundle.auth_level,
                    stationId: bundle.station_id || (isSystemUser ? 'SYSTEM_GOVERNANCE' : ''),
                    companyName: bundle.station_name || (isSystemUser ? 'IoTank Governance' : 'Organization Setup Pending'),
                    stationEmail: bundle.station_email,
                    logoUrl: bundle.logo_url,
                    address: bundle.address,
                    phoneNumber: bundle.phone_number,
                    siteIds: bundle.site_ids || [],
                    mfaEnabled: hasVerifiedMfa,
                    securityPinEnabled: (pinIntentRef.current && (Date.now() - pinIntentRef.current.ts < 60000)) 
                        ? pinIntentRef.current.enabled 
                        : (bundle.security_pin_enabled ?? currentUser?.securityPinEnabled ?? false),
                    isSystemAccount: isSystemUser,
                    isProvisional: false, 
                    createdAt: bundle.created_at ? new Date(bundle.created_at).getTime() : Date.now(),
                    lastLoginAt: Date.now()
                };

                // [DEBUG]: Forensic verification of security flags
                debugLog(`[DEBUG_LOG] ENRICHMENT: Security Flags - MFA: ${finalUser.mfaEnabled}, PIN: ${finalUser.securityPinEnabled}`);


                // 4. CACHE: Persist for SWR (Stale-While-Revalidate) bootstrap
                // HIGH-001: Only cache non-sensitive identity fields — role/authLevel always come from DB
                try {
                    const safeCache: Partial<User> = {};
                    SAFE_CACHE_FIELDS.forEach(k => { (safeCache as any)[k] = (finalUser as any)[k]; });
                    localStorage.setItem(CACHE_KEY, JSON.stringify(safeCache));
                } catch (cacheErr) {
                    debugLog('[DEBUG_LOG] Failed to cache user profile:', cacheErr);
                }
            
                if (handshakeTimedOut) {
                    logger.warn("RECOVERY: Identity applied after timeout window.", null, 'AUTH_HANDSHAKE');
                } else {
                    debugLog("[DEBUG_LOG] SUCCESS: Identity bundle applied.");
                }
                isProvisionedRef.current = !!finalUser.stationId;
                setCurrentUser(finalUser);
                updateLoadingState(false);
                return true;
            };

            return await Promise.race([runQuery(), timeoutPromise]) as boolean;

        } catch (err) {
            logger.error('FATAL: Identity bundle fetch failed or timed out:', err, 'AUTH_HANDSHAKE');
            
            // Safety fallback: Treat as unprovisioned ONLY if we have no current state
            if (!currentUser || (currentUserAuthIdRef.current !== sbUser.id)) {
                isProvisionedRef.current = false;
                setCurrentUser(mapToUnprovisionedUser(sbUser));
            } else {
                debugLog("[DEBUG_LOG] Handshake timed out but preserving current state.");
            }
            updateLoadingState(false);
            return false;
        } finally {
            isEnrichingRef.current = null;
            enrichmentLockRef.current = false; // [FIX] Release lock
        }
    };

    // [RECOVERY DETECTOR]: Detect recovery fragments before routing or enrichment logic starts
    useEffect(() => {
        if (window.location.hash.includes('type=recovery') || window.location.hash.includes('recovery_token=')) {
            debugLog("[DEBUG_LOG] BOOT: Recovery hash detected. Immediate route to reset module.");
            const targetUrl = `${window.location.origin}/reset-password${window.location.hash}`;
            window.location.href = targetUrl;
        }
    }, []);

    const checkAndTriggerMFA = async (session: any): Promise<boolean> => {
        if (!session) return false;
        if (mfaChallengeRequired || mfaChallengeInProgressRef.current) return true;
        
        mfaChallengeInProgressRef.current = true;
        try {
            // [OPTIMIZATION]: Check session user metadata first for AAL level to avoid extra RPC
            if (session.user?.aud === 'authenticated' && session.user?.app_metadata?.aal === 'aal2') {
                mfaChallengeInProgressRef.current = false;
                return false;
            }

            const { data, error } = await Promise.race([
                supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
                new Promise<any>((_, reject) => setTimeout(() => reject(new Error('AAL Timeout')), 5000))
            ]);
            if (error) throw error;

            debugLog(`[MFA] AAL Check: Current=${data.currentLevel}, Next=${data.nextLevel}`);

            if (data.currentLevel !== data.nextLevel && data.nextLevel === 'aal2') {
                const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
                if (factorsError) throw factorsError;
                
                mfaFactorsRef.current = factors; // Cache for enrichment

                const totpFactor = factors.totp.find(f => f.status === 'verified');
                if (totpFactor) {
                    debugLog(`[MFA] Verified TOTP factor found: ${totpFactor.id}. Triggering challenge.`);
                    
                    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
                    if (challengeError) throw challengeError;

                    mfaChallengeIdRef.current = challenge.id;
                    setMfaFactorId(totpFactor.id);
                    setMfaChallengeRequired(true);
                    updateLoadingState(false);
                    return true;
                }
            }
        } catch (err) {
            logger.warn('[MFA] Challenge initiation failed:', err, 'AUTH_MFA');
            mfaChallengeInProgressRef.current = false;
            updateLoadingState(false);
            throw err;
        }
        updateLoadingState(false);
        return false;
    };

    // Mutual Exclusion: Track the initial boot handshake
    const isBootingRef = useRef(true);

    useEffect(() => {
        // [REFACTOR]: Single sequential boot flow via onAuthStateChange
        // This prevents the race between getSession() and onAuthStateChange which
        // frequently caused GoTrue lock contention and 'Security Vault' timeouts.
        const safetyTimer = setTimeout(() => {
            if (isLoadingRef.current) {
                logger.warn("BOOT: Safety timeout triggered. Unlocking UI.", null, 'AUTH_CONTEXT');
                updateLoadingState(false);
                isBootingRef.current = false;
                handshakeInProgressRef.current = false;
            }
        }, 12000);

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            const handleAuthEvent = async () => {
                debugLog(`[DEBUG_LOG] AUTH_EVENT: ${event} (Booting: ${isBootingRef.current})`);

                if (event === 'PASSWORD_RECOVERY') {
                    debugLog("[DEBUG_LOG] AUTH_EVENT: Password recovery detected. Forcing navigation to reset module.");
                    updateLoadingState(false);
                    if (window.location.pathname !== '/reset-password') {
                        // Use href to ensure a clean state break
                        const target = `${window.location.origin}/reset-password${window.location.hash}`;
                        window.location.href = target;
                        return;
                    }
                    return;
                }

                if (window.location.pathname === '/reset-password') {
                    updateLoadingState(false);
                    return;
                }

                // Always handle sign out immediately
                if (event === 'SIGNED_OUT') {
                    debugLog("[DEBUG_LOG] AUTH_EVENT: Session terminated. Purging cache.");
                    localStorage.removeItem(CACHE_KEY);
                    currentUserAuthIdRef.current = null;
                    setCurrentUser(null);
                    updateLoadingState(false);
                    isBootingRef.current = false;
                    return;
                }

                // CRITICAL: Suppress background events (token refresh, user update) during boot.
                // NEVER suppress SIGNED_IN or INITIAL_SESSION — they carry the critical initial auth payload.
                // The isEnrichingRef concurrency lock inside enrichUserFromSupabase handles deduplication.
                if ((isBootingRef.current || handshakeInProgressRef.current) && event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') {
                    debugLog(`[DEBUG_LOG] AUTH_EVENT: ${event} suppressed (Handshake in progress)`);
                    return;
                }

                const isSilentEvent = event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED';
                const isSameUser = session?.user?.id === currentUserAuthIdRef.current;

                // Handle sign-in events (including OAuth redirects and initial page loads)
                if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
                    if (session) {
                        const mfaTriggered = await checkAndTriggerMFA(session);
                        if (mfaTriggered) return;
                    }
                }

                // CRITICAL: isSameUser check should NOT block SIGNED_IN or INITIAL_SESSION events if we are stuck
                // in an unprovisioned state, as we need to re-trigger enrichment.
                if (isSilentEvent || (isSameUser && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && isProvisionedRef.current)) {
                    debugLog(`[DEBUG_LOG] AUTH_EVENT: Skipping redundant update for ${event}`);
                    return;
                }

                if (session?.user) {
                    let unlockedByCache = false;
                    
                    // 1. BOOTSTRAP: Load cache if this is the first encounter
                    if (isBootingRef.current) {
                        const cachedData = localStorage.getItem(CACHE_KEY);
                        if (cachedData) {
                            try {
                                const parsed = JSON.parse(cachedData);
                                if (parsed.authUserId === session.user.id) {
                                    // [VALIDATION]: Ensure critical fields exist
                                    if (parsed.role && parsed.stationId) {
                                        debugLog("[DEBUG_LOG] BOOT: Cache hit during subscription. Restoring.");
                                        setCurrentUser(parsed);
                                        updateLoadingState(false);
                                        unlockedByCache = true;
                                    } else {
                                        debugLog("[DEBUG_LOG] BOOT: Cache malformed. Purging.");
                                        localStorage.removeItem(CACHE_KEY);
                                    }
                                }
                            } catch (e) {
                                debugLog("[DEBUG_LOG] BOOT: Cache stale or invalid.");
                            }
                        }
                    }

                    // [IMMEDIATE FEEDBACK]: Notify user that identity is being verified
                    if (!isProvisionedRef.current && !unlockedByCache) {
                        window.dispatchEvent(new CustomEvent('system-toast', {
                            detail: {
                                title: 'Authenticating...',
                                message: 'Synchronizing secure session with IoTank Cloud.',
                                type: 'info',
                                duration: 2000
                            }
                        }));
                    }

                    updateLoadingState(true);
                    
                    // PROVISIONAL IDENTITY: Set unprovisioned user immediately so ProtectedRoute
                    // sees a truthy currentUser while enrichment happens.
                    if (!currentUserAuthIdRef.current || currentUserAuthIdRef.current !== session.user.id) {
                        debugLog("[DEBUG_LOG] AUTH_EVENT: Setting provisional identity.");
                        
                        const cachedUser = localStorage.getItem(CACHE_KEY);
                        if (cachedUser) {
                            try {
                                const parsed = JSON.parse(cachedUser);
                                if (parsed.authUserId === session.user.id) {
                                    debugLog("[DEBUG_LOG] AUTH_EVENT: Loading identity from cache.");
                                    parsed.isProvisional = true;
                                    parsed.role = 'viewer';
                                    parsed.authLevel = 8;
                                    setCurrentUser(parsed);
                                    updateLoadingState(false);
                                    unlockedByCache = true;
                                } else {
                                    setCurrentUser(mapToUnprovisionedUser(session.user));
                                }
                            } catch {
                                setCurrentUser(mapToUnprovisionedUser(session.user));
                            }
                        } else {
                            setCurrentUser(mapToUnprovisionedUser(session.user));
                        }
                    } else {
                        debugLog("[DEBUG_LOG] AUTH_EVENT: Same-user auth refresh detected, preserving current identity.");
                    }
                    
                    currentUserAuthIdRef.current = session.user.id;
                
                    const enrichmentPromise = enrichUserFromSupabase(session.user);
                    
                    // [FIX]: NEVER await enrichment inside the onAuthStateChange callback.
                    // The listener often holds the GoTrue lock, and awaiting a call that
                    // needs the lock (like listFactors or RPC) will cause a DEADLOCK.
                    // enrichmentPromise handles its own loading state cleanup.
                    enrichmentPromise.catch((e: any) => {
                        logger.error("[AUTH] Background enrichment failed:", e);
                        updateLoadingState(false);
                    });
                } else {
                    debugLog("[DEBUG_LOG] AUTH_EVENT: Clearing identity.");
                    currentUserAuthIdRef.current = null;
                    setCurrentUser(null);
                    updateLoadingState(false);
                }
                
                // End of boot sequence regardless of success/fail
                if (isBootingRef.current) {
                    isBootingRef.current = false;
                    updateLoadingState(false);
                }
            };
            
            // Execute non-blocking to immediately return control to GoTrue and release session locks
            handleAuthEvent().catch(err => {
                logger.error("[AUTH_CONTEXT] Error in onAuthStateChange handler:", err);
                updateLoadingState(false);
            });
        });

        return () => {
            clearTimeout(safetyTimer);
            subscription.unsubscribe();
        };
    }, []);

    // 4. NEWS LIFECYCLE: Only active for logged-in accounts
    useEffect(() => {
        if (currentUser && !loading) {
            NewsService.startListening();
            return () => NewsService.stopListening();
        }
    }, [currentUser, loading]);

    const signIn = async (email: string, password: string) => {
        updateLoadingState(true);
 
        // [OPTIMIZATION]: Rate limit check is already performed in LoginForm.tsx handleSubmit
        // to avoid redundant RPC calls during the critical auth path.

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            // [SELF-HEALING]: If session is corrupted, purge and reload
            if (error.message?.includes('refresh_token_not_found') || error.message?.includes('Invalid Refresh Token')) {
                logger.error("FATAL: Session corrupted. Purging all local data.", error);
                localStorage.clear();
                window.location.reload();
                return;
            }

            // Record the failed attempt
            supabase.rpc('log_auth_attempt', { p_email: email, p_is_success: false }).then(({error: rpcErr}) => {
                if (rpcErr) debugLog('[signIn] log_auth_attempt failed', rpcErr);
            });
            updateLoadingState(false);
            throw error;
        }

        // Emit forensic log for unified_events subscription (toast/navbar mapping)
        if (data?.user) {
             const userMeta = data.user.user_metadata || {};
             const dbStationId = userMeta.station_id || '';
             AuditService.log(
                 'SECURITY',
                 'LOGIN',
                 dbStationId,
                 `User ${email} authenticated successfully.`,
                 'INFO',
                 { email, auth_id: data.user.id }
             ).catch(err => logger.warn('[Audit Log Failed]', err, 'AUTH_AUDIT'));
        }

        updateLoadingState(false);
        return data;
    };

    const verifyMFA = async (code: string) => {
        if (!mfaFactorId || !mfaChallengeIdRef.current) {
            throw new Error('No active MFA challenge. Please sign in again.');
        }
        
        // [FORENSIC DEBUG]: Verify session state before MFA verification
        const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr || !session) {
            logger.error('[MFA] Verification failed: No active session found', sessionErr);
            throw new Error('Session timed out. Please sign in again.');
        }

        debugLog(`[MFA] Attempting verification for factor ${mfaFactorId} with challenge ${mfaChallengeIdRef.current}`);

        const { error } = await supabase.auth.mfa.verify({
            factorId: mfaFactorId,
            challengeId: mfaChallengeIdRef.current,
            code,
        });

        if (error) {
            logger.warn('[MFA] Verification rejected:', error);
            
            setMfaFailures(prev => prev + 1);
            if (error.message?.includes('IP addresses mismatch')) {
                throw new Error('Security Protocol Violation: Your network IP address changed during verification. Please sign in again from a stable connection.');
            }
            if (error.name === 'NavigatorLockAcquireTimeoutError') {
                throw new Error('Authentication Lock Timeout: Multiple sign-in attempts detected. Please wait a moment and try again.');
            }
            
            throw error;
        }
        
        // [AAL2 SYNC]: Supabase internally escalates the session after verify().
        // We rely on onAuthStateChange to detect the shift and trigger enrichment.
        // Manual refreshSession() here often causes NavigatorLock contention.

        // We still fetch the session to get the latest user object for enrichment,
        // but we use getSession() which is generally safer/cached.
        const { data: { session: updatedSession } } = await supabase.auth.getSession();

        if (updatedSession?.user) {
            handshakeInProgressRef.current = true;
            // [FORCE]: Bypass enrichment cooldown to ensure UI updates after MFA challenge
            await enrichUserFromSupabase(updatedSession.user, true);
            handshakeInProgressRef.current = false;
        }

        setMfaChallengeRequired(false);
        mfaChallengeInProgressRef.current = false;
        setMfaFactorId(null);
        mfaChallengeIdRef.current = null;
        setMfaFailures(0);
        debugLog('[MFA] Verification successful. Session escalated to AAL2.');
    };

    const resetMfaFailures = () => setMfaFailures(0);

    const cancelMFAChallenge = () => {
        setMfaChallengeRequired(false);
        mfaChallengeInProgressRef.current = false;
        setMfaFactorId(null);
        mfaChallengeIdRef.current = null;
        supabase.auth.signOut();
    };

    const enrollMFA = async (): Promise<EnrollMFAResult> => {
        // [FIX]: Also unenroll verified factors if re-enrolling (resolves "factor already exists" error)
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const allFactors = [...(factorsData?.totp || []), ...(factorsData?.phone || [])];
        for (const factor of allFactors) {
            debugLog(`[MFA] Cleaning up existing factor ${factor.id} before enrollment.`);
            await supabase.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {});
        }

        const { data, error } = await supabase.auth.mfa.enroll({ 
            factorType: 'totp',
            friendlyName: `IoTank-${currentUser?.email?.split('@')[0] || 'User'}`
        });
        
        if (error) throw error;
        return {
            factorId: data.id,
            qrCode: data.totp.qr_code,
            secret: data.totp.secret,
        };
    };

    const verifyMFARegistration = async (factorId: string, code: string) => {
        // Enrollment verification requires a challenge to be created first
        const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
        if (challengeError) throw challengeError;

        const { error: verifyError } = await supabase.auth.mfa.verify({
            factorId,
            challengeId: challengeData.id,
            code,
        });
        if (verifyError) throw verifyError;

        // Refresh session to update AAL (Authenticator Assurance Level)
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) await enrichUserFromSupabase(session.user, true);
    };

    const unenrollMFA = async () => {
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const allFactors = [...(factorsData?.totp || []), ...(factorsData?.phone || [])];
        if (allFactors.length === 0) throw new Error('No MFA factors found to remove.');
        
        for (const factor of allFactors) {
            const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
            if (error) throw error;
        }
        // Refresh user to update mfaEnabled flag
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) await enrichUserFromSupabase(session.user, true);
    };

    const signUp = async (email: string, password: string, displayName: string, stationId: string) => {
        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: displayName, role: 'viewer', station_id: stationId }
            }
        });
        if (error) throw error;
    };

    const signInWithGoogle = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                // Redirect to root — the LoginForm's useEffect on currentUser
                // will then navigate authenticated users to /dashboard.
                redirectTo: window.location.origin
            }
        });
        if (error) throw error;
    };

    const signOut = async () => {
        if (currentUser) {
            AuditService.log(
                'SECURITY',
                'LOGOUT',
                currentUser.stationId || '',
                `User ${currentUser.email} ended their session.`,
                'INFO',
                { email: currentUser.email, auth_id: currentUser.authUserId }
            ).catch(err => logger.warn('[Audit Log Failed]', err, 'AUTH_AUDIT'));
        }
        
        // [FIX] Force local cleanup immediately
        localStorage.removeItem(CACHE_KEY);
        
        try {
            // [FIX] Ensure logout cannot hang the UI if the network is disconnected
            await Promise.race([
                supabase.auth.signOut(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Signout timeout')), 3000))
            ]);
        } catch (e) {
            logger.warn('[AuthContext] Server signout timed out or failed. Forcing local logout.', e);
        } finally {
            window.location.href = '/';
        }
    };

    const resetPassword = async (email: string) => {
        const resetUrl = `${window.location.origin}/reset-password`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: resetUrl,
        });
        if (error) throw error;
    };

    const checkMFAChallenge = async (): Promise<boolean> => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return false;
        
        try {
            const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (error) throw error;

            if (data.currentLevel !== data.nextLevel && data.nextLevel === 'aal2') {
                const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
                if (factorsError) throw factorsError;

                const totpFactor = factors.totp.find(f => f.status === 'verified');
                if (totpFactor) {
                    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
                    if (challengeError) throw challengeError;

                    mfaChallengeIdRef.current = challenge.id;
                    setMfaFactorId(totpFactor.id);
                    setMfaChallengeRequired(true);
                    return true;
                }
            }
            return false;
        } catch (err) {
            logger.error('[MFA] Manual challenge failed:', err);
            return false;
        }
    };

    const updateMasterPassword = async (password: string) => {
        if (!currentUser) throw new Error("Not authenticated");
        const { error } = await supabase.rpc('update_master_password', { new_password: password });
        if (error) throw error;
        setCurrentUser(prev => prev ? { ...prev, masterAccessPassword: 'set' } : null);
    };

    const verifySettingsPassword = async (password: string) => {
        const { data, error } = await supabase.rpc('verify_master_password', { test_password: password });
        
        if (error || !data) {
            if (!currentUser?.email) throw new Error("Verification failed.");
            const { error: signInErr } = await supabase.auth.signInWithPassword({ email: currentUser.email, password });
            if (signInErr) throw new Error("Verification failed. Invalid password.");
        }
    };

    const updateUser = async (data: Partial<User>) => {
        if (!currentUser) return;
        
        const dbUpdates: any = {};
        
        if (currentUser.isSystemAccount) {
            if (data.displayName) dbUpdates.full_name = data.displayName;
            if (data.photoURL) dbUpdates.photo_url = data.photoURL;
            
            if (Object.keys(dbUpdates).length > 0) {
                const { error: dbError } = await supabase
                    .from('system_users')
                    .update(dbUpdates)
                    .eq('auth_user_id', currentUser.authUserId);
                if (dbError) throw dbError;
            }
        } else {
            if (data.displayName) dbUpdates.display_name = data.displayName;
            if (data.photoURL) dbUpdates.photo_url = data.photoURL;
            if (data.address) dbUpdates.address = data.address;
            
            if (Object.keys(dbUpdates).length > 0) {
                const { error: dbError } = await supabase
                    .from('profiles')
                    .update(dbUpdates)
                    .eq('auth_user_id', currentUser.authUserId);
                if (dbError) throw dbError;
            }
        }

        const metadataPatch: Record<string, unknown> = {};
        if (data.displayName !== undefined) metadataPatch.full_name = data.displayName;
        if (data.companyName !== undefined) metadataPatch.company_name = data.companyName;
        if (data.address !== undefined) metadataPatch.address = data.address;
        if (data.photoURL !== undefined) metadataPatch.avatar_url = data.photoURL;
        
        if (Object.keys(metadataPatch).length > 0) {
            const { error: authUpdateError } = await supabase.auth.updateUser({ data: metadataPatch });
            if (authUpdateError) throw authUpdateError;
        }

        setCurrentUser(prev => prev ? { ...prev, ...data } : null);
    };

    const setupSecurityPin = async (pin: string) => {
        if (!currentUser) throw new Error("Not authenticated");
        
        // [OPTIMISTIC UPDATE]: Update local state immediately for "instant" feel
        const previousState = { ...currentUser };
        const updatedUser: User = { ...currentUser, securityPinEnabled: true };
        setCurrentUser(updatedUser);
        
        // [RESILIENCE]: Set intent lock to prevent refresh resets during propagation
        pinIntentRef.current = { enabled: true, ts: Date.now() };
        
        // Update cache immediately
        const safeCache: any = {};
        SAFE_CACHE_FIELDS.forEach(k => { safeCache[k] = (updatedUser as any)[k]; });
        localStorage.setItem(CACHE_KEY, JSON.stringify(safeCache));

        // [IMMEDIATE FEEDBACK]: Fire intent notification
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Securing Vault...',
                message: 'Establishing secondary 6-digit verification layer.',
                type: 'info'
            }
        }));

        const pinHash = btoa(pin); 
        
        try {
            // [FIX]: 30s timeout for slow DB/network, but non-blocking for UI
            const rpcPromise = supabase.rpc('setup_security_pin', { p_pin_hash: pinHash });
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Security Vault Timeout')), 30000));
            
            const { error } = await Promise.race([rpcPromise, timeoutPromise]) as any;
            if (error) throw error;
        } catch (err) {
            logger.error('[Security] PIN setup failed:', err);
            // Rollback on failure
            setCurrentUser(previousState);
            const rollbackCache: any = {};
            SAFE_CACHE_FIELDS.forEach(k => { rollbackCache[k] = (previousState as any)[k]; });
            localStorage.setItem(CACHE_KEY, JSON.stringify(rollbackCache));
            throw err;
        }
    };

    const disableSecurityPin = async () => {
        if (!currentUser) return;

        // [OPTIMISTIC UPDATE]: Immediate local change
        const previousState = { ...currentUser };
        const updatedUser: User = { ...currentUser, securityPinEnabled: false };
        setCurrentUser(updatedUser);
        
        // [RESILIENCE]: Set intent lock to prevent refresh resets
        pinIntentRef.current = { enabled: false, ts: Date.now() };
        
        // Sync cache immediately
        const safeCache: any = {};
        SAFE_CACHE_FIELDS.forEach(k => { safeCache[k] = (updatedUser as any)[k]; });
        localStorage.setItem(CACHE_KEY, JSON.stringify(safeCache));

        // [IMMEDIATE FEEDBACK]: Fire intent notification
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Removing Protection...',
                message: 'De-activating secondary verification layer.',
                type: 'warning'
            }
        }));

        try {
            const rpcPromise = supabase.rpc('disable_security_pin');
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Security Vault Timeout')), 30000));
            
            const { error } = await Promise.race([rpcPromise, timeoutPromise]) as any;
            if (error) throw error;
        } catch (err) {
            logger.error('[Security] PIN disable failed:', err);
            // Rollback
            if (previousState) setCurrentUser(previousState as User);
            const rollbackCache: any = {};
            if (previousState) {
                SAFE_CACHE_FIELDS.forEach(k => { rollbackCache[k] = (previousState as any)[k]; });
                localStorage.setItem(CACHE_KEY, JSON.stringify(rollbackCache));
            }
            throw err;
        }
    };

    const verifySecurityPin = async (pin: string): Promise<boolean> => {
        if (!currentUser) return false;
        const pinHash = btoa(pin);
        const { data, error } = await supabase.rpc('verify_security_pin', { p_pin_hash: pinHash });
        if (error) throw error;
        return !!data;
    };

    const hasRole = (requiredRole: UserRole | UserRole[]): boolean => {
        if (!currentUser) return false;
        const roleHierarchy: Record<UserRole, number> = { viewer: 1, operator: 2, supervisor: 3, admin: 4, owner: 4 };
        const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
        return roles.some(role => roleHierarchy[currentUser.role] >= roleHierarchy[role]);
    };

    const canSee = (requiredLevel: number): boolean => {
        return (currentUser?.authLevel ?? 99) <= requiredLevel;
    };

    const value = {
        currentUser,
        loading,
        mfaChallengeRequired,
        mfaFactorId,
        mfaFailures,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        resetPassword,
        enrichUserFromSupabase,
        hasRole,
        canSee,
        updateMasterPassword,
        verifySettingsPassword,
        updateUser,
        enrollMFA,
        verifyMFARegistration,
        verifyMFA,
        unenrollMFA,
        cancelMFAChallenge,
        checkMFAChallenge,
        resetMfaFailures,
        setupSecurityPin,
        disableSecurityPin,
        verifySecurityPin,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
