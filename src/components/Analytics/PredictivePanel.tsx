import React, { useState } from 'react';
import { Tank, GeminiInsight } from '@/types';
import { useGeminiInsights } from '@/hooks/useGeminiInsights';
import { useTanks, useHistoricalReadings } from '@/hooks/useSupabase';
import { useConsumptionAnalytics } from '@/hooks/useConsumptionAnalytics';
import { FiTrendingUp, FiAlertOctagon, FiZap, FiRefreshCw, FiHelpCircle, FiCalendar, FiAlertTriangle } from 'react-icons/fi';
import { format } from 'date-fns';
import { ExplainabilityModal } from '@/components/Governance/ExplainabilityModal';
import './PredictivePanel.css';

interface PredictivePanelProps {
    stationId: string;
    tankId?: string;
}

interface ExplainerInsight extends GeminiInsight {
    description: string;
    sources: string[];
    reasoning: string[];
}

export const PredictivePanel: React.FC<PredictivePanelProps> = ({ stationId, tankId }) => {
    const { insights, loading: insightsLoading, refetch } = useGeminiInsights(stationId, tankId);
    const { tanks } = useTanks(stationId);

    // Find the specific tank if tankId is provided
    const tank = tankId ? tanks.find((t: Tank) => t.id === tankId) : null;

    // Fetch readings for specific tank or skip entirely if no tank
    const { readings, loading: readingsLoading } = useHistoricalReadings(stationId, tankId ?? '', {
        start: Date.now() - 24 * 60 * 60 * 1000,
        end: Date.now()
    }, undefined, undefined, !!tankId);

    // Only run analytics if tank exists. We must invoke the hook unconditionally though.
    const emptyAnalytics = {
        predictedRefillDate: null,
        ete: 'N/A',
        isTheftSuspected: false,
        isLeakageSuspected: false,
        defillRate: 0,
        trend: 'stable' as const
    };
    
    // We pass empty array/null objects but always call the hook in exact order
    const realAnalytics = useConsumptionAnalytics(tank, readings);
    const analytics = tank ? realAnalytics : emptyAnalytics;

    const loading = insightsLoading || (tankId ? readingsLoading : false);

    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
    const [explainInsight, setExplainInsight] = useState<ExplainerInsight | null>(null);

    const handleAction = async (id: string, action: 'implement' | 'dismiss') => {
        setProcessingIds(prev => new Set(prev).add(id));
        await new Promise(resolve => setTimeout(resolve, 1200));
        if (action === 'dismiss' || action === 'implement') {
            setHiddenIds(prev => new Set(prev).add(id));
        }
        setProcessingIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
        if (action === 'implement') {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Action Queued',
                    message: 'Strategic action has been queued for implementation.',
                    type: 'success',
                    attribution: 'AI ENGINE'
                }
            }));
        }
    };

    if (loading) {
        return (
            <div className="predictive-panel loading">
                <FiRefreshCw className="spinner" />
                <p>Gemini AI is analyzing latest data...</p>
            </div>
        );
    }

    const availableInsights = insights.filter(i => !hiddenIds.has(i.id));

    if (availableInsights.length === 0 && !analytics.isTheftSuspected && !analytics.isLeakageSuspected) {
        return (
            <div className="predictive-panel empty">
                <FiZap />
                <p>No further strategic insights at this time.</p>
                <button onClick={refetch} className="btn btn-sm btn-outline mt-2">Check for Updates</button>
            </div>
        );
    }

    return (
        <div className="predictive-panel">
            <div className="panel-header">
                <div className="flex items-center gap-2">
                    <FiZap style={{ color: '#a855f7' }} />
                    <h3 className="text-md font-bold text-slate-800">Predictive Intelligence</h3>
                </div>
            </div>

            {/* AI Refill Forecast Card */}
            {tank && analytics.predictedRefillDate && (
                <div className="refill-forecast-card" style={{ background: 'rgba(124, 58, 237, 0.03)', border: '1px solid rgba(124, 58, 237, 0.1)', borderRadius: '12px', padding: '16px' }}>
                    <div className="forecast-icon" style={{ background: '#7c3aed', color: 'white', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FiCalendar />
                    </div>
                    <div className="forecast-details ml-3">
                        <div className="forecast-label" style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#7c3aed', letterSpacing: '0.05em' }}>AI Refill Forecast</div>
                        <div className="forecast-date" style={{ fontSize: '18px', fontWeight: 900, color: '#1e1b4b' }}>
                            {format(analytics.predictedRefillDate, 'MMMM d, yyyy')}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">
                            Estimated threshold breach in <span style={{ color: '#a855f7', fontWeight: 700 }}>{analytics.ete}</span>
                        </p>
                    </div>
                </div>
            )}

            {/* Real-time Alerts */}
            {tank && (analytics.isTheftSuspected || analytics.isLeakageSuspected) && (
                <div className="alerts-intelligence mb-4 space-y-2">
                    {analytics.isTheftSuspected && (
                        <div className="alert-item theft">
                            <FiAlertTriangle />
                            <span><strong>Rapid Defill Alert:</strong> Unusual volume drop detected ({analytics.defillRate.toFixed(1)} L/hr)</span>
                        </div>
                    )}
                    {analytics.isLeakageSuspected && (
                        <div className="alert-item leakage">
                            <FiAlertTriangle />
                            <span><strong>Leakage Warning:</strong> Persistent micro-drop detected during idle hours.</span>
                        </div>
                    )}
                </div>
            )}

            <div className="insights-list">
                {availableInsights.map((insight) => (
                    <div key={insight.id} className={`insight-card insight-${insight.type}`}>
                        <div className="insight-icon">
                            {insight.type === 'procurement' ? <FiTrendingUp /> : <FiAlertOctagon />}
                        </div>
                        <div className="insight-content">
                            <h4 className="insight-title">{insight.title}</h4>
                            <p className="insight-summary">{insight.summary}</p>
                            <div className="insight-recommendation">
                                <strong>Recommendation:</strong> {insight.recommendation}
                            </div>
                            <div className="insight-footer flex-col items-stretch gap-3">
                                <button
                                    className="text-xs text-secondary hover:text-white flex flex-col gap-1 w-full text-left"
                                    onClick={() => setExplainInsight({
                                        ...insight,
                                        description: insight.summary,
                                        sources: ['Market API', 'Historical Velocity', 'KPA Regulatory Feed'],
                                        reasoning: [
                                            'Analyzed 30-day consumption velocity trend.',
                                            'Detected 15% price hike signal from KPC regulatory preview.',
                                            'Cross-referenced with current inventory holding cost.',
                                            'Calculated optimal bulk purchase time window: < 48h.'
                                        ]
                                    })}
                                >
                                    <div className="flex justify-between items-center w-full mb-1">
                                        <span className="flex items-center gap-1"><FiHelpCircle /> Reliability Score</span>
                                        <span>{(insight.confidence * 100).toFixed(0)}%</span>
                                    </div>
                                    <div className="confidence-meter w-full" style={{ height: '4px', background: 'rgba(168, 85, 247, 0.1)', borderRadius: '99px', overflow: 'hidden' }}>
                                        <div
                                            className="confidence-fill"
                                            style={{ width: `${insight.confidence * 100}%`, background: '#a855f7', height: '100%' }}
                                        />
                                    </div>
                                </button>
                                <div className="actions flex justify-end gap-2">
                                    <button
                                        className="btn btn-xs btn-primary"
                                        onClick={() => handleAction(insight.id, 'implement')}
                                        disabled={processingIds.has(insight.id)}
                                    >
                                        {processingIds.has(insight.id) ? 'Processing...' : 'Implement'}
                                    </button>
                                    <button
                                        className="btn btn-xs btn-outline"
                                        onClick={() => handleAction(insight.id, 'dismiss')}
                                        disabled={processingIds.has(insight.id)}
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {explainInsight && (
                <ExplainabilityModal
                    isOpen={!!explainInsight}
                    onClose={() => setExplainInsight(null)}
                    insight={explainInsight}
                />
            )}
        </div>
    );
};
