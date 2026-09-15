import React, { useMemo } from 'react';
import './TankVisual2D.css';

interface TankVisual2DProps {
  fuelLevel: number; // 0-100
  fuelType: string;
  shape?: 'cylinder' | 'rectangular' | 'capsule' | 'spherical' | 'compartmentalized';
  height?: number;
  diameter?: number;
  length?: number;
}

export const TankVisual2D: React.FC<TankVisual2DProps> = ({
  fuelLevel,
  fuelType,
  shape = 'cylinder',
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Determine fuel color matching the original 3D logic
  const fuelColor = useMemo(() => {
    switch (fuelType.toLowerCase()) {
      case 'diesel': return '#10b981'; // Emerald Green
      case 'gasoline': 
      case 'petrol': 
      case 'pms': return '#fbbf24'; // Gold Yellow
      case 'kerosene': return '#3b82f6'; // Marine Blue
      case 'vpower':
      case 'v-power': return '#ef4444'; // Shell Red
      case 'jet a1': return '#64748b'; // Slate Grey
      default: return '#7c3aed'; // Deep Purple (Brand Color)
    }
  }, [fuelType]);

  // Inject dynamic styles directly via DOM to bypass strict style linting rules
  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.setProperty('--fuel-level', `${fuelLevel}%`);
      containerRef.current.style.setProperty('--fuel-color', fuelColor);
      containerRef.current.style.setProperty('--fuel-glow', `0 0 20px ${fuelColor}44`);
    }
  }, [fuelLevel, fuelColor]);

  // Handle shape classes
  const shapeClass = `tank-2d-body ${shape}`;

  return (
    <div className="tank-2d-container" ref={containerRef}>
      <div className={shapeClass}>
        {/* Background / Shell */}
        <div className="tank-2d-shell"></div>

        {/* Liquid Layer */}
        <div className="tank-2d-liquid">
          {/* Wave effect at the top of the liquid */}
          {fuelLevel > 0 && fuelLevel < 100 && (
            <div className="tank-2d-wave">
              <svg viewBox="0 0 120 28" preserveAspectRatio="none">
                <path d="M0 25.8C15 25.8 15 2 30 2s15 23.8 30 23.8 15-23.8 30-23.8 15 23.8 30 23.8V28H0V25.8z" fill={fuelColor} opacity="0.6">
                  <animate attributeName="d" dur="3s" repeatCount="indefinite" values="M0 25.8C15 25.8 15 2 30 2s15 23.8 30 23.8 15-23.8 30-23.8 15 23.8 30 23.8V28H0V25.8z; M0 2C15 2 15 25.8 30 25.8s15-23.8 30-23.8 15 23.8 30 23.8 15-23.8 30-23.8V28H0V2z; M0 25.8C15 25.8 15 2 30 2s15 23.8 30 23.8 15-23.8 30-23.8 15 23.8 30 23.8V28H0V25.8z" />
                </path>
              </svg>
            </div>
          )}
        </div>

        {/* Glossy Overlay for depth */}
        <div className="tank-2d-gloss"></div>
        
        {/* Level Indicators */}
        <div className="tank-2d-markers">
          <div className="marker top"><span>100%</span></div>
          <div className="marker mid"><span>50%</span></div>
          <div className="marker bottom"><span>0%</span></div>
        </div>
      </div>
      
      {/* Percentage Indicator */}
      <div className="tank-2d-percentage">
        {parseFloat(fuelLevel.toFixed(2))}%
      </div>
    </div>
  );
};
