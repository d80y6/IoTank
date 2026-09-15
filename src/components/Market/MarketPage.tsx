/* eslint-disable @typescript-eslint/no-explicit-any, no-unused-vars */
import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
    FiActivity,
    FiGlobe,
    FiAlertCircle,
    FiAlertTriangle,
    FiShield,
    FiTrendingUp,
    FiExternalLink,
    FiSearch,
    FiRefreshCw,
    FiBookmark,
    FiWifiOff,
    FiClock,
    FiCheckCircle,
    FiX,
    FiTrash2,
    FiArchive,
    FiInfo,
} from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { useTanks, updateTank } from '@/hooks/useSupabase';
import { useMarketIntelligence } from '@/hooks/useMarketIntelligence';
import { useGeminiInsights } from '@/hooks/useGeminiInsights';
import { useMarketNews, NewsArticle } from '@/hooks/useMarketNews';
import { STRATEGIC_CAPABILITIES, OPERATIONAL_BOUNDARIES } from './MarketConstants';
import { calculateCommandOverviewMetrics } from '@/utils/strategicIntelligence';
import { TelemetryErrorBoundary, useTelemetryErrorHandling } from '@/components/Common/TelemetryErrorBoundary';
import { supabase } from '@/config/supabase';
import '../Common/DesignSystemCards.css';
import './MarketPage.css';
import officialBadge from '../../assets/images/official-badge.png';
import { FiCpu } from 'react-icons/fi';
import { NotificationService } from '@/services/NotificationService';
import { generateTacticalDirective } from '@/utils/directiveEngine';
import { logger } from '@/utils/logger';

/**
 * Clean up HTML entities like &nbsp; or &amp; from RSS strings safely
 */
const decodeHTMLEntities = (text: string) => {
    if (!text) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    return doc.body.textContent || "";
};

// ─── Small helper components ──────────────────────────────────────────────────

const PriorityBadge: React.FC<{ score: number }> = ({ score }) => {
    if (score > 0.90) return <span className="mi-pill mi-pill--high">HIGH PRIORITY</span>;
    if (score > 0.6) return <span className="mi-pill mi-pill--med">MEDIUM</span>;
    return <span className="mi-pill mi-pill--normal">NORMAL</span>;
};

const RegionChip: React.FC<{ region: 'Kenya' | 'Global' }> = ({ region }) => (
    <span className={`mi-pill mi-pill--${(region || 'Global').toLowerCase()}`}>{region || 'Global'}</span>
);

// ─── News Card ────────────────────────────────────────────────────────────────

