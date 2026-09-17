import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { supabase } from '../config/supabase';
import { FiDatabase, FiActivity, FiRefreshCw, FiCpu, FiKey } from 'react-icons/fi';
import './SecurityEvents.css';

type ToolResult = { name: string; ok: boolean; value: string };

const DATA_TOOLS = [
    { id: 'migrate_legacy_sensor_readings', label: 'Migrate Legacy Sensor Readings', desc: 'Folds sensor_readings_legacy rows into the partitioned sensor_readings table (dedupes by metadata.source_id).', needs: 'p_limit', def: '1000' },
    { id: 'backfill_events_pre_partition', label: 'Backfill Pre-Partition Events', desc: 'Copies unified_events rows that predate partitioning into monthly partitions (dedupes by metadata.source_id).', needs: 'p_limit', def: '1000' },
    { id: 'cleanup_old_events', label: 'Cleanup Old Events', desc: 'Purges aged event rows according to retention rules.', needs: null },
    { id: 'cleanup_old_rss_cache', label: 'Cleanup Old RSS Cache', desc: 'Deletes rss_cache rows older than 24 hours.', needs: null },
    { id: 'refresh_tank_analytics', label: 'Refresh Tank Analytics (30d)', desc: 'Rebuilds the tank_analytics_30d materialized view from live partitioned readings.', needs: null },
] as const;

const PROBE_RPCS = [
    'check_is_super_admin',
    'check_is_staff',
    'check_station_active',
    'check_index_exists',
    'get_my_station_id',
    'get_user_station_id',
    'get_station_id_from_auth',
    'get_user_client_id',
    'current_auth_uid_text',
    'firebase_uid',
    'user_owns_client',
    'has_client_access',
] as const;

const SYSTEM_TABLES = [
    { id: 'auth_events', label: 'auth_events' },
    { id: 'auth_attempts', label: 'auth_attempts' },
    { id: 'edge_rate_limits', label: 'edge_rate_limits' },
    { id: 'scraper_rate_limits', label: 'scraper_rate_limits' },
    { id: 'internal_api_keys', label: 'internal_api_keys' },
    { id: 'telemetry_history', label: 'telemetry_history' },
] as const;

