import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { supabase } from '../config/supabase';
import { hardwareService, Device, FirmwareVersion, OTACampaign, DevTask } from '../services/hardwareService';
import { 
    FiCpu, FiHardDrive, FiActivity, FiMapPin, 
    FiWifi, FiServer, FiSettings, FiRefreshCw, 
    FiUploadCloud, FiDownload, FiAlertTriangle, FiCheckCircle, FiClock,
    FiPlus, FiFilter, FiSearch, FiMoreVertical, FiTerminal,
    FiGitCommit, FiLayers, FiList, FiTrendingUp, FiChevronRight, FiMaximize2,
    FiShield, FiDatabase, FiCloudLightning, FiCode, FiCopy
} from 'react-icons/fi';
import { BackendTab } from '../components/Hardware/BackendTab';
import './HardwareMonitoring.css';

const HardwareMonitoring: React.FC<{ isHubView?: boolean }> = ({ isHubView }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'registry' | 'detail' | 'firmware' | 'actions' | 'dev' | 'backend'>('overview');
    const [stats, setStats] = useState<any>(null);
    const [devices, setDevices] = useState<Device[]>([]);
    const [firmware, setFirmware] = useState<FirmwareVersion[]>([]);
    const [campaigns, setCampaigns] = useState<OTACampaign[]>([]);
    const [tasks, setTasks] = useState<DevTask[]>([]);
    const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
    const [loading, setLoading] = useState(true);
    const [safetyArmed, setSafetyArmed] = useState(false);
    const [commandLoading, setCommandLoading] = useState<string | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [statsData, devicesData, firmwareData, campaignsData, tasksData] = await Promise.all([
                hardwareService.getDeviceStats(),
                hardwareService.getDevices(),
                hardwareService.getFirmwareLibrary(),
                hardwareService.getOTACampaigns(),
                hardwareService.getDevTasks()
            ]);
            setStats(statsData);
            setDevices(devicesData);
            setFirmware(firmwareData);
            setCampaigns(campaignsData);
            setTasks(tasksData);
        } catch (error) {
            console.error('Error fetching hardware data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();

        // ── REALTIME TELEMETRY SYNC ──────────────────────────────────────────
        // Subscribe to all changes in the 'devices' table for live dashboard updates
        const channel = supabase
            .channel('hardware_live_pulse')
            .on(
                'postgres_changes', 
                { event: '*', schema: 'public', table: 'devices' }, 
                (payload) => {
                    if (payload.new && (payload.new as any).station_id) {
                        // In a high-performance scenario, we'd update specific rows, 
                        // but for 12-20 nodes, a fresh fetch is ultra-reliable.
                        fetchData();
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'ID Copied',
                message: `Identity token #${text.substring(0, 8)}... copied to operational clipboard.`,
                type: 'info'
            }
        }));
    };

    const handleDeviceClick = (device: Device) => {
        setSelectedDevice(device);
        setActiveTab('detail');
    };

    const handleExecuteCommand = async (command: string, label: string, targetType: 'fleet' | 'device' = 'fleet') => {
        const confirmMsg = targetType === 'fleet' 
            ? `Are you sure you want to broadcast ${label} to the ENTIRE fleet? This may cause temporary platform-wide downtime.`
            : `Send ${label} command to node ${selectedDevice?.device_id}?`;
        
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Confirm Operation',
                message: confirmMsg,
                type: 'warning',
                persistent: true,
                actions: [
                    {
                        label: 'Abort',
                        onClick: () => {}
                    },
                    {
                        label: 'Execute Command',
                        primary: true,
                        onClick: async () => {
                            setCommandLoading(command);
                            try {
                                if (targetType === 'fleet') {
                                    for (const device of devices) {
                                        if (device.status === 'online') {
                                            await hardwareService.sendCommand(device.id, device.device_id, command);
                                        }
                                    }
                                } else if (selectedDevice) {
                                    await hardwareService.sendCommand(selectedDevice.id, selectedDevice.device_id, command);
                                }
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Command Dispatched',
                                        message: `${label} sequence has been successfully transmitted to the target ${targetType}.`,
                                        type: 'success'
                                    }
                                }));
                            } catch (error: any) {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Command Error',
                                        message: error.message || 'Transmission failure detected in the hardware link.',
                                        type: 'error'
                                    }
                                }));
                            } finally {
                                setCommandLoading(null);
                            }
                        }
                    }
                ]
            }
        }));
    };

    const renderCircularGauge = (value: number, label: string, color: string) => {
        const radius = 45;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (value / 100) * circumference;

        return (
            <div className="flex flex-col items-center">
                <div className="gauge-container mb-4">
                    <svg className="w-full h-full gauge-svg-ring" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r={radius} className="gauge-circle-bg" />
                        <circle 
                            cx="50" cy="50" r={radius} 
                            className="gauge-circle-val" 
                            stroke={color}
                            strokeDasharray={circumference}
                            strokeDashoffset={offset}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-black tracking-tighter" style={{ color }}>{value}%</span>
                    </div>
                </div>
                <span className="text-[10px] font-black uppercase opacity-40 tracking-widest">{label}</span>
            </div>
        );
    };

    const renderOverview = () => (
        <div className="hw-overview animate-mission-control">
            <div className="hw-node-grid">
                {[
                    { label: 'Active Nodes', val: stats?.online, total: `${stats?.total} total`, status: 'active', color: 'text-emerald-500' },
                    { label: 'Uptime Integrity', val: `${stats?.avgUptime}%`, total: 'Target 99.9%', status: 'active', color: 'text-cyan-400' },
                    { label: 'Terminal Offline', val: stats?.offline, total: 'Critically Low', status: 'critical', color: 'text-rose-500' },
                    { label: 'Update Pipeline', val: stats?.needingUpdate, total: 'Awaiting Rollout', status: 'warning', color: 'text-amber-500' }
                ].map((node, i) => (
                    <div key={i} className={`hw-node-card ${node.status}`}>
                        <div className="flex justify-between items-start mb-4">
                            <span className="text-[10px] font-black uppercase opacity-40 tracking-widest">{node.label}</span>
                            <FiMaximize2 className="opacity-20 hover:opacity-100 cursor-pointer" />
                        </div>
                        <h2 className={`text-4xl font-black tracking-tighter mb-1 ${node.color}`}>{node.val}</h2>
                        <div className="text-[9px] font-bold opacity-30 uppercase">{node.total}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-12 gap-8">
                <div className="col-span-8">
                    <div className="mission-table-container">
                        <div className="p-6 border-b border-white border-opacity-5 flex justify-between items-center">
                            <h3 className="text-xs font-black uppercase tracking-widest">Recent node telemetry</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="mission-table">
                                <thead>
                                    <tr>
                                        <th>Node ID</th>
                                        <th>Target Profile</th>
                                        <th>Last Pulse</th>
                                        <th>Link Status</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {devices.slice(0, 5).map(d => (
                                        <tr key={d.id} className="cursor-pointer" onClick={() => handleDeviceClick(d)}>
                                            <td className="font-mono text-xs font-black text-neon-cyan">
                                                <div className="flex items-center gap-2 group/id">
                                                    <span>#{d.device_id.substring(0, 8)}</span>
                                                    <FiCopy 
                                                        className="opacity-0 group-hover/id:opacity-100 cursor-pointer pointer-events-auto" 
                                                        onClick={(e) => { e.stopPropagation(); copyToClipboard(d.device_id); }}
                                                    />
                                                </div>
                                            </td>
                                            <td className="font-bold text-xs uppercase opacity-80">{d.station_name}</td>
                                            <td className="text-[10px] opacity-40 font-bold italic">{new Date().toLocaleTimeString()}</td>
                                            <td>
                                                <div className={`status-pill ${d.status === 'online' ? 'online' : 'offline'}`}>
                                                    {d.status}
                                                </div>
                                            </td>
                                            <td><FiChevronRight className="opacity-20" /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="col-span-4">
                    <div className="hw-terminal-wrapper h-full">
                        <div className="hw-terminal-header">
                           <div className="flex items-center gap-2">
                                <FiTerminal className="text-neon-cyan" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-neon-cyan">Node_Stream.sh</span>
                           </div>
                        </div>
                        <div className="hw-terminal-body terminal-view min-h-[300px]">
                            <div>[SYSTEM] INITIALIZING TELEMETRY STREAM...</div>
                            <div className="opacity-40"># FETCHING CORE METRICS...</div>
                            <div className="mt-2 text-neon-emerald">SUCCESS: Link established with HUB_01</div>
                            <div className="mt-4 text-neon-rose">WARNING: HUB_04 latencies exceeding 400ms</div>
                            <div className="mt-4 text-neon-cyan animate-pulse">_ EXEC_CMD_0X92... LOADING</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderRegistry = () => (
        <div className="hw-registry animate-mission-control">
            <div className="hw-filter-bar mb-8">
                <div className="relative flex-1">
                    <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
                    <input type="text" placeholder="Search Node Fleet..." className="hw-search-input pl-12" />
                </div>
                <button className="hw-action-btn">
                    <FiDownload /> Export Cluster.log
                </button>
            </div>

            <div className="mission-table-container">
                <table className="mission-table">
                    <thead>
                        <tr>
                            <th>UID / NODE_NAME</th>
                            <th>Station Segment</th>
                            <th>Firmware</th>
                            <th>Operational State</th>
                            <th>Link Strength</th>
                            <th className="text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {devices.map(d => (
                            <tr key={d.id} className="cursor-pointer" onClick={() => handleDeviceClick(d)}>
                                <td>
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2 group/regid">
                                            <span className="font-mono text-xs font-black text-neon-cyan">{d.device_id}</span>
                                            <FiCopy 
                                                className="opacity-0 group-hover/regid:opacity-100 cursor-pointer pointer-events-auto" 
                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(d.device_id); }}
                                            />
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <div className="font-bold text-xs">{d.station_name}</div>
                                    <div className="text-[10px] opacity-40 uppercase font-black">{d.client_name}</div>
                                </td>
                                <td>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${d.firmware_version === '2.6.0' ? 'bg-emerald-500' : 'bg-amber-500 shadow-[0_0_10px_#f59e0b]'}`}></div>
                                        <span className="text-xs font-bold font-mono opacity-80">{d.firmware_version}</span>
                                    </div>
                                </td>
                                <td>
                                    <div className={`status-pill ${d.status === 'online' ? 'online' : 'offline'}`}>
                                        {d.status}
                                    </div>
                                </td>
                                <td>
                                    <div className="signal-bars">
                                        {[1,2,3,4,5].map(b => (
                                            <div key={b} className={`signal-bar ${b <= (d.signal_strength === 'excellent' ? 5 : 2) ? 'active' : ''}`} style={{ height: `${b * 3}px` }}></div>
                                        ))}
                                    </div>
                                </td>
                                <td className="text-right">
                                    <button className="icon-btn hover:text-neon-cyan" onClick={(e) => {e.stopPropagation();}}><FiSettings /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderDetail = () => {
        if (!selectedDevice) return <div className="text-center py-20 opacity-40">No device selected</div>;
        return (
            <div className="hw-detail animate-mission-control">
                <div className="flex justify-between items-center mb-10">
                    <div className="flex items-center gap-4">
                        <button className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-[var(--glass-border)] bg-[var(--bg-surface)] hover:bg-[var(--color-bg-tertiary)]" onClick={() => setActiveTab('registry')}>Back to Cluster</button>
                        <div>

                             <h2 className="text-3xl font-black lowercase tracking-tighter">node: <span className="text-neon-cyan font-mono">{selectedDevice.device_id}</span></h2>
                             <button 
                                className="ml-4 p-2 bg-white/5 rounded-lg hover:bg-neon-cyan/20 transition-all text-neon-cyan"
                                onClick={() => copyToClipboard(selectedDevice.device_id)}
                                title="Copy Node ID"
                             >
                                <FiCopy size={16} />
                             </button>
                             <span className="text-[10px] font-bold opacity-30 uppercase tracking-[0.2em] ml-4">{selectedDevice.station_name} /// SEGMENT_DELTA_09</span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="hw-node-card p-10 flex flex-col items-center justify-center bg-[var(--bg-surface)]">
                        {renderCircularGauge(selectedDevice.cpu_usage, 'CPU Load', 'var(--neon-cyan)')}
                    </div>

                    <div className="hw-node-card p-10 flex flex-col items-center justify-center bg-[var(--bg-surface)]">
                        {renderCircularGauge(selectedDevice.ram_usage, 'RAM Memory', 'var(--neon-emerald)')}
                    </div>

                    <div className="hw-node-card p-0 flex flex-col border-[var(--glass-border)] h-full bg-[var(--bg-surface)]">
                        <div className="p-4 border-b border-[var(--glass-border)] bg-[var(--color-bg-tertiary)] bg-opacity-50">
                            <span className="text-[10px] font-black uppercase text-white/40 tracking-widest">Live Telemetric Feed</span>
                        </div>
                        <div className="p-8 flex-1 flex flex-col gap-6">
                            <div className="flex justify-between items-end border-b border-white border-opacity-5 pb-4">
                                <div>
                                    <span className="text-[10px] font-black uppercase opacity-30 tracking-widest block mb-1">Dip Distance</span>
                                    <span className="text-3xl font-black font-mono tracking-tighter">1,245 <small className="text-xs opacity-30 font-bold">mm</small></span>
                                </div>
                            </div>
                            <div className="flex justify-between items-end">
                                <div>
                                    <span className="text-[10px] font-black uppercase opacity-30 tracking-widest block mb-1">Ambient Temp</span>
                                    <span className="text-3xl font-black font-mono tracking-tighter" style={{ color: selectedDevice.temp > 50 ? 'var(--neon-rose)' : 'inherit' }}>{selectedDevice.temp}°C</span>
                                </div>
                                <FiActivity className={selectedDevice.temp > 50 ? 'text-rose-500 animate-pulse' : 'text-neon-cyan opacity-30'} size={24} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderFirmware = () => (
        <div className="hw-firmware animate-mission-control">
            <div className="grid grid-cols-12 gap-8">
                <div className="col-span-12 xl:col-span-8">
                     <div className="hw-node-card p-0 bg-[var(--bg-surface)]">
                        <div className="p-6 border-b border-[var(--glass-border)] flex justify-between items-center">
                            <div>
                                <h3 className="text-xs font-black uppercase tracking-widest">Binary Repository / Repository_v2</h3>
                                <span className="text-[10px] font-bold opacity-30 mt-1 block uppercase font-mono">Rollout Management Console</span>
                            </div>
                            <button className="hw-action-btn bg-neon-pink">
                                <FiUploadCloud /> Upload New Binary
                            </button>
                        </div>
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                            {firmware.map(f => (
                                <div key={f.id} className="hw-binary-card group">
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="flex items-center gap-3">
                                            <div className="hw-binary-icon">
                                                <FiLayers size={20} />
                                            </div>
                                            <div>
                                                <div className="text-lg font-black tracking-tighter">{f.version}</div>
                                                <span className="hw-binary-type">{f.type}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mb-6 flex flex-col gap-2">
                                        <div className="flex justify-between text-[10px] font-bold uppercase opacity-30">
                                            <span>Compatibility</span>
                                            <span className="text-neon-cyan">ESP32-S3</span>
                                        </div>
                                        <div className="h-1 bg-[var(--glass-border)] rounded-full overflow-hidden">
                                            <div className="h-full bg-neon-cyan w-full opacity-30"></div>
                                        </div>
                                    </div>
                                    <button className="hw-deploy-btn">
                                        Initiate Deployment
                                    </button>
                                </div>
                            ))}
                        </div>
                     </div>
                </div>

                <div className="col-span-12 xl:col-span-4">
                        <div className="p-6 bg-[#08081a] flex-1 min-h-[400px]">
                            <h4 className="text-xs font-black uppercase tracking-widest mb-6 opacity-40">Active Campaigns</h4>
                            <div className="space-y-4">
                                {campaigns.length === 0 && <div className="text-[10px] opacity-20 italic">No active rollouts</div>}
                                {campaigns.map(c => (
                                    <div key={c.id} className="p-4 bg-white/5 rounded-xl border border-white/5">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-xs font-black tracking-tight">{c.name}</span>
                                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded ${c.status === 'in_progress' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{c.status}</span>
                                        </div>
                                        <div className="flex justify-between text-[9px] font-bold opacity-30 uppercase mb-2">
                                            <span>Progress</span>
                                            <span>{Math.round((c.updated_devices / (c.total_devices || 1)) * 100)}%</span>
                                        </div>
                                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                            <div className="h-full bg-indigo-500" style={{ width: `${(c.updated_devices / (c.total_devices || 1)) * 100}%` }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                </div>
            </div>
        </div>
    );

    const renderActions = () => (
        <div className="hw-actions animate-mission-control">
            <div className="flex justify-between items-end mb-10">
                <div>
                   <h2 className="text-3xl font-black lowercase tracking-tighter">Remote Fleet Control</h2>
                   <p className="text-[10px] font-bold opacity-30 uppercase tracking-[0.2em] mt-1">Super Admin Administrative Overrides</p>
                </div>
                <div className="flex items-center gap-4 bg-[var(--bg-surface)] p-4 rounded-2xl border border-[var(--glass-border)]">
                    <div className="text-right">
                        <span className="text-[9px] font-black uppercase opacity-40 block">Safety Mode</span>
                        <span className={`text-[10px] font-black uppercase ${safetyArmed ? 'text-neon-rose' : 'text-emerald-500'}`}>{safetyArmed ? 'ARMED / DANGEROUS' : 'LOCKED / SECURE'}</span>
                    </div>
                    <div 
                        className={`hw-safety-switch ${safetyArmed ? 'armed' : ''}`}
                        onClick={() => setSafetyArmed(!safetyArmed)}
                    >
                        <div className="hw-switch-toggle shadow-lg"></div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                { [
                    { id: 'REBOOT', icon: <FiRefreshCw />, title: 'Bulk System Reboot', desc: 'Propagate graceful restart command across all online nodes in the fleet.', action: 'Broadcast Reboot', risk: 'safe' },
                    { id: 'SYNC', icon: <FiCloudLightning />, title: 'Force Connectivity Sync', desc: 'Interrupt current radio state and perform a full handshake with Supabase edge.', action: 'Force Sync', risk: 'safe' },
                    { id: 'DIAGNOSTIC', icon: <FiTerminal />, title: 'Remote Diagnostic Scan', desc: 'Execute comprehensive sensory and radio diagnostic routine on all nodes.', action: 'Trigger Diagnostic', risk: 'safe' },
                    { id: 'FLUSH', icon: <FiShield />, title: 'Clear Security Buffers', desc: 'Flush all local telemetry cache and security event buffers from node flash.', action: 'Flush Buffers', risk: 'warning' },
                    { id: 'PROVISION', icon: <FiDatabase />, title: 'Node Re-Provisioning', desc: 'Securely re-bind node identity keys and infrastructure parameters.', action: 'Re-Provision', risk: 'warning' },
                    { id: 'FACTORY_RESET', icon: <FiAlertTriangle />, title: 'Fleet Factory Reset', desc: 'CRITICAL: Wipe all flash segments and return entire fleet to base OS binaries.', action: 'Execute Wipe', risk: 'destructive' }
                ].map((act, i) => (
                    <div key={i} className={`hw-command-plate ${act.risk}`}>
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-6 shadow-xl ${act.risk === 'destructive' ? 'bg-neon-rose/10 text-neon-rose' : 'bg-neon-cyan/10 text-neon-cyan'}`}>
                            {act.icon}
                        </div>
                        <h4 className="font-bold text-xl mb-3 tracking-tight">{act.title}</h4>
                        <p className="text-xs opacity-50 mb-8 leading-relaxed h-12 overflow-hidden">{act.desc}</p>
                        <button 
                            className={`w-full py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                act.risk === 'destructive' 
                                    ? (safetyArmed ? 'bg-neon-rose text-white hover:scale-[1.02]' : 'bg-[var(--glass-border)] text-[var(--color-text-disabled)] cursor-not-allowed')
                                    : 'bg-[var(--bg-surface)] border border-[var(--glass-border)] hover:bg-neon-cyan hover:text-white hover:border-neon-cyan'
                            }`}
                            disabled={(act.risk === 'destructive' && !safetyArmed) || commandLoading === act.id}
                            onClick={() => handleExecuteCommand(act.id, act.action, 'fleet')}
                        >
                            {commandLoading === act.id ? 'Dispatching...' : act.action}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderDev = () => (
        <div className="hw-dev animate-mission-control">
            <div className="flex justify-between items-start mb-12">
                <div>
                   <h2 className="text-3xl font-black lowercase tracking-tighter">Developer Supervision</h2>
                   <p className="text-[10px] font-bold opacity-30 uppercase tracking-[0.2em] mt-1">Environment Health & CI/CD Pipelines</p>
                </div>
                <button className="hw-action-btn bg-[var(--bg-surface)] border border-[var(--glass-border)] text-[var(--color-text-primary)]">
                    <FiGitCommit /> Platform Logs
                </button>
            </div>

            <div className="hw-node-card p-0 bg-[var(--bg-surface)] mb-12">
                <div className="p-6 border-b border-[var(--glass-border)] flex justify-between items-center">
                    <h3 className="text-xs font-black uppercase tracking-widest">System Maintenance Board</h3>
                    <FiPlus className="opacity-40 hover:opacity-100 cursor-pointer" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 p-6 gap-6">
                    {tasks.length === 0 && <div className="col-span-full text-center py-20 opacity-20">No active system tasks</div>}
                    {tasks.map(t => (
                        <div key={t.id} className="p-6 bg-white/5 rounded-2xl border border-white/5 hover:border-indigo-500/50 transition-all cursor-pointer group">
                            <div className="flex justify-between items-start mb-4">
                                <span className={`text-[8px] font-black uppercase px-2 py-1 rounded ${t.priority === 'critical' ? 'bg-rose-500 text-white' : 'bg-indigo-500/20 text-indigo-400'}`}>
                                    {t.priority}
                                </span>
                                <span className="text-[10px] font-mono opacity-20">#{t.id.substring(0,6)}</span>
                            </div>
                            <h4 className="font-bold text-sm mb-2 group-hover:text-indigo-400 transition-colors">{t.title}</h4>
                            <p className="text-[10px] opacity-40 leading-relaxed mb-6">{t.description}</p>
                            <div className="flex justify-between items-center pt-4 border-t border-white/5">
                                <span className="text-[9px] font-black uppercase tracking-widest opacity-30">{t.status}</span>
                                <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px]">{t.assignee?.charAt(0) || 'U'}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>


            <div className="hw-terminal-wrapper border-none shadow-none">
                <div className="hw-terminal-header">
                    <div className="flex items-center gap-3">
                        <FiCode className="text-neon-cyan" />
                        <span className="text-[10px] font-black uppercase opacity-30 tracking-widest">Global_System_Observer.sh</span>
                    </div>
                    <div className="flex gap-2">
                        <span className="text-[8px] font-black px-2 py-0.5 bg-neon-cyan/10 text-neon-cyan rounded">SU: ACTIVE</span>
                    </div>
                </div>
                <div className="hw-terminal-body min-h-[400px]">
                    <div className="text-neon-emerald">[09:30:12] KERNEL: BOOT SEQUENCE OK</div>
                    <div>[09:30:15] SUPABASE: LINK_ESTABLISHED (REGION: EU-WEST)</div>
                    <div className="opacity-20"># ------------------------------------------------------------</div>
                    <div>[09:31:05] SENSOR_BUFFER: MAPPING 4 I2C ENDPOINTS...</div>
                    <div className="text-neon-pink">[09:31:42] ERROR: SPI_BUS_COLLISION DETECTED (AUTO-FIXING)</div>
                    <div className="text-neon-cyan">[09:32:00] PIPELINE: BUILD_SUCCESS (COMMIT: 8fa2c03)</div>
                    <div className="animate-pulse mt-4 text-neon-cyan">_ SYSTEM_IDLE // LISTENING_FOR_INPUT...</div>
                </div>
            </div>
        </div>
    );

    const renderBackend = () => (
        <div className="hw-backend animate-mission-control">
             <div className="hw-data-station-frame">
                <div className="flex justify-between items-center mb-8 px-4">
                    <div>
                        <h2 className="text-2xl font-black lowercase tracking-tighter">Analytical Workbook</h2>
                        <span className="text-[10px] font-bold opacity-30 uppercase tracking-widest">Correction Tables & Volume Lookup Workstation</span>
                    </div>
                    <FiDatabase className="opacity-20" size={24} />
                </div>
                <div className="flex-1 overflow-hidden relative rounded-2xl border border-[var(--glass-border)]">
                    <BackendTab />
                </div>
             </div>
        </div>
    );

    const content = (
            <div className="hardware-page">
                <header className="hw-header-advanced flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Mission Control // Core </span>
                            <div className="h-px w-10 bg-white opacity-10"></div>
                        </div>
                        <h1 className="hw-title-glitch">system hardware</h1>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] mt-2 opacity-40">ESP32 Fleet Command & Telemetry HUB</p>
                    </div>
                    <div className="flex gap-4">
                         <div className="hw-live-pulse">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]"></div>
                            <span>TELEMETRY_LINK: STABLE</span>
                         </div>
                    </div>
                </header>

                <div className="hw-tabs-modern">
                    {[
                        { id: 'overview', label: 'Overview' },
                        { id: 'registry', label: 'Cluster' },
                        { id: 'detail', label: 'Diagnostics', hidden: !selectedDevice },
                        { id: 'firmware', label: 'Binaries' },
                        { id: 'actions', label: 'Remote' },
                        { id: 'dev', label: 'Developer' },
                        { id: 'backend', label: 'Backend' }
                    ].map(t => (!t.hidden && (
                        <button 
                            key={t.id} 
                            className={`hw-tab-btn-modern ${activeTab === t.id ? 'active' : ''}`} 
                            onClick={() => setActiveTab(t.id as any)}
                        >
                            {t.label}
                        </button>
                    )))}
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-40">
                        <div className="relative">
                            <div className="w-16 h-16 border-t-2 border-neon-cyan rounded-full animate-spin"></div>
                            <FiSettings className="absolute inset-0 m-auto text-neon-cyan/30" />
                        </div>
                        <p className="mt-8 font-black tracking-[0.3em] uppercase text-[10px] text-neon-cyan animate-pulse">Initializing Fleet_Terminal.sh...</p>
                    </div>
                ) : (
                    <div className="animate-mission-control">
                        {activeTab === 'overview' && renderOverview()}
                        {activeTab === 'registry' && renderRegistry()}
                        {activeTab === 'detail' && renderDetail()}
                        {activeTab === 'firmware' && renderFirmware()}
                        {activeTab === 'actions' && renderActions()}
                        {activeTab === 'dev' && renderDev()}
                        {activeTab === 'backend' && renderBackend()}
                    </div>
                )}
            </div>
    );

    if (isHubView) return content;
    return <Layout>{content}</Layout>;
};

export default HardwareMonitoring;
