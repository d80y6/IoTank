// supabase/functions/_shared/price-authorities/generic.ts
// No-op adapter for jurisdictions without a configured price authority.
// Returns no prices and only advertises the site's own content.

import type { PriceAuthorityAdapter, PriceAuthorityContext, PriceAuthorityResult } from "./types.ts";

export const genericAdapter: PriceAuthorityAdapter = {
  name: "generic",

  async adapt(_ctx: PriceAuthorityContext, _html: string, site: { name: string; domain: string; url: string }): Promise<PriceAuthorityResult> {
    return {
      prices: [],
      signal: {
        id: `generic-${site.domain}-${Date.now()}`,
        type: "regulatory",
        source: site.name,
        sourceType: "RSS",
        title: `Update: ${site.name}`,
        summary: `No rule-based extractor configured for ${site.domain}.`,
        timestamp: Date.now(),
        relevanceScore: 0.3,
        confidenceScore: 0.3,
        externalUrl: site.url,
        attribution: site.domain,
        metadata: { adapter: "generic" },
      },
    };
  },
};