import { JurisdictionConfig } from '@shared/lib/jurisdiction';
import { supabase } from '../config/supabase';

export interface JurisdictionListItem {
  code: string;
  name: string;
  currency: string;
  currency_symbol: string;
  locale: string;
  timezone: string;
  phone_prefix: string;
  regulatory_body: string | null;
  country_code: string;
  is_active: boolean;
  is_global: boolean;
  config: Record<string, unknown> | null;
}

export interface CreateJurisdictionInput {
  code: string;
  name: string;
  currency: string;
  currency_symbol: string;
  locale: string;
  timezone: string;
  phone_prefix: string;
  regulatory_body?: string | null;
  country_code: string;
  is_active?: boolean;
  is_global?: boolean;
  config?: Record<string, unknown>;
}

export interface UpdateJurisdictionInput extends Partial<CreateJurisdictionInput> {
  code: string;
}

export async function listJurisdictions(): Promise<JurisdictionListItem[]> {
  const { data, error } = await supabase
    .from('jurisdictions')
    .select('*')
    .order('is_global', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(row => ({
    code: row.code,
    name: row.name,
    currency: row.currency,
    currency_symbol: row.currency_symbol,
    locale: row.locale,
    timezone: row.timezone,
    phone_prefix: row.phone_prefix,
    regulatory_body: row.regulatory_body,
    country_code: row.country_code,
    is_active: row.is_active,
    is_global: row.is_global,
    config: row.config,
  }));
}

export async function getJurisdiction(code: string): Promise<JurisdictionListItem | null> {
  const { data, error } = await supabase
    .from('jurisdictions')
    .select('*')
    .eq('code', code)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? {
    code: data.code,
    name: data.name,
    currency: data.currency,
    currency_symbol: data.currency_symbol,
    locale: data.locale,
    timezone: data.timezone,
    phone_prefix: data.phone_prefix,
    regulatory_body: data.regulatory_body,
    country_code: data.country_code,
    is_active: data.is_active,
    is_global: data.is_global,
    config: data.config,
  } : null;
}

export async function createJurisdiction(input: CreateJurisdictionInput): Promise<JurisdictionListItem> {
  const { data, error } = await supabase
    .from('jurisdictions')
    .insert({
      code: input.code,
      name: input.name,
      currency: input.currency,
      currency_symbol: input.currency_symbol,
      locale: input.locale,
      timezone: input.timezone,
      phone_prefix: input.phone_prefix,
      regulatory_body: input.regulatory_body || null,
      country_code: input.country_code,
      is_active: input.is_active ?? true,
      is_global: input.is_global ?? false,
      config: input.config || {},
    })
    .select()
    .single();

  if (error) throw error;
  return {
    code: data.code,
    name: data.name,
    currency: data.currency,
    currency_symbol: data.currency_symbol,
    locale: data.locale,
    timezone: data.timezone,
    phone_prefix: data.phone_prefix,
    regulatory_body: data.regulatory_body,
    country_code: data.country_code,
    is_active: data.is_active,
    is_global: data.is_global,
    config: data.config,
  };
}

export async function updateJurisdiction(input: UpdateJurisdictionInput): Promise<JurisdictionListItem> {
  const { code, ...updates } = input;
  const { data, error } = await supabase
    .from('jurisdictions')
    .update(updates)
    .eq('code', code)
    .select()
    .single();

  if (error) throw error;
  return {
    code: data.code,
    name: data.name,
    currency: data.currency,
    currency_symbol: data.currency_symbol,
    locale: data.locale,
    timezone: data.timezone,
    phone_prefix: data.phone_prefix,
    regulatory_body: data.regulatory_body,
    country_code: data.country_code,
    is_active: data.is_active,
    is_global: data.is_global,
    config: data.config,
  };
}

export async function deleteJurisdiction(code: string): Promise<void> {
  const { error } = await supabase
    .from('jurisdictions')
    .delete()
    .eq('code', code);

  if (error) throw error;
}

export async function getJurisdictionConfig(code: string): Promise<JurisdictionConfig | null> {
  const item = await getJurisdiction(code);
  if (!item) return null;
  return {
    code: item.code,
    name: item.name,
    currency: item.currency,
    currencySymbol: item.currency_symbol,
    locale: item.locale,
    timezone: item.timezone,
    phonePrefix: item.phone_prefix,
    regulatoryBody: item.regulatory_body,
    countryCode: item.country_code,
    isActive: item.is_active,
    isGlobal: item.is_global,
    config: item.config ?? undefined,
  };
}