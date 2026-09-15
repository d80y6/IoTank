// supabase/functions/groq-proxy/index.ts

import { getCorsHeaders } from '../_shared/cors.ts'
import { enforceDurableRateLimit, getOptionalProxyScope, requireProxyScope } from '../_shared/auth.ts'
import { CHAT_PROJECT_CONTEXT, buildIntelligencePrompt, sanitizeContextForAI, buildDirectivePrompt } from '../_shared/prompts.ts'
declare const Deno: any;

const CHAT_MAX_ANON    = 5;
const CHAT_MAX_AUTH    = 20;
const INTELLIGENCE_MAX = 15;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const { action, context } = payload;
    let body = payload.body || {};

    let authz: any;
    if (action === 'intelligence') {
      authz = await requireProxyScope(req, corsHeaders);
    } else {
      authz = await getOptionalProxyScope(req, corsHeaders);
    }
    if ('response' in authz) return authz.response;

    const isAnon = authz.context.user.id === 'anonymous';
    const maxRequests = action === 'intelligence'
      ? INTELLIGENCE_MAX
      : (isAnon ? CHAT_MAX_ANON : CHAT_MAX_AUTH);

    const limit = await enforceDurableRateLimit(authz.context, corsHeaders, `groq-${action}`, maxRequests);
    if ('response' in limit) return limit.response;

    if (action === 'chat') {
       body.messages = [
          { role: 'system', content: CHAT_PROJECT_CONTEXT },
          ...(body.messages || [])
       ];
    } else if (action === 'intelligence') {
       const safeSignals = (context?.signals || []).map((s: any) => sanitizeContextForAI(JSON.stringify(s)));
       const safeRisks   = (context?.risks   || []).map((r: any) => sanitizeContextForAI(JSON.stringify(r)));
       const safeNotices = (context?.notices || []).map((n: any) => sanitizeContextForAI(JSON.stringify(n)));
       const safeInventory = (context?.inventory || []);

       let systemPrompt;
       if (context?.signal) {
         systemPrompt = buildDirectivePrompt(context.signal, safeInventory);
       } else {
         systemPrompt = buildIntelligencePrompt(safeSignals, safeRisks, safeNotices, safeInventory);
       }
       body.messages = [{ role: 'user', content: systemPrompt }];
    }

    // Key Rotation Logic
    const apiKeys = [
      Deno.env.get('GROQ_API_KEY'),
      Deno.env.get('GROQ_API_KEY_2'),
      Deno.env.get('GROQ_API_KEY_3')
    ].filter(Boolean);

    if (apiKeys.length === 0) throw new Error('No Groq API keys configured');

    let lastError: any = null;
    for (const key of apiKeys) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        });

        if (response.status === 429) {
          console.warn(`Groq key rotation: 429 encountered, trying next key...`);
          lastError = new Error('Rate limit reached (429) on this key');
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Groq API error: ${errorText}`);
        }

        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        lastError = err;
        console.error(`Groq key attempt failed:`, err.message);
      }
    }

    throw lastError || new Error('All Groq keys failed');

  } catch (error: any) {
    console.error('Groq proxy error:', error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
