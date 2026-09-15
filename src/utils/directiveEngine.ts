import { Tank } from '@/types';

export interface TacticalDirective {
    status: 'CRITICAL' | 'CAUTION' | 'STABLE';
    recommendation: string;
    actionDetails: string;
    colorClass: string;
}

/**
 * Tactical Directive Engine
 * Analyzes real-time news title/summary against current tank levels, capacities, 
 * and prices to generate exact, actionable business decision recommendations.
 */
export function generateTacticalDirective(article: any, tanks: Tank[]): TacticalDirective {
    if (!article) {
        return {
            status: 'STABLE',
            recommendation: 'Market movements are standard. Continue normal operations and routine inventory audits.',
            actionDetails: 'Maintain standard operational hours and baseline retail pricing parameters.',
            colorClass: 'mi-directive--stable'
        };
    }

    if (article.aiDirective && article.aiDirective.recommendation) {
        const status = (article.aiDirective.status || 'STABLE').toUpperCase() as 'CRITICAL' | 'CAUTION' | 'STABLE';
        return {
            status,
            recommendation: article.aiDirective.recommendation,
            actionDetails: article.aiDirective.actionDetails || article.aiDirective.actionRequired || 'No immediate tactical action required.',
            colorClass: status === 'CRITICAL' ? 'mi-directive--critical' :
                        status === 'CAUTION' ? 'mi-directive--caution' : 'mi-directive--stable'
        };
    }

    const fuelTypes = (article.topicTags || []).map((t: string) => t.toLowerCase());
    
    // Find relevant tanks for this news signal
    const relevantTanks = (tanks || []).filter(t => {
        const type = t.fuelType?.toLowerCase();
        if (fuelTypes.includes('all') || fuelTypes.length === 0) return true;
        if (type === 'petrol' || type === 'pms' || type === 'super') {
            return fuelTypes.includes('petrol') || fuelTypes.includes('pms') || fuelTypes.includes('super');
        }
        if (type === 'diesel' || type === 'ago') {
            return fuelTypes.includes('diesel') || fuelTypes.includes('ago');
        }
        return fuelTypes.includes(type);
    });

    const titleAndSummary = `${article.title || ''} ${article.summary || ''}`.toLowerCase();
    
    const isPriceImplication = article.implicationCategory?.toLowerCase() === 'price' || 
                               titleAndSummary.includes('price') || 
                               titleAndSummary.includes('rate') ||
                               titleAndSummary.includes('epra') || 
                               titleAndSummary.includes('ksh') ||
                               titleAndSummary.includes('sh.');

    const isSupplyImplication = article.implicationCategory?.toLowerCase() === 'supply' ||
                                titleAndSummary.includes('shortage') || 
                                titleAndSummary.includes('supply') ||
                                titleAndSummary.includes('pipeline') ||
                                titleAndSummary.includes('depot') ||
                                titleAndSummary.includes('delivery');

    const isSecurityImplication = article.implicationCategory?.toLowerCase() === 'security' ||
                                  titleAndSummary.includes('theft') ||
                                  titleAndSummary.includes('leak') ||
                                  titleAndSummary.includes('breach') ||
                                  titleAndSummary.includes('intrusion');

    const isIncrease = titleAndSummary.includes('increase') || 
                        titleAndSummary.includes('hike') || 
                        titleAndSummary.includes('up') || 
                        titleAndSummary.includes('raised') || 
                        titleAndSummary.includes('increased') ||
                        titleAndSummary.includes('rise');

    const isReduction = titleAndSummary.includes('reduce') || 
                        titleAndSummary.includes('reduction') || 
                        titleAndSummary.includes('down') || 
                        titleAndSummary.includes('slash') || 
                        titleAndSummary.includes('cut') || 
                        titleAndSummary.includes('slashed') || 
                        titleAndSummary.includes('reduced') || 
                        titleAndSummary.includes('decreased') ||
                        titleAndSummary.includes('drop');

    // Extract numerical price change if present
    const priceChangeMatch = titleAndSummary.match(/(?:sh|ksh|shillings)?\.?\s*(\d+(?:\.\d+)?)\s*(?:increase|reduction|decrease|hike|drop|slash|cut|slashed|reduced|increased|up|down)/i) || 
                             titleAndSummary.match(/(?:increase|reduction|decrease|hike|drop|slash|cut|slashed|reduced|increased|up|down)\s+(?:by|of)?\s*(?:sh|ksh|shillings)?\.?\s*(\d+(?:\.\d+)?)/i);
    const priceDiff = priceChangeMatch ? parseFloat(priceChangeMatch[1]) : null;

    // Default stable directive if no relevant tanks or standard news
    if (relevantTanks.length === 0) {
        return {
            status: 'STABLE',
            recommendation: 'Market movements are standard. Continue normal operations and routine inventory audits.',
            actionDetails: 'Maintain standard operational hours and baseline retail pricing parameters.',
            colorClass: 'mi-directive--stable'
        };
    }

    // Identify lowest and highest tank inventory levels
    const lowestTank = relevantTanks.reduce((prev, curr) => {
        const prevVol = prev.currentVolume ?? 0;
        const currVol = curr.currentVolume ?? 0;
        return (prevVol / (prev.capacity || 1) < currVol / (curr.capacity || 1) ? prev : curr);
    }, relevantTanks[0]);
    
    const lowestVol = lowestTank.currentVolume ?? 0;
    const lowestLevelPct = Math.round((lowestVol / (lowestTank.capacity || 1)) * 100);
    const lowestTankName = lowestTank.name || `${lowestTank.fuelType} Tank`;

    if (isPriceImplication) {
        if (isIncrease) {
            const diffText = priceDiff ? `of KES ${priceDiff.toFixed(2)}/L` : '';
            if (lowestLevelPct < 60) {
                // Critical procurement order needed
                const orderVol = Math.round(lowestTank.capacity - lowestVol);
                return {
                    status: 'CRITICAL',
                    recommendation: `EPRA price hike notice ${diffText} detected. Your ${lowestTankName} inventory is low at ${lowestLevelPct}%. Dispatch a major restocking order immediately.`,
                    actionDetails: `Trigger a replenishment order of ${orderVol.toLocaleString()} Liters of ${lowestTank.fuelType} immediately to secure current lower wholesale rates.`,
                    colorClass: 'mi-directive--critical'
                };
            } else {
                // High inventory - storage optimization
                return {
                    status: 'CAUTION',
                    recommendation: `EPRA price hike notice ${diffText} detected. Your ${lowestTankName} inventory is healthy at ${lowestLevelPct}%. Hold sales and maximize storage gains.`,
                    actionDetails: `Retain inventory. Schedule your manual pump retail price upward adjustment immediately once the new EPRA gazette takes effect to maximize inventory valuation profit.`,
                    colorClass: 'mi-directive--caution'
                };
            }
        } else if (isReduction) {
            const diffText = priceDiff ? `of KES ${priceDiff.toFixed(2)}/L` : '';
            if (lowestLevelPct < 40) {
                // Defer order
                return {
                    status: 'CAUTION',
                    recommendation: `EPRA price reduction ${diffText} is scheduled. Your ${lowestTankName} inventory is at ${lowestLevelPct}%. Defer any major replenishments.`,
                    actionDetails: `Delay wholesale procurement orders until the price reduction takes effect. Maintain only minimum operational stock to avoid purchase price loss.`,
                    colorClass: 'mi-directive--caution'
                };
            } else {
                // High inventory - margin liquidation
                return {
                    status: 'CRITICAL',
                    recommendation: `EPRA price reduction ${diffText} is scheduled. Your ${lowestTankName} is holding high stock (${lowestLevelPct}%). Flush high-cost volume immediately.`,
                    actionDetails: `Accelerate local pump throughput. Consider offering a minor local wholesale discount to liquidate inventory before the lower EPRA retail cap compresses margins.`,
                    colorClass: 'mi-directive--critical'
                };
            }
        }
    }

    if (isSupplyImplication) {
        if (lowestLevelPct < 50) {
            return {
                status: 'CRITICAL',
                recommendation: `Supply chain disruption detected. Your ${lowestTankName} level is at ${lowestLevelPct}%. Safeguard local supply continuity.`,
                actionDetails: `Raise safety stock threshold to 30%, suspend wholesale discounts, and lock in contract orders with local pipeline depots immediately.`,
                colorClass: 'mi-directive--critical'
            };
        } else {
            return {
                status: 'CAUTION',
                recommendation: `Sector supply chain disruption detected. Your ${lowestTankName} inventory is currently secure at ${lowestLevelPct}%.`,
                actionDetails: `Verify tank secondary safety seals, monitor depot delivery lead times closely, and suspend speculative external sales.`,
                colorClass: 'mi-directive--caution'
            };
        }
    }

    if (isSecurityImplication) {
        return {
            status: 'CRITICAL',
            recommendation: `Operational security vulnerability warning active in the sector. Safeguard station assets.`,
            actionDetails: `Execute emergency manual relay test, check terminal safety PIN access logs, and confirm telemetry network integrity.`,
            colorClass: 'mi-directive--critical'
        };
    }

    // Default stable but tank-aware fallback
    const targetRestock = Math.round(lowestTank.capacity * 0.8 - lowestVol);
    if (lowestLevelPct < 30) {
        return {
            status: 'CAUTION',
            recommendation: `Standard market conditions. Your ${lowestTankName} inventory is moderately low at ${lowestLevelPct}%.`,
            actionDetails: `Schedule a baseline restocking order of ${Math.max(5000, targetRestock).toLocaleString()} Liters to avoid running dry.`,
            colorClass: 'mi-directive--caution'
        };
    }

    return {
        status: 'STABLE',
        recommendation: `Standard market cycle. Your ${lowestTankName} inventory is stable at ${lowestLevelPct}%.`,
        actionDetails: `No immediate tactical action required. Continue routine operations at current retail price of KES ${(lowestTank as any).metadata?.retailPrice || '---'}/L.`,
        colorClass: 'mi-directive--stable'
    };
}
