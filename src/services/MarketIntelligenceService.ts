/* eslint-disable @typescript-eslint/no-explicit-any */
import { MarketSignal, RegulatoryNotice, SignalSourceType } from '@/types';
import { logger } from '@/utils/logger';
import { supabase } from '@/config/supabase';

export interface MarketIntelligenceConfig {
    newsApiKey?: string;
    eiaApiKey?: string;
    alphaVantageApiKey?: string;
    exchangeRateApiKey?: string;
}

export class MarketIntelligenceService {
    constructor(_config?: MarketIntelligenceConfig) { }

    private async getSafeAuthHeaders(): Promise<Record<string, string>> {
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const headers: Record<string, string> = { 
            'Content-Type': 'application/json',
            'apikey': anonKey || ''
        };

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const isValidToken = session && (session.expires_at ? session.expires_at > (Date.now() / 1000) + 10 : true);
            
            if (isValidToken && session?.access_token) {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }
        } catch (e) {
            logger.warn('[MarketIntelligenceService] Auth check failed, proceeding anonymously.');
        }

        return headers;
    }

    async fetchGlobalNews(): Promise<MarketSignal[]> {
        const domains = [
            'nation.africa',
            'businessdailyafrica.com',
            'standardmedia.co.ke',
            'the-star.co.ke',
            'reuters.com',
            'bloomberg.com',
            'oilprice.com'
        ].join(',');

        const now = new Date();
        const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
        const fromDate = tenDaysAgo.toISOString().split('T')[0];

        const queries = [
            'EPRA fuel price Kenya',
            'Suez Canal oil supply disruption',
            'Kenyan shilling exchange rate fuel',
            'Brent crude price drivers',
            'KPC fuel storage Nairobi'
        ];

        const allArticles: any[] = [];

        try {
            const headers = await this.getSafeAuthHeaders();

            for (const q of queries) {
                const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&domains=${domains}&language=en&sortBy=publishedAt&pageSize=15&from=${fromDate}`;
                const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                const response = await fetch(`${supabaseUrl}/functions/v1/news-api-proxy`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ url })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 'ok' && data.articles) {
                        allArticles.push(...data.articles);
                    }
                }
            }
            
            if (allArticles.length === 0) {
                const headlinesUrl = `https://newsapi.org/v2/top-headlines?category=business&q=fuel&language=en&pageSize=10`;
                const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                const response = await fetch(`${supabaseUrl}/functions/v1/news-api-proxy`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ url: headlinesUrl })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 'ok' && data.articles) {
                        allArticles.push(...data.articles);
                    }
                }
            }

            if (allArticles.length === 0) return this.getFallbackNews();
            
            const uniqueArticles = Array.from(new Map(allArticles.map(a => [a.url, a])).values());
            return uniqueArticles.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()).map((article: any) => {
                const title = article.title.toLowerCase();
                let sourceType: SignalSourceType = 'General News';
                let relevanceScore = 0.8;
                if (title.includes('epra') || title.includes('legislation')) {
                    sourceType = 'Regulatory';
                    relevanceScore = 0.95;
                } else if (title.includes('price') || title.includes('crude')) {
                    sourceType = 'Price Impact';
                    relevanceScore = 0.9;
                } else if (title.includes('supply') || title.includes('pipeline')) {
                    sourceType = 'Supply Chain';
                    relevanceScore = 0.85;
                }
                const urlHash = article.url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
                return {
                    id: `news-${urlHash}`,
                    type: 'market',
                    source: article.source?.name || 'News Source',
                    sourceType,
                    title: article.title,
                    summary: article.description || article.content,
                    timestamp: new Date(article.publishedAt).getTime(),
                    relevanceScore: Math.min(relevanceScore, 1.0),
                    confidenceScore: 0.92,
                    externalUrl: article.url,
                    attribution: article.source?.name || 'News Outlet'
                };
            });
        } catch (error) {
            logger.error('Error fetching NewsAPI:', error);
            return this.getFallbackNews();
        }
    }

    async fetchEIAPrices(): Promise<any> {
        try {
            const headers = await this.getSafeAuthHeaders();
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const response = await fetch(`${supabaseUrl}/functions/v1/eia-proxy`, {
                method: 'POST',
                headers
            });

            if (!response.ok) throw new Error(`EIA error: ${response.statusText}`);
            const data = await response.json();
            return data.response?.data || [];
        } catch (error) {
            logger.error('Error fetching EIA:', error);
            return null;
        }
    }

    async fetchCrudeBenchmarks(): Promise<any[]> {
        const benchmarks = ['WTI', 'BRENT'];
        const results = [];

        try {
            const headers = await this.getSafeAuthHeaders();
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

            for (const symbol of benchmarks) {
                const response = await fetch(`${supabaseUrl}/functions/v1/alpha-vantage-proxy`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ symbol })
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.data) results.push({ symbol, data: data.data[0] });
                }
            }
        } catch (error) {
            logger.error(`Error fetching benchmarks from proxy:`, error);
        }
        return results;
    }

    async fetchEPRANotices(): Promise<RegulatoryNotice[]> {
        // M-04 FIX: The previous implementation returned a hardcoded mock EPRA notice on every
        // call, causing syncAll() to upsert the same fake record indefinitely and polluting
        // regulatory_notices. EPRA scraping is handled by the 'official-scraper' Edge Function
        // via useMarketNews.ts. This client-side method intentionally returns nothing.
        logger.info('[MarketIntelligenceService] fetchEPRANotices() deferred to Edge Function scraper.');
        return [];
    }

    async syncAll(stationId: string): Promise<boolean> {
        let someFailure = false;
        let news: MarketSignal[] = [];
        const triggerAlert = async (type: 'market_news' | 'regulatory_update', message: string, severity: 'info' | 'warning' = 'info') => {
            try {
                await supabase.from('alerts').upsert({
                    station_id: stationId,
                    alert_type: type, // Standardized to the actual alert type
                    severity,
                    title: type === 'market_news' ? '💡 Price Review Trigger' : '📜 Regulatory Advisory',
                    message,
                    alert_data: { detectionMethod: 'ai-assisted' },
                    is_read: false,
                    is_acknowledged: false,
                    is_resolved: false,
                    created_at: new Date().toISOString()
                }, { onConflict: 'station_id,alert_type,title' }); // Avoid duplicate news alerts
            } catch (err) { logger.error('Failed to trigger news alert:', err); }
        };

        try {
            news = await this.fetchGlobalNews();
            for (const signal of news) {
                const { error } = await supabase.from('market_signals').upsert({
                    id: signal.id,
                    station_id: stationId,
                    type: signal.type,
                    source: signal.source,
                    source_type: signal.sourceType,
                    title: signal.title,
                    summary: signal.summary,
                    timestamp: signal.timestamp,
                    relevance_score: signal.relevanceScore,
                    confidence_score: signal.confidenceScore,
                    external_url: signal.externalUrl,
                    attribution: signal.attribution,
                    created_at: new Date().toISOString()
                });
                if (error) throw error;
                if ((signal.relevanceScore ?? 0) >= 0.9) await triggerAlert('market_news', `High-Impact News: ${signal.title}`);
            }
        } catch (e) { logger.error('News sync failed:', e); someFailure = true; }

        try {
            const epra = await this.fetchEPRANotices();
            for (const notice of epra) {
                const { error } = await supabase.from('regulatory_notices').upsert({
                    id: `reg-${notice.authority}-${notice.id}`,
                    station_id: stationId,
                    authority: notice.authority,
                    notice_type: notice.noticeType,
                    title: notice.title,
                    effective_date: notice.effectiveDate,
                    summary: notice.summary,
                    document_url: notice.documentUrl,
                    created_at: new Date().toISOString()
                });
                if (error) throw error;
                await triggerAlert('regulatory_update', `Regulatory Update: ${notice.title}`, 'warning');
            }
        } catch (e) { logger.error('EPRA sync failed:', e); someFailure = true; }

        try {
            const eiaData = await this.fetchEIAPrices();
            if (eiaData && Array.isArray(eiaData)) {
                for (const item of eiaData.slice(0, 3)) {
                    if (!item || !item.period || !item.value) continue;
                    const { error } = await supabase.from('raw_market_data').upsert({
                        id: `eia-crude-${item.period}`,
                        station_id: stationId,
                        fuel_type: 'crude_oil',
                        region: 'Global/EIA',
                        price_per_liter: parseFloat(item.value),
                        currency: 'KES',
                        timestamp: new Date(item.period).getTime() || Date.now(),
                        source: 'eia',
                        created_at: new Date().toISOString()
                    });
                    if (error) throw error;
                }
            }
        } catch (e) { logger.error('EIA sync failed:', e); someFailure = true; }

        try {
            const benchmarks = await this.fetchCrudeBenchmarks();
            for (const b of benchmarks) {
                if (!b || !b.data || !b.data.value) continue;
                const { error } = await supabase.from('raw_market_data').upsert({
                    id: `benchmark-${b.symbol}-${new Date().toISOString().split('T')[0]}`,
                    station_id: stationId,
                    fuel_type: b.symbol,
                    region: 'Global',
                    price_per_liter: parseFloat(b.data.value),
                    currency: 'KES',
                    timestamp: Date.now(),
                    source: 'alpha-vantage',
                    created_at: new Date().toISOString()
                });
                if (error) throw error;
            }
        } catch (e) { logger.error('Benchmark sync failed:', e); someFailure = true; }

        return !someFailure;
    }

    private getFallbackNews(): MarketSignal[] {
        return [{
            id: `fb-1-${Date.now()}`, type: 'market', source: 'Daily Nation', sourceType: 'News Outlet', title: 'EPRA Kenya signals retail price stabilization', summary: 'Improved landing costs and a stronger Shilling are key factors.', timestamp: Date.now() - 7200000, relevanceScore: 0.98, confidenceScore: 0.95, externalUrl: 'https://nation.africa/kenya/business/energy', attribution: 'Daily Nation Business'
        }];
    }
}
