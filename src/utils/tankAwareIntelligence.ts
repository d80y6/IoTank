/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Enhanced Tank-Aware Intelligence Service
 * Provides AI analytics that specifically address different tanks in the fleet
 */

import { Tank, MarketSignal, SupplyRisk, GeminiInsight } from '@/types';
import { IntelligenceAIService } from '@/services/IntelligenceAIService';
import { logger } from '@/utils/logger';

export interface TankSpecificAnalysis {
  tankId: string;
  tankName: string;
  fuelType: string;
  currentLevel: number;
  timeToEmpty: number;
  riskScore: number;
  procurementUrgency: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  recommendation: string;
  financialImpact: {
    currentPrice: number;
    projectedPrice: number;
    savingsPotential: number;
    volumeToProcure: number;
  };
  marketFactors: {
    sentiment: string;
    volatility: number;
    supplyRisks: string[];
    regulatorySignals: string[];
  };
}

export interface FleetIntelligenceSummary {
  totalTanks: number;
  criticalTanks: number;
  overallRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  fleetRecommendation: string;
  totalSavingsPotential: number;
  immediateActions: string[];
  strategicPriorities: string[];
}

/**
 * Generate tank-specific analysis for each tank in the fleet
 */
export function generateTankSpecificAnalysis(
  tanks: Tank[],
  signals: MarketSignal[],
  risks: SupplyRisk[],
  currentMarketPrice: number = 178.50
): TankSpecificAnalysis[] {
  return tanks.map(tank => {
    if (!tank) return null as any; // Safe skip

    const currentLevel = (tank as any).currentLevel ?? 50; // Default to 50% if not available
    const currentVolume = (currentLevel / 100) * (tank.capacity || 0);
    const avgConsumption = 890; // L/day average consumption
    const timeToEmpty = avgConsumption > 0 ? currentVolume / avgConsumption : 0;

    // Calculate tank-specific risk score
    let riskScore = 0;
    
    // Time pressure (50% weight)
    if (timeToEmpty < 1) riskScore += 50;
    else if (timeToEmpty < 2) riskScore += 40;
    else if (timeToEmpty < 3) riskScore += 30;
    else if (timeToEmpty < 5) riskScore += 20;
    else if (timeToEmpty < 7) riskScore += 10;
    
    // Level-based risk (30% weight)
    if (currentLevel < 15) riskScore += 30;
    else if (currentLevel < 25) riskScore += 25;
    else if (currentLevel < 35) riskScore += 15;
    else if (currentLevel < 50) riskScore += 5;
    
    // Market volatility impact (20% weight)
    const volatilityScore = calculateMarketVolatility(signals);
    riskScore += (volatilityScore / 100) * 20;

    // Determine procurement urgency
    let procurementUrgency: TankSpecificAnalysis['procurementUrgency'];
    if (timeToEmpty < 2 || currentLevel < 20) procurementUrgency = 'CRITICAL';
    else if (timeToEmpty < 4 || currentLevel < 35) procurementUrgency = 'HIGH';
    else if (timeToEmpty < 7 || currentLevel < 50) procurementUrgency = 'MODERATE';
    else procurementUrgency = 'LOW';

    // Generate tank-specific recommendation
    const recommendation = generateTankRecommendation(tank, timeToEmpty, currentLevel, signals);

    // Calculate financial impact
    const priceChangeSignal = signals.find(s => 
      (s.title || '').toLowerCase().includes('price') && 
      ((s.title || '').toLowerCase().includes('increase') || (s.title || '').toLowerCase().includes('hike'))
    );
    
    const projectedPrice = priceChangeSignal ? currentMarketPrice * 1.07 : currentMarketPrice * 1.02; // 7% increase if signal found
    const volumeToProcure = Math.min(tank.capacity * 0.8, 15000); // 80% capacity or 15kL max
    const savingsPotential = (projectedPrice - currentMarketPrice) * volumeToProcure;

    // Extract market factors
    const marketFactors = extractMarketFactors(signals, risks);

    return {
      tankId: tank?.id || 'unknown',
      tankName: tank?.name || 'Unnamed Tank',
      fuelType: tank?.fuelType || 'Unknown',
      currentLevel,
      timeToEmpty,
      riskScore: Math.min(100, riskScore),
      procurementUrgency,
      recommendation,
      financialImpact: {
        currentPrice: currentMarketPrice,
        projectedPrice,
        savingsPotential,
        volumeToProcure
      },
      marketFactors
    };
  });
}

