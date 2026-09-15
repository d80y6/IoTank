// supabase/functions/deepseek-proxy/index.ts
// DeepSeek is TankIQ-only — always requires authentication

import { getCorsHeaders } from '../_shared/cors.ts'
import { enforceDurableRateLimit, requireProxyScope } from '../_shared/auth.ts'
import { CHAT_PROJECT_CONTEXT, buildIntelligencePrompt, sanitizeContextForAI, buildDirectivePrompt } from '../_shared/prompts.ts'
declare const Deno: any;

const MAX_PER_WINDOW = 15;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authz = await requireProxyScope(req, corsHeaders);
    if ('response' in authz) return authz.response;

    const limit = await enforceDurableRateLimit(authz.context, corsHeaders, 'deepseek-proxy', MAX_PER_WINDOW);
    if ('response' in limit) return limit.response;

    const payload = await req.json()
    const { action, context } = payload;
    let body = payload.body || {};

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
    } else {
       return new Response(JSON.stringify({ error: 'Valid action (chat or intelligence) is required' }), {
         status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
       });
    }

    // Key Rotation Logic
    const apiKeys = [
      Deno.env.get('DEEPSEEK_API_KEY'),
      Deno.env.get('DEEPSEEK_API_KEY_2')
    ].filter(Boolean);

    if (apiKeys.length === 0) throw new Error('No DeepSeek API keys configured');

    let lastError: any = null;
    for (const key of apiKeys) {
      try {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        });

        if (response.status === 429) {
          console.warn(`DeepSeek key rotation: 429 encountered, trying next key...`);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`DeepSeek API error: ${errorText}`);
        }

        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        lastError = err;
        console.error(`DeepSeek key attempt failed:`, err.message);
      }
    }

    throw lastError || new Error('All DeepSeek keys failed');

  } catch (error: any) {
    console.error('DeepSeek proxy error:', error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
