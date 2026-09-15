/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * useMarketNews — Spark-Safe Market Intelligence Hook
 *
 * Architecture:
 *  - Client-side RSS fetch via rss2json.com (free, no key, no proxy needed)
 *  - localStorage cache with 15-min TTL
 *  - 30-second refresh rate-limit guard
 *  - Rule-based relevance scoring and topic tagging (no LLM calls)
 *  - Failure states: 'ok' | 'cached-stale' | 'no-signal' | 'source-unavailable'
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { MarketSignal, Tank } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { logger } from '@/utils/logger';
import { supabase } from '@/config/supabase';
import { IntelligenceAIService, ArticleAIDirective } from '@/services/IntelligenceAIService';
import { AuditService } from '@/services/AuditService';

const CACHE_TTL_MS = 15 * 60 * 1000;       // 15 minutes — standard news sources
const CACHE_TTL_SLOW_MS = 60 * 60 * 1000;  // 60 minutes — regulatory/forex (low frequency)
const REFRESH_COOLDOWN_MS = 30 * 1000;     // 30 seconds
const PERSISTENT_CACHE_KEY = 'mi:persistent_signals';
const MAX_CACHE_DAYS = 14;                 // 14 days of signals kept locally (purged after 14 days)
const ACK_SIGNALS_KEY = 'mi:acknowledged_urls';
export const VERIFIED_AI_SOURCES = ['EPRA', 'CBK', 'KPA', 'EIA', 'REUTERS', 'BD AFRICA'];

// LOW-06 FIX: Typed as ArticleAIDirective instead of 'any' to ensure type safety
// across all references to this fallback value.
const FALLBACK_DIRECTIVE: ArticleAIDirective = {
    status: 'STABLE',
    recommendation: 'Market signals stable. Standard monitoring cycle (periodic data refresh and sentiment scan) active — no immediate tactical adjustment required for station inventory or pricing.',
    actionRequired: false,
    actionDetails: 'Continue routine monitoring. Verify against official EPRA announcements on the 14th.',
    confidence: 1.0,
    priceData: []
};

// ─── Proxies (Function Names) ─────────────────────────────────────────────────
const OFFICIAL_SCRAPER = 'official-scraper';
const GNEWS_PROXY = 'gnews-proxy';
const NEWSDATA_PROXY = 'newsdata-proxy';
const CURRENTS_PROXY = 'currents-proxy';
const RSS_PARSER = 'rss-parser';

