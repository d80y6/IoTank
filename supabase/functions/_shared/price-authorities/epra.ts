// supabase/functions/_shared/price-authorities/epra.ts
// Kenya-specific EPRA pump-price extraction. All Kenya coupling lives in this
// adapter; the official-scraper only dispatches to it when the jurisdiction's
// `regulatory.adapter` is "epra".

import type {
  PriceAuthorityAdapter,
  PriceAuthorityContext,
  PriceAuthorityResult,
  PriceRow,
} from "./types.ts";

const EPRA_FORENSIC_REGEX = /(Super Petrol|Diesel|Kerosene|PMS|AGO|IK).*?(?:Ksh|shillings|at)?\s*(\d{2,3}(?:\.\d{2})?)/gi;

export const epraAdapter: PriceAuthorityAdapter = {
  name: "epra",

  async adapt(ctx, html, site): Promise<PriceAuthorityResult> {
    const now = new Date();
    const band = ctx.priceBand ?? [150, 250];
    const prices: PriceRow[] = [];
    const detections: Array<{ fuelType: string; price: number }> = [];

    const scanContent = html.slice(0, 8000);
    for (const found of scanContent.matchAll(EPRA_FORENSIC_REGEX)) {
      const fuelLabel = (found[1] || "").toUpperCase();
      const price = parseFloat(found[2]);
      if (!fuelLabel || isNaN(price) || price <= band[0] || price >= band[1]) continue;

      let fuelType = fuelLabel;
      if (fuelLabel.includes("PETROL") || fuelLabel === "PMS") fuelType = "PMS";
      else if (fuelLabel.includes("DIESEL") || fuelLabel === "AGO") fuelType = "AGO";
      else if (fuelLabel.includes("KEROSENE") || fuelLabel === "IK") fuelType = "IK";
      else continue;

      if (detections.some((d) => d.fuelType === fuelType)) continue;
      detections.push({ fuelType, price });
      prices.push({
        fuelType,
        price,
        currency: ctx.currency || "KES",
        unit: "liter",
        effectiveDate: now.toISOString(),
        sourceUrl: site.url,
        isOfficial: true,
      });
    }

    return {
      prices,
      signal: {
        id: `official-${site.domain}-${now.getTime()}`,
        type: "regulatory",
        source: site.name,
        sourceType: "API",
        title: `Official Update: ${site.name}`,
        summary: `Official document or price review detected at ${site.domain}.`,
        timestamp: now.getTime(),
        relevanceScore: 1.0,
        confidenceScore: 1.0,
        externalUrl: site.url,
        attribution: site.domain,
        metadata: { isForensic: true },
      },
    };
  },
};