import {
  normalizeJurisdiction,
  currencySymbolOf,
  localeOf,
  phonePrefixOf,
  formatMoney,
} from '../src/lib/jurisdiction';

describe('jurisdiction helpers', () => {
  test('normalizeJurisdiction falls back to GLOBAL defaults', () => {
    const norm = normalizeJurisdiction(null);
    expect(norm.code).toBe('GLOBAL');
    expect(norm.currency).toBe('USD');
    expect(norm.currencySymbol).toBe('$');
    expect(norm.locale).toBe('en');
    expect(norm.phonePrefix).toBe('+1');
    expect(norm.isGlobal).toBe(true);
  });

  test('GLOBAL code is treated as global regardless of fields', () => {
    const norm = normalizeJurisdiction({ code: 'GLOBAL', currency: 'EUR', currencySymbol: '€' });
    expect(norm.isGlobal).toBe(true);
    expect(norm.currency).toBe('EUR');
  });

  test('normalizeJurisdiction preserves jurisdiction fields', () => {
    const norm = normalizeJurisdiction({
      code: 'KE',
      name: 'Kenya',
      currency: 'KES',
      currencySymbol: 'KSh',
      locale: 'en-KE',
      timezone: 'Africa/Nairobi',
      phonePrefix: '+254',
      regulatoryBody: 'EPRA',
    });
    expect(norm.isGlobal).toBe(false);
    expect(norm.regulatoryBody).toBe('EPRA');
    expect(norm.phonePrefix).toBe('+254');
  });

  test('normalizeJurisdiction maps snake_case row keys from RPC', () => {
    const norm = normalizeJurisdiction({
      code: 'KE',
      name: 'Kenya',
      currency: 'KES',
      currency_symbol: 'KSh',
      locale: 'en-KE',
      timezone: 'Africa/Nairobi',
      phone_prefix: '+254',
      regulatory_body: 'EPRA',
    });
    expect(norm.currencySymbol).toBe('KSh');
    expect(norm.phonePrefix).toBe('+254');
    expect(norm.regulatoryBody).toBe('EPRA');
    expect(norm.isGlobal).toBe(false);
  });

  test('formatMoney uses config symbol and locale grouping', () => {
    const out = formatMoney(1234567.89, { code: 'KE', currencySymbol: 'KSh', locale: 'en-KE' });
    expect(out).toContain('KSh');
    expect(out).toMatch(/1,234,568/);
  });

  test('formatMoney falls back to default dollar symbol', () => {
    expect(formatMoney(50, null)).toContain('$');
    expect(formatMoney(50, undefined)).toContain('$');
  });

  test('currencySymbolOf / localeOf / phonePrefixOf return configured or default', () => {
    expect(currencySymbolOf({ code: 'KE', currencySymbol: 'KSh' })).toBe('KSh');
    expect(currencySymbolOf(null)).toBe('$');
    expect(localeOf({ locale: 'fr-FR' })).toBe('fr-FR');
    expect(localeOf(null)).toBe('en');
    expect(phonePrefixOf({ phonePrefix: '+233' })).toBe('+233');
    expect(phonePrefixOf(null)).toBe('+1');
  });
});