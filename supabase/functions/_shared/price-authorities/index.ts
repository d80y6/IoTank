// supabase/functions/_shared/price-authorities/index.ts
// Registry of available price-authority adapters, selected by jurisdiction
// config key `regulatory.adapter`.

import type { PriceAuthorityAdapter } from "./types.ts";
import { epraAdapter } from "./epra.ts";
import { eiaAdapter } from "./eia.ts";
import { genericAdapter } from "./generic.ts";

export type { PriceAuthorityAdapter, PriceAuthorityContext, PriceAuthorityResult, PriceRow } from "./types.ts";

export const priceAuthorities: Record<string, PriceAuthorityAdapter> = {
  epra: epraAdapter,
  eia: eiaAdapter,
  generic: genericAdapter,
};

export function resolveAuthority(code: string | null | undefined): PriceAuthorityAdapter {
  return priceAuthorities[code || "generic"] || genericAdapter;
}