// supabase/functions/_shared/price-authorities/eia.ts
// US Energy Information Administration adapter. Reads the EIA target list and
// sanity band from jurisdiction config so per-market calibration lives in DB.

import type { PriceAuthorityAdapter, PriceAuthorityContext, PriceAuthorityResult, PriceRow } from "./types.ts";

const EIA_PRICE_REGEX = /([A-Z0-9]{2,6})\s*[=:=]\s*([0-9]+(?:\.[0-9]+)?)/gi;

export const eiaAdapter: PriceAuthorityAdapter = {
  name: "eia",

  async adapt(ctx, html, site): Promise<PriceAuthorityResult> {
    const now = new Date();
    const band = ctx.priceBand ?? [0.2, 10];
    const prices: PriceRow[] = [];
    const detections: Array<{ fuelType: string; price: number }> = [];

    for (const found of html.slice(0, 12000).matchAll(EIA_PRICE_REGEX)) {
      const key = found[1] as string;
      const price = parseFloat(found[2]);
      if (!isNaN(price) && price > band[0] && price < band[1] && !detections.some((d) => d.fuelType === key)) {
        detections.push({ fuelType: key, price });
        prices.push({
          fuelType: key,
          price,
          currency: ctx.currency || "USD",
          unit: "liter",
          effectiveDate: now.toISOString(),
          sourceUrl: site.url,
          isOfficial: true,
        });
      }
    }

    return {
      prices,
      signal: {
        id: `official-${site.domain}-${now.getTime()}`,
        type: "regulatory",
        source: site.name,
        sourceType: "API",
        title: `Official Update: ${site.name}`,
        summary: `Market data parsed for ${site.domain}.`,
        timestamp: now.getTime(),
        relevanceScore: 0.9,
        confidenceScore: 0.8,
        externalUrl: site.url,
        attribution: site.domain,
        metadata: { adapter: "eia" },
      },
    };
  },
};