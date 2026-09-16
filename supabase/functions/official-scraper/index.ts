// supabase/functions/official-scraper/index.ts
// Scrapes price-authority sources and publishes official prices to market_prices.
// The scraping/extraction logic lives in _shared/price-authorities adapters,
// selected per-jurisdiction via the `regulatory.adapter` config key.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"
import { getCorsHeaders } from "../_shared/cors.ts"
import { enforceDurableRateLimit, getOptionalProxyScope } from "../_shared/auth.ts"
import { resolveAuthority } from "../_shared/price-authorities/index.ts"
import type { PriceAuthorityContext } from "../_shared/price-authorities/types.ts"

const DEFAULT_SITE = 'https://www.epra.go.ke/pump-prices/'

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // [STABILITY]: Use optional scope so public dashboard can trigger (rate-limited by IP)
    const authz = await getOptionalProxyScope(req, corsHeaders);
    if ('response' in authz) return authz.response;

    const limit = await enforceDurableRateLimit(authz.context, corsHeaders, 'official-scraper', 10);
    if ('response' in limit) return limit.response;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Jurisdiction selection: `?jurisdiction=KE` overrides the platform default.
    const url = new URL(req.url);
    const requested = url.searchParams.get('jurisdiction') || 'GLOBAL';

    const { data: cfg } = await supabase.rpc('get_jurisdiction_config', { p_code: requested });
    const jur = cfg?.jurisdiction || {};
    const config = cfg?.config || {};

    const regulatory = config.regulatory || {};
    const adapterCode = (regulatory.adapter as string) || (jur.regulatory_body === 'EPRA' ? 'epra' : 'generic');
    const adapter = resolveAuthority(adapterCode);

    const siteUrl = (regulatory.site as string) ||
      (requested === 'KE' ? DEFAULT_SITE : (regulatory.baseUrl as string) || '') ||
      DEFAULT_SITE;

    const site = {
      name: (jur.name as string) || 'Price Authority',
      domain: new URL(siteUrl).hostname,
      url: siteUrl,
    };

    const band = regulatory.priceBand as [number, number] | undefined;

    const ctx: PriceAuthorityContext = {
      jurisdictionCode: requested,
      currency: (jur.currency as string) || 'USD',
      baseUrl: (regulatory.baseUrl as string) || null,
      targets: (regulatory.targets as string[]) || [],
      priceBand: band || null,
      config,
      supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
      serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    };

    console.log(`[OfficialScraper] Adapter="${adapter.name}" for "${requested}" site=${site.domain}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response;
    try {
      response = await fetch(site.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'IoTank-Forensic-Bot/2.0 (+https://the-iotank-project.web.app)',
          'Accept': 'text/html',
          'Cache-Control': 'no-cache',
        },
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      console.warn(`[OfficialScraper] Connect timeout/failure for ${site.name}:`, fetchErr.message);
      return new Response(JSON.stringify({ success: false, error: `Fetch failed: ${fetchErr.message}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      return new Response(JSON.stringify({ success: false, error: `${site.name}: ${response.statusText}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const html = await response.text();
    const result = await adapter.adapt(ctx, html, site);
    const results = [];

    // Persist official prices.
    for (const price of result.prices) {
      await supabase.rpc('forensic_update_market_price', {
        p_fuel_type: price.fuelType,
        p_new_price: price.price,
        p_effective_date: price.effectiveDate,
        p_source_url: price.sourceUrl,
        p_is_official: price.isOfficial,
      });
    }

    // Broadcast the signal to the news feed.
    if (result.signal) {
      await supabase.from('market_news').upsert({
        id: result.signal.id,
        source: result.signal.source,
        title: result.signal.title,
        link: result.signal.externalUrl,
        summary: result.signal.summary,
        source_type: result.signal.sourceType,
        created_at: new Date().toISOString(),
      });
      results.push(result.signal);
    }

    return new Response(JSON.stringify({ success: true, adapter: adapter.name, jurisdiction: requested, prices: result.prices.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[OfficialScraper] Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
})