const SystemUtilities: React.FC = () => {
    const [toast, setToast] = useState<{ show: boolean; type: string; title: string; message: string }>({ show: false, type: 'info', title: '', message: '' });
    const [results, setResults] = useState<Record<string, ToolResult>>({});
    const [busyTool, setBusyTool] = useState<string | null>(null);
    const [limitInput, setLimitInput] = useState<Record<string, string>>({});
    const [probes, setProbes] = useState<Record<string, ToolResult>>({});
    const [probing, setProbing] = useState(false);
    const [activeTable, setActiveTable] = useState<string>('auth_events');
    const [tableRows, setTableRows] = useState<any[]>([]);
    const [tableLoading, setTableLoading] = useState(false);

    const notify = (title: string, message: string, type = 'success') =>
        setToast({ show: true, type, title, message: String(message).slice(0, 600) });

    const runTool = async (id: string) => {
        setBusyTool(id);
        try {
            const args: Record<string, any> = {};
            const tool = DATA_TOOLS.find(t => t.id === id);
            if (tool?.needs === 'p_limit') args.p_limit = parseInt(limitInput[id] || tool.def, 10) || 1;
            const { data, error } = await supabase.rpc(id, args);
            if (error) throw error;
            const value = data === null || data === undefined
                ? 'OK'
                : typeof data === 'object' ? JSON.stringify(data) : String(data);
            setResults(prev => ({ ...prev, [id]: { name: id, ok: true, value } }));
            notify('Operation Complete', `RPC ${id} returned: ${value}`);
        } catch (err: any) {
            setResults(prev => ({ ...prev, [id]: { name: id, ok: false, value: err.message } }));
            notify('Operation Failed', err.message, 'error');
        } finally {
            setBusyTool(null);
        }
    };

    const runProbes = async () => {
        setProbing(true);
        const out: Record<string, ToolResult> = {};
        await Promise.all(PROBE_RPCS.map(async (name) => {
            try {
                const args = name === 'check_index_exists' ? { p_index_name: 'tank_analytics_30d_pkey' } : {};
                const { data, error } = await supabase.rpc(name, args);
                if (error) throw error;
                out[name] = { name, ok: true, value: data === null || data === undefined ? 'null' : typeof data === 'object' ? JSON.stringify(data) : String(data) };
            } catch (err: any) {
                out[name] = { name, ok: false, value: err.message };
            }
        }));
        setProbes(out);
        setProbing(false);
    };

    const fetchTable = useCallback(async (table: string) => {
        setTableLoading(true);
        try {
            let query = supabase.from(table).select('*', { count: 'exact' }).limit(12);
            if (['auth_events', 'auth_attempts', 'telemetry_history', 'edge_rate_limits', 'scraper_rate_limits', 'internal_api_keys'].includes(table)) {
                query = query.order('created_at', { ascending: false });
            }
            const { data, error, count } = await query;
            if (error) throw error;
            setTableRows(data || []);
            setToast(prev => ({ show: false, type: 'info', title: '', message: '' }));
            if (data && data.length === 0) setToast({ show: true, type: 'info', title: table, message: `(no rows returned; total in table: ${count ?? 'n/a'})` });
        } catch (err: any) {
            setTableRows([]);
            setToast({ show: true, type: 'error', title: 'Table Load Failed', message: err.message });
        } finally {
            setTableLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTable(activeTable);
    }, [activeTable, fetchTable]);

    const tableCols = (rows: any[]): string[] => {
        const set = new Set<string>();
        rows.forEach(r => Object.keys(r).forEach(k => set.add(k)));
        return Array.from(set).slice(0, 7);
    };

    return (
        <Layout>
            <div className="p-8 max-w-6xl">
                {toast.show && (
                    <div className={`mb-6 p-4 rounded-lg border-2 text-xs font-bold uppercase tracking-widest ${toast.type === 'error' ? 'bg-danger/10 border-danger text-danger' : 'bg-success/10 border-success text-success'}`}>
                        {toast.title}: {toast.message}
                    </div>
                )}

                <header className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 rounded-xl bg-accent-primary/20 flex items-center justify-center text-accent-primary">
                        <FiDatabase size={22} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black uppercase tracking-tight text-primary">System Utilities</h1>
                        <p className="text-xs text-secondary font-bold uppercase tracking-widest mt-1">data tools · diagnostics · edge infra</p>
                    </div>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <section className="card p-6">
                        <h2 className="text-sm font-black mb-6 flex items-center gap-2 text-primary uppercase tracking-widest">
                            <FiDatabase className="text-accent-primary" /> data tools
                        </h2>
                        <div className="flex flex-col gap-4">
                            {DATA_TOOLS.map((tool) => (
                                <div key={tool.id} className="p-4 rounded-lg bg-bg-tertiary border border-divider">
                                    <p className="font-bold text-primary text-sm">{tool.label}</p>
                                    <p className="text-[11px] text-secondary font-medium mt-1 mb-3">{tool.desc}</p>
                                    <div className="flex items-center gap-3">
                                        {tool.needs === 'p_limit' && (
                                            <input
                                                type="number"
                                                className="w-24 px-2 py-1 text-xs bg-bg-primary border border-divider rounded font-bold"
                                                value={limitInput[tool.id] || tool.def}
                                                onChange={(e) => setLimitInput(prev => ({ ...prev, [tool.id]: e.target.value }))}
                                            />
                                        )}
                                        <button onClick={() => runTool(tool.id)} disabled={busyTool === tool.id} className="btn btn-secondary btn-sm font-black uppercase text-[10px]">
                                            {busyTool === tool.id ? 'Running...' : 'Run'}
                                        </button>
                                        {results[tool.id] && (
                                            <span className={`text-[10px] font-black uppercase ${results[tool.id].ok ? 'text-success' : 'text-danger'}`}>
                                                {results[tool.id].ok ? 'ok' : 'failed'}
                                            </span>
                                        )}
                                    </div>
                                    {results[tool.id] && (
                                        <pre className="mt-3 p-2 text-[10px] bg-bg-primary border border-divider rounded overflow-x-auto font-mono">{results[tool.id].value}</pre>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="card p-6">
                        <h2 className="text-sm font-black mb-6 flex items-center gap-2 text-primary uppercase tracking-widest">
                            <FiCpu className="text-accent-primary" /> diagnostic probes
                        </h2>
                        <button onClick={runProbes} disabled={probing} className="btn btn-secondary btn-sm font-black uppercase text-[10px] mb-4 flex items-center gap-2">
                            <FiRefreshCw className={probing ? 'animate-spin' : ''} /> {probing ? 'Probing...' : 'Run Diagnostics'}
                        </button>
                        <div className="grid grid-cols-2 gap-3">
                            {PROBE_RPCS.map((name) => (
                                <div key={name} className="flex items-center justify-between p-3 rounded-lg bg-bg-tertiary border border-divider">
                                    <span className="font-bold text-primary text-[11px]">{name}</span>
                                    <span className={`text-[10px] font-black ${probes[name]?.ok ? 'text-success' : probes[name] ? 'text-danger' : 'text-disabled'}`}>
                                        {probes[name] ? (probes[name].ok ? 'ok' : 'fail') : '···'}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 flex flex-col gap-2">
                            {Object.entries(probes).map(([name, r]) => (
                                <pre key={name} className="p-2 text-[10px] bg-bg-primary border border-divider rounded overflow-x-auto font-mono">
                                    {name}: {r.value}
                                </pre>
                            ))}
                        </div>
                    </section>

                    <section className="card p-6 lg:col-span-2">
                        <h2 className="text-sm font-black mb-6 flex items-center gap-2 text-primary uppercase tracking-widest">
                            <FiActivity className="text-accent-primary" /> system tables viewer
                        </h2>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {SYSTEM_TABLES.map((t) => (
                                <button key={t.id} onClick={() => setActiveTable(t.id)} className={`btn btn-sm font-black uppercase text-[10px] ${activeTable === t.id ? 'btn-primary' : 'btn-secondary'}`}>
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        {tableLoading ? (
                            <div className="p-10 text-center text-secondary font-bold uppercase tracking-widest text-xs animate-pulse">reading {activeTable}...</div>
                        ) : tableRows.length === 0 ? (
                            <div className="p-10 text-center text-secondary italic text-xs bg-bg-tertiary rounded-lg border border-dashed border-divider">
                                no rows currently visible in {activeTable} (RLS / service-role only source).
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-left text-[10px] uppercase tracking-widest text-secondary border-b border-divider">
                                            {tableCols(tableRows).map((c) => <th key={c} className="py-2 pr-4 font-black">{c}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tableRows.map((row, i) => (
                                            <tr key={i} className="border-b border-divider/50">
                                                {tableCols(tableRows).map((c) => (
                                                    <td key={c} className="py-2 pr-4 text-primary font-medium">
                                                        {typeof row[c] === 'object' && row[c] !== null ? JSON.stringify(row[c]) : String(row[c] ?? '∅').slice(0, 48)}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </div>

                <div className="mt-8 p-4 rounded-lg bg-bg-tertiary border border-divider flex items-start gap-3">
                    <FiKey className="text-accent-primary mt-0.5" />
                    <p className="text-[11px] text-secondary font-medium">
                        Internal API keys are issued to provider clients; management lives in the provider engine, this view is read-only. Rate-limit rows are written by edge-functions at request time.
                    </p>
                </div>
            </div>
        </Layout>
    );
};

export default SystemUtilities;