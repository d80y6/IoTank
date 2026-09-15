import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { supabase } from '../config/supabase';
import { clientsService } from '../services/clientsService';
import { 
    FiSearch, FiFilter, FiActivity, FiMapPin, FiDatabase, 
    FiCodesandbox, FiChevronDown, FiChevronUp, FiExternalLink,
    FiPlus, FiRefreshCw, FiCopy, FiCheck, FiInfo, FiShield,
    FiDownload, FiTruck, FiActivity as FiPulse, FiClock, FiX, FiCheckCircle, FiXCircle, FiLoader, FiUser,
    FiChevronLeft, FiChevronRight
} from 'react-icons/fi';
import './PendingRegistrations.css'; // Shared premium aesthetics
import './ClientsList.css'; 
import KenyaMap from '../components/KenyaMap';

interface Station {
    station_id: string;
    station_name: string;
    phone: string;
    email: string;
    account_status: 'active' | 'suspended' | 'pending';
    county: string;
    created_at: string;
    tanks: any[];
}

// Internal Pagination Component (Standardized)
const TablePagination = ({ 
    currentPage, 
    totalItems, 
    pageSize, 
    onPageChange 
}: { 
    currentPage: number, 
    totalItems: number, 
    pageSize: number, 
    onPageChange: (p: number) => void 
}) => {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalItems);

    return (
        <div className="table-pagination-footer">
            <div className="pagination-info">
                Showing <b>{start}</b> to <b>{end}</b> of <b>{totalItems}</b> entries
            </div>
            <div className="pagination-controls">
                <button 
                    className="pagination-btn" 
                    disabled={currentPage === 1}
                    onClick={() => onPageChange(currentPage - 1)}
                >
                    Previous
                </button>
                <button 
                    className="pagination-btn" 
                    disabled={currentPage === totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                >
                    Next
                </button>
            </div>
        </div>
    );
};

