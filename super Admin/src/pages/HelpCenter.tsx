import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { helpCenterService, KnowledgeArticle } from '../services/helpCenterService';
import { 
    FiSearch, FiBook, FiShield, FiActivity, 
    FiSettings, FiHelpCircle, FiChevronRight, 
    FiMessageSquare, FiExternalLink, FiFileText,
    FiZap, FiDownload, FiLoader, FiChevronDown
} from 'react-icons/fi';
import './HelpCenter.css';

const HELP_CATEGORIES = [
    {
        id: 'onboarding',
        title: 'Platform Onboarding',
        desc: 'Quickstart guides for new administrative staff and organization setup.',
        icon: <FiZap />
    },
    {
        id: 'telemetry',
        title: 'Telemetry & IoT Logistics',
        desc: 'Advanced sensor documentation, calibration engine, and tank monitoring.',
        icon: <FiActivity />
    },
    {
        id: 'security',
        title: 'Security & RBAC',
        desc: 'Managing permissions, access levels, and security event forensics.',
        icon: <FiShield />
    },
    {
        id: 'billing',
        title: 'Financial Governance',
        desc: 'Understanding the billing engine, immutable ledgers, and revenue reports.',
        icon: <FiBook />
    },
    {
        id: 'compliance',
        title: 'Regulatory & Compliance',
        desc: 'Regulatory standards, tax integration, and automated compliance checks.',
        icon: <FiFileText />
    },
    {
        id: 'support',
        title: 'Advanced Support',
        desc: 'Technical troubleshooting and developer-level console utilities.',
        icon: <FiSettings />
    }
];

const HelpCenter: React.FC<{ isHubView?: boolean }> = ({ isHubView }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
    const [loading, setLoading] = useState(true);
    const [searching, setSearching] = useState(false);
    const [expandedArticle, setExpandedArticle] = useState<string | null>(null);
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

    useEffect(() => {
        const fetchInitialData = async () => {
            setLoading(true);
            try {
                const data = await helpCenterService.getArticles();
                setArticles(data);
            } catch (err) {
                console.error("Knowledge Sync Error:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchInitialData();
    }, []);

    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            if (searchQuery.length > 2) {
                setSearching(true);
                const results = await helpCenterService.searchArticles(searchQuery);
                setArticles(results);
                setSearching(false);
            } else if (searchQuery.length === 0) {
                const data = await helpCenterService.getArticles();
                setArticles(data);
            }
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [searchQuery]);

    const content = (
        <div className="help-center-page animate-fade-in">
                <header className="dp-header">
                    <div className="dp-title-group">
                        <h1 className="lowercase">administrative resource suite</h1>
                        <div className="dp-subtitle">Strategic Platform Intelligence Documentation & Support Terminal</div>
                    </div>
                </header>

                <section className="help-search-hub">
                    <h2 className="lowercase">how can we assist your mission?</h2>
                    <div className="help-search-bar">
                        {searching ? <FiLoader className="help-search-icon animate-spin" /> : <FiSearch className="help-search-icon" />}
                        <input 
                            type="text" 
                            placeholder="Search documentation, metadata, or recovery procedures..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </section>

                <section className="help-category-grid">
                    {HELP_CATEGORIES.map(cat => (
                        <div key={cat.id} className="help-category-card" onClick={() => helpCenterService.getArticles(cat.id).then(setArticles)}>
                            <div className="category-icon-box">{cat.icon}</div>
                            <h3>{cat.title}</h3>
                            <p>{cat.desc}</p>
                        </div>
                    ))}
                </section>

                <div className="help-sections-grid">
                    <section className="popular-articles-section">
                        <h4>{searchQuery ? 'Search Results' : 'Trending intelligence articles'}</h4>
                        <div className="space-y-3">
                            {loading ? (
                                <div className="p-8 text-center opacity-40 text-xs font-black uppercase tracking-widest">Synchronizing Articles...</div>
                            ) : articles.length === 0 ? (
                                <div className="p-8 text-center opacity-40 text-xs font-black uppercase tracking-widest">No matching articles found</div>
                            ) : (
                                articles.map((article, i) => (
                                    <div
                                        key={article.id || i}
                                        className="help-article-row group"
                                        style={expandedArticle === article.id ? { flexDirection: 'column', alignItems: 'stretch' } : undefined}
                                        onClick={() => setExpandedArticle(expandedArticle === article.id ? null : article.id)}
                                    >
                                        <div className="flex items-center justify-between w-full">
                                            <div className="flex items-center gap-4">
                                                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-all">
                                                    <FiFileText />
                                                </div>
                                                <div>
                                                    <span className="article-title">{article.title}</span>
                                                    <div className="text-[10px] font-bold opacity-30 uppercase">{article.category} • {article.views} views • {article.helpful_count} helpful</div>
                                                </div>
                                            </div>
                                            {expandedArticle === article.id ? <FiChevronDown className="opacity-40" /> : <FiChevronRight className="opacity-40 group-hover:translate-x-1 transition-all" />}
                                        </div>
                                        {expandedArticle === article.id && (
                                            <div className="mt-4 pt-4 border-t border-slate-100 text-xs font-semibold text-slate-500 leading-relaxed whitespace-pre-wrap w-full">
                                                {article.content || 'No detail available for this article.'}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </section>

                    <aside className="support-sidebar">
                        <div className="support-contact-card">
                            <h4 className="lowercase">need engineering support?</h4>
                            <p>Direct priority line to IoTank platform specialists for critical infrastructure resolution.</p>
                            <a href="/support" className="btn-support-action">
                                <FiMessageSquare /> Raise Priority Ticket
                            </a>
                            <div className="mt-8 pt-8 border-t border-white/10 space-y-4">
                                <a href="../../Documentation/PROJECT_SPEC.md" target="_blank" rel="noreferrer" className="flex items-center gap-3 text-[10px] font-black uppercase text-slate-400 hover:text-emerald-400 transition-all">
                                    <FiDownload />
                                    <span>System Manifest PDF</span>
                                </a>
                                <a href={supabaseUrl ? `${supabaseUrl}/rest/v1/` : '/help'} target="_blank" rel="noreferrer" className="flex items-center gap-3 text-[10px] font-black uppercase text-slate-400 hover:text-emerald-400 transition-all">
                                    <FiExternalLink />
                                    <span>Platform Developer API Docs</span>
                                </a>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
    );

    if (isHubView) return content;
    return <Layout>{content}</Layout>;
};

export default HelpCenter;

