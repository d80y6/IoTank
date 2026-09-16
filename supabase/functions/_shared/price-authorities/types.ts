// supabase/functions/_shared/price-authorities/types.ts
// Pluggable price-authority contract. A jurisdiction's `regulatory.adapter`
// config key selects which adapter runs (e.g. "epra", "eia", "generic").

export interface PriceRow {
  fuelType: string      // canonical key: PMS | AGO | IK | EIA_* | custom
  price: number
  currency: string
  unit: string          // e.g. "liter", "gallon", "barrel"
  effectiveDate: string // ISO date
  sourceUrl: string
  isOfficial: boolean
}

export interface AuthoritySignal {
  id: string
  type: 'regulatory'
  source: string
  sourceType: 'API' | 'RSS' | 'DOCUMENT'
  title: string
  summary: string
  timestamp: number
  relevanceScore: number
  confidenceScore: number
  externalUrl: string
  attribution: string
  metadata: Record<string, unknown>
}

export interface PriceAuthorityContext {
  jurisdictionCode: string
  currency: string
  baseUrl: string | null
  targets: string[]       // fuel types to look for
  priceBand: [number, number] | null // sanity band, e.g. [150, 250]
  config: Record<string, unknown>
  supabaseUrl: string
  serviceRoleKey: string
}

export interface PriceAuthorityResult {
  prices: PriceRow[]
  signal?: AuthoritySignal
}

export interface PriceAuthorityAdapter {
  name: string
  adapt(ctx: PriceAuthorityContext, html: string, site: { name: string; domain: string; url: string }): Promise<PriceAuthorityResult>
}