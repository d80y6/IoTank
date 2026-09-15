/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useCallback } from 'react';
import { GeminiInsight } from '@/types';
import { useConfig } from '@/contexts/ConfigContext';
import { useMarketIntelligence } from './useMarketIntelligence';
import { useTanks } from './useSupabase';
import { IntelligenceAIService } from '@/services/IntelligenceAIService';
import { generateTankAwareInsights } from '@/utils/tankAwareIntelligence';
import { logger } from '@/utils/logger';

/**
 * Hook to fetch AI insights for a specific tank with integrated market intelligence and failover
 */
export function useGeminiInsights(stationId: string, tankId?: string) {
    const { geminiConfig, groqConfig, deepSeekConfig } = useConfig();
    const { signals, risks, notices } = useMarketIntelligence(stationId);
    const { tanks } = useTanks(stationId);
    const [insights, setInsights] = useState<GeminiInsight[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchInsights = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const service = new IntelligenceAIService({
                gemini: geminiConfig ? { apiKey: geminiConfig.apiKey } : undefined,
                groq: groqConfig ? { apiKey: groqConfig.apiKey } : undefined,
                deepseek: deepSeekConfig ? { apiKey: deepSeekConfig.apiKey } : undefined
            });

            // Use tank-aware intelligence generation
            const tankAwareInsights = await generateTankAwareInsights(tanks, signals, risks, notices, service);
            setInsights(tankAwareInsights);
        } catch (err) {
            logger.error('[useGeminiInsights] Error fetching AI insights (Failover exhausted):', err);
            setError(err as Error);
            setInsights([]);
        } finally {
            setLoading(false);
        }
    }, [stationId, tankId, geminiConfig, groqConfig, deepSeekConfig, signals, risks, notices, tanks]);

    useEffect(() => {
        if (stationId) {
            fetchInsights();
        }
    }, [stationId, fetchInsights]);

    return { insights, loading, error, refetch: fetchInsights };
}

