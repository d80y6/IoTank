import React, { useEffect, useState } from 'react';
import { systemUsersService } from '../services/systemUsersService';
import Layout from '../components/Layout';
import { 
    FiUser, FiInfo, FiTag, FiDatabase, FiSettings, 
    FiActivity, FiKey, FiLoader, FiChevronDown, FiChevronUp, 
    FiDownload, FiExternalLink, FiClock, FiTarget
} from 'react-icons/fi';
import './AdminLogs.css';

const AdminLogs: React.FC<{ isHubView?: boolean }> = ({ isHubView }) => {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedLog, setExpandedLog] = useState<string | null>(null);

    useEffect(() => {
        const fetchLogs = async () => {
            try {
                const data = await systemUsersService.getAdminLogs();
                setLogs(data || []);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchLogs();
    }, []);

    const getLogIcon = (type: string) => {
        const t = type.toLowerCase();
        if (t.includes('auth') || t.includes('login')) return <FiKey />;
        if (t.includes('create') || t.includes('delete')) return <FiDatabase />;
        if (t.includes('update') || t.includes('config')) return <FiSettings />;
        return <FiActivity />;
    };

    const exportLogsArchive = () => {
        const headers = ['Timestamp', 'Authority', 'Role', 'Action Type', 'Event Description', 'Subject'];
        const rows = logs.map(log => [
            new Date(log.created_at).toLocaleString([], { hour12: false }),
            log.system_users?.full_name || 'Anonymous Authority',
            log.system_users?.role || 'SYSTEM',
            log.action_type.replace('_', ' '),
            log.description,
            log.fuel_stations?.station_name || 'Global Scope'
        ]);
        const escape = (value: string | number) => {
            const str = String(value ?? '');
            return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        };
        const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'admin_logs_archive.csv';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: { title: 'Archive Extracted', message: `${logs.length} log entries written to CSV.`, type: 'success' }
        }));
    };

    const content = (
        <div className="logs-container animate-fade-in">
            <header className="dp-header">
                <div className="dp-title-group">
                    <h1 className="lowercase">system audit trail</h1>
                    <div className="dp-subtitle">Complete Immutable Record of Platform Administrative Activity</div>
                </div>
                
                <div className="dp-header-actions">
                     <button onClick={exportLogsArchive} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">
                        <FiDownload /> Archive Extraction
                    </button>
                </div>
            </header>

            <div className="tdv-transaction-table-container">
                <table className="tdv-transaction-table">
                    <thead>
                        <tr>
                            <th>Timestamp</th>
                            <th>Authority</th>
                            <th>Action Type</th>
                            <th>Event Description</th>
                            <th>Subject (Context)</th>
                            <th className="text-right">Audit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="p-20 text-center">
                                    <div className="flex flex-col items-center gap-4 opacity-40">
                                        <FiLoader className="animate-spin text-2xl" />
                                        <span className="text-[10px] font-black uppercase tracking-widest">Retrieving Forensic Archives...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : logs.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="p-20 text-center opacity-40">
                                    <FiInfo className="mx-auto text-3xl mb-4" />
                                    <p className="text-xs font-bold uppercase tracking-widest">No administrative logs found</p>
                                </td>
                            </tr>
                        ) : (
                            logs.map(log => {
                                const isExpanded = expandedLog === log.id;
                                return (
                                    <React.Fragment key={log.id}>
                                        <tr 
                                            className={`cursor-pointer group ${isExpanded ? 'bg-slate-50' : ''}`}
                                            onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                                        >
                                            <td className="font-mono text-[10px] opacity-40">
                                                {new Date(log.created_at).toLocaleString([], { hour12: false })}
                                            </td>
                                            <td>
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 group-hover:text-blue-600 transition-all">
                                                        {getLogIcon(log.action_type)}
                                                    </div>
                                                    <div>
                                                        <div className="font-black text-sm tracking-tight">{log.system_users?.full_name || 'Anonymous Authority'}</div>
                                                        <div className="text-[9px] opacity-40 font-black uppercase">{log.system_users?.role || 'SYSTEM'}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <span className="log-type-tag">
                                                    {log.action_type.replace('_', ' ')}
                                                </span>
                                            </td>
                                            <td className="max-w-[300px] truncate">
                                                <div className="font-bold text-xs text-slate-700">{log.description}</div>
                                            </td>
                                            <td>
                                                {log.fuel_stations ? (
                                                    <div className="log-meta-pill">
                                                        <FiTarget className="opacity-40" />
                                                        <span>{log.fuel_stations.station_name}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] font-black uppercase opacity-20 tracking-widest">Global Scope</span>
                                                )}
                                            </td>
                                            <td className="text-right">
                                                <button className="action-circle view">
                                                    {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                                                </button>
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <tr key={`${log.id}-expanded`}>
                                                <td colSpan={6} className="p-0">
                                                    <div className="log-expansion-panel animate-fade-in">
                                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                                            <div>
                                                                <label className="changes-label">Technical Metadata</label>
                                                                <div className="flex flex-col gap-3">
                                                                    <div className="flex justify-between text-xs"><span className="opacity-40 uppercase font-black">Entry ID:</span> <span className="font-mono">{log.id}</span></div>
                                                                    <div className="flex justify-between text-xs"><span className="opacity-40 uppercase font-black">Ref Tag:</span> <span className="font-mono">{log.action_type}</span></div>
                                                                </div>
                                                            </div>
                                                            {log.changes_made && (
                                                                <div>
                                                                    <label className="changes-label">Payload Delta</label>
                                                                    <div className="log-changes-box">
                                                                        <pre className="changes-pre">
                                                                            {typeof log.changes_made === 'string' 
                                                                                ? log.changes_made 
                                                                                : JSON.stringify(log.changes_made, null, 2)}
                                                                        </pre>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    if (isHubView) return content;
    return <Layout>{content}</Layout>;
};

export default AdminLogs;
