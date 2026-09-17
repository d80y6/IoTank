/* eslint-disable react/no-unescaped-entities */
import React, { useState, useEffect } from 'react';
import { 
  FiAlertCircle, FiDroplet, FiTrendingUp, FiCheckCircle, 
  FiActivity, FiShield, FiZap, FiBox 
} from 'react-icons/fi';
import { useJurisdiction } from '@/hooks/useJurisdiction';
import { formatNumber } from '@/lib/jurisdiction';
import './InteractiveDashboardSnippet.css';

const InteractiveDashboardSnippet: React.FC = () => {
  const { jurisdiction, currencySymbol } = useJurisdiction();
  const regBody = jurisdiction?.regulatoryBody || 'regulator';
  const basePrice = Number((jurisdiction?.config as any)?.pricing?.superPetrol) || (currencySymbol === 'Ksh' ? 185.50 : 1.85);
  const [tankLevel, setTankLevel] = useState(14250); // Liters
  const [isSimulationActive, setIsSimulationActive] = useState<null | 'leak' | 'price'>(null);
  const [alerts, setAlerts] = useState<{ id: number; type: 'info' | 'warning' | 'critical'; message: string; timestamp: string }[]>([]);
  const [priceProjection, setPriceProjection] = useState(basePrice);

  // Simulation: Leak
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isSimulationActive === 'leak') {
      interval = setInterval(() => {
        setTankLevel(prev => Math.max(0, prev - 1.2)); // Rapid visible leak for demo
      }, 100);
      
      const newAlert = {
        id: Date.now(),
        type: 'critical' as const,
        message: "CRITICAL: Abnormal flow detected in Tank #1. Potential leak or unauthorized siphoning.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setAlerts(prev => [newAlert, ...prev].slice(0, 3));
    }
    return () => clearInterval(interval);
  }, [isSimulationActive]);

  // Simulation: Price
  const handlePriceSimState = () => {
    setIsSimulationActive('price');
    const projectedPrice = basePrice * 1.07; // ~7% increase
    const increase = projectedPrice - basePrice;
    setPriceProjection(projectedPrice);
    const newAlert = {
      id: Date.now(),
      type: 'warning' as const,
      message: `AI ADVISOR: Projected ${regBody} price increase of ${currencySymbol} ${formatNumber(increase, jurisdiction, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} detected. Recommended action: BUY NOW.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setAlerts(prev => [newAlert, ...prev].slice(0, 3));
    
    setTimeout(() => setIsSimulationActive(null), 5000); // Reset after 5s
  };

  const handleReset = () => {
    setIsSimulationActive(null);
    setTankLevel(14250);
    setPriceProjection(basePrice);
    setAlerts([]);
  };

  return (
    <section className="ids-section">
      <div className="ids-container">
        <div className="ids-content">
          <div className="ids-pill">INTERACTIVE EXPERIENCE</div>
          <h2 className="ids-title">Test the <span className="text-cyan">Intelligence</span></h2>
          <p className="ids-subtitle">
            Experience how IoTank reacts to real-world threats in real-time. Choose a scenario below to start the simulation.
          </p>
          
          <div className="ids-controls">
            <button 
              className={`ids-sim-btn leak ${isSimulationActive === 'leak' ? 'active' : ''}`}
              onClick={() => isSimulationActive === 'leak' ? handleReset() : setIsSimulationActive('leak')}
            >
              <FiDroplet /> {isSimulationActive === 'leak' ? 'Stop Leak' : 'Simulate Leak'}
            </button>
            <button 
              className={`ids-sim-btn price ${isSimulationActive === 'price' ? 'active' : ''}`}
              onClick={handlePriceSimState}
              disabled={isSimulationActive === 'price'}
            >
              <FiTrendingUp /> Simulate Price Hike
            </button>
            <button className="ids-reset-btn" onClick={handleReset}>Reset Demo</button>
          </div>
        </div>

        {/* The Dashboard Mock */}
        <div className="ids-dashboard-frame">
          <div className="dashboard-header-mock">
            <div className="dash-title">Station Overview: {jurisdiction?.name || 'Main Depot'}</div>
            <div className="dash-status-dot">
              <span className={`pulse ${isSimulationActive === 'leak' ? 'critical' : 'active'}`}></span>
              {isSimulationActive === 'leak' ? 'Alert Active' : 'System Secure'}
            </div>
          </div>

          <div className="dash-grid-mock">
            {/* Tank Card */}
            <div className="dash-card-mock main-tank">
              <div className="card-label-mock">Tank #1: Super Petrol</div>
              <div className="tank-viz-container">
                <div 
                  className={`tank-fluid ${tankLevel > 15000 ? 'petrol' : 'vpower'}`} 
                  style={{ height: `${(tankLevel / 20000) * 100}%` }}
                >
                  <div className="liquid-wave"></div>
                </div>
              </div>
              <div className="tank-data-row">
                <div className="stat-group">
                  <span className="stat-label">Volume</span>
                  <span className={`stat-value ${isSimulationActive === 'leak' ? 'declining' : ''}`}>
                    {tankLevel.toLocaleString(undefined, { maximumFractionDigits: 1 })} L
                  </span>
                </div>
                <div className="stat-group">
                  <span className="stat-label">Capacity</span>
                  <span className="stat-value">20,000 L</span>
                </div>
              </div>
            </div>

            {/* AI Insight Card */}
            <div className="dash-card-mock ai-insight">
              <div className="card-label-mock">AI Advisory Engine</div>
              <div className="ai-insight-content">
                <div className="price-forecast">
                  <div className="current-price">
                    <span className="label">Current</span>
                    <span className="value">{currencySymbol} {formatNumber(basePrice, jurisdiction, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="projection-arrow">→</div>
                  <div className={`projected-price ${isSimulationActive === 'price' ? 'active' : ''}`}>
                    <span className="label">Projected</span>
                    <span className="value">{currencySymbol} {formatNumber(priceProjection, jurisdiction, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
                <div className={`ai-decision-bubble ${isSimulationActive === 'price' ? 'recommend-buy' : ''}`}>
                  {isSimulationActive === 'price' ? (
                    <>
                      <FiZap className="icon pulse" />
                      <div>
                        <strong>BUY IMMEDIATELY</strong>
                        <p>Potential savings: {currencySymbol} {formatNumber((priceProjection - basePrice) * 15000, jurisdiction, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} on 15kL order.</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <FiCheckCircle className="icon" />
                      <div>
                        <strong>OPTIMAL LEVEL</strong>
                        <p>Inventory sufficient for 4.2 days.</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Alerts Center */}
            <div className="dash-card-mock alerts-log">
              <div className="card-label-mock">Real-time Alerts</div>
              <div className="alerts-list-mock">
                {alerts.length > 0 ? (
                  alerts.map(alert => (
                    <div key={alert.id} className={`alert-entry-mock ${alert.type}`}>
                      <FiAlertCircle className="alert-icon" />
                      <div className="alert-body">
                        <p>{alert.message}</p>
                        <span className="alert-time">{alert.timestamp}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-alerts">
                    <FiShield className="shield-icon" />
                    <p>Continuous monitoring active. No threats detected.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Row Stats */}
            <div className="dash-mini-stats">
              <div className="mini-stat-mock">
                <FiActivity /> 28.4°C
              </div>
              <div className="mini-stat-mock">
                <FiBox /> ±1.2mm
              </div>
            </div>
          </div>

          <div className="dashboard-footer-mock">
            IoTank Secure Cloud Terminal v2.1.4 &middot; Last Encrypted Sync: Just Now
          </div>
        </div>
      </div>
    </section>
  );
};

export default InteractiveDashboardSnippet;