/**
 * Generate fleet-wide intelligence summary
 */
export function generateFleetIntelligenceSummary(
  tankAnalyses: TankSpecificAnalysis[]
): FleetIntelligenceSummary {
  const criticalTanks = tankAnalyses.filter(t => t.procurementUrgency === 'CRITICAL').length;
  const highRiskTanks = tankAnalyses.filter(t => t.riskScore > 70).length;
  
  let overallRisk: FleetIntelligenceSummary['overallRisk'];
  if (criticalTanks > 0 || highRiskTanks > tankAnalyses.length / 2) overallRisk = 'CRITICAL';
  else if (highRiskTanks > 0) overallRisk = 'HIGH';
  else if (tankAnalyses.some(t => t.riskScore > 40)) overallRisk = 'MODERATE';
  else overallRisk = 'LOW';

  const totalSavingsPotential = tankAnalyses.reduce((sum, tank) => sum + tank.financialImpact.savingsPotential, 0);
  
  const immediateActions = tankAnalyses
    .filter(t => t.procurementUrgency === 'CRITICAL')
    .map(t => `Immediate refill required for ${t.tankName} (${t.timeToEmpty.toFixed(1)} days remaining)`);

  const strategicPriorities = [
    'Monitor EPRA price cycle announcements',
    'Track Mombasa port congestion status',
    'Maintain 15-day buffer across all tanks',
    'Optimize procurement timing based on market sentiment'
  ];

  const fleetRecommendation = overallRisk === 'CRITICAL' 
    ? 'EMERGENCY PROCUREMENT: Initiate immediate refill for critical tanks to prevent stockout'
    : overallRisk === 'HIGH'
    ? 'PRIORITIZED PROCUREMENT: Focus on high-risk tanks within 48 hours'
    : overallRisk === 'MODERATE'
    ? 'STRATEGIC PROCUREMENT: Plan refills within 5-7 days to optimize costs'
    : 'MAINTENANCE MODE: Current inventory levels adequate, monitor market conditions';

  return {
    totalTanks: tankAnalyses.length,
    criticalTanks,
    overallRisk,
    fleetRecommendation,
    totalSavingsPotential,
    immediateActions,
    strategicPriorities
  };
}

/**
 * Generate enhanced Gemini insights with tank-specific context
 */
export async function generateTankAwareInsights(
  tanks: Tank[],
  signals: MarketSignal[],
  risks: SupplyRisk[],
  notices: any[],
  aiService: IntelligenceAIService
): Promise<GeminiInsight[]> {
  const tankAnalyses = generateTankSpecificAnalysis(tanks, signals, risks);
  const fleetSummary = generateFleetIntelligenceSummary(tankAnalyses);

  // 1. Create individual tank insights for critical tanks (Heuristic-based for speed/reliability)
  const criticalTankInsights: GeminiInsight[] = tankAnalyses
    .filter(tank => tank.procurementUrgency === 'CRITICAL')
    .map(tank => ({
      id: `tank-critical-${tank.tankId}`,
      tankId: tank.tankId,
      type: 'procurement' as const,
      title: `CRITICAL: ${tank.tankName} Requires Immediate Refill`,
      summary: `${tank.tankName} has ${tank.currentLevel.toFixed(1)}% fuel remaining with ${tank.timeToEmpty.toFixed(1)} days to empty. Current market conditions indicate ${tank.marketFactors.sentiment} sentiment.`,
      recommendation: tank.recommendation,
      prompt: `Analyze tank-specific risk for ${tank.tankName} with current level ${tank.currentLevel}% and market signals`,
      response: `Tank-specific analysis complete with risk score ${tank.riskScore.toFixed(0)}/100`,
      confidence: 0.92,
      timestamp: Date.now(),
      modelVersion: 'gemini-tank-aware',
      supportingData: {
        tankAnalysis: tank,
        fleetContext: fleetSummary
      }
    }));

  // 2. Create fleet-level strategic insight (AI-Powered reasoning)
  try {
    const aiFleetInsight = await aiService.generateInsight(signals, risks, notices, tanks);
    
    // Enrich AI insight with fleet summary data if needed
    const fleetInsight: GeminiInsight = {
      ...aiFleetInsight,
      id: 'fleet-strategic-summary',
      supportingData: {
        ...aiFleetInsight.supportingData,
        fleetSummary,
        tankAnalyses: tankAnalyses.slice(0, 3)
      }
    };

    return [...criticalTankInsights, fleetInsight];
  } catch (err) {
    logger.warn('[TankIQ] AI Fleet insight failed, falling back to heuristic:', err);
    
    // Fallback: Create fleet-level strategic insight using heuristics
    const fleetInsight: GeminiInsight = {
      id: 'fleet-strategic-summary-fallback',
      type: 'procurement',
      title: `Fleet Strategy: ${fleetSummary.overallRisk} Risk Level`,
      summary: `Fleet status: ${fleetSummary.criticalTanks} critical tanks. Market analysis shows ${tankAnalyses[0]?.marketFactors.sentiment || 'neutral'} conditions with ${fleetSummary.totalSavingsPotential.toLocaleString()} KES potential savings.`,
      recommendation: fleetSummary.fleetRecommendation,
      prompt: 'Generate fleet-wide strategic procurement intelligence (Fallback)',
      response: 'Fleet intelligence synthesis complete (Heuristic)',
      confidence: 0.85,
      timestamp: Date.now(),
      modelVersion: 'tank-intelligence-heuristic',
      supportingData: {
        fleetSummary,
        tankAnalyses: tankAnalyses.slice(0, 3)
      }
    };

    return [...criticalTankInsights, fleetInsight];
  }
}

