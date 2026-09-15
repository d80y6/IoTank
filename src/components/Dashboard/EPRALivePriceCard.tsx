import React from 'react';
import { useMarketIntelligence } from '@/hooks/useMarketIntelligence';

export const EPRALivePriceCard: React.FC<{ stationId: string }> = ({ stationId }) => {
    const { prices, loading } = useMarketIntelligence(stationId);

    if (loading || !prices || prices.length === 0) return null;

    return (
        <div className="epra-price-info-panel animate-in fade-in slide-in-from-top-2 duration-300 mt-6">
            <div className="epra-panel-header">
                <span className="epra-pulse-dot" />
                <span className="epra-panel-title">EPRA Live Price Cap (Informational Only)</span>
            </div>
            <div className="epra-prices-list">
                {[
                    { type: 'PMS', name: 'Super Petrol (PMS)' },
                    { type: 'AGO', name: 'Diesel (AGO)' },
                    { type: 'IK', name: 'Kerosene (IK)' }
                ].map(grade => {
                    const mp = prices.find(p => p.fuelType?.toUpperCase() === grade.type);
                    if (!mp) return null;
                    return (
                        <div key={grade.type} className="epra-price-item">
                            <span className="epra-fuel-name">{grade.name}</span>
                            <span className="epra-fuel-val">KES {Number(mp.pricePerLiter).toFixed(2)}/L</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
