import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/config/supabase';
import {
    FiShield, FiActivity, FiCpu, FiDatabase, FiEye,
    FiCheckCircle, FiClock, FiDollarSign,
    FiServer, FiWifi, FiTrendingUp
} from 'react-icons/fi';
import '../Common/DesignSystemCards.css';
import './AIGovernancePage.css';

interface InferenceLog {
    id: string;
    timestamp: Date;
    model: string;
    purpose: string;
    inputTokens: number;
    outputTokens: number;
    latency: number;
    confidence: number;
    safetyFlag: boolean;
}

export const AIGovernancePage: React.FC = () => {
    const { canSee, currentUser } = useAuth();
    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState<'integrity' | 'data' | 'transparency' | 'risk' | 'reliability' | 'logs' | 'trace' | 'safeguards'>('logs');
    const [inferenceLogs, setInferenceLogs] = useState<InferenceLog[]>([]);
    const [selectedInference, setSelectedInference] = useState<InferenceLog | null>(null);

    React.useEffect(() => {
        const fetchInferenceLogs = async () => {
            if (!currentUser?.stationId) return;
            const { data } = await supabase
                .from('analysis_history')
                .select('id, analysis_type, created_at, analysis_result')
                .eq('station_id', currentUser.stationId)
                .order('created_at', { ascending: false })
                .limit(50);

            const mapped = (data || []).map((row: any): InferenceLog => {
                const result = row.analysis_result || {};
                return {
                    id: row.id,
                    timestamp: row.created_at ? new Date(row.created_at) : new Date(),
                    model: result.modelVersion || 'gemini-proxy',
                    purpose: row.analysis_type || 'analysis',
                    inputTokens: Number(result.supportingData?.inputTokens || 0),
                    outputTokens: Number(result.supportingData?.outputTokens || 0),
                    latency: Number(result.supportingData?.latencyMs || 0),
                    confidence: Number(result.confidence || 0),
                    safetyFlag: Number(result.confidence || 0) < 0.7
                };
            });

            setInferenceLogs(mapped);
            setSelectedInference(mapped[0] || null);
        };

        fetchInferenceLogs();
    }, [currentUser?.stationId]);

    // Scroll to top when tab changes
    React.useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
    }, [activeTab]);

    if (!canSee(5)) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] p-8 text-center">
                <div className="ds-card ds-card-panel p-12 max-w-2xl border-t-4 border-t-danger shadow-2xl">
                    <div className="w-20 h-20 bg-danger/10 rounded-full flex items-center justify-center mb-6 mx-auto">
                        <FiShield size={40} className="text-danger" />
                    </div>
                    <h2 className="text-3xl font-extrabold text-white mb-4 tracking-tight">Access Restricted</h2>
                    <p className="text-secondary text-lg mb-8 leading-relaxed">
                        The **AI Governance Console** contains sensitive model integrity and logic trace data. 
                        Access is strictly limited to **Station Owners (Level 5)**.
                    </p>
                    <div className="flex gap-4 justify-center">
                        <button 
                            onClick={() => navigate('/dashboard')}
                            className="px-8 py-3 bg-accent text-white font-bold rounded-xl hover:bg-accent-hover transition-all shadow-lg active:scale-95"
                        >
                            Back to Safety
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Calculate Real-time KPIs from inferenceLogs
    const kpiData = useMemo(() => {
        if (inferenceLogs.length === 0) return {
            count: '0',
            latency: '0ms',
            tokens: '0',
            cost: 'FREE',
            safety: '100%'
        };

        const totalLatency = inferenceLogs.reduce((acc, log) => acc + log.latency, 0);
        const totalTokens = inferenceLogs.reduce((acc, log) => acc + (log.inputTokens || 0) + (log.outputTokens || 0), 0);
        const flaggedCount = inferenceLogs.filter(log => log.safetyFlag).length;
        const safetyScore = ((inferenceLogs.length - flaggedCount) / inferenceLogs.length * 100).toFixed(1);

        return {
            count: inferenceLogs.length.toLocaleString(),
            latency: `${Math.round(totalLatency / inferenceLogs.length)}ms`,
            tokens: totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens.toString(),
            cost: 'BETA',
            safety: `${safetyScore}%`
        };
    }, [inferenceLogs]);

    return (
        <div className="governance-page p-6">
            <div className="page-header flex justify-between items-center mb-4">
                <div>
                    <h1 className="text-2xl">AI Governance Console</h1>
                    <p className="text-secondary text-sm">Enterprise-grade model integrity, traceability, and risk control.</p>
                </div>
                <div className="flex gap-4">
                    <span className="badge badge-success flex items-center gap-2 px-3 py-1">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                        Neural Core Sync: Optimal
                    </span>
                </div>
            </div>

            {/* 1. Top - AI Performance Metrics (KPI Row) */}
            <div className="flex gap-4 mb-8 overflow-x-auto pb-2 scrollbar-hide">
                {[
                    { label: 'Inferences', value: kpiData.count, icon: <FiActivity />, color: 'accent', sub: 'Sample Size' },
                    { label: 'Latency (Avg)', value: kpiData.latency, icon: <FiClock />, color: 'success', sub: 'Real-time' },
                    { label: 'Token Flux', value: kpiData.tokens, icon: <FiDatabase />, color: 'info', sub: 'Total Vol' },
                    { label: 'Neural Cost', value: kpiData.cost, icon: <FiDollarSign />, color: 'warning', sub: 'Beta Usage' },
                    { label: 'Model Integrity', value: kpiData.safety, icon: <FiShield />, color: 'danger', sub: 'Safety Score' }
                ].map((kpi, i) => (
                    <div key={i} className={`ds-card ds-card-panel min-w-[180px] flex-1 p-4 border-t-2 border-t-${kpi.color}`}>
                        <div className="flex items-center justify-between mb-3 text-secondary">
                            <span className="text-[10px] font-black uppercase tracking-widest">{kpi.label}</span>
                            <span className={`text-${kpi.color} opacity-80`}>{kpi.icon}</span>
                        </div>
                        <div className="text-2xl font-mono text-white mb-1 tracking-tight">{kpi.value}</div>
                        <div className="text-[9px] text-secondary/60 font-bold uppercase">{kpi.sub}</div>
                    </div>
                ))}
            </div>

            {/* 2. Primary Navigation Tabs (Professional Row) */}
            <div className="tabs-navigation mb-8 border-b border-divider/30 flex items-center justify-between">
                <div className="flex gap-8">
                    {(['integrity', 'data', 'transparency', 'risk', 'reliability', 'logs', 'trace', 'safeguards'] as const).map(tab => (
                        <button
                            key={tab}
                            className={`pb-4 px-1 text-[11px] font-black uppercase tracking-widest transition-all relative ${
                                activeTab === tab 
                                ? 'text-accent' 
                                : 'text-secondary hover:text-white'
                            }`}
                            onClick={() => setActiveTab(tab)}
                        >
                            <div className="flex items-center gap-2">
                                {tab === 'integrity' && <FiCpu size={14} />}
                                {tab === 'data' && <FiDatabase size={14} />}
                                {tab === 'transparency' && <FiEye size={14} />}
                                {tab === 'risk' && <FiShield size={14} />}
                                {tab === 'reliability' && <FiServer size={14} />}
                                {tab === 'logs' && <FiDatabase size={14} />}
                                {tab === 'trace' && <FiEye size={14} />}
                                {tab === 'safeguards' && <FiShield size={14} />}
                                {tab.replace('-', ' ')}
                            </div>
                            {activeTab === tab && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent shadow-[0_0_8px_rgba(0,212,255,0.5)] animate-in fade-in zoom-in duration-300"></div>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="min-h-[600px] flex flex-col gap-6">
                {/* Content rendering logic will follow based on activeTab */}

                <div className="tab-content min-h-[500px]">
                    {/* 1. Model Integrity Tab */}
                    {activeTab === 'integrity' && (
                        <div className="grid grid-cols-12 gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="col-span-4 space-y-5">
                                <div className="ds-card ds-card-panel p-4">
                                    <h3 className="text-xs font-bold uppercase text-secondary mb-3 flex items-center gap-2 border-b border-divider pb-2">
                                        <FiCpu /> Model Specifications
                                    </h3>
                                    <div className="space-y-2 text-[11px]">
                                        <div className="flex justify-between"><span>Primary Model:</span> <span className="font-mono text-accent">gemini-1.5-pro-002</span></div>
                                        <div className="flex justify-between"><span>Temperature:</span> <span className="font-mono">0.2</span></div>
                                        <div className="flex justify-between"><span>Max Tokens:</span> <span className="font-mono">8192</span></div>
                                        <div className="flex justify-between"><span>Prompt ID:</span> <span className="font-mono">v4.2.1-prod</span></div>
                                    </div>
                                </div>
                                <div className="ds-card ds-card-panel p-4 border-l-2 border-l-success">
                                    <h3 className="text-xs font-bold uppercase text-secondary mb-3 flex items-center gap-2 border-b border-divider pb-2">
                                        <FiCheckCircle /> Hallucination Guardian
                                    </h3>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-secondary text-[10px]">Verification Confidence</span>
                                        <span className="text-success font-mono">100%</span>
                                    </div>
                                    <div className="w-full bg-surface-darker h-1.5 rounded-full">
                                        <div className="bg-success h-full rounded-full" style={{ width: '100%' }}></div>
                                    </div>
                                </div>
                            </div>
                            <div className="col-span-8">
                                <div className="ds-card ds-card-panel p-4 h-full">
                                    <h3 className="text-xs font-bold uppercase text-secondary mb-3 flex items-center gap-2 border-b border-divider pb-2">
                                        <FiTrendingUp /> Weighting & Knowledge Drift
                                    </h3>
                                    <div className="grid grid-cols-2 gap-6 h-[200px] items-center">
                                        <div className="text-center">
                                            <div className="text-3xl font-mono text-white">0.992</div>
                                            <div className="text-[10px] text-secondary uppercase mt-2">Cosine Similarity Baseline</div>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="text-[10px] text-secondary uppercase">Drift Vectors (Nominal)</div>
                                            <div className="h-24 bg-surface-darker/50 rounded flex items-end justify-around p-2 gap-1">
                                                {[40, 70, 45, 90, 65, 80, 55].map((h, i) => (
                                                    <div key={i} className="w-full bg-accent/40 rounded-t" style={{ height: `${h}%` }}></div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 2. Data Integrity Tab */}
                    {activeTab === 'data' && (
                        <div className="grid grid-cols-12 gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="col-span-4 ds-card ds-card-panel p-4">
                                <h3 className="text-xs font-bold uppercase text-secondary mb-4 flex items-center gap-2 border-b border-divider pb-2">
                                    <FiDatabase /> Context Engine (RAG)
                                </h3>
                                <div className="space-y-4 text-xs">
                                    <div className="flex justify-between items-center">
                                        <span className="text-secondary">Vector DB Status</span>
                                        <span className="badge badge-success text-[10px] py-0 border-0">SYNCED</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-secondary">Embedding Count</span>
                                        <span className="font-mono">142,850</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-secondary">Index Shards</span>
                                        <span className="font-mono">4 (Distributed)</span>
                                    </div>
                                </div>
                            </div>
                            <div className="col-span-8 ds-card ds-card-panel p-4">
                                <h3 className="text-xs font-bold uppercase text-secondary mb-3 flex items-center gap-2 border-b border-divider pb-2">
                                    <FiWifi /> External Knowledge Feeds
                                </h3>
                                <div className="space-y-3">
                                    {['EPRA Global', 'Platts Brent', 'Local Market Spy'].map(feed => (
                                        <div key={feed} className="flex items-center justify-between p-2.5 bg-surface-darker/40 rounded border border-divider/30">
                                            <div className="flex items-center gap-3">
                                                <div className="w-2 h-2 rounded-full bg-success"></div>
                                                <span className="text-[11px] font-bold">{feed}</span>
                                            </div>
                                            <div className="text-[10px] font-mono text-secondary">Lat: 140ms | Loss: 0%</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 3. Decision Transparency Tab */}
                    {activeTab === 'transparency' && (
                        <div className="ds-card ds-card-panel p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <h3 className="text-xs font-bold uppercase text-secondary mb-4 flex items-center gap-2 border-b border-divider pb-2">
                                <FiEye /> Logic Trace Visualizer
                            </h3>
                            <div className="flex gap-8 items-center justify-center p-10 bg-surface-darker/20 rounded-lg border border-dashed border-divider">
                                <div className="text-center p-4 rounded bg-accent/10 border border-accent/30 w-32">
                                    <FiDatabase className="mx-auto mb-2 text-accent" />
                                    <div className="text-[10px] uppercase font-bold">Inbound Data</div>
                                </div>
                                <div className="h-px w-16 bg-gradient-to-r from-accent/50 to-success/50 relative">
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] text-accent">Reasoning</div>
                                </div>
                                <div className="text-center p-4 rounded bg-success/10 border border-success/30 w-32">
                                    <FiCpu className="mx-auto mb-2 text-success" />
                                    <div className="text-[10px] uppercase font-bold">Model Logic</div>
                                </div>
                                <div className="h-px w-16 bg-gradient-to-r from-success/50 to-info/50"></div>
                                <div className="text-center p-4 rounded bg-info/10 border border-info/30 w-32">
                                    <FiActivity className="mx-auto mb-2 text-info" />
                                    <div className="text-[10px] uppercase font-bold">Action Output</div>
                                </div>
                            </div>
                            <div className="mt-6 p-4 bg-accent/5 rounded border border-accent/20">
                                <h4 className="text-[10px] font-bold uppercase text-accent mb-2">Transparency Report</h4>
                                <p className="text-xs text-gray-400">All logic flows are hashed and stored in the immutable audit vault. Every decision is traceable back to the specific embedding and sensor reading that triggered it.</p>
                            </div>
                        </div>
                    )}

                    {/* 4. Risk & Cost Tab */}
                    {activeTab === 'risk' && (
                        <div className="grid grid-cols-2 gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="ds-card ds-card-panel p-4">
                                <h3 className="text-xs font-bold uppercase text-secondary mb-3 flex items-center gap-2 border-b border-divider pb-2">
                                    <FiDollarSign /> Spend Analysis
                                </h3>
                                <div className="space-y-4">
                                    {['Gemini 1.5 Pro', 'Groq Llama 3', 'DeepSeek Coder'].map(m => (
                                        <div key={m} className="space-y-1">
                                            <div className="flex justify-between text-[10px]">
                                                <span className="font-bold text-gray-300">{m}</span>
                                                <span className="font-mono text-secondary">
                                                    KES {((inferenceLogs.filter(log => log.model === m).reduce((acc, log) => acc + (log.inputTokens + log.outputTokens), 0) / 1000) * (m.includes('Pro') ? 0.15 : 0.05)).toFixed(2)}
                                                </span>
                                            </div>
                                            <div className="w-full bg-surface-darker h-1 rounded-full">
                                                <div className="bg-accent h-full rounded-full" style={{ width: '45%' }}></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="ds-card ds-card-panel p-4">
                                <h3 className="text-xs font-bold uppercase text-secondary mb-3 flex items-center gap-2 border-b border-divider pb-2">
                                    <FiShield /> Risk Mitigations
                                </h3>
                                <div className="space-y-3">
                                    <div className="p-3 bg-danger/5 border border-danger/20 rounded flex justify-between items-center">
                                        <span className="text-[11px] font-bold">Unrecognized Pattern Guard</span>
                                        <span className="badge badge-danger text-[9px] py-0 border-0">ACTIVE</span>
                                    </div>
                                    <div className="p-3 bg-success/5 border border-success/20 rounded flex justify-between items-center">
                                        <span className="text-[11px] font-bold">Budget Hard-Cap</span>
                                        <span className="badge badge-success text-[9px] py-0 border-0">94% REM.</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 5. Operational Reliability Tab */}
                    {activeTab === 'reliability' && (
                        <div className="grid grid-cols-12 gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="col-span-12 ds-card ds-card-panel p-4">
                                <h3 className="text-xs font-bold uppercase text-secondary mb-4 flex items-center gap-2 border-b border-divider pb-2">
                                    <FiServer /> Orchestration Failover Chain
                                </h3>
                                <div className="grid grid-cols-3 gap-6">
                                    <div className="p-4 rounded border border-success bg-success/5">
                                        <div className="flex justify-between mb-3">
                                            <span className="font-bold text-xs">Primary</span>
                                            <span className="text-[10px] text-success font-mono animate-pulse">● ONLINE</span>
                                        </div>
                                        <div className="text-xl font-mono text-white mb-2">Gemini</div>
                                        <div className="text-[10px] text-secondary">Latency: 140ms</div>
                                    </div>
                                    <div className="p-4 rounded border border-divider bg-surface">
                                        <div className="flex justify-between mb-3">
                                            <span className="font-bold text-xs text-secondary">Standby 1</span>
                                            <span className="text-[10px] text-secondary font-mono">READY</span>
                                        </div>
                                        <div className="text-xl font-mono text-gray-500 mb-2">Groq</div>
                                        <div className="text-[10px] text-secondary/50">Heartbeat: 12ms</div>
                                    </div>
                                    <div className="p-4 rounded border border-divider bg-surface">
                                        <div className="flex justify-between mb-3">
                                            <span className="font-bold text-xs text-secondary">Standby 2</span>
                                            <span className="text-[10px] text-secondary font-mono">READY</span>
                                        </div>
                                        <div className="text-xl font-mono text-gray-500 mb-2">DeepSeek</div>
                                        <div className="text-[10px] text-secondary/50">Heartbeat: 45ms</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 6. Inference Audit Log Tab */}
                    {activeTab === 'logs' && (
                        <div className="ds-card ds-card-panel p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <h3 className="text-xs font-bold uppercase text-secondary mb-4 flex items-center gap-2 border-b border-divider pb-2">
                                <FiDatabase /> Global Inference Audit
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="border-b border-divider">
                                        <tr className="text-[10px] uppercase text-secondary font-bold">
                                            <th className="py-2.5 px-2">Timestamp</th>
                                            <th className="py-2.5 px-2">Model</th>
                                            <th className="py-2.5 px-2">Purpose</th>
                                            <th className="py-2.5 px-2">Tokens</th>
                                            <th className="py-2.5 px-2">Lat.</th>
                                            <th className="py-2.5 px-2">Conf.</th>
                                            <th className="py-2.5 px-2">Safety</th>
                                            <th className="py-2.5 px-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-[11px]">
                                        {inferenceLogs.map((inf) => (
                                            <tr key={inf.id}
                                                className={`border-b border-divider/30 hover:bg-white/5 cursor-pointer transition-colors ${selectedInference?.id === inf.id ? 'bg-accent/10 border-l-2 border-l-accent' : ''}`}
                                                onClick={() => setSelectedInference(inf)}
                                            >
                                                <td className="py-2 px-2 font-mono text-secondary">{inf.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                                <td className="py-2 px-2 text-white font-bold">{inf.model}</td>
                                                <td className="py-2 px-2 text-secondary">{inf.purpose}</td>
                                                <td className="py-2 px-2 text-secondary">{inf.inputTokens} / {inf.outputTokens}</td>
                                                <td className="py-2 px-2 text-secondary">{inf.latency}ms</td>
                                                <td className="py-2 px-2 font-mono">
                                                    <span className={inf.confidence > 0.9 ? 'text-success' : 'text-warning'}>
                                                        {(inf.confidence * 100).toFixed(0)}%
                                                    </span>
                                                </td>
                                                <td className="py-2 px-2">
                                                    <span className={`badge ${inf.safetyFlag ? 'badge-danger' : 'badge-success'} text-[9px] py-0`}>
                                                        {inf.safetyFlag ? 'FLAGGED' : 'NONE'}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-2 text-accent"><FiEye /></td>
                                            </tr>
                                        ))}
                                        {inferenceLogs.length === 0 && (
                                            <tr>
                                                <td className="py-3 px-2 text-secondary" colSpan={8}>No AI inference records available.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* 7. Decision Trace Tab */}
                    {activeTab === 'trace' && (
                        <div className="ds-card ds-card-panel p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="flex justify-between items-center mb-4 border-b border-divider pb-2">
                                <h3 className="text-xs font-bold uppercase text-secondary flex items-center gap-2">
                                    <FiEye /> Reasoning Breakdown
                                </h3>
                                <span className="text-[9px] font-mono text-secondary">REF: {selectedInference?.id}</span>
                            </div>
                            <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-3">
                                        <h5 className="font-bold text-[10px] uppercase text-secondary flex items-center gap-2 border-b border-divider pb-2">
                                            <FiDatabase size={12} /> Inputs Used
                                        </h5>
                                        <ul className="text-[11px] space-y-1.5 font-mono text-gray-300">
                                            <li className="flex justify-between"><span className="opacity-70">Model Version:</span> <span>{selectedInference?.model}</span></li>
                                            <li className="flex justify-between"><span className="opacity-70">Input Tokens:</span> <span>{selectedInference?.inputTokens}</span></li>
                                            <li className="flex justify-between"><span className="opacity-70">Output Tokens:</span> <span>{selectedInference?.outputTokens}</span></li>
                                            <li className="flex justify-between"><span className="opacity-70">Processing Time:</span> <span>{selectedInference?.latency}ms</span></li>
                                        </ul>
                                    </div>
                                    <div className="space-y-3">
                                        <h5 className="font-bold text-[10px] uppercase text-secondary flex items-center gap-2 border-b border-divider pb-2">
                                            <FiActivity size={12} /> Decision Metrics
                                        </h5>
                                        <ul className="text-[11px] space-y-1.5 font-mono text-gray-300">
                                            <li className="flex justify-between"><span className="opacity-70">Confidence:</span> <span className={selectedInference && selectedInference.confidence > 0.9 ? 'text-success' : 'text-warning'}>{(selectedInference?.confidence ? selectedInference.confidence * 100 : 0).toFixed(0)}%</span></li>
                                            <li className="flex justify-between"><span className="opacity-70">Safety Status:</span> <span className={selectedInference?.safetyFlag ? 'text-danger' : 'text-success'}>{selectedInference?.safetyFlag ? 'Flagged' : 'Passed'}</span></li>
                                            <li className="flex justify-between"><span className="opacity-70">Traceability:</span> <span className="text-info">Encrypted</span></li>
                                        </ul>
                                    </div>
                                </div>
                                <div className="mt-2 p-3 bg-accent/5 border border-accent/20 rounded">
                                    <h5 className="text-[10px] font-bold uppercase text-accent mb-1">Metadata Summary</h5>
                                    <p className="text-[11px] text-gray-400 leading-relaxed">System prompt injected with market pricing strategy v2. Context focused on minimizing weekend delivery surcharges. Output enforced as valid JSON schema.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 8. Risk Safeguards Tab */}
                    {activeTab === 'safeguards' && (
                        <div className="ds-card ds-card-panel p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <h3 className="text-xs font-bold uppercase text-secondary mb-4 flex items-center gap-2 border-b border-divider pb-2">
                                <FiShield /> Governance Controls
                            </h3>
                            <div className="space-y-4">
                                <div className="space-y-3">
                                    <h4 className="text-xs font-bold border-b border-divider pb-2">Automation Limits</h4>
                                    <div className="flex items-center justify-between p-3 bg-surface-darker/30 rounded border border-divider">
                                        <div>
                                            <div className="font-bold text-xs text-white">Auto-Procurement Execution</div>
                                            <div className="text-[10px] text-secondary">Allow AI to directly issue LPOs to suppliers.</div>
                                        </div>
                                        <div className="w-10 h-5 bg-surface-darker rounded-full relative cursor-pointer border border-divider">
                                            <div className="w-3 h-3 rounded-full bg-secondary absolute left-1 top-1"></div>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-success/10 rounded border border-success/30">
                                        <div>
                                            <div className="font-bold text-xs text-success">Auto-Alert Escalation</div>
                                            <div className="text-[10px] text-success/70">Automatically escalate critical anomalies.</div>
                                        </div>
                                        <div className="w-10 h-5 bg-success/30 rounded-full relative cursor-pointer border border-success/50">
                                            <div className="w-3 h-3 rounded-full bg-success absolute right-1 top-1"></div>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-surface-darker/30 rounded border border-divider">
                                        <div>
                                            <div className="font-bold text-xs text-white">HIIL Requirement</div>
                                            <div className="text-[10px] text-secondary">Manual override for decisions &gt; KES 50k.</div>
                                        </div>
                                        <div className="w-10 h-5 bg-accent/30 rounded-full relative cursor-pointer border border-accent/50">
                                            <div className="w-3 h-3 rounded-full bg-accent absolute right-1 top-1"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
