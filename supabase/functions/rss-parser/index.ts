// supabase/functions/rss-parser/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.1.2"
import { getCorsHeaders } from "../_shared/cors.ts"
import { enforceDurableRateLimit, getOptionalProxyScope } from "../_shared/auth.ts"

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authz = await getOptionalProxyScope(req, corsHeaders);
    if ('response' in authz) return authz.response;

    const maxRequests = authz.context.user.id === 'anonymous' ? 10 : 50;
    const limit = await enforceDurableRateLimit(authz.context, corsHeaders, 'rss-parser', maxRequests);
    if ('response' in limit) return limit.response;

    const { rssUrl } = await req.json()
    if (!rssUrl) throw new Error('Missing rssUrl')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Check Cache
    const { data: cached } = await supabase
      .from('rss_cache')
      .select('*')
      .eq('feed_url', rssUrl)
      .single()

    const now = Date.now()
    if (cached && (now - new Date(cached.cached_at).getTime() < CACHE_TTL_MS)) {
      console.log('Returning from cache:', rssUrl)
      return new Response(JSON.stringify({ items: cached.content, source: 'cache' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Fetch Fresh
    console.log('Fetching fresh RSS:', rssUrl)
    const response = await fetch(rssUrl, {
      headers: { 'User-Agent': 'IoTank-News-Bot/2.0' }
    });
    
    if (!response.ok) {
      console.error(`[RSS Fetch Failed] URL: ${rssUrl} | Status: ${response.status} ${response.statusText}`);
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const parsed = parser.parse(xml);

    // 3. Normalize (Handle RSS 2.0 and Atom)
    let items = [];
    if (parsed.rss?.channel?.item) {
      const rawItems = Array.isArray(parsed.rss.channel.item) ? parsed.rss.channel.item : [parsed.rss.channel.item];
      items = rawItems.map((item: any) => ({
        title: item.title,
        link: item.link,
        summary: item.description || item['content:encoded'] || '',
        pubDate: item.pubDate,
        guid: item.guid || item.link
      }));
    } else if (parsed.feed?.entry) {
      const rawEntries = Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry];
      items = rawEntries.map((entry: any) => ({
        title: entry.title,
        link: entry.link?.["@_href"] || entry.id,
        summary: entry.summary || entry.content || '',
        pubDate: entry.published || entry.updated,
        guid: entry.id
      }));
    }

    // 4. Update Cache
    await supabase.from('rss_cache').upsert({
      feed_url: rssUrl,
      content: items,
      cached_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    return new Response(JSON.stringify({ items, source: 'fresh' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('RSS Parser Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
})