/**
 * Calculate market volatility from signals
 */
function calculateMarketVolatility(signals: MarketSignal[]): number {
  const volatilityKeywords = ['volatile', 'uncertain', 'fluctuation', 'instability', 'turbulent'];
  const volatilitySignals = signals.filter(s => 
    volatilityKeywords.some(keyword => 
      ((s.title || '') + ' ' + (s.summary || '')).toLowerCase().includes(keyword)
    )
  );
  
  return Math.min(100, volatilitySignals.length * 15 + 35); // Base 35% + 15% per volatility signal
}

/**
 * Generate tank-specific recommendation
 */
function generateTankRecommendation(
  tank: Tank,
  timeToEmpty: number,
  currentLevel: number,
  signals: MarketSignal[]
): string {
  const priceSignals = signals.filter(s => (s.title || '').toLowerCase().includes('price'));
  const hasPriceIncrease = priceSignals.some(s => 
    (s.title || '').toLowerCase().includes('increase') || (s.title || '').toLowerCase().includes('hike')
  );

  if (timeToEmpty < 2) {
    return `CRITICAL: Initiate emergency procurement for ${tank?.name || 'Tank'} within 24 hours to prevent stockout. Current inventory at ${currentLevel.toFixed(1)}% will deplete in ${timeToEmpty.toFixed(1)} days.`;
  }

  if (timeToEmpty < 4 && hasPriceIncrease) {
    return `HIGH PRIORITY: Procure ${tank?.name || 'Tank'} within 48 hours to avoid both stockout risk and upcoming price increases. Time window optimal for cost savings.`;
  }

  if (currentLevel < 30) {
    return `MODERATE PRIORITY: Schedule refill for ${tank?.name || 'Tank'} within 5-7 days. Current level at ${currentLevel.toFixed(1)}% requires attention to maintain operational buffer.`;
  }

  return `MONITOR: ${tank?.name || 'Tank'} inventory stable at ${currentLevel.toFixed(1)}%. Continue monitoring market conditions for optimal procurement timing.`;
}

/**
 * Extract market factors from signals
 */
function extractMarketFactors(signals: MarketSignal[], risks: SupplyRisk[]) {
  const priceSignals = signals.filter(s => (s.title || '').toLowerCase().includes('price'));
  const regulatorySignals = signals.filter(s => s.source === 'EPRA' || (s.title || '').toLowerCase().includes('epra'));

  // Determine sentiment
  const bullishKeywords = ['increase', 'rise', 'bullish', 'upward'];
  const bearishKeywords = ['decrease', 'fall', 'bearish', 'downward'];
  
  let sentiment = 'neutral';
  const bullishCount = priceSignals.filter(s => 
    bullishKeywords.some(keyword => (s.title || '').toLowerCase().includes(keyword))
  ).length;
  const bearishCount = priceSignals.filter(s => 
    bearishKeywords.some(keyword => (s.title || '').toLowerCase().includes(keyword))
  ).length;
  
  if (bullishCount > bearishCount) sentiment = 'bullish';
  else if (bearishCount > bullishCount) sentiment = 'bearish';

  return {
    sentiment,
    volatility: calculateMarketVolatility(signals),
    supplyRisks: risks.map(r => `${r.category}: ${r.severity}`),
    regulatorySignals: regulatorySignals.map(s => s.title)
  };
}
