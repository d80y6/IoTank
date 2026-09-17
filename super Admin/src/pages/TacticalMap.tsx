import { Device } from '../services/hardwareService';
import { FiTarget } from 'react-icons/fi';
import KenyaMap from '../components/KenyaMap';


interface TacticalMapProps {
    stationCount: number;
    devices: Device[];
}

const TacticalMap = ({ stationCount, devices }: TacticalMapProps) => {
    const latestDevice = devices[0];
    
    // Map devices to points for the deployment map
    const mapPoints = devices.map(d => ({
        lat: d.lat || 0,
        lng: d.lng || 0,
        status: d.status
    }));

    return (
        <div className="tactical-map-container glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="map-scan-line"></div>
            <div className="ornament ornament-tl">GRID_REF::GLOBAL</div>
            <div className="ornament ornament-tr">SIGNAL_STRENGTH::{latestDevice?.signal_strength?.toUpperCase() || 'N/A'}</div>
            <div className="ornament ornament-bl">SYNC_ID::{latestDevice?.device_id?.slice(0, 6) || 'N/A'}</div>
            
            <div className="w-full h-full p-4">
                <KenyaMap 
                    points={mapPoints} 
                    className="border-none shadow-none bg-transparent"
                />
            </div>

            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ zIndex: 10 }}>
                <FiTarget size={32} className="text-indigo-600 mb-2 opacity-20" />
                <div className="text-center">
                    <p className="text-[10px] font-black text-indigo-900 uppercase tracking-[0.3em]">Satellite Oversight</p>
                    <p className="text-[20px] font-black text-slate-900 tracking-tighter">{stationCount} LIVE HUBS</p>
                </div>
            </div>

            {/* Micro Data Panels */}
            <div className="absolute bottom-6 right-6 flex gap-4" style={{ zIndex: 20 }}>
                <div className="p-2 bg-white/60 backdrop-blur-md rounded-lg border border-white/50">
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none mb-1">LATITUDE</p>
                    <p className="text-[10px] font-black text-slate-900 mono">{latestDevice?.lat != null ? `${latestDevice.lat.toFixed(4)}°` : '—'}</p>
                </div>
                <div className="p-2 bg-white/60 backdrop-blur-md rounded-lg border border-white/50">
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none mb-1">LONGITUDE</p>
                    <p className="text-[10px] font-black text-slate-900 mono">{latestDevice?.lng != null ? `${latestDevice.lng.toFixed(4)}°` : '—'}</p>
                </div>
            </div>
        </div>
    );
};


export default TacticalMap;
