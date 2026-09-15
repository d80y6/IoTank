import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"
import { corsHeaders } from "../_shared/cors.ts"
import { requireAdminOrCron } from "../_shared/auth.ts"
import { emitSecurityTelemetry } from "../_shared/telemetry.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const auth = await requireAdminOrCron(req, corsHeaders);
  if ('response' in auth) return auth.response;
  const { supabaseAdmin: supabase } = auth;

  const BRENT_URL = 'https://www.marketwatch.com/investing/future/brn00?countrycode=uk';
  const FX_URL = 'https://www.centralbank.go.ke/rates/forex-exchange-rates/';
  const results = [];

  try {
    // 1. Scrape Brent Crude
    try {
      const brentResp = await fetch(BRENT_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
      });
      const brentHtml = await brentResp.text();
      const priceMatch = brentHtml.match(/bg-quote[^>]*>([\d,.]+)</i) || brentHtml.match(/current-price[^>]*>([\d,.]+)</i);
      
      if (priceMatch && priceMatch[1]) {
        const price = parseFloat(priceMatch[1].replace(',', ''));
        await supabase.from('market_prices').upsert({
          fuel_type: 'BRENT', // Intelligence only, not for station pricing
          price_per_liter: price,
          currency: 'USD',
          source: 'marketwatch',
          effective_date: new Date().toISOString()
        }, { onConflict: 'fuel_type' });

        results.push({ type: 'BRENT', value: price });
      } else {
        throw new Error('Brent price heuristic failed');
      }
    } catch (e) {
      console.error('Brent Scrape Error:', e.message);
      await emitSecurityTelemetry(supabase, {
        eventType: 'proxy_config_error',
        severity: 'critical',
        source: 'market-stats-scraper',
        reason: 'brent_scraping_failed',
        details: { error: e.message }
      });
    }

    // 2. Scrape GBP/KSH
    try {
      const fxResp = await fetch(FX_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const fxHtml = await fxResp.text();
      const gbpMatch = fxHtml.match(/GBP[^<]*<\/td>\s*<td[^>]*>([\d,.]+)</i);
      
      if (gbpMatch && gbpMatch[1]) {
        const rate = parseFloat(gbpMatch[1].replace(',', ''));
        await supabase.from('market_prices').upsert({
          fuel_type: 'GBP_KSH', // Intelligence only, not for station pricing
          price_per_liter: rate,
          currency: 'KSH',
          source: 'cbk',
          effective_date: new Date().toISOString()
        }, { onConflict: 'fuel_type' });

        results.push({ type: 'GBP_KSH', value: rate });
      } else {
        throw new Error('FX rate heuristic failed');
      }
    } catch (e) {
      console.error('FX Scrape Error:', e.message);
      await emitSecurityTelemetry(supabase, {
        eventType: 'proxy_config_error',
        severity: 'warning',
        source: 'market-stats-scraper',
        reason: 'fx_scraping_failed',
        details: { error: e.message }
      });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
})