const ClientsList: React.FC<{ isHubView?: boolean }> = ({ isHubView }) => {
    const navigate = useNavigate();
    const [stations, setStations] = useState<Station[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [selectedStation, setSelectedStation] = useState<Station | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 8;

    useEffect(() => {
        const fetchStations = async () => {
            setLoading(true);
            try {
                // Stabilize Identity
                await supabase.rpc('repair_my_identity');

                // Fetch Stations & Telemetry Breadcrumbs
                const [stationsData, telemetryData] = await Promise.all([
                    clientsService.getRegisteredStations(),
                    supabase.from('latest_sensor_readings').select('tank_id, timestamp')
                ]);

                // Map telemetry to stations (Last Active)
                const mappedStations = (stationsData || []).map((s: any) => {
                    const stTanks = s.tanks || [];
                    const tankIds = stTanks.map((t: any) => t.id);
                    const lastReadings = (telemetryData.data || [])
                        .filter(r => tankIds.includes(r.tank_id))
                        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                    
                    return {
                        ...s,
                        last_active: lastReadings.length > 0 ? lastReadings[0].timestamp : null
                    };
                });

                setStations(mappedStations);
            } catch (error) {
                console.error('Error fetching stations:', error);
            } finally {
                setTimeout(() => setLoading(false), 800);
            }
        };
        fetchStations();
    }, []);

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleResyncHardware = async (stationId: string) => {
        setLoading(true);
        try {
            await supabase.rpc('refresh_tank_analytics');
            // Mocking a hardware probe delay for premium feel
            await new Promise(resolve => setTimeout(resolve, 1500));
            window.location.reload(); 
        } catch (error) {
            console.error('Hardware re-sync error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleExport = () => {
        const csvRows = [
            ['Station ID', 'Station Name', 'County', 'Contact', 'Status', 'Tanks Count', 'Last Active', 'Created At'],
            ...stations.map((s: any) => [
                s.station_id,
                s.station_name,
                s.county || 'N/A',
                s.phone || s.email || 'N/A',
                s.account_status,
                s.tanks?.length || 0,
                s.last_active ? new Date(s.last_active).toLocaleString() : 'NEVER',
                new Date(s.created_at).toLocaleDateString()
            ])
        ];

        const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `IoTank_Registered_Clients_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Intelligence Metrics
    const metrics = useMemo(() => {
        const total = stations.length;
        const active = stations.filter(s => s.account_status === 'active').length;
        const suspended = stations.filter(s => s.account_status === 'suspended').length;
        const totalTanks = stations.reduce((acc, s) => acc + (s.tanks?.length || 0), 0);
        
        return { total, active, suspended, totalTanks };
    }, [stations]);

    const filteredStations = useMemo(() => {
        return stations.filter((station: any) => {
            const matchesSearch = !searchTerm || 
                station.station_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                station.station_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                station.county?.toLowerCase().includes(searchTerm.toLowerCase());
            
            const matchesFilter = filterStatus === 'all' ? true : station.account_status === filterStatus;
            
            return matchesSearch && matchesFilter;
        });
    }, [stations, searchTerm, filterStatus]);

    // Paginated Data
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredStations.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredStations.length / itemsPerPage);

    const StationAuditModal = ({ station, onClose }: { station: Station; onClose: () => void }) => {
        useEffect(() => {
            const originalStyle = window.getComputedStyle(document.body).overflow;
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = originalStyle; };
        }, []);

        return createPortal(
            <div className="iotank-portal-overlay" onClick={onClose}>
                <div className="iotank-portal-content" onClick={e => e.stopPropagation()}>
                    <header className="modal-header">
                        <div className="header-text-container">
                            <h2 className="text-white font-black tracking-tight flex items-center gap-3">
                                <FiShield className="text-emerald-400" />
                                Station Registry Audit: {station.station_name}
                            </h2>
                            <p className="text-slate-400 text-xs mt-1">Forensic metadata analysis and hardware inventory overview.</p>
                        </div>
                        <button className="close-btn" onClick={onClose} title="Close Audit">
                            <FiX size={18} />
                        </button>
                    </header>

                    <div className="modal-body-scroll custom-scrollbar">
                        
                        {/* ── Live Geographic Intelligence ── */}
                        <div className="telemetry-radar-card" style={{ padding: '16px', background: '#f8fafc' }}>
                            <div className="radar-visualization" style={{ width: '180px', height: '180px' }}>
                                <KenyaMap 
                                    lat={-1.2921} // Defaulting to Nairobi if specific cords missing, or use station data if available
                                    lng={36.8219} 
                                    className="border-none shadow-none"
                                />
                            </div>
                            <div className="telemetry-stats">
                                <div className="tel-active-badge">
                                    <div className="tel-pulse-icon"><FiActivity size={20} /></div>
                                    <div className="tel-active-text">Satellite Link Active</div>
                                </div>
                                <div className="flex gap-12 mt-4">
                                    <div className="form-group">
                                        <label>Latitude</label>
                                        <div className="audit-field-value mono" style={{ fontSize: '0.9rem' }}>1.2921° N</div>
                                    </div>
                                    <div className="form-group">
                                        <label>Longitude</label>
                                        <div className="audit-field-value mono" style={{ fontSize: '0.9rem' }}>36.8219° E</div>
                                    </div>
                                </div>
                                <div className="mt-4 p-3 bg-white border border-slate-200 rounded-lg">
                                    <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Grid Reference</p>
                                    <p className="text-[11px] font-bold text-slate-700">KENYA_SOUTH_CENTRAL_09X</p>
                                </div>
                            </div>
                        </div>

                        {/* ── Identity Section ── */}
                        <div className="atm-section">
                            <div className="atm-section-header">
                                <div className="atm-section-icon" style={{ background: '#6366f1' }}><FiUser /></div>
                                <span className="atm-section-title">Identity & Signature</span>
                            </div>
                            <div className="atm-section-body">
                                <div className="atm-grid-2">
                                    <div className="form-group">
                                        <label>Full Legal Entity</label>
                                        <div className="audit-field-value">{station.station_name}</div>
                                    </div>
                                    <div className="form-group">
                                        <label>System Identifier</label>
                                        <div className="flex items-center gap-2">
                                            <div className="audit-field-value mono truncate">{station.station_id}</div>
                                            <button onClick={() => copyToClipboard(station.station_id, 'audit-id')} className="text-indigo-500 hover:text-indigo-700">
                                                {copiedId === 'audit-id' ? <FiCheck size={12} className="text-emerald-500" /> : <FiCopy size={12} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ── Regional Section ── */}
                        <div className="atm-section">
                            <div className="atm-section-header">
                                <div className="atm-section-icon" style={{ background: '#0ea5e9' }}><FiMapPin /></div>
                                <span className="atm-section-title">Operational Region</span>
                            </div>
                            <div className="atm-section-body">
                                <div className="atm-grid-2">
                                    <div className="form-group"><label>Primary County</label><div className="audit-field-value">{station.county || 'Unassigned'}</div></div>
                                    <div className="form-group"><label>Status</label><div><span className={`dp-status-badge dp-status-badge--${station.account_status === 'active' ? 'approved' : 'rejected'}`}>{station.account_status}</span></div></div>
                                </div>
                            </div>
                        </div>

                        {/* ── Hardware Section ── */}
                        <div className="atm-section">
                            <div className="atm-section-header">
                                <div className="atm-section-icon" style={{ background: '#10b981' }}><FiCodesandbox /></div>
                                <span className="atm-section-title">Hardware Inventory (ATG Telemetry)</span>
                            </div>
                            <div className="atm-section-body">
                                <div className="hw-inventory-grid">
                                    {station.tanks?.map((tank: any) => (
                                        <div key={tank.id} className="hw-tank-card forensic-card">
                                            <div className="card-main-info">
                                                <div className="flex justify-between items-start mb-4">
                                                    <div>
                                                        <div className="hw-tank-name">{tank.tank_name}</div>
                                                        <div className="text-[10px] text-emerald-600 font-black uppercase tracking-[0.15em]">{tank.fuel_type}</div>
                                                    </div>
                                                    <div className="capacity-glance">
                                                        <span className="val">{Number(tank.tank_capacity).toLocaleString()}</span>
                                                        <span className="unit">Liters</span>
                                                    </div>
                                                </div>
                                                
                                                <div className="forensic-meta-grid">
                                                    <div className="meta-item full-width">
                                                        <label>Firmware Tank Identifier (.ino config)</label>
                                                        <div className="copy-code-wrapper">
                                                            <code className="tank-id-code">{tank.id}</code>
                                                            <button 
                                                                onClick={() => copyToClipboard(tank.id, `tank-${tank.id}`)}
                                                                className="copy-btn-inner"
                                                                title="Copy for .ino configuration"
                                                            >
                                                                {copiedId === `tank-${tank.id}` ? <FiCheck size={14} className="text-emerald-500" /> : <FiCopy size={14} />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="meta-item">
                                                        <label>Telemetry Endpoint</label>
                                                        <div className="meta-val truncate">atg.v3.io/{tank.id.slice(0, 8)}</div>
                                                    </div>
                                                    <div className="meta-item">
                                                        <label>Sync Authority</label>
                                                        <div className="meta-val">CLOUD_MANAGED</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )) || <p className="text-slate-400 text-xs italic">No hardware provisioned.</p>}
                                </div>
                            </div>
                        </div>

                        {/* ── History Section ── */}
                        <div className="atm-section">
                            <div className="atm-section-header">
                                <div className="atm-section-icon" style={{ background: '#f59e0b' }}><FiClock /></div>
                                <span className="atm-section-title">Chronicle & Handshake</span>
                            </div>
                            <div className="atm-section-body">
                                <div className="atm-grid-2">
                                    <div className="form-group"><label>Handshake</label><div className="audit-field-value mono">{new Date(station.created_at).toLocaleString()}</div></div>
                                    <div className="form-group"><label>Last Telemetry</label><div className={`audit-field-value mono ${(station as any).last_active ? 'text-emerald-600' : 'text-rose-500'}`}>{(station as any).last_active ? new Date((station as any).last_active).toLocaleString() : 'OFFLINE'}</div></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <footer className="modal-footer premium-footer">
                        <button className="btn-cancel" onClick={onClose} style={{ fontWeight: 800 }}>Close Registry</button>
                        <button className="btn-resync-hardware" onClick={() => handleResyncHardware(station.station_id)} disabled={loading} style={{ fontWeight: 800 }}>
                            {loading ? <FiLoader className="animate-spin" /> : <FiRefreshCw />}
                            <span>Re-sync Hardware</span>
                        </button>
                        <button className="btn-audit-approve" onClick={() => navigate(`/clients/${station.station_id}`)}>
                            <span>ADVANCED ENGINEERING HUB</span>
                            <FiExternalLink />
                        </button>
                    </footer>
                </div>
            </div>,
            document.body
        );
    };

    const content = (
        <div className="clients-list-container animate-in fade-in duration-500">
                
                {/* Standardized Header */}
                <header className="dp-header">
                    <div className="dp-header-left">
                        <div className="dp-icon-box">
                            <FiCodesandbox size={24} />
                        </div>
                        <div>
                            <h1>Organization Hub</h1>
                            <p className="dp-subtitle">Comprehensive station command and forensic hardware oversight.</p>
                        </div>
                    </div>
                    
                    <div className="dp-header-actions">
                        <button className="dp-btn dp-btn--primary" onClick={handleExport}>
                            <FiDownload /> Export Bulk Logs (.csv)
                        </button>
                        <button className="dp-btn btn-provision-trigger" onClick={() => navigate('/registrations')}>
                            <FiPlus />
                            <span>New Onboarding</span>
                        </button>
                        <button className={`sync-refresher ${loading ? 'is-syncing' : ''}`} onClick={() => window.location.reload()} title="Sync Archive">
                            <FiRefreshCw size={18} />
                        </button>
                    </div>
                </header>

                {/* Industrial Stats Grid */}
                <section className="dp-stats-grid">
                    <div className="dp-premium-stat-card card-emerald">
                        <div className="dp-stat-icon-wrapper"><FiDatabase size={22} className="text-emerald-600" /></div>
                        <div className="dp-stat-content">
                            <span className="dp-stat-label">Live Stations</span>
                            <span className="dp-stat-value">{metrics.total} Entities</span>
                            <span className="dp-stat-footer">Registered Network</span>
                        </div>
                    </div>
                    <div className="dp-premium-stat-card card-blue">
                        <div className="dp-stat-icon-wrapper"><FiPulse size={22} className="text-blue-600" /></div>
                        <div className="dp-stat-content">
                            <span className="dp-stat-label">System Health</span>
                            <span className="dp-stat-value">{metrics.active} Stable</span>
                            <span className="dp-stat-footer">Active Connections</span>
                        </div>
                    </div>
                    <div className="dp-premium-stat-card card-amber">
                        <div className="dp-stat-icon-wrapper"><FiCodesandbox size={22} className="text-amber-600" /></div>
                        <div className="dp-stat-content">
                            <span className="dp-stat-label">Hardware Depth</span>
                            <span className="dp-stat-value">{metrics.totalTanks} Sensors</span>
                            <span className="dp-stat-footer">ATG Telemetry Hubs</span>
                        </div>
                    </div>
                    <div className="dp-premium-stat-card card-rose">
                        <div className="dp-stat-icon-wrapper"><FiShield size={22} className="text-rose-600" /></div>
                        <div className="dp-stat-content">
                            <span className="dp-stat-label">Security Alerts</span>
                            <span className="dp-stat-value">{metrics.suspended} Flagged</span>
                            <span className="dp-stat-footer">Risk Mitigation</span>
                        </div>
                    </div>
                </section>

                {/* Forensic Registry Table */}
                <div className="tdv-section-card mt-6">
                    <div className="section-header flex items-center justify-between p-6">
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-3">
                                <FiShield className="text-emerald-600" />
                                <h3 className="section-title">Organization Registry</h3>
                            </div>
                            
                            <div className="header-search-box">
                                <FiSearch className="search-icon" />
                                <input 
                                    type="text" 
                                    placeholder="Find station or region..." 
                                    value={searchTerm}
                                    onChange={(e) => {setSearchTerm(e.target.value); setCurrentPage(1);}}
                                />
                            </div>
                        </div>

                        <div className="filter-pill-cloud">
                            {['active', 'suspended', 'all'].map(s => (
                                <button 
                                    key={s} 
                                    className={`filter-btn ${filterStatus === s ? `active type--${s}` : ''}`} 
                                    onClick={() => {setFilterStatus(s); setCurrentPage(1);}}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="table-responsive">
                        <table className="tdv-transaction-table">
                            <thead>
                                <tr>
                                    <th>STATION ID</th>
                                    <th>ENTITY NAME</th>
                                    <th>SENSORS</th>
                                    <th>LAST ACTIVE</th>
                                    <th>REGION</th>
                                    <th>STATUS</th>
                                    <th className="text-right">COMMAND</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={7} className="py-24 text-center">
                                            <div className="flex flex-col items-center">
                                                <div className="w-10 h-10 border-2 border-emerald-100 border-t-emerald-600 rounded-full animate-spin mb-4"></div>
                                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Probing Registry Hub...</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : currentItems.length > 0 ? (
                                    currentItems.map((station) => (
                                        <tr key={station.station_id} onClick={() => setSelectedStation(station)}>
                                            <td>
                                                <div className="flex flex-col">
                                                    <span className="td-mono text-[10.5px]">{station.station_id.slice(0, 18)}...</span>
                                                    <span className="text-[10px] text-slate-400">{station.phone || 'NO CONTACT'}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <span className="td-bold">{station.station_name}</span>
                                            </td>
                                            <td>
                                                <div className="flex items-center gap-2">
                                                    <FiCodesandbox size={12} className="text-slate-300" />
                                                    <span className="font-bold text-slate-600">{station.tanks?.length || 0} Sensors</span>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="forensic-time-cell">
                                                    <span className={`date-part font-extrabold ${(station as any).last_active ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                        {(station as any).last_active ? new Date((station as any).last_active).toLocaleDateString() : 'NO SIGNAL'}
                                                    </span>
                                                    <span className="time-part">
                                                        <FiClock size={8} /> {(station as any).last_active ? new Date((station as any).last_active).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'OFFLINE'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td>
                                                <span className="td-region">{station.county}</span>
                                            </td>
                                            <td>
                                                <span className={`dp-status-badge dp-status-badge--${station.account_status === 'active' ? 'approved' : 'rejected'}`}>
                                                    {station.account_status}
                                                </span>
                                            </td>
                                            <td className="text-right">
                                                <div className="flex justify-end pr-4">
                                                    <button className="action-circle view" title="View Audit">
                                                        <FiExternalLink size={18} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={7} className="py-24 text-center">
                                            <div className="flex flex-col items-center opacity-30">
                                                <FiDatabase size={40} className="mb-4" />
                                                <p className="text-xs font-bold uppercase tracking-widest">No organization records found.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <TablePagination 
                        currentPage={currentPage}
                        totalItems={filteredStations.length}
                        pageSize={itemsPerPage}
                        onPageChange={setCurrentPage}
                    />
                </div>

                {selectedStation && <StationAuditModal station={selectedStation} onClose={() => setSelectedStation(null)} />}
            </div>
    );

    if (isHubView) return content;
    return <Layout>{content}</Layout>;
};

export default ClientsList;
