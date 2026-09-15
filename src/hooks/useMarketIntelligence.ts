import { useState, useEffect } from 'react';
import { supabase } from '@/config/supabase';
import { MarketSignal, SupplyRisk, RegulatoryNotice, MarketData, MarketActionItem } from '@/types';
import { NewsService } from '@/services/NewsService';
import { extractPricesFromText } from './useMarketNews';
import { logger } from '@/utils/logger';

export const useMarketIntelligence = (stationId: string) => {
    // Cache key for news feed
    const MI_CACHE_KEY_SIGNALS = 'mi_cache_signals';
    
    const VERIFIED_BASE_PRICES: MarketData[] = [
        { id: 'init-pms', fuelType: 'PMS', region: 'Kenya', pricePerLiter: 214.25, currency: 'KES', timestamp: 1778803200000, source: 'epra', metadata: { isOfficial: true, sourceDetail: 'User Verified' } as any },
        { id: 'init-ago', fuelType: 'AGO', region: 'Kenya', pricePerLiter: 242.92, currency: 'KES', timestamp: 1778803200000, source: 'epra', metadata: { isOfficial: true, sourceDetail: 'User Verified' } as any },
        { id: 'init-ik', fuelType: 'IK', region: 'Kenya', pricePerLiter: 152.78, currency: 'KES', timestamp: 1778803200000, source: 'epra', metadata: { isOfficial: true, sourceDetail: 'User Verified' } as any },
        { id: 'init-brent', fuelType: 'BRENT', region: 'Global', pricePerLiter: 83.45, currency: 'USD', timestamp: 1778803200000, source: 'api' },
        { id: 'init-fx', fuelType: 'FX', region: 'Kenya', pricePerLiter: 132.50, currency: 'KES', timestamp: 1778803200000, source: 'api' },
    ];

    const [signals, setSignals] = useState<MarketSignal[]>(() => {
        try {
            const cached = localStorage.getItem(MI_CACHE_KEY_SIGNALS);
            return cached ? JSON.parse(cached) : [];
        } catch {
            return [];
        }
    });

    const [risks, setRisks] = useState<SupplyRisk[]>([]);
    const [notices, setNotices] = useState<RegulatoryNotice[]>([]);
    const [prices, setPrices] = useState<MarketData[]>(() => {
        try {
            const cached = localStorage.getItem('mi_cache_prices');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
            return VERIFIED_BASE_PRICES;
        } catch {
            return VERIFIED_BASE_PRICES;
        }
    });
    const [actionQueue, setActionQueue] = useState<MarketActionItem[]>([]);

    const [loading, setLoading] = useState<boolean>(() => {
        try {
            return !localStorage.getItem(MI_CACHE_KEY_SIGNALS) || !localStorage.getItem('mi_cache_prices');
        } catch {
            return true;
        }
    });

    const [refreshTrigger, setRefreshTrigger] = useState(0);

    /**
     * Triggers a background data reload.
     * NOTE (L-02): This is NOT a synchronous fetch — it increments a counter to
     * re-trigger the useEffect. The returned Promise resolves after 500ms as a
     * minimum delay hint, not after data is actually fetched. Callers should
     * observe the `loading` state to know when the refresh completes.
     */
    const refetch = async () => {
        setRefreshTrigger(prev => prev + 1);
        setLoading(true);
        return new Promise<void>(resolve => setTimeout(resolve, 500));
    };

    // ── Real-time Listener ──
    useEffect(() => {
        const handleNewSignal = (e: any) => {
            const newSignal = e.detail;
            setSignals(prev => {
                const alreadyExists = prev.some(s => s.id === newSignal.id);
                if (alreadyExists) return prev;
                const updated = [newSignal, ...prev].slice(0, 50); // Keep last 50
                try {
                    localStorage.setItem(MI_CACHE_KEY_SIGNALS, JSON.stringify(updated));
                } catch (err) { logger.warn('[useMarketIntelligence] Cache update failed:', err); }
                return updated;
            });
        };

        window.addEventListener('market-news-update', handleNewSignal);
        NewsService.startListening();

        return () => {
            window.removeEventListener('market-news-update', handleNewSignal);
            NewsService.stopListening();
        };
    }, []);

    useEffect(() => {
        let isMounted = true;
        if (signals.length === 0 || prices.length === 0) setLoading(true);

        const fetchData = async () => {
            try {
                // 1. Fetch Historical News (Market News)
                const historicalNews = await NewsService.fetchRecentNews(20);

                // 2. Fetch Prices (Official Database)
                const { data: priceData, error: priceError } = await supabase
                    .from('market_prices')
                    .select('*')
                    .order('effective_date', { ascending: false })
                    .limit(20);
                
                if (priceError) throw priceError;
                const mappedPricesValue = (priceData || []).map((p: any) => ({
                    id: p.id,
                    fuelType: p.fuel_type.toUpperCase(),
                    pricePerLiter: Number(p.price || p.price_per_liter),
                    currency: p.currency,
                    timestamp: new Date(p.effective_date).getTime(),
                    source: p.source as any
                } as MarketData));

                // 3. Fetch Signals (AI / External)
                const { data: signalData, error: signalError } = await supabase
                    .from('market_signals')
                    .select('*')
                    .order('timestamp', { ascending: false })
                    .limit(20);
                
                if (signalError) throw signalError;
                const mappedSignalsValue = (signalData || []).map((s: any) => ({
                    id: s.id,
                    type: s.type,
                    source: s.source,
                    sourceType: s.source_type,
                    title: s.title,
                    summary: s.summary,
                    timestamp: s.timestamp,
                    relevanceScore: s.relevance_score,
                    confidenceScore: s.confidence_score,
                    externalUrl: s.external_url,
                    attribution: s.attribution
                } as MarketSignal));

                // 4. Fetch Action Queue
                const { data: queueData } = await supabase
                    .from('market_action_queue')
                    .select('*')
                    .eq('station_id', stationId)
                    .eq('status', 'pending')
                    .order('created_at', { ascending: false });

                const mappedQueue = (queueData || []).map((q: any) => ({
                    id: q.id,
                    stationId: q.station_id,
                    fuelType: q.fuel_type,
                    oldPrice: q.old_price,
                    newPrice: q.new_price,
                    effectiveDate: q.effective_date,
                    actionType: q.action_type,
                    status: q.status,
                    metadata: q.metadata,
                    createdAt: q.created_at,
                    updatedAt: q.updated_at
                } as MarketActionItem));

                // Merge Both Sources, Sort by Timestamp
                const mergedSignals = [...historicalNews, ...mappedSignalsValue]
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, 30);

                // ─── Forensic Extraction Logic ───
                const basePricesMap = prices.reduce((acc, p) => {
                    let key = p.fuelType;
                    if (key === 'PMS') key = 'Petrol';
                    else if (key === 'AGO') key = 'Diesel';
                    else if (key === 'IK') key = 'Kerosene';
                    acc[key] = p.pricePerLiter;
                    return acc;
                }, {} as Record<string, number>);

                const extractedPrices: MarketData[] = [];
                mergedSignals.forEach(signal => {
                    const detections = extractPricesFromText(signal.title + ' ' + signal.summary, basePricesMap);
                    const topicTags = (signal as any).topicTags || [];
                    const isEPRA = topicTags.includes('EPRA') || signal.source?.includes('EPRA') || signal.attribution?.includes('EPRA');
                    
                    detections.forEach(det => {
                        // [FORENSIC RULE]: Fuel prices (PMS/AGO/IK) MUST come from EPRA sources.
                        const commodityUpper = det.commodity.toUpperCase();
                        const isFuel = ['PETROL', 'DIESEL', 'KEROSENE', 'PMS', 'AGO', 'IK'].includes(commodityUpper);
                        
                        if (det.commodity !== 'General' && (!isFuel || isEPRA)) {
                            // C-03 FIX: Apply the same >= 0.80 confidence guard that useMarketNews uses.
                            // Without this, low-confidence AI extractions can corrupt production prices.
                            // Official EPRA sources are considered 100% verified (confidence = 1.0).
                            const detConfidence = isEPRA ? 1.0 : ((det as any).confidence ?? 0);
                            if (isFuel && detConfidence < 0.80) return;

                            let fuelType = commodityUpper;
                            if (fuelType === 'PETROL') fuelType = 'PMS';
                            else if (fuelType === 'DIESEL') fuelType = 'AGO';
                            else if (fuelType === 'KEROSENE') fuelType = 'IK';

                            // Synchronize variance to the database table market_prices and trigger action queue alerts
                            const currentDbPrice = basePricesMap[det.commodity];
                            if (currentDbPrice !== det.value) {
                                supabase.rpc('forensic_update_market_price', {
                                    p_fuel_type: fuelType,
                                    p_new_price: det.value,
                                    p_effective_date: new Date(signal.timestamp).toISOString(),
                                    p_source_url: (signal as any).url || null,
                                    p_is_official: isEPRA,
                                    p_signal_id: signal.id || null
                                }).then(
                                    ({ error }) => {
                                        if (error) {
                                            logger.error(`[useMarketIntelligence] Sync extracted price failed for ${fuelType}:`, error.message);
                                        } else {
                                            logger.info(`[useMarketIntelligence] Forensic update success for ${fuelType} to KES ${det.value}`);
                                        }
                                    },
                                    (err: any) => {
                                        logger.error(`[useMarketIntelligence] Sync error for ${fuelType}:`, err);
                                    }
                                );
                            }

                            extractedPrices.push({
                                id: `extraction-${fuelType}-${signal.id}`,
                                fuelType: fuelType,
                                pricePerLiter: det.value,
                                currency: det.currency,
                                timestamp: signal.timestamp,
                                source: 'api',
                                metadata: { isLiveExtraction: true, sourceTitle: signal.title, isOfficial: isEPRA }
                            } as any);
                        }
                    });
                });

                // Merge: Live Extraction (High Priority) > Database Prices > Base Verified
                let finalPrices = [...VERIFIED_BASE_PRICES];
                
                // Update with initial state/cache if fresher
                prices.forEach(p => {
                    const idx = finalPrices.findIndex(f => f.fuelType === p.fuelType);
                    if (idx === -1) finalPrices.push(p);
                    else if (p.timestamp > finalPrices[idx].timestamp) finalPrices[idx] = p;
                });

                // Update with DB data
                mappedPricesValue.forEach(dbPrice => {
                    const idx = finalPrices.findIndex(p => p.fuelType === dbPrice.fuelType);
                    if (idx === -1) finalPrices.push(dbPrice);
                    else if (dbPrice.timestamp >= finalPrices[idx].timestamp) finalPrices[idx] = dbPrice;
                });

                // Update with Live Extraction
                extractedPrices.forEach(ext => {
                    const idx = finalPrices.findIndex(p => p.fuelType === ext.fuelType);
                    if (idx === -1) finalPrices.push(ext);
                    else if (ext.timestamp >= finalPrices[idx].timestamp) finalPrices[idx] = ext;
                });

                // 5. Fetch Risks
                const { data: riskData, error: riskError } = await supabase
                    .from('supply_risks')
                    .select('*')
                    .order('timestamp', { ascending: false })
                    .limit(10);
                
                if (riskError) throw riskError;
                const mappedRisksValue = (riskData || []).map((r: any) => ({
                    id: r.id,
                    category: r.category,
                    severity: r.severity,
                    message: r.message,
                    affectedRegions: r.affected_regions,
                    timestamp: r.timestamp,
                    source: r.source
                } as SupplyRisk));

                // 6. Fetch Notices
                const { data: noticeData, error: noticeError } = await supabase
                    .from('regulatory_notices')
                    .select('*')
                    .order('effective_date', { ascending: false })
                    .limit(10);
                
                if (noticeError) throw noticeError;
                const mappedNoticesValue = (noticeData || []).map((n: any) => ({
                    id: n.id,
                    authority: n.authority,
                    noticeType: n.notice_type,
                    title: n.title,
                    effectiveDate: n.effective_date,
                    summary: n.summary,
                    documentUrl: n.document_url
                } as RegulatoryNotice));

                if (isMounted) {
                    setPrices(finalPrices);
                    setSignals(mergedSignals);
                    setActionQueue(mappedQueue);
                    try {
                        localStorage.setItem(MI_CACHE_KEY_SIGNALS, JSON.stringify(mergedSignals));
                        localStorage.setItem('mi_cache_prices', JSON.stringify(finalPrices));
                    } catch (e) {
                        logger.warn('[useMarketIntelligence] Failed to cache market data:', e);
                    }
                    setRisks(mappedRisksValue);
                    setNotices(mappedNoticesValue);
                    setLoading(false);
                }
            } catch (err: unknown) {
                logger.warn('[useMarketIntelligence] Fetch error:', err);
                if (isMounted) setLoading(false);
            }
        };

        fetchData();

        const timer = setTimeout(() => {
            if (isMounted) {
                setLoading(false);
            }
        }, 5000);

        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
    }, [stationId, refreshTrigger]);

    // ── Database Real-Time Subscriptions ──
    useEffect(() => {
        if (!stationId) return;

        const instanceSuffix = Math.random().toString(36).substring(7);

        // 1. Subscribe to market_prices changes
        const priceChannelId = `live-prices-${stationId}-${instanceSuffix}`;
        const priceSubscription = supabase
            .channel(priceChannelId)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'market_prices' },
                () => {
                    refetch();
                }
            )
            .subscribe();

        // 2. Subscribe to market_signals changes
        const signalChannelId = `live-signals-${stationId}-${instanceSuffix}`;
        const signalSubscription = supabase
            .channel(signalChannelId)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'market_signals' },
                () => {
                    refetch();
                }
            )
            .subscribe();

        // 3. Subscribe to market_action_queue changes
        const queueChannelId = `live-queue-${stationId}-${instanceSuffix}`;
        const queueSubscription = supabase
            .channel(queueChannelId)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'market_action_queue',
                    filter: `station_id=eq.${stationId}`
                },
                () => {
                    refetch();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(priceSubscription);
            supabase.removeChannel(signalSubscription);
            supabase.removeChannel(queueSubscription);
        };
    }, [stationId]);

    const completeAction = async (actionId: string) => {
        try {
            const { error } = await supabase
                .from('market_action_queue')
                .update({ status: 'completed', updated_at: new Date().toISOString() })
                .eq('id', actionId);
            if (error) throw error;
            setActionQueue(prev => prev.filter(a => a.id !== actionId));
        } catch (err) {
            logger.error('[useMarketIntelligence] Failed to complete action:', err);
        }
    };

    return { signals, risks, notices, prices, actionQueue, loading, refetch, completeAction };
};
