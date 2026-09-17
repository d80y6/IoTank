export interface JurisdictionConfig {
  code?: string;
  name?: string;
  currency?: string;
  currencySymbol?: string;
  locale?: string;
  timezone?: string;
  phonePrefix?: string;
  regulatoryBody?: string | null;
  countryCode?: string;
  isActive?: boolean;
  isGlobal?: boolean;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

const DEFAULT_CONFIG: Required<Pick<JurisdictionConfig, 'currency' | 'currencySymbol' | 'locale' | 'timezone' | 'phonePrefix'>> = {
  currency: 'USD',
  currencySymbol: '$',
  locale: 'en',
  timezone: 'UTC',
  phonePrefix: '+1',
};

function mapRow(value: Record<string, unknown>): JurisdictionConfig {
  const out: JurisdictionConfig = {};
  const pick = (k: string) => (value[k] as string | undefined) ?? undefined;
  out.code = pick('code');
  out.name = pick('name');
  out.currency = pick('currency');
  out.currencySymbol = pick('currency_symbol') ?? pick('currencySymbol');
  out.locale = pick('locale');
  out.timezone = pick('timezone');
  out.phonePrefix = pick('phone_prefix') ?? pick('phonePrefix');
  out.regulatoryBody = (value.regulatory_body as string | null) ?? (value.regulatoryBody as string | null) ?? null;
  out.countryCode = pick('country_code') ?? pick('countryCode');
  out.isActive = (value.is_active as boolean | undefined) ?? (value.isActive as boolean | undefined);
  out.config = value.config as Record<string, unknown> | undefined;
  return out;
}

export function normalizeJurisdiction(value: Record<string, unknown> | null | undefined): JurisdictionConfig {
  if (!value) {
    return { code: 'GLOBAL', currency: 'USD', currencySymbol: '$', locale: 'en', timezone: 'UTC', phonePrefix: '+1', isGlobal: true };
  }
  const row = mapRow(value);
  const base = { ...DEFAULT_CONFIG, ...row };
  return { ...base, isGlobal: !row.code || row.code === 'GLOBAL' };
}

export function currencySymbolOf(config: JurisdictionConfig | null | undefined): string {
  const norm = normalizeJurisdiction(config);
  return norm.currencySymbol || '$';
}

export function localeOf(config: JurisdictionConfig | null | undefined): string {
  return normalizeJurisdiction(config).locale || 'en';
}

export function phonePrefixOf(config: JurisdictionConfig | null | undefined): string {
  return normalizeJurisdiction(config).phonePrefix || '+1';
}

export function formatNumber(
  amount: number,
  config: JurisdictionConfig | null | undefined,
  options: Intl.NumberFormatOptions = {}
): string {
  const locale = localeOf(config);
  try {
    return new Intl.NumberFormat(locale, options).format(amount);
  } catch {
    return amount.toLocaleString();
  }
}

export function formatMoney(amount: number, config: JurisdictionConfig | null | undefined): string {
  const norm = normalizeJurisdiction(config);
  const symbol = norm.currencySymbol || norm.currency || '$';
  try {
    return `${symbol} ${formatNumber(amount, config, { maximumFractionDigits: 0 })}`;
  } catch {
    return `${symbol} ${Math.round(amount)}`;
  }
}