// Google News RSS fallback queries
const GN_RSS = (query: string) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-KE&gl=KE&ceid=KE:en`;


// ─── Source Credibility Mapping ──────────────────────────────────────────────

const SOURCE_CREDIBILITY: Record<string, number> = {
    'epra.go.ke': 1.0,
    'cbk.go.ke': 1.0,
    'eia.gov': 0.95,
    'reuters.com': 0.85,
    'oilprice.com': 0.85,
    'businessdailyafrica.com': 0.75,
    'nation.africa': 0.75,
    'the-star.co.ke': 0.60,
    'standardmedia.co.ke': 0.70,
};

// ─── Whitelisted RSS Sources ──────────────────────────────────────────────────

export interface NewsFeedSource {
    label: string;
    shortLabel: string;
    region: 'Kenya' | 'Global';
    url: string;
    type: 'Regulatory' | 'News Outlet' | 'Commodity' | 'Logistics';
    /** Override cache TTL (ms). Defaults to CACHE_TTL_MS (15 min). */
    cacheTTL?: number;
}

export const NEWS_SOURCES: NewsFeedSource[] = [
    // ── Tier 1: Kenya Regulatory (highest priority) ──────────────────────────
    {
        label: 'EPRA — Petroleum Pricing',
        shortLabel: 'EPRA',
        region: 'Kenya',
        url: GN_RSS('EPRA petroleum price Kenya'),
        type: 'Regulatory',
        cacheTTL: CACHE_TTL_MS,
    },
    {
        label: 'Central Bank of Kenya — Forex',
        shortLabel: 'CBK',
        region: 'Kenya',
        url: GN_RSS('Central Bank Kenya shilling forex rate'),
        type: 'Regulatory',
        cacheTTL: CACHE_TTL_SLOW_MS, // CBK data moves slowly — 1hr TTL
    },
    {
        label: 'Kenya Ports Authority — Logistics',
        shortLabel: 'KPA',
        region: 'Kenya',
        url: GN_RSS('Kenya Ports Authority Mombasa fuel supply terminal'),
        type: 'Logistics',
        cacheTTL: CACHE_TTL_SLOW_MS,
    },

    // ── Tier 2: Kenya News ────────────────────────────────────────────────────
    {
        label: 'Business Daily Africa',
        shortLabel: 'BD Africa',
        region: 'Kenya',
        url: GN_RSS('Business Daily Africa fuel energy'),
        type: 'News Outlet',
    },
    {
        label: 'Nation Africa — Kenya',
        shortLabel: 'Nation',
        region: 'Kenya',
        url: GN_RSS('Nation Africa Kenya fuel prices energy'),
        type: 'News Outlet',
    },
    {
        label: 'The Standard Media',
        shortLabel: 'Standard',
        region: 'Kenya',
        url: GN_RSS('Standard Media Kenya petroleum news'),
        type: 'News Outlet',
    },

    // ── Tier 3: Global Commodity ──────────────────────────────────────────────
    {
        label: 'Reuters — Commodities',
        shortLabel: 'Reuters',
        region: 'Global',
        url: 'https://feeds.reuters.com/reuters/businessNews',
        type: 'News Outlet',
    },
    {
        label: 'OilPrice.com',
        shortLabel: 'OilPrice',
        region: 'Global',
        url: 'https://oilprice.com/rss/main',
        type: 'Commodity',
    },
    // ── Tier 4: Intelligence Proxies (Internal) ──────────────────────────────
    {
        label: 'EIA Petroleum Intelligence',
        shortLabel: 'EIA',
        region: 'Global',
        url: 'proxy:eia',
        type: 'Commodity',
        cacheTTL: CACHE_TTL_SLOW_MS,
    },
    {
        label: 'Global Exchange Parity',
        shortLabel: 'Forex',
        region: 'Global',
        url: 'proxy:exchange-rate',
        type: 'Regulatory',
        cacheTTL: CACHE_TTL_SLOW_MS,
    },
    {
        label: 'Alpha Vantage Market Sentiment',
        shortLabel: 'AlphaV',
        region: 'Global',
        url: 'proxy:alpha-vantage',
        type: 'Commodity',
    },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type FetchStatus = 'ok' | 'cached-stale' | 'no-signal' | 'source-unavailable' | 'loading';

export interface NewsArticle extends MarketSignal {
    region: 'Kenya' | 'Global';
    topicTags: string[];
    implicationCategory: 'Price' | 'Supply' | 'Compliance' | 'Logistics' | 'Political' | 'General';
    briefingSummary: string;   // Rule-based 200-char snippet + implication
    feedSource: string;        // shortLabel of origin
    imageUrl?: string;
    url: string;               // Explicit source URL for deduplication
    
    // ─── Verification Metadata ───
    confidenceScore: number;   // 0-1.0
    verificationStatus: 'verified' | 'unverified' | 'disputed' | 'flagged';
    validationLabel?: string;
    isCorroborated?: boolean;
    corroborationCount?: number;
    isUnhighlighted?: boolean; // If hidden/auto-hide
    isOfficial?: boolean;      // EPRA / Official Kenyan Agency

    /** TankIQ AI-Generated Operational Intelligence */
    aiDirective?: ArticleAIDirective;
}



// ─── Rule-based helpers ───────────────────────────────────────────────────────

function computeTopicTags(title: string, description: string): string[] {
    const text = ((title || '') + ' ' + (description || '')).toLowerCase();
    const tags: string[] = [];
    if (text.includes('epra') || text.includes('energy and petroleum regulatory') || text.includes('epra_kenya')) tags.push('EPRA');
    if (text.includes('price') || text.includes('pump price') || text.includes('petroleum price') || text.includes('retail price')) tags.push('PriceAlert');
    if (text.includes('supply') || text.includes('shortage')) tags.push('SupplyChain'); // MED-04 FIX: removed duplicate 'shortage' check
    if (text.includes('forex') || text.includes('dollar') || text.includes('shilling') || text.includes('exchange rate')) tags.push('Forex');
    if (text.includes('crude') || text.includes('brent') || text.includes('wti')) tags.push('CrudeOil');
    if (text.includes('pipeline') || text.includes('kpc') || text.includes('logistics') || text.includes('port') || text.includes('terminal')) tags.push('Logistics');
    if (text.includes('tax') || text.includes('vat') || text.includes('levy') || text.includes('excise')) tags.push('Tax');
    if (text.includes('diesel') || text.includes('petrol') || text.includes('kerosene') || text.includes('lpg')) tags.push('FuelProduct');
    return tags.length > 0 ? tags : ['General'];
}

function computeImplication(title: string, summary: string): 'Price' | 'Supply' | 'Compliance' | 'Logistics' | 'Political' | 'General' {
    const text = ((title || '') + ' ' + (summary || '')).toLowerCase();
    if (text.includes('epra') || text.includes('regulation') || text.includes('tax') || text.includes('vat') || text.includes('mandate') || text.includes('policy')) return 'Compliance';
    if (text.includes('government') || text.includes('president') || text.includes('court') || text.includes('sanctions') || text.includes('war') || text.includes('unrest') || text.includes('political')) return 'Political';
    if (text.includes('pipeline') || text.includes('port') || text.includes('logistics') || text.includes('terminal') || text.includes('shipping')) return 'Logistics';
    if (text.includes('supply') || text.includes('shortage') || text.includes('stock')) return 'Supply';
    if (text.includes('price') || text.includes('crude') || text.includes('brent') || text.includes('cost') || text.includes('forex') || text.includes('shilling')) return 'Price';
    return 'General';
}

function computeRelevanceScore(title: string, summary: string, sourceType: string, externalUrl?: string): number {
    const text = ((title || '') + ' ' + (summary || '')).toLowerCase();
    let score = 0.65;
    if (text.includes('epra')) score += 0.3;
    if (text.includes('fuel') || text.includes('petroleum') || text.includes('diesel') || text.includes('petrol')) score += 0.15;
    if (text.includes('kenya') || text.includes('nairobi')) score += 0.05;
    if (text.includes('price')) score += 0.15;
    if (sourceType === 'Regulatory') score += 0.25; 
    if (sourceType === 'Commodity') score += 0.1;

    // Apply Source Credibility Multiplier
    let multiplier = 0.7; // Default for unknown sources
    if (externalUrl) {
        try {
            const hostname = new URL(externalUrl).hostname;
            const domain = hostname.replace('www.', '');
            if (SOURCE_CREDIBILITY[domain]) {
                multiplier = SOURCE_CREDIBILITY[domain];
            } else {
                // Check if any key is a substring (e.g. nation.africa might be business.nation.africa)
                const entry = Object.entries(SOURCE_CREDIBILITY).find(([key]) => domain.includes(key));
                if (entry) multiplier = entry[1];
            }
        } catch { /* ignore invalid urls */ }
    }

    return Math.min(score * multiplier, 1.0);
}

export interface PriceDetection {
    commodity: 'Petrol' | 'Diesel' | 'Kerosene' | 'BRENT' | 'FX' | 'General';
    value: number;
    currency: string;
}

export function extractPricesFromText(text: string, basePrices?: Record<string, number>): PriceDetection[] {
    const results: PriceDetection[] = [];
    
    // 1. Kenya Pump Prices (Ksh - absolute)
    // Enhanced regex to catch standard news formatting like "petrol at 214.25", "PMS: 214.25", etc.
    const kshRegex = /(?:set at|retail at|price of|to ksh|ksh|shillings|sh|ksh\.|kshs|kshs\.|to|at|:\s*|of\s*|up to\s*)\s*(?:ksh|sh|shs|sh\.)?\s*(\d{2,3}(?:\.\d{2})?)/gi;
    let match;
    
    while ((match = kshRegex.exec(text)) !== null) {
        const val = parseFloat(match[1]);
        // Valid EPRA prices in Kenya are typically 150-300 KES. 
        if (val < 100 || val > 300) continue; 
        
        const snippet = (text || '').substring(Math.max(0, match.index - 80), Math.min(text.length, match.index + 80)).toLowerCase();
        
        let commodity: PriceDetection['commodity'] = 'General';
        if (snippet.includes('petrol') || snippet.includes('pms') || snippet.includes('super')) commodity = 'Petrol';
        else if (snippet.includes('diesel') || snippet.includes('ago')) commodity = 'Diesel';
        else if (snippet.includes('kerosene') || snippet.includes('ik')) commodity = 'Kerosene';
        
        // Boost confidence if specific regulatory keywords or "Nairobi" (default pricing zone) are nearby
        const isOfficialPhrasing = snippet.includes('set at') || snippet.includes('retail at') || snippet.includes('regulated') || snippet.includes('epra') || snippet.includes('nairobi') || snippet.includes('at');
        if (commodity !== 'General' || isOfficialPhrasing) {
            // Deduplicate: If we found multiple mentions of the same price for the same commodity, keep only one
            if (!results.some(r => r.commodity === commodity && r.value === val)) {
                results.push({ commodity, value: val, currency: 'KES' });
            }
        }
    }

    // 2. Relative Change Parser (e.g. "petrol increased by sh 10")
    const lowerText = (text || '').toLowerCase();
    const commodities = [
        { name: 'Petrol' as const, aliases: ['petrol', 'super', 'pms'] },
        { name: 'Diesel' as const, aliases: ['diesel', 'ago'] },
        { name: 'Kerosene' as const, aliases: ['kerosene', 'ik'] }
    ];

    const resolvedBase = {
        Petrol: basePrices?.Petrol || basePrices?.pms || basePrices?.PMS || 206.97,
        Diesel: basePrices?.Diesel || basePrices?.ago || basePrices?.AGO || 206.84,
        Kerosene: basePrices?.Kerosene || basePrices?.ik || basePrices?.IK || 152.78
    };

    const sentences = lowerText.split(/[.!?;\n]+/);
    sentences.forEach(sentence => {
        commodities.forEach(comm => {
            const hasComm = comm.aliases.some(alias => sentence.includes(alias));
            if (!hasComm) return;

            // Regex to find: direction word + optional "by/of" + optional "sh/ksh" + number (1 to 2 digits, optional decimal)
            const relativeRegex = /(?:increase|reduction|decrease|hike|rise|drop|slash|cut|slashed|reduced|increased|up|down|grows|falls|grew|fell)\s+(?:by|of)?\s*(?:ksh|sh|shs|shillings|sh\.|ksh\.)?\s*(\d{1,2}(?:\.\d{2})?)/gi;
            
            let relMatch;
            while ((relMatch = relativeRegex.exec(sentence)) !== null) {
                const changeVal = parseFloat(relMatch[1]);
                if (changeVal <= 0 || changeVal > 50) continue; 

                const snippet = sentence.substring(Math.max(0, relMatch.index - 30), Math.min(sentence.length, relMatch.index + 30));
                const isDown = snippet.includes('reduce') || snippet.includes('decrease') || snippet.includes('drop') || snippet.includes('slash') || snippet.includes('cut') || snippet.includes('slashed') || snippet.includes('reduced') || snippet.includes('down') || snippet.includes('fell') || snippet.includes('fall');
                const isUp = snippet.includes('increase') || snippet.includes('hike') || snippet.includes('rise') || snippet.includes('increased') || snippet.includes('up') || snippet.includes('grows') || snippet.includes('grew') || snippet.includes('raise');

                if (isDown || isUp) {
                    const directionMultiplier = isDown ? -1 : 1;
                    const basePrice = resolvedBase[comm.name];
                    const computedPrice = basePrice + (changeVal * directionMultiplier);
                    
                    if (computedPrice >= 100 && computedPrice <= 300) {
                        const existingIdx = results.findIndex(r => r.commodity === comm.name);
                        if (existingIdx === -1) {
                            results.push({ 
                                commodity: comm.name, 
                                value: parseFloat(computedPrice.toFixed(2)), 
                                currency: 'KES' 
                            });
                        }
                    }
                }
            }
        });
    });

    // 3. Global Brent ($)
    const brentRegex = /(?:brent|crude|oil).*?(\$?\d{1,3}(?:\.\d{2})?)/gi;
    while ((match = brentRegex.exec(text)) !== null) {
        const valStr = match[1].replace('$', '');
        const val = parseFloat(valStr);
        if (!isNaN(val)) results.push({ commodity: 'BRENT', value: val, currency: 'USD' });
    }

    return results;
}

// Legacy wrapper to keep validatePriceClaim working
function extractPriceFromText(text: string): number | null {
    const detections = extractPricesFromText(text);
    return detections.length > 0 ? detections[0].value : null;
}

function validatePriceClaim(article: NewsArticle, currentEPRAPrice: number) {
    const text = (article.title + ' ' + article.summary);
    const claimedPrice = extractPriceFromText(text);

    if (!claimedPrice) return { status: 'unverifiable' as const };

    const deviation = Math.abs(claimedPrice - currentEPRAPrice) / currentEPRAPrice;

    if (deviation > 0.20) {
        return {
            status: 'flagged' as const,
            label: `⚠️ Unverified — exceeds 20% variance from current EPRA data (Ksh ${currentEPRAPrice})`,
            autoHide: true
        };
    }
    return { status: 'plausible' as const };
}




function buildBriefingSummary(title: string, description: string): string {
    const cleanDesc = description.replace(title, '').replace(/<[^>]*>/g, '').trim();
    const snippet = cleanDesc.length > 20 ? cleanDesc.substring(0, 300) : description.substring(0, 300);
    // Remove boilerplate "Strategic Context" and provide direct intelligence
    return `${snippet || title}`;
}

function buildSignalFromArticle(
    article: any,
    source: NewsFeedSource
): NewsArticle {
    const title = article.title || 'Untitled';
    const description = (article.description || article.content || '').replace(/<[^>]*>/g, '');
    const topicTags = computeTopicTags(title, description);
    const implicationCategory = computeImplication(title, description);
    const link = article.link || article.url || article.guid || '';
    const relevanceScore = computeRelevanceScore(title, description, source.type, link);
    
    let publishedAt = Date.now();
    if (article.pubDate || article.publishedAt || article.published_at) {
        try {
            const dateStr = article.pubDate || article.publishedAt || article.published_at;
            publishedAt = new Date(dateStr).getTime();
            if (isNaN(publishedAt)) publishedAt = Date.now();
        } catch {
            publishedAt = Date.now();
        }
    }
    const articleKey = article.url || `${article.title}-${source.shortLabel}`;
    const stableId = `int-${source.shortLabel.replace(/\s/g, '_')}-${articleKey.substring(0, 16)}-${publishedAt}`;

    const signalSourceType = source.type === 'Logistics' ? 'Operational Alert' : source.type;

    return {
        id: stableId,
        type: source.type === 'Regulatory' ? 'regulatory' : source.type === 'Commodity' ? 'market' : source.type === 'Logistics' ? 'logistics' : 'market',
        source: source.label,
        sourceType: signalSourceType,
        title,
        summary: (description.replace(title, '').trim() || description || title).substring(0, 500),
        timestamp: publishedAt,
        relevanceScore,
        confidenceScore: source.type === 'Regulatory' ? 0.95 : 0.7,
        verificationStatus: (source.type === 'Regulatory' || relevanceScore >= 0.80) ? 'verified' : 'unverified',
        isCorroborated: (source.type === 'Regulatory' || relevanceScore >= 0.80),
        url: link,
        attribution: source.shortLabel,
        region: source.region,
        topicTags,
        implicationCategory,
        briefingSummary: buildBriefingSummary(title, description),
        feedSource: source.shortLabel,
        isOfficial: source.type === 'Regulatory',
        imageUrl: article.thumbnail || article.urlToImage || article.image || article.enclosure?.link || undefined,
    };
}


// ─── Cache helpers ────────────────────────────────────────────────────────────

// ─── Cache Management (Offline-First Persistent Store) ─────────────────────────

function readMasterHistory(): NewsArticle[] {
    try {
        const raw = localStorage.getItem(PERSISTENT_CACHE_KEY);
        if (!raw) return [];
        const payload: any = JSON.parse(raw);
        const articles: NewsArticle[] = Array.isArray(payload) ? payload : (payload.articles || []);
        
        // Retention cleanup: keep signals from last 30 days
        const limit = Date.now() - (MAX_CACHE_DAYS * 24 * 60 * 60 * 1000);
        return articles.filter(a => a.timestamp > limit);
    } catch {
        return [];
    }
}

function writeMasterHistory(newArticles: NewsArticle[]): void {
    try {
        const existing = readMasterHistory();
        
        // Incremental Merge & Deduplicate
        const mergedMap = new Map<string, NewsArticle>();
        
        // Load existing
        existing.forEach(a => mergedMap.set(a.url || `${a.title}-${a.feedSource}`, a));
        
        // Append New (overwrite existing if same source+title)
        newArticles.forEach(a => mergedMap.set(a.url || `${a.title}-${a.feedSource}`, a));
        
        const final = Array.from(mergedMap.values())
            .sort((a, b) => b.timestamp - a.timestamp);
            
        // Limit total history to 200 items to prevent storage bloat
        localStorage.setItem(PERSISTENT_CACHE_KEY, JSON.stringify(final.slice(0, 200)));
    } catch { /* Quota exceeded: silent fail */ }
}

function getSyncTime(sourceLabel: string): number {
    try {
        const syncs = JSON.parse(localStorage.getItem('mi:sync_times') || '{}');
        return syncs[sourceLabel] || 0;
    } catch { return 0; }
}

function updateSyncTime(sourceLabel: string): void {
    try {
        const syncs = JSON.parse(localStorage.getItem('mi:sync_times') || '{}');
        syncs[sourceLabel] = Date.now();
        localStorage.setItem('mi:sync_times', JSON.stringify(syncs));
    } catch { /* noop */ }
}

function getLastRefreshTime(): number {
    try {
        return parseInt(localStorage.getItem('mi:lastRefresh') || '0', 10);
    } catch {
        return 0;
    }
}

function setLastRefreshTime(): void {
    try {
        localStorage.setItem('mi:lastRefresh', String(Date.now()));
    } catch { /* noop */ }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseMarketNewsReturn {
    articles: NewsArticle[];
    status: FetchStatus;
    lastUpdated: Date | null;       // Date of last successful fetch
    isRefreshing: boolean;
    canRefresh: boolean;            // false during 30s cooldown
    countdown: number;              // seconds remaining in cooldown
    refresh: (tanks?: Tank[]) => Promise<void>;
    activeSource: string;           // 'all' or a source shortLabel
    setActiveSource: (s: string) => void;
    activeRegion: 'all' | 'Kenya' | 'Global';
    setActiveRegion: (r: 'all' | 'Kenya' | 'Global') => void;
    filteredArticles: NewsArticle[]; // post-filter view
    validateAgainstEPRA: (articles: NewsArticle[], epraPrice: number) => NewsArticle[];
    acknowledgeArticle: (url: string) => void;
}

export function useMarketNews(): UseMarketNewsReturn {
    // Initialize from persistent store for instant offline availability (0ms UI)
    const [allArticles, setAllArticles] = useState<NewsArticle[]>(() => readMasterHistory());
    const [status, setStatus] = useState<FetchStatus>(allArticles.length > 0 ? 'ok' : 'loading');
    const [lastUpdated, setLastUpdated] = useState<Date | null>(() => {
        const last = getLastRefreshTime();
        return last > 0 ? new Date(last) : null;
    });
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const [activeSource, setActiveSource] = useState('all');
    const [activeRegion, setActiveRegion] = useState<'all' | 'Kenya' | 'Global'>('all');
    const [acknowledgedUrls, setAcknowledgedUrls] = useState<Set<string>>(() => {
        try {
            const raw = localStorage.getItem(ACK_SIGNALS_KEY);
            return raw ? new Set(JSON.parse(raw)) : new Set();
        } catch { return new Set(); }
    });

    const { loading: authLoading } = useAuth();
    const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const apiCooldowns = useRef<Record<string, number>>({}); // Tracks API -> expiration timestamp
    const initialFetchAttempted = useRef(false);
    // HIGH-09 FIX: Stable singleton — prevents creating a new IntelligenceAIService (+ auth call)
    // on every source fetch. One instance is shared across the entire lifecycle of this hook.
    const aiServiceRef = useRef<IntelligenceAIService>(new IntelligenceAIService());

    // Adaptive backoff check
    const isApiAvailable = (api: string) => {
        const cooldown = apiCooldowns.current[api];
        if (!cooldown) return true;
        if (Date.now() > cooldown) {
            delete apiCooldowns.current[api];
            return true;
        }
        return false;
    };

    const markApiLimited = (api: string) => {
        // HIGH-06 FIX: Use structured logger instead of raw console.warn
        logger.warn(`[useMarketNews] API ${api} rate-limited. Backing off for 2 minutes.`, null, 'MARKET_NEWS');
        apiCooldowns.current[api] = Date.now() + 120000; // 2 minute cooldown
    };

    // Can refresh is computed from countdown
    const canRefresh = countdown === 0;

    // Start cooldown UI timer
    const startCooldown = useCallback(() => {
        const last = getLastRefreshTime();
        const elapsed = Date.now() - last;
        const remaining = Math.max(0, REFRESH_COOLDOWN_MS - elapsed);
        if (remaining <= 0) {
            setCountdown(0);
            return;
        }
        setCountdown(Math.ceil(remaining / 1000));
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, []);

    const fetchFromSource = useCallback(async (source: NewsFeedSource, tanks?: Tank[], force = false): Promise<NewsArticle[]> => {
        // [SYNC_OPTIMIZATION]: Check per-source TTL before triggering a network sync
        const lastSync = getSyncTime(source.shortLabel);
        const ttl = source.cacheTTL ?? CACHE_TTL_MS;
        if (!force && (Date.now() - lastSync < ttl)) {
            // Data is still fresh in master history, skip network load
            return [];
        }

        const collected: NewsArticle[] = [];
        // [FORENSIC_PRIORITY]: EPRA is our primary regulatory source.
        // If we fail to get results from the scraper, we immediately try the GNews proxy.
        // 0. Try HIGH-INTEGRITY: Official Scraper (only for Regulatory/Logistics)
        if (source.type === 'Regulatory' || source.type === 'Logistics') {
            try {
                const { data, error } = await supabase.functions.invoke(OFFICIAL_SCRAPER, {
                    method: 'POST',
                    body: { source: source.shortLabel }
                });

                if (!error && data?.results?.length > 0) {
                    const signals = data.results.map((s: any) => ({
                        ...s,
                        feedSource: s.source || source.shortLabel,
                        isOfficial: true,
                        isCorroborated: true,
                        relevanceScore: 1.0 
                    }));
                    collected.push(...signals);
                }
            } catch (e) {
                logger.warn(`[useMarketNews] Scraper fail for ${source.shortLabel}:`, e);
            }
        }

        // 1. Try Primary: GNews API Proxy (Optimized for EPRA)
        if (isApiAvailable('GNEWS')) {
            try {
                const query = source.shortLabel === 'EPRA' 
                    ? 'EPRA petroleum price Kenya news' 
                    : `${source.shortLabel} fuel petroleum Kenya`;

                const { data, error } = await supabase.functions.invoke(GNEWS_PROXY, {
                    method: 'POST',
                    body: { query, max: 8 }
                });
                
                if (error && (error as any).status === 429) {
                    markApiLimited('GNEWS');
                } else if (!error && data?.articles) {
                    const articles = data.articles.map((a: any) => buildSignalFromArticle(a, source));
                    collected.push(...articles);
                }
            } catch (e) { /* fallback */ }
        }

        // 2. Try Secondary Redundancy (only if primary failed or returned nothing)
        if (collected.length === 0 && isApiAvailable('NEWSDATA')) {
            try {
                const { data, error } = await supabase.functions.invoke(NEWSDATA_PROXY, {
                    method: 'POST',
                    body: { query: source.shortLabel + ' energy Kenya' }
                });
                
                if (error && (error as any).status === 429) {
                    markApiLimited('NEWSDATA');
                } else if (!error && data?.results) {
                    const articles = data.results.map((a: any) => buildSignalFromArticle(a, source));
                    collected.push(...articles);
                }
            } catch (e) {
                // Failover to Currents Proxy
                if (isApiAvailable('CURRENTS')) {
                    try {
                        const { data: currentsData, error: currentsError } = await supabase.functions.invoke(CURRENTS_PROXY, {
                            method: 'POST',
                            body: { query: source.shortLabel }
                        });
                        if (currentsError && (currentsError as any).status === 429) {
                            markApiLimited('CURRENTS');
                        } else if (!currentsError && currentsData?.news) {
                            const articles = currentsData.news.map((a: any) => buildSignalFromArticle(a, source));
                            collected.push(...articles);
                        }
                    } catch (ce) { /* exhaust proxies */ }
                }
            }
        }

        // 3. Last Resort: Self-Hosted RSS Parser
        const isUrlValid = source.url && source.url.startsWith('http');
        const isProxy = source.url && source.url.startsWith('proxy:');
        
        if (collected.length === 0 && isUrlValid && !isProxy) {
            try {
                const { data, error } = await supabase.functions.invoke(RSS_PARSER, {
                    method: 'POST',
                    body: { rssUrl: source.url }
                });
                if (error) {
                    logger.warn(`RSS Parser 400/Failure for ${source.shortLabel}: ${source.url}`, error, 'MARKET_NEWS');
                } else if (data?.items) {
                    const articles = data.items.map((i: any) => buildSignalFromArticle(i, source));
                    collected.push(...articles);
                }
            } catch (e) { 
                // HIGH-06 FIX: Use structured logger
                logger.error(`[useMarketNews] Parser failure for ${source.shortLabel}`, e, 'MARKET_NEWS');
            }
        }

        if (collected.length > 0) {
            // [TankIQ ENRICHMENT]: Only for newly fetched high-relevance signals from VERIFIED sources
            // HIGH-09 FIX: Reuse a single IntelligenceAIService instance per fetch cycle instead of
            // instantiating one per source (was creating up to 10 instances with 10 separate auth calls).
            const aiService = aiServiceRef.current;
            const enriched = [];
            const isVerifiedSource = VERIFIED_AI_SOURCES.includes(source.shortLabel.toUpperCase());
            const existingHistory = readMasterHistory();

            let aiProcessedCount = 0;
            for (const article of collected) {
                // Deduplication & Cache Check: Check if article has already been processed with an AI directive
                const cachedArticle = existingHistory.find(
                    a => a.url === article.url || (a.title === article.title && a.feedSource === article.feedSource)
                );
                if (cachedArticle && cachedArticle.aiDirective) {
                    enriched.push({ ...article, aiDirective: cachedArticle.aiDirective });
                    continue;
                }

                const relevance = article.relevanceScore ?? 0;
                const isKenyanNews = article.region === 'Kenya' && (article.feedSource === 'BD Africa' || article.feedSource === 'Nation' || article.feedSource === 'Standard');
                
                // [FORENSIC EXTRACTION]: Cap AI processing at 1 article per source fetch cycle to protect API limits and eliminate UI lag
                if (aiProcessedCount < 1 && ((isVerifiedSource && relevance > 0.65) || (isKenyanNews && ((article.title || '') + (article.summary || '')).toLowerCase().includes('price')))) {
                    try {
                        const directive = await aiService.generateArticleDirective(article, Array.isArray(tanks) ? tanks : []);
                        enriched.push({ ...article, aiDirective: directive });
                        aiProcessedCount++;
                        // [Rate Limit Shield]: Increased stagger delay between source requests to prevent gateway 429s
                        await new Promise(resolve => setTimeout(resolve, 800));
                    } catch (e) {
                        // HIGH-06 FIX: Use structured logger
                        logger.warn(`[useMarketNews] TankIQ directive failed for "${article.title}"`, e, 'MARKET_NEWS');
                        enriched.push({ ...article, aiDirective: FALLBACK_DIRECTIVE });
                    }
                } else if (relevance > 0.50) {
                    // Use hardcoded directive for non-verified or medium relevance sources to save tokens
                    enriched.push({ ...article, aiDirective: FALLBACK_DIRECTIVE });
                } else {
                    enriched.push(article);
                }
            }

            for (const article of enriched) {
                if (article.aiDirective?.priceData && article.aiDirective.priceData.length > 0) {
                    for (const p of article.aiDirective.priceData) {
                        // CRIT-06 GUARD: Only write EPRA prices extracted with high confidence (≥0.80)
                        // and from an EPRA-tagged verified source to limit the blast radius of a
                        // bad AI extraction. This does NOT fully replace server-side validation
                        // (tracked as a future Edge Function migration) but reduces invalid writes.
                        const isHighConfidenceEPRA =
                            (article.aiDirective?.confidence ?? 0) >= 0.80 &&
                            (article.topicTags?.includes('EPRA') || article.feedSource === 'EPRA' || article.attribution === 'EPRA' || article.isOfficial) &&
                            p.price > 0 &&
                            p.price < 500; // Sanity check: KES fuel prices are always < 500/L

                        if (!isHighConfidenceEPRA) {
                            logger.warn(
                                `[useMarketNews] Skipping low-confidence price write for ${p.fuelType}: ${p.price} (confidence: ${article.aiDirective?.confidence ?? 'N/A'})`,
                                null, 'MARKET_SENSE'
                            );
                            continue;
                        }

                        try {
                            const effectiveDate = p.effectiveDate || new Date().toISOString().split('T')[0];
                            await supabase.rpc('forensic_update_market_price', {
                                p_fuel_type: p.fuelType,
                                p_new_price: p.price,
                                p_effective_date: new Date(effectiveDate).toISOString(),
                                p_source_url: article.url || null,
                                p_is_official: true,
                                p_signal_id: article.id || null
                            });
                            
                            // Premium Global Notification for Price Shift
                            window.dispatchEvent(new CustomEvent('system-toast', {
                                detail: {
                                    title: `EPRA Price Shift: ${p.fuelType}`,
                                    message: `New regulated price detected: ${p.currency || 'KES'} ${p.price}/L. Market intelligence has updated your local reference.`,
                                    type: 'warning',
                                    attribution: 'MARKET_SENSE'
                                }
                            }));

                            const stationIdVal = (Array.isArray(tanks) && tanks.length > 0) ? (tanks[0] as any).station_id || (tanks[0] as any).stationId : null;
                            await AuditService.log('FINANCE', 'PRICE_UPDATE', stationIdVal || 'SYSTEM', `EPRA Auto-Sync: ${p.fuelType} price adjusted to ${p.price} ${p.currency || 'KES'}`, 'INFO', { fuelType: p.fuelType, price: p.price });
                            
                            logger.info(`[useMarketNews] Auto-updated price for ${p.fuelType}: ${p.price}`, null, 'MARKET_SENSE');
                        } catch (err) {
                            // HIGH-06 FIX: Use structured logger
                            logger.error(`[useMarketNews] Failed to update price for ${p.fuelType}`, err, 'MARKET_SENSE');
                        }
                    }
                }
            }

            writeMasterHistory(enriched);
            updateSyncTime(source.shortLabel);
            
            // [MARKET INTELLIGENCE]: Notify user of High-Relevance EPRA shifts
            if (source.shortLabel === 'EPRA') {
                const topSignal = enriched.find(a => (a.relevanceScore ?? 0) >= 0.90);
                const stationIdVal = (Array.isArray(tanks) && tanks.length > 0) ? (tanks[0] as any).station_id || (tanks[0] as any).stationId : null;
                
                if (topSignal) {
                    window.dispatchEvent(new CustomEvent('system-toast', {
                        detail: {
                            title: 'EPRA: New Pricing/Regulatory Signal',
                            message: topSignal.title,
                            type: 'info',
                            attribution: 'MARKET_SENSE'
                        }
                    }));
                    // [FORENSIC PERSISTENCE]: Register as formal station alert
                    if (stationIdVal) {
                        supabase.rpc('upsert_alert_v2', {
                            p_station_id: stationIdVal,
                            p_tank_id: (Array.isArray(tanks) && tanks.length > 0) ? tanks[0].id : null,
                            p_alert_type: 'regulatory_update',
                            p_title: 'EPRA Regulatory Signal',
                            p_message: topSignal.title,
                            p_severity: 'info',
                            p_metadata: { article_id: topSignal.id, source: 'EPRA' }
                        }).then(({ error }) => {
                            if (error) logger.error('[useMarketNews] Alert persistence failed:', error, 'MARKET_NEWS'); // HIGH-06 FIX
                        });
                    }
                }
            }

            // After individual source fetch, update state with master timeline
            setAllArticles(readMasterHistory());
        } else {
            // Even if no news found, mark as synced to prevent flood
            updateSyncTime(source.shortLabel);
        }
        return collected;
    }, []);
    const fetchAll = useCallback(async (force = false, tanks?: Tank[]) => {
        // Rate-limit check (skip on initial mount, enforce on manual refresh)
        if (force) {
            const last = getLastRefreshTime();
            if (Date.now() - last < REFRESH_COOLDOWN_MS) {
                return; // Blocked
            }
            setLastRefreshTime();
            startCooldown();
        }

        setIsRefreshing(true);
        setStatus(prev => (prev === 'ok' || prev === 'cached-stale') ? prev : 'loading');

        try {
            let anySuccess = false;

            for (const src of NEWS_SOURCES) {
                try {
                    const articles = await fetchFromSource(src, tanks, force);
                    if (articles.length > 0) {
                        anySuccess = true;
                    }
                } catch (e) {
                    logger.error(`[useMarketNews] Batch error for ${src.shortLabel}:`, e);
                }
                // [Rate Limit Shield]: Increased stagger delay between source requests to prevent gateway 429s
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Refresh completed: Update global state from persistent store
            const final = readMasterHistory();
            setAllArticles(final);
            
            // Database-level Purge: Automatically clean up Supabase signals older than 14 days
            const purgeThreshold = Date.now() - (14 * 24 * 60 * 60 * 1000);
            supabase.from('market_signals')
                .delete()
                .lt('timestamp', purgeThreshold)
                .then(({ error }) => {
                    if (error) logger.error('[useMarketNews] Database signals purge failed:', error);
                    else logger.info('[useMarketNews] Successfully purged database market signals older than 14 days.');
                });

            // MED-07 FIX: Prevent setting status to 'cached-stale' if the cache is actually fresh.
            // Also prevent falsely updating `lastUpdated` timestamp if we didn't fetch new items.
            const isCacheFresh = NEWS_SOURCES.some(src => Date.now() - getSyncTime(src.shortLabel) < (src.cacheTTL ?? CACHE_TTL_MS));

            if (anySuccess) {
                setStatus('ok');
                setLastUpdated(new Date());
                setLastRefreshTime();
            } else if (isCacheFresh && final.length > 0) {
                setStatus('ok');
                // Keep the existing lastUpdated date (from the actual last network sync)
            } else if (final.length > 0) {
                setStatus('cached-stale');
            } else {
                setStatus('no-signal');
            }
        } catch (e) {
            logger.error('[useMarketNews] Fetch failure:', e);
            setStatus(prev => (prev === 'ok' || prev === 'cached-stale') ? 'cached-stale' : 'no-signal');
        } finally {
            setIsRefreshing(false);
        }
    }, [fetchFromSource, startCooldown]);

    // Initial background sync check
    useEffect(() => {

        // 2. Background Refresh: Wait until Auth is ready OR we have a session to avoid 401s
        if (!authLoading && !initialFetchAttempted.current) {
            initialFetchAttempted.current = true;
            // Add a small safety delay to ensure the session is fully applied to the adapter
            setTimeout(() => {
                fetchAll(false);
            }, 500);
        }

        // Restore cooldown timer if still active
        startCooldown();

        return () => {
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        };
    }, [authLoading, fetchAll, startCooldown]);

    const refresh = useCallback(async (tanks?: Tank[]) => {
        if (!canRefresh) return;
        await fetchAll(true, tanks);
    }, [canRefresh, fetchAll]);

    const acknowledgeArticle = useCallback((url: string) => {
        setAcknowledgedUrls(prev => {
            const next = new Set(prev);
            next.add(url);
            try {
                localStorage.setItem(ACK_SIGNALS_KEY, JSON.stringify(Array.from(next)));
            } catch { /* storage full */ }
            return next;
        });
    }, []);

    // Filtered view
    const filteredArticles = allArticles.filter(a => {
        if (acknowledgedUrls.has(a.url)) return false;
        if (activeSource !== 'all' && a.feedSource !== activeSource) return false;
        if (activeRegion !== 'all' && a.region !== activeRegion) return false;
        return true;
    });

    const validateAgainstEPRA = useCallback((articles: NewsArticle[], epraPrice: number) => {
        return articles.map(a => {
            const validation = validatePriceClaim(a, epraPrice);
            return {
                ...a,
                verificationStatus: validation.status === 'flagged' ? 'flagged' : a.verificationStatus,
                validationLabel: a.validationLabel || validation.label,
                isUnhighlighted: (validation as any).autoHide || false
            };
        });
    }, []);

    return {
        articles: allArticles,
        status,
        lastUpdated,
        isRefreshing,
        canRefresh,
        countdown,
        refresh,
        activeSource,
        setActiveSource,
        activeRegion,
        setActiveRegion,
        filteredArticles,
        validateAgainstEPRA,
        acknowledgeArticle,
    };
}
