import { FiExternalLink, FiClock, FiRss, FiCheck } from 'react-icons/fi';
import React, { useMemo } from 'react';
import { useMarketNews, VERIFIED_AI_SOURCES } from '@/hooks/useMarketNews';
import { useAuth } from '@/hooks/useAuth';
import { useTanks } from '@/hooks/useSupabase';
import { generateTacticalDirective } from '@/utils/directiveEngine';
import { useNavigate } from 'react-router-dom';
import '../Common/DesignSystemCards.css';
import './MarketLens.css';

interface MarketLensProps {
    stationId: string;
}

export const MarketLens: React.FC<MarketLensProps> = () => {
    const { currentUser } = useAuth();
    const stationId = currentUser?.stationId || '00000000-0000-0000-0000-000000000000';
    const { tanks } = useTanks(stationId);
    const { filteredArticles, status, acknowledgeArticle } = useMarketNews();
    const loading = status === 'loading';
    const navigate = useNavigate();

    const handleCardClick = () => {
        navigate('/market?tab=news');
    };

    // Safe URL parsing to prevent component crashes on malformed links
    const getSafeHostname = (url: string | undefined) => {
        try {
            if (!url) return 'google.com';
            return new URL(url).hostname;
        } catch {
            return 'google.com';
        }
    };

    // Filter Logic: Only Verified Sources and specific categories.
    const displayedArticles = useMemo(() => {
        if (!filteredArticles) return [];
        return filteredArticles.filter(a => 
            VERIFIED_AI_SOURCES.includes(a.feedSource.toUpperCase()) &&
            (a.implicationCategory === 'Price' || 
             a.implicationCategory === 'Political' || 
             a.implicationCategory === 'Compliance' ||
             a.implicationCategory === 'Supply' ||
             a.implicationCategory === 'Logistics')
        );
    }, [filteredArticles]);

    const handleAcknowledge = (url: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        acknowledgeArticle(url);
    };

    return (
        <div className="market-lens-container ds-premium-card">
            <div className="market-lens-header">
                <div className="market-lens-title-group">
                    <div className="market-lens-icon">
                        <FiRss size={18} />
                    </div>
                    <div>
                        <h3 className="market-lens-title">Intelligence Feed</h3>
                        <p className="market-lens-subtitle">Real-time Commodity Signals</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="signals-count-badge">
                        {displayedArticles.length} SIGNALS
                    </div>
                    <div className="market-lens-badge">
                        Live
                    </div>
                </div>
            </div>

            <div className="market-feed-scroll custom-scrollbar">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-48 space-y-3">
                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-indigo-500 border-t-transparent"></div>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Scanning Markets...</span>
                    </div>
                ) : displayedArticles.length > 0 ? (
                    displayedArticles.map((signal, idx) => {
                        const directive = generateTacticalDirective(signal, tanks);
                        return (
                            <div 
                                key={signal.id || idx} 
                                className="market-item animate-in fade-in slide-in-from-right duration-500 cursor-pointer hover:border-accent/30 transition-all" 
                                style={{ animationDelay: `${idx * 100}ms` }}
                                onClick={handleCardClick}
                            >
                                <div className="market-item-main">
                                    <div className="market-item-header">
                                        <div className="flex items-center gap-2">
                                            <div className="relative w-3.5 h-3.5 flex items-center justify-center">
                                                <img 
                                                    src={`https://www.google.com/s2/favicons?domain=${getSafeHostname(signal.url)}&sz=32`} 
                                                    alt="" 
                                                    className="w-full h-full rounded-sm grayscale group-hover:grayscale-0 transition-all object-contain"
                                                    onError={(e) => { 
                                                        const target = e.target as HTMLImageElement;
                                                        target.style.display = 'none';
                                                        const fallback = target.nextElementSibling as HTMLElement;
                                                        if (fallback) fallback.style.display = 'flex';
                                                    }}
                                                />
                                            </div>
                                            <span className="market-item-source">{signal.attribution || signal.source}</span>
                                        </div>
                                        <div className="market-item-time">
                                            <FiClock size={10} />
                                            {new Date(signal.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>

                                    {/* Premium TankIQ Recommendation Stamping */}
                                    <div className={`market-lens-recommendation-box market-lens-recommendation-box--${directive.status.toLowerCase()}`}>
                                        <div className="market-lens-rec-header">
                                            <span className="rec-badge">TANKIQ RECOMMENDATION</span>
                                            <span className={`status-badge status-badge--${directive.status.toLowerCase()}`}>
                                                {directive.status}
                                            </span>
                                        </div>
                                        <p className="rec-text">{directive.recommendation}</p>
                                        <p className="rec-action"><strong>ACTION:</strong> {directive.actionDetails}</p>
                                    </div>

                                    <div className="market-item-source-title">
                                        <span className="source-label">SOURCE NEWS</span>
                                        <h4 className="market-item-title">{signal.title}</h4>
                                    </div>

                                    <div className="market-item-footer" onClick={(e) => e.stopPropagation()}>
                                        <a 
                                            href={signal.url} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            className="market-item-link"
                                        >
                                            Source Report <FiExternalLink size={10} />
                                        </a>
                                        <button 
                                            onClick={(e) => handleAcknowledge(signal.url, e)}
                                            className="market-item-ack-btn group"
                                            title="Dismiss Intelligence"
                                        >
                                            <FiCheck size={14} className="group-hover:text-green-500 transition-colors" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-10 animate-fade-in">
                        <div className="relative mb-8">
                            {/* Radar Rings */}
                            <div className="absolute inset-0 bg-indigo-500/20 rounded-full animate-ping duration-[3000ms]" />
                            <div className="absolute -inset-4 bg-indigo-500/5 rounded-full animate-pulse" />
                            
                            <div className="relative p-6 bg-white border border-indigo-50 shadow-xl rounded-3xl z-10">
                                <FiRss size={32} className="text-indigo-600 animate-pulse" />
                            </div>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="flex flex-col items-center gap-1">
                                <span className="bg-indigo-50 text-indigo-700 text-[9px] font-black px-2.5 py-1 rounded-md uppercase tracking-widest border border-indigo-100">
                                    Scanning Network
                                </span>
                                <h5 className="text-sm font-black text-slate-800 tracking-tight">Satellite Sync Active</h5>
                            </div>
                            
                            <div className="flex items-center justify-center gap-2 py-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '200ms' }} />
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '400ms' }} />
                            </div>
                        </div>

                        <div className="mt-8 pt-6 border-t border-slate-50 w-full flex flex-col items-center opacity-40">
                            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400 italic">Monitoring Commodity Parities</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
