// supabase/functions/exchange-rate-proxy/index.ts

import { getCorsHeaders } from '../_shared/cors.ts'
import { enforceDurableRateLimit, requireProxyScope } from '../_shared/auth.ts'
declare const Deno: any;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authz = await requireProxyScope(req, corsHeaders);
    if ('response' in authz) return authz.response;

    const limit = await enforceDurableRateLimit(authz.context, corsHeaders, 'exchange-rate-proxy', 30);
    if ('response' in limit) return limit.response;

    const apiKey = Deno.env.get('EXCHANGE_RATE_API_KEY')

    if (!apiKey) {
      throw new Error('ExchangeRate API key not configured')
    }

    const reqUrl = new URL(req.url);
    const from = (reqUrl.searchParams.get('from') || 'USD').toUpperCase();
    const to = (reqUrl.searchParams.get('to') || 'EUR').toUpperCase();

    const url = `https://v6.exchangerate-api.com/v6/${apiKey}/pair/${from}/${to}`;
    
    const response = await fetch(url)
    const data = await response.json()

    if (data.result === 'error') {
      throw new Error(data['error-type'] || 'API returned an error');
    }

    return new Response(
      JSON.stringify({
        success: true,
        base: data.base_code,
        target: data.target_code,
        rate: data.conversion_rate,
        timestamp: Math.floor(Date.now() / 1000)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Function error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
