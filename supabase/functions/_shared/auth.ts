// @ts-ignore Deno edge import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.40.0'
import { emitSecurityTelemetry } from './telemetry.ts'

/**
 * Deno namespace declaration for TypeScript environment awareness
 */
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

type CorsHeaders = Record<string, string>;
type SupabaseAdminClient = ReturnType<typeof createClient>;

type ProxyScopeContext = {
  user: { id: string; email?: string | null };
  supabaseAdmin: SupabaseAdminClient;
  authLevel: number;
  role: string;
  stationId: string | null;
  scopeKey: string;
};

export async function requireAuthenticatedUser(req: Request, corsHeaders: CorsHeaders) {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://suifvborodwergtrbjez.supabase.co';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[auth-guard] MISSING_SECRETS: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in the environment.');
    return {
      response: new Response(JSON.stringify({ 
        error: 'Edge Function Configuration Error',
        details: 'Required environment secrets (SUPABASE_SERVICE_ROLE_KEY) are missing in the function runtime.'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    await emitSecurityTelemetry(supabaseAdmin, {
      eventType: 'proxy_auth_denied',
      severity: 'warning',
      source: 'proxy_auth_guard',
      endpoint: new URL(req.url).pathname,
      statusCode: 401,
      reason: 'missing_authorization_header',
      details: {
        origin: req.headers.get('origin'),
        userAgent: req.headers.get('user-agent'),
      },
    });
    return {
      response: new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token || token.split('.').length !== 3) {
    await emitSecurityTelemetry(supabaseAdmin, {
      eventType: 'proxy_auth_denied',
      severity: 'warning',
      source: 'proxy_auth_guard',
      endpoint: new URL(req.url).pathname,
      statusCode: 401,
      reason: 'malformed_jwt',
      details: {
        origin: req.headers.get('origin'),
      },
    });
    return {
      response: new Response(JSON.stringify({ error: 'Malformed or empty JWT token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  // Verify JWT using the admin client directly
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error) {
    console.error('[auth-guard] auth.getUser FAILED:', {
      message: error.message,
      status: error.status,
      tokenPrefix: token.substring(0, 15) + '...',
      url: SUPABASE_URL,
      isServiceKeyPresent: !!SUPABASE_SERVICE_ROLE_KEY
    });
    
    const isExpired = error.message?.toLowerCase().includes('expired');
    const isInvalid = error.message?.toLowerCase().includes('invalid jwt') || error.message?.toLowerCase().includes('jwt');

    return {
      response: new Response(JSON.stringify({ 
        error: isExpired ? 'Session expired' : (isInvalid ? 'Invalid Security Token' : 'Unauthorized'),
        details: error.message,
        hint: isInvalid ? 'Ensure your frontend VITE_SUPABASE_URL matches the project secret SUPABASE_URL.' : undefined
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  if (!user) {
    console.warn('[auth-guard] auth.getUser returned NULL user without error');
    await emitSecurityTelemetry(supabaseAdmin, {
      eventType: 'proxy_auth_denied',
      severity: 'warning',
      source: 'proxy_auth_guard',
      endpoint: new URL(req.url).pathname,
      statusCode: 401,
      reason: 'invalid_or_expired_session',
      details: {
        origin: req.headers.get('origin'),
        authError: error?.message || null,
      },
    });
    return {
      response: new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  return { user, supabaseAdmin };
}

function mapSystemRoleToLevel(role: string): number {
  switch (role) {
    case 'super_admin': return 1;
    case 'admin_helper': return 2;
    case 'support_staff': return 3;
    case 'analyst': return 4;
    default: return 99;
  }
}

function mapProfileRoleToLevel(role: string): number {
  switch (role) {
    case 'owner':
    case 'admin':
      return 5;
    case 'supervisor':
      return 6;
    case 'operator':
      return 7;
    case 'viewer':
      return 8;
    default:
      return 99;
  }
}

export async function requireProxyScope(req: Request, corsHeaders: CorsHeaders) {
  const auth = await requireAuthenticatedUser(req, corsHeaders);
  if ('response' in auth) {
    return { response: auth.response as Response };
  }

  const { user, supabaseAdmin } = auth as { user: { id: string; email?: string | null }; supabaseAdmin: SupabaseAdminClient };

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, station_id')
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email || ''}`)
    .maybeSingle();

  if (profile?.role && profile?.station_id) {
    const authLevel = mapProfileRoleToLevel(profile.role);
    if (authLevel > 8) {
      await emitSecurityTelemetry(supabaseAdmin, {
        eventType: 'proxy_scope_denied',
        severity: 'warning',
        source: 'proxy_scope_guard',
        endpoint: new URL(req.url).pathname,
        actorUid: user.id,
        actorEmail: user.email || null,
        actorRole: profile.role,
        actorAuthLevel: authLevel,
        stationId: String(profile.station_id),
        statusCode: 403,
        reason: 'unsupported_profile_role',
      });
      return {
        response: new Response(JSON.stringify({ error: 'Unsupported profile role for proxy access' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }),
      };
    }
    const stationId = String(profile.station_id);
    const scopeKey = `station:${stationId}:user:${user.id}`;
    const ctx: ProxyScopeContext = {
      user: { id: user.id, email: user.email },
      supabaseAdmin,
      authLevel,
      role: profile.role,
      stationId,
      scopeKey,
    };
    return { context: ctx };
  }

  // Query by email first (most reliable — avoids dependency on specific ID column constraints)
  const { data: systemUser, error: dbError } = await supabaseAdmin
    .from('system_users')
    .select('role, is_active')
    .ilike('email', user.email || '')
    .maybeSingle();

  if (dbError) {
    console.error('SYSTEM_USER_DB_ERROR:', dbError);
    return {
      response: new Response(JSON.stringify({ 
        error: 'Database Error',
        details: `Failed to retrieve system user profile: ${dbError.message}`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  if (!systemUser) {
    return {
      response: new Response(JSON.stringify({ 
        error: 'Permission denied',
        details: `System profile not found for ${user.email} (UID: ${user.id}). Please verify the email in the system_users table matches EXACTLY.`
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  if (!systemUser.is_active) {
    return {
      response: new Response(JSON.stringify({ 
        error: 'Permission denied',
        details: `System profile found for ${user.email} but is_active is false.`
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  const authLevel = mapSystemRoleToLevel(systemUser.role);
  const satisfiesRole = authLevel <= 4; 

  if (satisfiesRole) {
    const ctx: ProxyScopeContext = {
      user: { id: user.id, email: user.email },
      supabaseAdmin,
      authLevel,
      role: systemUser.role,
      stationId: null,
      scopeKey: `system:${user.id}`,
    };
    return { context: ctx };
  }

  await emitSecurityTelemetry(supabaseAdmin, {
    eventType: 'proxy_scope_denied',
    severity: 'warning',
    source: 'proxy_scope_guard',
    endpoint: new URL(req.url).pathname,
    actorUid: user.id,
    actorEmail: user.email || null,
    actorRole: systemUser.role,
    actorAuthLevel: authLevel,
    statusCode: 403,
    reason: 'insufficient_role_level',
  });

  return {
    response: new Response(JSON.stringify({ 
      error: 'Permission denied',
      details: `Insufficient role level for ${user.email}. Role: ${systemUser.role} (Level ${authLevel}), Required: Level 4 or higher.`
    }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }),
  };
}

/**
 * Allows unauthenticated access but returns a public scope restricted by IP
 */
export async function getOptionalProxyScope(req: Request, corsHeaders: CorsHeaders) {
  const authHeader = req.headers.get('Authorization');
  
  // If we have a token, try to use it
  if (authHeader?.startsWith('Bearer ')) {
    const auth = await requireProxyScope(req, corsHeaders);
    if ('context' in auth) return auth;
    
    // If auth failed with 401 (Unauthorized), we log it and proceed to anonymous fallback
    // rather than blocking the "Launch Pad" experience.
    if ('response' in auth) {
      if ((auth.response as Response).status === 401) {
        console.warn('[auth-optional] Token present but invalid/expired. Falling back to anonymous scope.');
      } else {
        // For other errors (403 Forbidden, 500 Error), we respect the failure.
        return auth;
      }
    }
  }

  // Otherwise, provide a restricted anonymous scope based on IP
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://suifvborodwergtrbjez.supabase.co';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
     return { response: new Response('Config error', { status: 500, headers: corsHeaders }) };
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const clientIp = req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'anonymous';
  
  const ctx: ProxyScopeContext = {
    user: { id: 'anonymous' },
    supabaseAdmin,
    authLevel: 99,
    role: 'public',
    stationId: null,
    scopeKey: `ip:${clientIp}`,
  };

  return { context: ctx };
}

export async function enforceDurableRateLimit(
  context: ProxyScopeContext,
  corsHeaders: CorsHeaders,
  endpoint: string,
  maxPerWindow: number,
  windowSeconds = 60
) {
  const { data, error } = await context.supabaseAdmin.rpc('consume_edge_rate_limit', {
    p_scope_key: context.scopeKey,
    p_endpoint: endpoint,
    p_window_seconds: windowSeconds,
    p_max_requests: maxPerWindow,
  });

  if (error) {
    await emitSecurityTelemetry(context.supabaseAdmin, {
      eventType: 'proxy_rate_limiter_error',
      severity: 'critical',
      source: 'proxy_rate_limiter',
      endpoint,
      actorUid: context.user.id,
      actorEmail: context.user.email || null,
      actorRole: context.role,
      actorAuthLevel: context.authLevel,
      stationId: context.stationId,
      scopeKey: context.scopeKey,
      statusCode: 500,
      reason: 'rate_limiter_unavailable',
      details: { rpcError: error.message },
    });
    return {
      response: new Response(JSON.stringify({ error: 'Rate limiter unavailable' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.allowed) {
    const resetAt = result?.reset_at || new Date(Date.now() + 60000).toISOString();
    await emitSecurityTelemetry(context.supabaseAdmin, {
      eventType: 'proxy_rate_limit_exceeded',
      severity: 'warning',
      source: 'proxy_rate_limiter',
      endpoint,
      actorUid: context.user.id,
      actorEmail: context.user.email || null,
      actorRole: context.role,
      actorAuthLevel: context.authLevel,
      stationId: context.stationId,
      scopeKey: context.scopeKey,
      statusCode: 429,
      reason: 'rate_limit_exceeded',
      details: {
        remaining: 0,
        resetAt: resetAt,
        configuredMaxPerWindow: maxPerWindow,
        configuredWindowSeconds: windowSeconds,
      },
    });
    return {
      response: new Response(JSON.stringify({
        success: false,
        error: 'Rate limit exceeded',
        remaining: 0,
        resetAt: resetAt,
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  return { ok: true };
}

export async function requireAdminOrCron(req: Request, corsHeaders: CorsHeaders) {
  const authHeader = req.headers.get('Authorization') || '';
  const cronSecret = Deno.env.get('CRON_SECRET') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  const isAuthorized =
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (serviceKey && authHeader === `Bearer ${serviceKey}`);

  if (!isAuthorized) {
    return {
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }),
    };
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const supabaseAdmin = createClient(SUPABASE_URL, serviceKey);

  return { ok: true, supabaseAdmin };
}
