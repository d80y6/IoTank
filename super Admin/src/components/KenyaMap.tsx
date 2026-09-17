import React from 'react';

interface KenyaMapProps {
    lat?: number;
    lng?: number;
    points?: { lat: number; lng: number; status?: string }[];
    zoom?: number;
    className?: string;
    showPulse?: boolean;
}

/**
 * Global Deployment Map Component
 * Coordinate projection utility for global deployment points.
 */
const KenyaMap: React.FC<KenyaMapProps> = ({ 
    lat, 
    lng, 
    points = [], 
    className = "", 
    showPulse = true 
}) => {
    // Global Coverage Geographic Bounds (Approximate for projection)
    const bounds = {
        minLat: 12.0,
  	maxLat: 19.0,
  	minLng: 42.5,
  	maxLng: 54.5
    };

    // Project Geo-coordinates to SVG ViewBox (0,0 to 100,100)
    const project = (plat: number, plng: number) => {
        const x = ((plng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
        const y = 100 - ((plat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
        return { x, y };
    };

    // Production-ready simplified coverage SVG path (High resolution)
    // Main Coastline (Normalized to 0 0 100 100 viewBox)
const coveragePath = "M5.5,23.5 L19.7,23.5 L19.7,30.2 L37.2,30.2 L38.5,31.7 L46.0,17.4 C53.4,9.5 61.2,4.8 77.2,2.0 L77.2,2.5 L89.1,35.6 L79.6,44.7 L72.0,46.9 L69.3,57.1 C63.5,58.4 55.4,63.9 52.8,70.5 L50.4,72.2 L48.8,72.2 L47.4,74.0 C44.5,74.5 41.5,74.5 39.0,79.5 L34.7,80.1 C25.0,81.4 22.8,92.5 17.5,93.4 C11.5,94.5 8.7,92.9 8.2,88.7 C7.8,85.2 6.5,84.1 5.6,80.5 L6.2,74.5 C5.0,73.4 3.0,72.1 2.5,70.5 C1.0,65.2 1.3,55.5 3.3,49.2 C3.5,48.5 2.0,48.0 1.0,47.0 L1.0,43.2 L2.8,39.4 C3.6,35.1 4.5,31.2 5.5,23.5 Z";

const islandPath = "M91.2,93.6 C91.0,94.5 91.8,96.0 92.5,97.1 C93.6,98.5 96.0,99.1 97.4,99.1 C98.5,99.1 99.8,98.0 99.8,96.5 C99.8,95.5 98.7,94.5 97.2,94.2 C95.5,93.9 93.6,92.9 92.0,92.9 C91.5,92.9 91.3,93.2 91.2,93.6 Z";

    const mainPoint = lat && lng ? project(lat, lng) : null;
    const allPoints = points.map(p => ({ ...project(p.lat, p.lng), status: p.status }));

    return (
        <div className={`kenya-map-container ${className}`} style={{ position: 'relative', width: '100%', height: '100%', minHeight: '200px' }}>
            <svg viewBox="0 0 100 100" className="kenya-map-svg" style={{ width: '100%', height: '100%' }}>
                {/* Tactical Grid Background */}
                <defs>
                    <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(0,0,0,0.03)" strokeWidth="0.5" />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* Coverage Boundary */}
                <path 
                    d={coveragePath} 
                    fill="rgba(59, 130, 246, 0.05)" 
                    stroke="#1e293b" 
                    strokeWidth="0.8" 
                    strokeLinejoin="round"
                    className="kenya-border"
                />
                <path 
                    d={islandPath} 
                    fill="rgba(59, 130, 246, 0.05)" 
                    stroke="#1e293b" 
                    strokeWidth="0.8" 
                    strokeLinejoin="round"
                    className="kenya-border"
                />

                {/* All Active Nodes (for Dashboard) */}
                {allPoints.map((p, i) => (
                    <circle 
                        key={i} 
                        cx={p.x} cy={p.y} 
                        r="1.2" 
                        fill={p.status === 'online' ? '#10b981' : '#f43f5e'} 
                    />
                ))}

                {/* Primary Station Marker (for Audit Modal) */}
                {mainPoint && (
                    <g className="main-station-marker">
                        {showPulse && (
                            <circle cx={mainPoint.x} cy={mainPoint.y} r="4" fill="none" stroke="#6366f1" strokeWidth="0.5">
                                <animate attributeName="r" from="1.5" to="6" dur="1.5s" repeatCount="indefinite" />
                                <animate attributeName="opacity" from="0.8" to="0" dur="1.5s" repeatCount="indefinite" />
                            </circle>
                        )}
                        <circle cx={mainPoint.x} cy={mainPoint.y} r="1.5" fill="#4338ca" />
                        <circle cx={mainPoint.x} cy={mainPoint.y} r="0.8" fill="white" />
                    </g>
                )}
            </svg>

            <style dangerouslySetInnerHTML={{ __html: `
                .kenya-map-container { background: #f8fafc; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; }
                .kenya-border { stroke-dasharray: 200; stroke-dashoffset: 200; animation: draw 2s forwards ease-out; }
                @keyframes draw { to { stroke-dashoffset: 0; } }
            `}} />
        </div>
    );
};

export default KenyaMap;
