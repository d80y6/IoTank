import { useJurisdiction as useJurisdictionContext } from '@/contexts/JurisdictionContext';
import { formatMoney, currencySymbolOf, localeOf, phonePrefixOf } from '@/lib/jurisdiction';

export function useJurisdiction() {
    const ctx = useJurisdictionContext();
    return {
        ...ctx,
        formatMoney: (amount: number) => formatMoney(amount, ctx.jurisdiction),
        currencySymbol: currencySymbolOf(ctx.jurisdiction),
        currency: ctx.jurisdiction.currency || 'USD',
        locale: localeOf(ctx.jurisdiction),
        phonePrefix: phonePrefixOf(ctx.jurisdiction),
    };
}