const NewsCard: React.FC<{
    article: NewsArticle;
    onBookmark: (a: NewsArticle) => void;
    bookmarked: Set<string>;
    isArchive?: boolean;
    onDelete?: (id: string) => void;
    onIgnore?: (id: string) => void;
    tanks?: any[];
}> = ({ article, onBookmark, bookmarked, isArchive, onDelete, onIgnore, tanks }) => {
    const [expanded, setExpanded] = useState(false);
    const isHighPriority = (article.relevanceScore ?? 0) > 0.90;
    const isBookmarked = bookmarked.has(article.id);
    
    // Check if within 48 hours for "RECENT" badge
    const isRecent = (Date.now() - article.timestamp) < (48 * 60 * 60 * 1000);

    const timeAgo = () => {
        const diff = Date.now() - article.timestamp;
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins} Min`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs} Hrs`;
        const days = Math.floor(hrs / 24);
        return `${days} Day${days > 1 ? 's' : ''}`;
    };

    const isUnverified = article.verificationStatus === 'flagged' || !article.isCorroborated;

    return (
        <div className={`mi-news-card ${isHighPriority ? 'mi-news-card--high' : ''} ${article.verificationStatus === 'flagged' ? 'mi-news-card--flagged' : ''}`}>
            {/* Top severity strap */}
            <div className={`mi-news-top-strap mi-news-top-strap--${
                article.verificationStatus === 'flagged' ? 'flagged' :
                (article.relevanceScore ?? 0) > 0.90 ? 'high' : 
                (article.relevanceScore ?? 0) > 0.6 ? 'med' : 'normal'
            }`} />

            <div className="mi-news-body">
                {/* Header Metadata Row */}
                <div className="mi-news-header-row mb-1">
                    <div className="mi-news-pill-group flex-1">
                        <RegionChip region={article.region} />
                        {!isUnverified && <PriorityBadge score={article.relevanceScore ?? 0} />}
                        
                        {isRecent && !isArchive && <span className="mi-pill bg-emerald-500 text-white font-bold px-2 py-0.5 rounded text-[8px]">RECENT</span>}
                        {isArchive && <span className="mi-pill mi-pill--archive">ARCHIVED</span>}
                        <span className="mi-pill mi-pill--impact">{article.implicationCategory} STRATEGIC IMPACT</span>
                    </div>
                    <div className="mi-news-pill-group ml-auto items-center">
                        {article.isOfficial && (
                            <img 
                                src={officialBadge} 
                                alt="Official" 
                                className="mi-official-badge-icon"
                                title="Official Regulatory Source"
                            />
                        )}
                        <span className="mi-pill mi-pill--source">
                            {article.feedSource}
                        </span>
                        <span className="mi-pill mi-pill--time">
                            {timeAgo()}
                        </span>
                    </div>
                </div>

                <div className="mi-news-content-layout">
                    {/* Main Content (Left) */}
                    <div className="mi-news-main-content">
                        <div className="cursor-pointer" onClick={() => setExpanded(e => !e)}>
                            <h3 className="mi-news-title">
                                {decodeHTMLEntities(article.title)}
                            </h3>
                            {article.summary && (decodeHTMLEntities(article.summary) || '').toLowerCase() !== (decodeHTMLEntities(article.title) || '').toLowerCase() && (
                                <p className="mi-news-summary line-clamp-2">
                                    {decodeHTMLEntities(article.summary)}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Relevance Sidebar (Middle Right) */}
                    <div className="mi-relevance-sidebar">
                        <div className="mi-relevance-sidebar-label">STRATEGIC IMPACT</div>
                        <span className="mi-relevance-sidebar-percentage">
                            {Math.round((article.relevanceScore ?? 0) * 100)}%
                        </span>
                        <div className="mi-relevance-sidebar-bar">
                            <div 
                                className={`mi-relevance-sidebar-fill mi-relevance-sidebar-fill--${
                                    (article.relevanceScore ?? 0) > 0.90 ? 'high' : 
                                    (article.relevanceScore ?? 0) > 0.6 ? 'med' : 'normal'
                                }`} 
                                style={{ width: `${Math.max(15, (article.relevanceScore ?? 0) * 100)}%` }}
                            />
                        </div>
                        {(article.relevanceScore ?? 0) > 0.6 && (
                            <div className="mt-2 flex items-center justify-end gap-1 opacity-80">
                                <div className="w-1.5 h-1.5 rounded-full bg-[#00D4FF] animate-pulse" />
                            </div>
                        )}
                    </div>
                </div>

                {/* Expanded: Intelligence Briefing OVERHAUL */}
                {expanded && (
                    <div className="mi-briefing-panel animate-in fade-in slide-in-from-top-2 duration-300">

                        {/* Section 1: Briefing */}
                        <div className="mi-briefing-section mb-3">
                            <div className="mi-section-header mb-1">
                                <FiInfo size={12} className="text-accent" />
                                <span className="uppercase tracking-widest text-[9px] font-black">Briefing</span>
                            </div>
                            <p className="mi-briefing-text text-[11px] leading-snug text-[#4A4A65]">
                                {(() => {
                                    const brief = decodeHTMLEntities(article.briefingSummary || article.summary || '');
                                    const title = decodeHTMLEntities(article.title);
                                    // If brief is just the title, don't show it or show something more useful
                                    if (!brief || brief.toLowerCase() === (title || '').toLowerCase()) {
                                        return article.topicTags.length > 0 
                                            ? `Strategic analysis of ${article.topicTags.join(', ')} market signals. Impacts ${article.implicationCategory.toLowerCase()} operations.`
                                            : "Analyzing market volatility and regulatory shifts for tactical station response.";
                                    }
                                    return brief;
                                })()}
                            </p>
                        </div>

                        {/* Section 2: Operational Directives — PREMIUM REDESIGN */}
                        <div className="mi-directive-premium-card">
                            <div className="mi-directive-header">
                                <FiCpu size={14} className="text-accent" />
                                <span className="uppercase tracking-widest text-[9px] font-black text-[#323264]">TankIQ AI Operational Directive</span>
                            </div>
                            
                            {(() => {
                                const directive = generateTacticalDirective(article, tanks || []);
                                const status = directive.status;
                                const colorClass = directive.colorClass;
                                const icon = status === 'CRITICAL' ? <FiAlertCircle /> : status === 'CAUTION' ? <FiAlertTriangle /> : <FiCheckCircle />;
                                
                                return (
                                    <div className={`mi-directive-content ${colorClass}`}>
                                        <div className="mi-directive-status-row">
                                            <span className="mi-directive-icon">{icon}</span>
                                            <span className="mi-directive-status-label">DIRECTIVE: {status}</span>
                                        </div>
                                        <p className="mi-directive-body">{directive.recommendation}</p>
                                        <div className="mi-directive-action">
                                            <span className="font-black mr-2">ACTION:</span> {directive.actionDetails}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {!article.isCorroborated && (
                            <div className="mi-validation-banner mi-validation-banner--warn mt-2">
                                <FiAlertTriangle size={10} />
                                <span>Intelligence Note: Single-source signal. External validation required.</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Action Footer */}
                <div className="mi-news-footer mt-2 pt-2 border-t border-[#F8F9FF]">
                    <div className="mi-news-actions">
                        <button
                            className="mi-action-btn-outline"
                            onClick={() => setExpanded(e => !e)}
                            title={expanded ? 'Minimize intelligence briefing' : 'Analyze article intelligence signals'}
                        >
                            <FiActivity size={12} />
                            {expanded ? 'Close' : 'Analyze'}
                        </button>
                        <button
                            className={`mi-action-btn-outline ${isBookmarked ? 'mi-action-btn-outline--active' : ''}`}
                            onClick={() => onBookmark(article)}
                            title={isBookmarked ? 'Signal already bookmarked' : 'Save signal to forensic archive'}
                        >
                            <FiBookmark size={12} />
                            {isBookmarked ? 'Saved' : 'Bookmark'}
                        </button>
                        
                        {(isUnverified || article.verificationStatus === 'flagged') && onIgnore && (
                            <button
                                className="mi-action-btn-outline mi-action-btn-outline--ignore"
                                onClick={() => onIgnore(article.url)}
                                title="Dismiss as non-critical noise"
                            >
                                <FiTrash2 size={12} />
                                Mark as Noise
                            </button>
                        )}

                        {/* Archive specific delete button */}
                        {isArchive && onDelete && (
                            <button
                                className="mi-action-btn-outline mi-action-btn-outline--delete"
                                onClick={() => onDelete(article.url)}
                                title="Permanently purge this item from archive"
                            >
                                <FiTrash2 size={12} />
                                Purge
                            </button>
                        )}
                        {article.externalUrl && (
                            <a
                                href={article.externalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mi-external-link ml-2"
                                title="Open Full Article Source"
                            >
                                <FiExternalLink size={16} />
                            </a>
                        )}
                    </div>

                    {/* Impact Chip - Moved to Action Row Footer */}
                    <div className="mi-pill mi-pill--category">
                        {article.implicationCategory} IMPACT
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Status Banners ───────────────────────────────────────────────────────────

const StatusBanner: React.FC<{
    type: 'no-signal' | 'cached-stale' | 'source-unavailable';
    onRetry?: () => void;
    onDismiss: () => void;
    isSyncing?: boolean;
}> = ({ type, onRetry, onDismiss, isSyncing }) => {
    if (type === 'no-signal') return (
        <div className="mi-banner mi-banner--error">
            <div className="flex items-center gap-2 flex-1">
                <FiWifiOff size={14} className={isSyncing ? "animate-pulse text-[#FF4560]" : ""} />
                <span><strong>No signal.</strong> All news sources are unreachable. Showing fallback data.</span>
            </div>
            {onRetry && (
                <button 
                    className="mi-banner-btn flex items-center gap-1.5" 
                    onClick={onRetry} 
                    disabled={isSyncing}
                    title="Attempt to reconnect to market news sources"
                >
                    <FiRefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
                    {isSyncing ? 'Scanning...' : 'Retry'}
                </button>
            )}
            <button className="mi-banner-dismiss" onClick={onDismiss} title="Dismiss this connectivity warning"><FiX size={12} /></button>
        </div>
    );
    if (type === 'cached-stale') {
        return (
            <div className="mi-banner mi-banner--warn">
                <div className="flex items-center gap-2 flex-1">
                    <FiClock size={14} className={isSyncing ? "animate-pulse text-[#FEB019]" : ""} />
                    <span><strong>Sync Mode: Offline-First.</strong> Showing persisted intelligence data.</span>
                </div>
                {onRetry && (
                    <button 
                        className="mi-banner-btn flex items-center gap-1.5" 
                        onClick={onRetry} 
                        disabled={isSyncing}
                        title="Force refresh from source news feeds"
                    >
                        <FiRefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
                        {isSyncing ? 'Scanning...' : 'Sync Now'}
                    </button>
                )}
                <button className="mi-banner-dismiss" onClick={onDismiss} title="Dismiss stale cache warning"><FiX size={12} /></button>
            </div>
        );
    }
    return (
        <div className="mi-banner mi-banner--warn">
            <div className="flex items-center gap-2 flex-1">
                <FiAlertCircle size={14} />
                <span><strong>One or more sources unavailable.</strong> Displaying partial results.</span>
            </div>
            <button className="mi-banner-dismiss" onClick={onDismiss} title="Dismiss partial source warning"><FiX size={12} /></button>
        </div>
    );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const MarketPage: React.FC = () => {
    const { currentUser } = useAuth();
    const location = useLocation();
    const stationId = currentUser?.stationId || '00000000-0000-0000-0000-000000000000'; // Prevents PostgREST UUID syntax error during provisional boot

    // Existing hooks (keep metrics & insights)
    const { signals, risks, prices, actionQueue, completeAction, loading: marketLoading, refetch } = useMarketIntelligence(stationId);
    const { tanks } = useTanks(stationId);
    const { insights } = useGeminiInsights(stationId);

    const {
        status: newsStatus,
        isRefreshing,
        canRefresh,
        refresh,
        filteredArticles,
        validateAgainstEPRA,
        acknowledgeArticle,
    } = useMarketNews();

    // Bookmarks & Persistence
    const [bookmarked, setBookmarked] = useState<Set<string>>(new Set());
    const [bookmarkFeedback, setBookmarkFeedback] = useState<string | null>(null);



    const [bannerDismissed, setBannerDismissed] = useState(false);
    const [confirmingAction, setConfirmingAction] = useState<any>(null);

    // [INTELLIGENCE SYNC NOTIFICATION]: Promote stale cache warning to global toast + browser notification
    useEffect(() => {
        if (newsStatus === 'cached-stale' && !bannerDismissed) {
            // 1. Dispatch High-Visibility System Toast
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Intelligence Sync: Offline-First',
                    message: 'Network signal weak. Displaying persisted market data. Refresh when connection stabilizes.',
                    type: 'warning',
                    persistent: false
                }
            }));

            // 2. Trigger Native Browser Notification
            if (NotificationService.isEnabled()) {
                NotificationService.show('IoTank: Offline Sync Mode', {
                    body: 'Showing cached market data due to connection issues.',
                    tag: 'market-sync-stale'
                });
            }
        }
    }, [newsStatus, bannerDismissed]);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'med'>('all');
    const [fuelFilter, setFuelFilter] = useState<string>('all');

    // Tab logic
    const [activeTab, setActiveTab] = useState<'news' | 'outlook' | 'archive'>('news');

    // Thresholds
    const LIFESPAN_DAYS = 7;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const ARCHIVE_THRESHOLD = LIFESPAN_DAYS * MS_PER_DAY;

    // Dynamic Fuel Types from Tanks
    const registeredFuelTypes = React.useMemo(() => {
        const types = new Set<string>();
        tanks.forEach((t: import('@/types').Tank) => {
            if (t.fuelType) {
                // Normalize e.g. gasoline -> Petrol, diesel -> Diesel
                let label = t.fuelType.charAt(0).toUpperCase() + t.fuelType.slice(1).toLowerCase();
                if (label === 'Gasoline') label = 'Petrol';
                types.add(label);
            }
        });
        return Array.from(types).sort();
    }, [tanks]);



    // Deep-linking from notifications
    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        const tabParam = queryParams.get('tab');
        if (tabParam && ['news', 'analytics', 'strategy', 'archive'].includes(tabParam)) {
            setActiveTab(tabParam as any);
        }
    }, [location.search]);

    // Strategic intelligence metrics
    const metrics = useTelemetryErrorHandling(
        () => calculateCommandOverviewMetrics(signals, tanks, risks),
        {
            signalIntegrity: { score: 0, status: 'PARTIAL_BLACKOUT' as const, activeSources: 0, totalSources: 15, dataFreshness: 'Stale', crossVerification: 0 },
            marketSentiment: { score: 50, label: 'Neutral' as const, momentum: 'stable' as const, confidence: 'Low' as const, sourceAgreement: 0, totalSources: 0 },
            systemLatency: { score: 999, status: 'degraded' as const, breakdown: { newsFetch: 999, aiProcessing: 999, dashboardUpdate: 999 } },
            tankRiskOverlay: { score: 0, level: 'LOW_STRATEGIC_RISK' as const, timeToEmpty: 999, marketVolatility: 0, supplyRisk: 0, recommendation: 'System error — check telemetry' },
            strategicConfidence: { score: 0, level: 'Low' as const, sourceAgreement: 0, signalClarity: 'Low', historicalAccuracy: 0 },
        },
        'Strategic Intelligence Metrics Calculation'
    );

    // Bookmark handler
    const handleBookmark = useCallback(async (article: NewsArticle) => {
        if (bookmarked.has(article.id)) return;
        setBookmarked(prev => new Set([...prev, article.id]));
        setBookmarkFeedback(`"${article.title.substring(0, 40)}…" saved`);
        setTimeout(() => setBookmarkFeedback(null), 2500);
        try {
            const { error } = await supabase
                .from('market_bookmarks')
                .insert({
                    station_id: stationId,
                    title: article.title,
                    url: article.externalUrl || null,
                    source: article.feedSource,
                    published_at: new Date(article.timestamp).toISOString(),
                });
            if (error) throw error;
        } catch (err) {
            logger.warn('[Market] Bookmark save failed:', err);
        }
    }, [bookmarked, stationId]);

    // Ignore handler
    const handleIgnoreNews = useCallback((url: string) => {
        acknowledgeArticle(url);
    }, [acknowledgeArticle]);

    // Delete handler
    const handleDeleteNews = useCallback((url: string) => {
        acknowledgeArticle(url);
    }, [acknowledgeArticle]);

    // ─── Data Split Logic ───
    
    const { verifiedFeed, unverifiedFeed, archiveFeed } = React.useMemo(() => {
        const now = Date.now();
        
        // Find latest EPRA price for validation (Diesel/AGO is most common reference)
        const epraLatest = prices.find(p => p.fuelType === 'AGO' || p.source === 'epra')?.pricePerLiter || 0; // Use cached value or 0

        const mappedSignals: NewsArticle[] = signals.map(s => ({
            ...s,
            region: (s as any).region || (((s.title || '').toLowerCase().includes('kenya') || (s.source ?? '').toLowerCase().includes('kenya')) ? 'Kenya' : 'Global'),
            topicTags: (s as any).topicTags || [],
            implicationCategory: (s as any).implicationCategory || 'General',
            briefingSummary: (s as any).briefingSummary || s.summary,
            feedSource: s.attribution || s.source || 'Intelligence',
            verificationStatus: 'verified' as const,
            confidenceScore: s.confidenceScore ?? 0.85,
            url: (s as any).url || (s as any).externalUrl || '',
        }));

        const combined = [...filteredArticles, ...mappedSignals];
        
        // Apply EPRA Validation
        const validated = validateAgainstEPRA(combined, epraLatest);

        // Deduplicate
        const seenIds = new Set<string>();
        const processed = validated.filter(a => {
            if (seenIds.has(a.id)) return false;
            // Acknowledged items are already filtered by the useMarketNews hook in filteredArticles.

            // Fuel Filter
            if (fuelFilter !== 'all') {
                const searchStr = ((a.title || '') + ' ' + (a.summary || '')).toLowerCase();
                const matchesFuel = searchStr.includes(fuelFilter.toLowerCase()) || 
                                   (a as any).topicTags?.some((t: string) => t.toLowerCase() === fuelFilter.toLowerCase());
                if (!matchesFuel) return false;
            }

            seenIds.add(a.id);
            return true;
        });

        // Split by 7 days to archive and 14 days to purge
        const verified: NewsArticle[] = [];
        const unverified: NewsArticle[] = [];
        const archived: NewsArticle[] = [];
        const PURGE_THRESHOLD = 14 * MS_PER_DAY;

        processed.forEach(a => {
            const age = now - a.timestamp;
            if (age > PURGE_THRESHOLD) {
                // Purged after 14 days: exclude entirely from display
            } else if (age > ARCHIVE_THRESHOLD) {
                archived.push(a);
            } else {
                const isUnverified = a.verificationStatus === 'flagged' || !a.isCorroborated;
                if (isUnverified) {
                    unverified.push(a);
                } else if ((a.relevanceScore ?? 0) >= 0.6) {
                    verified.push(a);
                } else {
                    archived.push(a); // Low relevance verified news goes to archive
                }
            }
        });

        return {
            verifiedFeed: verified.sort((a, b) => b.timestamp - a.timestamp),
            unverifiedFeed: unverified.sort((a, b) => b.timestamp - a.timestamp),
            archiveFeed: archived.sort((a, b) => b.timestamp - a.timestamp)
        };
    }, [filteredArticles, signals, ARCHIVE_THRESHOLD, prices, validateAgainstEPRA]);

    // Search & Filter application
    const filterList = (list: NewsArticle[]) => {
        return list.filter(a => {
            if (searchTerm) {
                const q = (searchTerm || '').toLowerCase();
                if (!(a.title || '').toLowerCase().includes(q) && !(a.summary || '').toLowerCase().includes(q)) return false;
            }
            if (priorityFilter === 'high' && (a.relevanceScore ?? 0) <= 0.90) return false;
            if (priorityFilter === 'med' && ((a.relevanceScore ?? 0) <= 0.6 || (a.relevanceScore ?? 0) > 0.90)) return false;
            return true;
        });
    };

    const currentDisplayList = activeTab === 'archive' ? filterList(archiveFeed) : filterList(verifiedFeed);
    const currentUnverifiedList = activeTab === 'archive' ? [] : filterList(unverifiedFeed);
    
    // [TankIQ Strategy Integration]
    // Harvest actionable directives from articles and merge into the strategy insights
    const allActionableArticles = [...verifiedFeed, ...unverifiedFeed]
        .filter(a => a.aiDirective?.actionRequired)
        .map(a => ({
            id: `article-action-${a.id}`,
            type: 'procurement' as any,
            title: `SIGNAL ACTION: ${a.aiDirective?.status}`,
            summary: a.title,
            recommendation: a.aiDirective?.recommendation || 'Operational response required.',
            timestamp: a.timestamp,
            confidence: a.aiDirective?.confidence || 0.9,
            modelVersion: 'TankIQ-Signal-Insight',
            supportingData: { article: a }
        }));

    const mergedInsights = [...insights, ...allActionableArticles].sort((a, b) => b.timestamp - a.timestamp);

    const procurementAdvisories = mergedInsights.filter(i => i.type === 'procurement');
    const showBanner = !bannerDismissed && (newsStatus === 'no-signal' || newsStatus === 'cached-stale');

    return (
        <TelemetryErrorBoundary>
            <div className="market-page max-w-7xl mx-auto">

                {/* ── Tactical Command Header ── */}
                <header className="market-header mb-8">
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-6">
                        <div>
                            <h1 className="text-2xl md:text-4xl font-black text-[#323264] uppercase tracking-tight flex items-center gap-4">
                                Market Intelligence
                            </h1>
                            <p className="text-[#7A7A95] font-medium text-sm mt-3 max-w-2xl leading-relaxed">
                                Real-time operational awareness and regulatory forensic analysis for the Kenyan petroleum sector. 
                                Monitored directly from EPRA, CBK, and global energy benchmarks.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-3 items-center">
                            {/* SCANNING and EXPORT buttons removed. Manual sync available inside the status banner popup. */}
                        </div>
                    </div>

                    {/* Mission-Critical KPIs: Real Data Injection */}
                    <div className="mission-status-grid">
                        {(() => {
                            
                            // Map registered types to EPRA source keys
                            const fuelPriceCards = registeredFuelTypes.map(ft => {
                                const sourceKey = ft.toUpperCase() === 'DIESEL' ? 'AGO' : 
                                                ft.toUpperCase() === 'PETROL' ? 'PMS' : 
                                                ft.toUpperCase() === 'KEROSENE' ? 'IK' : ft;
                                
                                const priceData = prices.find(p => p.fuelType === sourceKey || p.fuelType === ft);
                                const priceValue = priceData?.pricePerLiter || 0;
                                const price = priceValue > 0 ? `KES ${priceValue.toFixed(2)}` : '---';
                                const metadata = (priceData as any)?.metadata || {};
                                const isLive = metadata.isLiveExtraction;
                                const isOfficial = metadata.isOfficial;
                                
                                const isToday = priceData?.effective_date && new Date(priceData.effective_date).toDateString() === new Date().toDateString();
                                
                                return {
                                    label: `EPRA ${ft} Price`,
                                    val: price,
                                    unit: priceValue > 0 ? '/L' : '',
                                    delta: isOfficial ? 'OFFICIAL' : (isLive ? 'LIVE SYNC' : 'VERIFIED'),
                                    up: true,
                                    sub: `${sourceKey} · ${priceData?.effective_date ? new Date(priceData.effective_date).toLocaleDateString() : 'Current cycle'}`,
                                    isLive,
                                    isOfficial,
                                    isToday
                                };
                            });

                            // Calculate OTS Cycle (Countdown to next 14th)
                            const now = new Date();
                            const next14th = new Date(now.getFullYear(), now.getMonth(), 14);
                            if (now.getDate() >= 14) next14th.setMonth(now.getMonth() + 1);
                            const daysLeft = Math.ceil((next14th.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                            const cycleStart = new Date(next14th);
                            cycleStart.setMonth(cycleStart.getMonth() - 1);
                            cycleStart.setDate(15);
                            const cycleEnd = new Date(next14th);

                            const formatMonth = (d: Date) => d.toLocaleString('default', { month: 'short' });

                            const brentData = prices.find(p => p.fuelType === 'BRENT');
                            const fxData = prices.find(p => p.fuelType === 'FX' || p.fuelType === 'GBP_KSH');

                            const brentPrice = brentData?.pricePerLiter || 0;
                            const fxPrice = fxData?.pricePerLiter || 0;

                            return [
                                { label: 'Brent Crude', val: brentPrice > 0 ? `$${brentPrice.toFixed(2)}` : '---', unit: brentPrice > 0 ? '/bbl' : '', delta: 'LIVE SYNC', up: true, sub: 'Global benchmark', isLive: (brentData as any)?.metadata?.isLiveExtraction },
                                { label: 'FX Rate', val: fxPrice > 0 ? `KES ${fxPrice.toFixed(2)}` : '---', unit: '', delta: 'LIVE SYNC', up: true, sub: 'USD/KES Spot', isLive: (fxData as any)?.metadata?.isLiveExtraction },
                                ...fuelPriceCards,
                                { label: 'OTS Cycle', val: `${daysLeft} days`, unit: '', delta: `${formatMonth(cycleStart)} 15–${formatMonth(cycleEnd)} 14`, up: true, sub: 'Next review countdown' },
                            ].map((kpi: any, idx) => (
                                <div key={idx} className={`an-kpi-card ${kpi.isLive ? 'an-kpi-card--live' : ''}`}>
                                    <div className="flex justify-between items-start mb-1">
                                        <div className="an-kpi-label">{kpi.label}</div>
                                        {kpi.isLive && (
                                            <span className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded ${kpi.isToday ? 'bg-emerald-500/10 text-emerald-400' : 'bg-cyan-500/10 text-cyan-400'} text-[9px] font-bold animate-pulse`}>
                                                <div className={`w-1 h-1 rounded-full ${kpi.isToday ? 'bg-emerald-400' : 'bg-cyan-400'}`} />
                                                {kpi.isToday ? 'UPDATED TODAY' : 'LIVE'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="an-kpi-value">{kpi.val}<span className="an-kpi-unit">{kpi.unit}</span></div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={`an-kpi-delta ${kpi.up ? 'an-kpi-delta--up' : 'an-kpi-delta--down'}`}>
                                            {kpi.up ? '▲' : '▼'} {kpi.delta}
                                        </span>
                                        <span className="an-kpi-sub">{kpi.sub}</span>
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>
                </header>

                <div className="mi-tab-bar mb-8">
                    {([
                        { id: 'news', label: 'LIVE Feed', icon: <FiGlobe size={14} />, dot: true },
                        { id: 'outlook', label: 'Strategic Outlook', icon: <FiTrendingUp size={14} />, dot: false },
                        { id: 'archive', label: 'Archive', icon: <FiArchive size={14} />, dot: false },
                    ] as const).map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`mi-tab-btn ${activeTab === tab.id ? 'mi-tab-btn--active' : ''}`}
                            title={`Switch to ${tab.label} intelligence view`}
                        >
                            <span className="mi-tab-icon">{tab.icon}</span>
                            <span className="mi-tab-label">{tab.label}</span>
                            {tab.dot && newsStatus === 'ok' && verifiedFeed.some(a => (Date.now() - a.timestamp) < 48 * 60 * 60 * 1000) && <span className="mi-tab-live-dot" />}
                        </button>
                    ))}
                </div>
                
                {/* ── Actionable Intel (Forensic Queue) ── */}
                {activeTab === 'news' && actionQueue.length > 0 && (
                    <div className="mi-action-queue-section mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                            <h2 className="text-sm font-black text-[#323264] uppercase tracking-wider">Actionable Intelligence Required</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {actionQueue.map(action => (
                                <div key={action.id} className="ds-card p-5 border-l-4 border-l-red-500 bg-white shadow-sm hover:shadow-md transition-shadow">
                                    <div className="flex justify-between items-start mb-3">
                                        <span className="text-[10px] font-black text-red-500 uppercase tracking-widest bg-red-50 px-2 py-0.5 rounded">
                                            {action.actionType.replace('_', ' ')}
                                        </span>
                                        <span className="text-[10px] text-[#7A7A95] font-bold">
                                            {new Date(action.effectiveDate).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <h3 className="text-sm font-bold text-[#323264] mb-1">
                                        Update {action.fuelType} Pump Prices
                                    </h3>
                                    <p className="text-[11px] text-[#7A7A95] mb-4 leading-relaxed">
                                        EPRA has officially revised {action.fuelType} rates to 
                                        <span className="text-[#323264] font-bold mx-1">KES {action.newPrice.toFixed(2)}</span>.
                                        Variance: {action.metadata.variance ? `${action.metadata.variance > 0 ? '+' : ''}${action.metadata.variance.toFixed(2)}` : 'N/A'}.
                                    </p>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => setConfirmingAction(action)}
                                            className="mi-action-btn-premium text-[10px] py-2 flex-1 justify-center"
                                        >
                                            Confirm Adjustment
                                        </button>
                                        {action.metadata.source_url && (
                                            <a 
                                                href={action.metadata.source_url} 
                                                target="_blank" 
                                                rel="noreferrer"
                                                className="mi-action-btn-outline px-3 py-2"
                                                title="View Official Source"
                                            >
                                                <FiExternalLink size={12} />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── LIVE Feed & Archive Views ── */}
                {(activeTab === 'news' || activeTab === 'archive') && (
                    <div className="space-y-5 animate-in slide-in-from-bottom-2 duration-300">
                        {showBanner && activeTab === 'news' && (
                            <StatusBanner
                                type={newsStatus as any}
                                onRetry={canRefresh ? () => { refresh(tanks); refetch(); } : undefined}
                                onDismiss={() => setBannerDismissed(true)}
                                isSyncing={isRefreshing || marketLoading}
                            />
                        )}

                        {bookmarkFeedback && (
                            <div className="mi-bookmark-toast">
                                <FiBookmark size={12} /> {bookmarkFeedback}
                            </div>
                        )}

                        {/* Filter toolbar */}
                        <div className="mi-filter-bar">
                            <div className="mi-search-wrap">
                                <FiSearch className="mi-search-icon" size={14} />
                                <input
                                    type="text"
                                    placeholder={activeTab === 'archive' ? "Search historical data..." : "Search live intelligence..."}
                                    className="mi-search-input"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                            </div>

                            <div className="mi-chip-row mb-3">
                                <button
                                    className={`mi-pill-btn ${fuelFilter === 'all' ? 'mi-pill-btn--active' : ''}`}
                                    onClick={() => setFuelFilter('all')}
                                >
                                    All Products
                                </button>
                                {registeredFuelTypes.map(ft => (
                                    <button
                                        key={ft}
                                        className={`mi-pill-btn ${fuelFilter === ft ? 'mi-pill-btn--active' : ''}`}
                                        onClick={() => setFuelFilter(ft)}
                                        title={`Filter signals for ${ft}`}
                                    >
                                        {ft}
                                    </button>
                                ))}
                            </div>

                            <div className="mi-chip-row border-t border-accent/5 pt-3">
                                {(['all', 'high', 'med'] as const).map(p => (
                                    <button
                                        key={p}
                                        className={`mi-pill-btn ${priorityFilter === p ? 'mi-pill-btn--active' : ''}`}
                                        onClick={() => setPriorityFilter(p)}
                                        title={`Filter signals by ${p} priority`}
                                    >
                                        {p === 'all' ? 'All Priority' : p === 'high' ? 'High' : 'Medium'}
                                    </button>
                                ))}
                            </div>
                            
                            {activeTab === 'archive' && (
                                <div className="ml-auto text-[10px] bg-amber-500/10 text-amber-600 px-3 py-1 rounded-md font-bold uppercase">
                                    Older than {LIFESPAN_DAYS}d
                                </div>
                            )}
                        </div>

                        {/* Article list */}
                        {currentDisplayList.length > 0 || currentUnverifiedList.length > 0 ? (
                            <div className="space-y-8">
                                {/* Verified Section */}
                                {currentDisplayList.length > 0 && (
                                    <div className="space-y-3">
                                        {currentDisplayList.map(article => (
                                            <NewsCard
                                                key={article.id}
                                                article={article}
                                                onBookmark={handleBookmark}
                                                bookmarked={bookmarked}
                                                isArchive={activeTab === 'archive'}
                                                onDelete={handleDeleteNews}
                                                onIgnore={handleIgnoreNews}
                                                tanks={tanks}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* Unverified Section */}
                                {currentUnverifiedList.length > 0 && (
                                    <div className="mi-unverified-section space-y-3">
                                        <div className="mi-section-divider">
                                            <FiAlertCircle size={14} className="text-amber-500" />
                                            <span>UNVERIFIED SIGNALS ({currentUnverifiedList.length})</span>
                                            <div className="mi-divider-line" />
                                        </div>
                                        
                                        <div className="mi-unverified-banner">
                                            <FiInfo size={14} />
                                            <span>The following signals are either single-source or show significant variance from official EPRA benchmark data. Useful for early intelligence but not yet confirmed.</span>
                                        </div>

                                        {currentUnverifiedList.map(article => (
                                            <NewsCard
                                                key={article.id}
                                                article={article}
                                                onBookmark={handleBookmark}
                                                bookmarked={bookmarked}
                                                isArchive={activeTab === 'archive'}
                                                onDelete={handleDeleteNews}
                                                onIgnore={handleIgnoreNews}
                                                tanks={tanks}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : newsStatus !== 'loading' && (
                            <div className="mi-empty-state">
                                <FiGlobe size={36} className="mi-empty-icon" />
                                <p className="mi-empty-title">{searchTerm ? 'No matches found' : activeTab === 'archive' ? 'Archive is empty' : 'Feed is empty'}</p>
                                <p className="mi-empty-sub">Signals beyond {LIFESPAN_DAYS} days will appear in the Archive.</p>
                            </div>
                        )}

                        {/* Loading */}
                        {newsStatus === 'loading' && currentDisplayList.length === 0 && (
                            <div className="space-y-3">
                                {[...Array(3)].map((_, i) => <div key={i} className="mi-skeleton-card" />)}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Strategic Outlook (Command Center Redesign) ── */}
                {activeTab === 'outlook' && (
                    <div className="space-y-8 animate-in slide-in-from-bottom-6 duration-700">
                        
                        {/* 1. Executive Intelligence Row */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                            {/* Primary Strategic Advisory */}
                            <div className="lg:col-span-8 relative">
                                <div className="ds-card h-full p-0 overflow-hidden border-none shadow-2xl bg-[#1A1A3A] text-white">
                                    <div className="absolute top-0 right-0 w-full h-full opacity-10 pointer-events-none">
                                        <div className="absolute top-0 right-0 w-96 h-96 bg-accent rounded-full -mr-32 -mt-32 blur-[120px]" />
                                    </div>
                                    
                                    <div className="relative z-10 h-full flex flex-col">
                                        {/* Advisory Header */}
                                        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/5 backdrop-blur-sm">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center shadow-lg shadow-accent/20">
                                                    <FiShield size={24} className="text-[#1A1A3A]" />
                                                </div>
                                                <div>
                                                    <h2 className="text-xl font-black tracking-tight">Executive Intelligence Advisory</h2>
                                                    <div className="flex items-center gap-3 mt-1">
                                                        <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-accent">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                                                            Tactical Priority: High
                                                        </span>
                                                        <div className="w-1 h-1 rounded-full bg-white/20" />
                                                        <span className="text-[9px] font-bold text-white/50 uppercase tracking-widest">Confidence: {metrics.strategicConfidence.level}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="hidden md:flex items-center gap-6">
                                                <div className="text-right">
                                                    <div className="text-[9px] font-black text-white/40 uppercase tracking-widest mb-1">Projected Savings</div>
                                                    <div className="text-2xl font-black text-accent leading-none">KES 420K</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Advisory Content */}
                                        <div className="p-8 flex-1">
                                            {procurementAdvisories.length > 0 ? (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                                    <div className="space-y-6">
                                                        <div>
                                                            <div className="text-[10px] font-black text-accent uppercase tracking-[0.2em] mb-3">Current Directive</div>
                                                            <h3 className="text-2xl font-black leading-tight mb-4">{procurementAdvisories[0].title}</h3>
                                                            <p className="text-sm text-white/70 leading-relaxed font-medium">
                                                                {procurementAdvisories[0].recommendation}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-4 pt-4">
                                                            <button className="bg-accent hover:bg-accent/90 text-[#1A1A3A] px-8 py-4 rounded-2xl font-black text-sm transition-all transform hover:scale-105 active:scale-95 shadow-xl shadow-accent/20">
                                                                Confirm Directive
                                                            </button>
                                                            <button className="p-4 rounded-2xl border border-white/10 hover:bg-white/5 transition-colors text-white/70">
                                                                <FiExternalLink size={20} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col justify-between">
                                                        <div>
                                                            <div className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-4">Strategic Metrics</div>
                                                            <div className="space-y-4">
                                                                <div className="flex justify-between items-center">
                                                                    <span className="text-xs font-bold text-white/60">Inventory Resilience</span>
                                                                    <span className="text-xs font-black text-accent">84%</span>
                                                                </div>
                                                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-accent w-[84%]" />
                                                                </div>
                                                                <div className="flex justify-between items-center pt-2">
                                                                    <span className="text-xs font-bold text-white/60">Supply Risk Exposure</span>
                                                                    <span className="text-xs font-black text-red-400">Low</span>
                                                                </div>
                                                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-red-400 w-[15%]" />
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="pt-6 mt-6 border-t border-white/5">
                                                            <div className="flex items-center gap-3">
                                                                <div className="p-2 bg-accent/10 rounded-lg">
                                                                    <FiClock className="text-accent" size={14} />
                                                                </div>
                                                                <div className="text-[10px] font-bold text-white/40">Next market review scheduled for May 14th cycle.</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="h-full flex flex-col items-center justify-center py-12">
                                                    <FiActivity size={64} className="text-accent/20 mb-6 animate-pulse" />
                                                    <h3 className="text-lg font-bold mb-2">Analyzing Signal Vectors</h3>
                                                    <p className="text-white/40 text-sm">Real-time market logic processing... No active directives detected.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Market Sentiment Summary */}
                            <div className="lg:col-span-4 space-y-6">
                                <div className="ds-card p-6 h-full flex flex-col justify-between bg-white border-[#E8E9F5]">
                                    <div>
                                        <div className="flex justify-between items-start mb-8">
                                            <div>
                                                <h3 className="text-sm font-black text-[#1A1A3A] uppercase tracking-widest">Market Sentiment</h3>
                                                <p className="text-[10px] font-bold text-[#7A7A95] mt-1">Weighted 12-Month Index</p>
                                            </div>
                                            <div className="px-3 py-1 bg-emerald-500/10 text-emerald-600 rounded-full text-[10px] font-black tracking-widest uppercase">Bullish</div>
                                        </div>
                                        
                                        <div className="an-bar-chart flex items-end justify-between gap-2 h-40 mb-8 px-2">
                                            {[45, 52, 48, 65, 78, 82, 75, 88, 92, 85, 78, 84].map((v, i) => (
                                                <div key={i} className="an-bar-col h-full flex items-end flex-1 group/bar relative">
                                                    <div 
                                                        className={`an-bar w-full rounded-t-sm transition-all duration-700 ${v > 70 ? 'an-bar--bull' : v > 55 ? 'an-bar--mid' : 'an-bar--bear'} h-${Math.round(v / 5) * 5}p hover:opacity-80`} 
                                                    />
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover/bar:opacity-100 transition-all bg-[#1A1A3A] text-white text-[9px] font-black px-2 py-1 rounded shadow-xl pointer-events-none whitespace-nowrap z-20">
                                                        Index: {v}.0
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center p-3 bg-[#F8F9FF] rounded-2xl border border-[#E8E9F5]">
                                            <span className="text-[10px] font-black text-[#7A7A95] uppercase">Annual ROI Projection</span>
                                            <span className="text-xs font-black text-[#1A1A3A]">+14.2%</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 bg-[#F8F9FF] rounded-2xl border border-[#E8E9F5]">
                                            <span className="text-[10px] font-black text-[#7A7A95] uppercase">Volatility Score</span>
                                            <span className="text-xs font-black text-amber-500">Low/Stable</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 2. Tactical Detail Row */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {/* Volatility Matrix */}
                            <div className="ds-card p-8 bg-white">
                                <div className="flex items-center justify-between mb-8">
                                    <h3 className="text-sm font-black text-[#1A1A3A] uppercase tracking-widest">Supply Stability</h3>
                                    <FiActivity className="text-red-500/40" size={16} />
                                </div>
                                <div className="grid grid-cols-7 gap-2">
                                    {[...Array(28)].map((_, i) => (
                                        <div 
                                            key={i} 
                                            className={`aspect-square rounded-md ${i % 7 === 0 ? 'bg-red-500/30' : i % 5 === 0 ? 'bg-amber-500/30' : 'bg-emerald-500/20'} hover:scale-110 transition-transform cursor-help shadow-sm`}
                                            title={`Day ${i+1}: Stability High`}
                                        />
                                    ))}
                                </div>
                                <div className="mt-8 pt-6 border-t border-[#F8F9FF] grid grid-cols-3 gap-2">
                                    <div className="text-center">
                                        <div className="w-2 h-2 rounded-full bg-red-500 mx-auto mb-1.5" />
                                        <div className="text-[8px] font-black text-[#7A7A95] uppercase">Risk</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="w-2 h-2 rounded-full bg-amber-500 mx-auto mb-1.5" />
                                        <div className="text-[8px] font-black text-[#7A7A95] uppercase">Warn</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 mx-auto mb-1.5" />
                                        <div className="text-[8px] font-black text-[#7A7A95] uppercase">Safe</div>
                                    </div>
                                </div>
                            </div>

                            {/* Guardrails Card */}
                            <div className="ds-card p-8 bg-white">
                                <div className="flex items-center justify-between mb-8">
                                    <h3 className="text-sm font-black text-[#1A1A3A] uppercase tracking-widest">Tactical Guardrails</h3>
                                    <FiShield className="text-indigo-500/40" size={16} />
                                </div>
                                <div className="space-y-4">
                                    {OPERATIONAL_BOUNDARIES.slice(0, 4).map((b, i) => (
                                        <div key={i} className="flex items-center gap-4 group">
                                            <div className="w-8 h-8 rounded-xl bg-[#F8F9FF] border border-[#E8E9F5] flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                                                <FiCheckCircle size={14} />
                                            </div>
                                            <span className="text-[11px] font-bold text-[#4A4A65] flex-1">{b}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Capabilities Stack */}
                            <div className="ds-card p-8 bg-gradient-to-br from-[#FAFBFF] to-white border-[#E8E9F5]">
                                <div className="flex items-center justify-between mb-8">
                                    <h3 className="text-sm font-black text-[#1A1A3A] uppercase tracking-widest">Intelligence Stack</h3>
                                    <FiCpu className="text-cyan-500/40" size={16} />
                                </div>
                                <div className="space-y-3">
                                    {STRATEGIC_CAPABILITIES.map((c, i) => (
                                        <div key={i} className="p-4 bg-white border border-[#E8E9F5] rounded-2xl flex items-center gap-4 shadow-sm hover:border-cyan-500/30 transition-all group">
                                            <div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]" />
                                            <span className="text-[10px] font-black text-[#7A7A95] uppercase tracking-wider">{c}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>

            {confirmingAction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="ds-card w-full max-w-lg p-6 bg-white/95 border border-white/20 shadow-2xl rounded-2xl animate-in zoom-in-95 duration-300 relative overflow-hidden">
                        {/* Top gradient glowing strap */}
                        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#00D4FF] via-[#06b6d4] to-blue-600" />
                        
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-2">
                                <FiCpu className="text-[#00D4FF] animate-pulse" size={20} />
                                <h3 className="text-base font-black text-[#323264] uppercase tracking-wider">
                                    Auto-Update Retail Price?
                                </h3>
                            </div>
                            <button 
                                onClick={() => setConfirmingAction(null)}
                                className="text-[#7A7A95] hover:text-[#323264] transition-colors p-1 rounded-full hover:bg-gray-100"
                            >
                                <FiX size={18} />
                            </button>
                        </div>

                        <div className="space-y-4 mb-6">
                            <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50/50 to-[#00D4FF]/5 border border-blue-100/50">
                                <p className="text-xs text-[#4A4A65] leading-relaxed">
                                    EPRA has revised <span className="font-bold text-[#323264]">{confirmingAction.fuelType}</span> regulated rates to <span className="font-bold text-[#323264]">KES {confirmingAction.newPrice.toFixed(2)}/L</span>.
                                </p>
                                <p className="text-[11px] text-[#7A7A95] mt-2">
                                    Do you want to automatically adjust the retail price for all <span className="font-semibold">{confirmingAction.fuelType}</span> tanks at your station to match this rate?
                                </p>
                            </div>

                            <div className="text-[11px] text-[#7A7A95] border-t border-gray-100 pt-3">
                                <span className="font-bold text-[#323264] block mb-1">Affected Tanks:</span>
                                {tanks.filter((t: any) => {
                                    const tType = t.fuelType?.toUpperCase();
                                    const aType = confirmingAction.fuelType?.toUpperCase();
                                    return tType === aType || 
                                           (tType === 'PETROL' && aType === 'PMS') || 
                                           (tType === 'DIESEL' && aType === 'AGO') || 
                                           (tType === 'KEROSENE' && aType === 'IK');
                                }).length > 0 ? (
                                    <div className="grid grid-cols-2 gap-2 mt-1">
                                        {tanks.filter((t: any) => {
                                            const tType = t.fuelType?.toUpperCase();
                                            const aType = confirmingAction.fuelType?.toUpperCase();
                                            return tType === aType || 
                                                   (tType === 'PETROL' && aType === 'PMS') || 
                                                   (tType === 'DIESEL' && aType === 'AGO') || 
                                                   (tType === 'KEROSENE' && aType === 'IK');
                                        }).map((t: any) => (
                                            <div key={t.id} className="flex justify-between items-center bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                                                <span className="font-bold text-[#323264] truncate max-w-[80px]">{t.name}</span>
                                                <span className="text-gray-400">
                                                    {t.metadata?.retailPrice ? `KES ${t.metadata.retailPrice}` : 'Not set'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="italic text-amber-600 block bg-amber-50 px-3 py-1.5 rounded-lg mt-1">
                                        No tanks configured for this fuel type.
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2">
                            <button
                                onClick={async () => {
                                    try {
                                        const targetTanks = tanks.filter((t: any) => {
                                            const tType = t.fuelType?.toUpperCase();
                                            const aType = confirmingAction.fuelType?.toUpperCase();
                                            return tType === aType || 
                                                   (tType === 'PETROL' && aType === 'PMS') || 
                                                   (tType === 'DIESEL' && aType === 'AGO') || 
                                                   (tType === 'KEROSENE' && aType === 'IK');
                                        });

                                        if (targetTanks.length > 0) {
                                            for (const t of targetTanks) {
                                                const currentMetadata = t.metadata || {};
                                                await updateTank(t.id, {
                                                    metadata: {
                                                        ...currentMetadata,
                                                        retailPrice: confirmingAction.newPrice
                                                    }
                                                });
                                            }
                                            
                                            window.dispatchEvent(new CustomEvent('system-toast', {
                                                detail: {
                                                    title: 'Retail Prices Updated',
                                                    message: `Successfully adjusted retail prices for all ${confirmingAction.fuelType} tanks to KES ${confirmingAction.newPrice.toFixed(2)}/L.`,
                                                    type: 'success'
                                                }
                                            }));

                                            const { AuditService } = await import('@/services/AuditService');
                                            await AuditService.log(
                                                'FINANCE',
                                                'PRICE_UPDATE',
                                                stationId,
                                                `Forensic Price Adjustment: Auto-updated retail prices for ${confirmingAction.fuelType} to KES ${confirmingAction.newPrice.toFixed(2)}`,
                                                'INFO',
                                                { fuelType: confirmingAction.fuelType, price: confirmingAction.newPrice, tanksCount: targetTanks.length }
                                            );
                                        }

                                        await completeAction(confirmingAction.id);
                                    } catch (err) {
                                        logger.error('[MarketPage] Retail update failed:', err);
                                        window.dispatchEvent(new CustomEvent('system-toast', {
                                            detail: {
                                                title: 'Update Failed',
                                                message: 'Could not apply automatic retail price updates to tanks.',
                                                type: 'error'
                                            }
                                        }));
                                    } finally {
                                        setConfirmingAction(null);
                                    }
                                }}
                                className="mi-action-btn-premium py-2.5 px-4 font-black justify-center flex-1"
                            >
                                Update Retail Price
                            </button>
                            <button
                                onClick={async () => {
                                    await completeAction(confirmingAction.id);
                                    setConfirmingAction(null);
                                    window.dispatchEvent(new CustomEvent('system-toast', {
                                        detail: {
                                            title: 'Adjustment Resolved',
                                            message: 'Reference prices updated, retail prices kept unchanged.',
                                            type: 'success'
                                        }
                                    }));
                                }}
                                className="bg-gray-100 hover:bg-gray-200 text-[#323264] border border-gray-200 font-bold text-xs py-2.5 px-4 rounded-xl transition-all duration-300 flex-1 justify-center flex items-center"
                            >
                                Keep Current Prices
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </TelemetryErrorBoundary>
    );
};
