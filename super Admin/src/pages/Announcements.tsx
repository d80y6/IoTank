import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { communicationService, DashboardBanner, NewsletterTemplate } from '../services/communicationService';
import { supabase } from '../config/supabase';
import { 
    FiSend, FiMail, FiMessageSquare, FiMonitor, 
    FiBell, FiCalendar, FiUsers, FiBarChart2, 
    FiActivity, FiLayout, FiPlus, FiMoreVertical,
    FiCheckCircle, FiAlertCircle, FiClock, FiEye,
    FiTrash2, FiEdit3, FiChevronRight, FiChevronDown,
    FiSmartphone, FiFileText, FiLayers, FiType,
    FiImage, FiMinusCircle, FiMove, FiTarget,
    FiInfo, FiSearch
} from 'react-icons/fi';
import './Announcements.css';

const Announcements: React.FC<{ isHubView?: boolean }> = ({ isHubView }) => {

    const [activeTab, setActiveTab] = useState<'build' | 'history' | 'banners' | 'newsletters'>('build');
    const [history, setHistory] = useState<any[]>([]);
    const [banners, setBanners] = useState<DashboardBanner[]>([]);
    const [templates, setTemplates] = useState<NewsletterTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedChannels, setSelectedChannels] = useState<string[]>(['Dashboard']);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [targetAudience, setTargetAudience] = useState('All Active Clients');
    const [isSending, setIsSending] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [annData, bannerData, templateData] = await Promise.all([
                supabase.from('global_announcements').select('*').order('created_at', { ascending: false }),
                communicationService.getActiveBanners(),
                communicationService.getNewsletterTemplates()
            ]);
            setHistory(annData.data || []);
            setBanners(bannerData || []);
            setTemplates(templateData || []);
        } catch (error) {
            console.error('Error fetching communication data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const toggleChannel = (channel: string) => {
        setSelectedChannels(prev => 
            prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel]
        );
    };

    const handleSend = async () => {
        if (!subject || !body) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Incomplete Broadcast',
                    message: 'Please provide both a subject and a message body.',
                    type: 'warning'
                }
            }));
            return;
        }
        if (selectedChannels.length === 0) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Channel Error',
                    message: 'Select at least one delivery channel for transmission.',
                    type: 'warning'
                }
            }));
            return;
        }
        setIsSending(true);
        try {
            const { error } = await supabase.from('global_announcements').insert({
                subject,
                body,
                channels: selectedChannels,
                target_audience: targetAudience,
                status: 'sent',
                created_by: (await supabase.auth.getUser()).data.user?.id
            });
            if (error) throw error;
            
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Broadcast Successful',
                    message: 'The announcement has been queued and transmitted to all selected channels.',
                    type: 'success'
                }
            }));
            setSubject('');
            setBody('');
            await fetchData();
            setActiveTab('history');
        } catch (error: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Broadcast Failed',
                    message: error.message || 'An unexpected error occurred during transmission.',
                    type: 'error'
                }
            }));
        } finally {
            setIsSending(false);
        }
    };

    const renderBuildAnnouncement = () => (
        <div className="builder-studio animate-fade-in">
            <div className="builder-main">
                <div className="mb-8">
                    <label className="info-label">Announcement Subject</label>
                    <input 
                        type="text" 
                        placeholder="e.g., Scheduled Maintenance: System Upgrade v2.4.0" 
                        className="support-input font-bold text-lg" 
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                    />
                </div>

                <div className="mb-8">
                    <div className="flex justify-between items-end mb-4">
                        <label className="info-label">Broadcast Payload (Body)</label>
                        <div className="flex gap-2 text-[10px] font-black uppercase text-slate-400">
                            <span>Markdown Supported</span>
                        </div>
                    </div>
                    <div className="rich-text-editor">
                        <textarea 
                            placeholder="Compose your high-fidelity broadcast message here..."
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                        ></textarea>
                    </div>
                </div>

                <div className="flex justify-between items-center gap-6 mt-12 bg-slate-50 p-8 rounded-3xl border border-slate-100">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-600 text-2xl">
                            <FiSend />
                        </div>
                        <div>
                            <h4 className="font-black text-slate-800 tracking-tight lowercase">ready to deploy broadcast?</h4>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">transmissions are queued for immediate execution</p>
                        </div>
                    </div>
                     <div className="flex gap-3">
                          <button className="px-6 py-3 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-white transition-all">Dry Run Preview</button>
                          <button 
                            className="px-8 py-3 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-700 transition-all shadow-lg shadow-amber-600/20"
                            disabled={isSending}
                            onClick={handleSend}
                          >
                            {isSending ? 'Transmitting...' : 'Execute Broadcast'}
                          </button>
                     </div>
                </div>
            </div>

            <aside className="builder-sidebar">
                <div className="builder-main" style={{ padding: '1.5rem' }}>
                    <h5 className="font-black lowercase tracking-tighter text-2xl mb-6">Delivery Channels</h5>
                    <div className="channel-pill-group">
                        {[
                            { id: 'Email', icon: <FiMail /> },
                            { id: 'SMS', icon: <FiMessageSquare /> },
                            { id: 'Dashboard', icon: <FiMonitor /> },
                            { id: 'Push', icon: <FiSmartphone /> }
                        ].map(ch => (
                            <div 
                                key={ch.id} 
                                className={`channel-pill ${selectedChannels.includes(ch.id) ? 'active' : ''}`}
                                onClick={() => toggleChannel(ch.id)}
                            >
                                <div className="text-xl">{ch.icon}</div>
                                <span className="text-[10px] font-black uppercase tracking-widest">{ch.id}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="builder-main" style={{ padding: '1.5rem' }}>
                    <h5 className="font-black lowercase tracking-tighter text-2xl mb-6">Target Parameters</h5>
                    <div className="space-y-4">
                        <select 
                            className="support-input font-bold"
                            value={targetAudience}
                            onChange={(e) => setTargetAudience(e.target.value)}
                        >
                            <option>All Active Clients</option>
                            <option>Specific Tier: Enterprise</option>
                            <option>County: Nairobi</option>
                        </select>
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                             <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 mb-2">
                                 <span>Audience Coverage</span>
                                 <span className="text-blue-600">~1,250 Nodes</span>
                             </div>
                             <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                 <div className="h-full bg-blue-600" style={{width: '65%'}}></div>
                             </div>
                        </div>
                    </div>
                </div>
            </aside>
        </div>
    );

    const renderHistory = () => (
        <div className="history-section animate-fade-in">
             <div className="dp-stats-grid">
                 {[
                    { label: 'Total Deployments', val: history.length, icon: <FiSend />, color: '#f59e0b' },
                    { label: 'Avg Open Rate', val: '58.4%', icon: <FiBarChart2 />, color: '#10b981' },
                    { label: 'Engagement Index', val: '12.8%', icon: <FiTarget />, color: '#06b6d4' },
                    { label: 'Scheduled Queue', val: '3', icon: <FiClock />, color: '#8b5cf6' }
                 ].map(k => (
                    <div key={k.label} className="dp-premium-stat-card">
                         <div className="stat-icon-blob" style={{ background: `${k.color}10`, color: k.color }}>{k.icon}</div>
                         <div className="stat-content">
                            <label>{k.label}</label>
                            <h3>{k.val}</h3>
                         </div>
                    </div>
                 ))}
             </div>

             <div className="tdv-transaction-table-container mt-12">
                <table className="ticket-table">
                    <thead>
                        <tr>
                            <th>Deployment Date</th>
                            <th>Subject & Transmission Vector</th>
                            <th>Node Coverage</th>
                            <th>Interaction Metrics</th>
                            <th>Status</th>
                            <th className="text-right">Audit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.map(h => (
                            <tr key={h.id}>
                                <td className="text-xs font-mono opacity-40">{new Date(h.created_at).toLocaleDateString()}</td>
                                <td>
                                    <div className="font-bold text-sm tracking-tight">{h.subject}</div>
                                    <div className="flex gap-2 mt-1.5">
                                        {(h.channels || []).map((m: string) => (
                                            <span key={m} className="text-[9px] font-black uppercase text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded-md">{m}</span>
                                        ))}
                                    </div>
                                </td>
                                <td className="font-black text-sm text-blue-600">{(h.recipients_count || 0).toLocaleString()} <span className="text-[10px] opacity-40">nodes</span></td>
                                <td>
                                    <div className="flex gap-6">
                                        <div className="text-center">
                                             <div className="text-[9px] font-black text-slate-400 uppercase">Open</div>
                                             <div className="text-xs font-black text-emerald-600">{h.open_rate || 0}%</div>
                                        </div>
                                        <div className="text-center">
                                             <div className="text-[9px] font-black text-slate-400 uppercase">Click</div>
                                             <div className="text-xs font-black text-amber-500">{h.click_rate || 0}%</div>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <span className={`su-status-badge ${h.status === 'sent' ? 'su-active' : 'su-pending'}`}>
                                        {h.status}
                                    </span>
                                </td>
                                <td className="text-right">
                                    <button className="action-circle view"><FiEye size={16}/></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
             </div>
        </div>
    );

    const renderBanners = () => (
        <div className="banners-section animate-fade-in">
            <div className="flex justify-between items-end mb-8">
                 <div className="dp-title-group">
                    <h3 className="text-2xl font-black lowercase tracking-tighter">Live dashboard banners</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">active persistent notifications across the platform ecosystem</p>
                 </div>
                 <button className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2">
                    <FiPlus /> Initialize Banner
                </button>
            </div>

            <div className="space-y-3">
                {banners.map(b => (
                    <div key={b.id} className={`banner-item ${b.type === 'warning' ? 'warning' : 'critical'}`}>
                         <div className="flex items-center gap-6">
                            <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-xl">
                                {b.type === 'warning' ? <FiAlertCircle className="text-amber-500" /> : <FiAlertCircle className="text-rose-600" />}
                            </div>
                            <div>
                                <div className="text-sm font-bold text-slate-700">{b.message}</div>
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Vector: {b.target} Nodes • {b.is_dismissible ? 'Dismissible' : 'Immutable'}</div>
                            </div>
                         </div>
                         <div className="flex gap-2">
                             <button className="action-circle view"><FiEdit3 size={14}/></button>
                             <button className="action-circle delete"><FiTrash2 size={14}/></button>
                         </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderNewsletters = () => (
        <div className="newsletters-section animate-fade-in">
             <div className="builder-studio">
                 <div className="builder-main">
                      <div className="newsletter-editor-space flex flex-col gap-4">
                           <div className="newsletter-block flex justify-between items-center group">
                                <div className="flex items-center gap-4">
                                    <FiMove className="opacity-20 group-hover:opacity-100 transition-opacity" />
                                    <div className="text-[10px] font-black uppercase text-blue-600 tracking-widest">Global Header Node</div>
                                </div>
                                <FiMinusCircle className="opacity-0 group-hover:opacity-100 text-rose-500 cursor-pointer" />
                           </div>
                           <div className="newsletter-block flex justify-between items-center group">
                                <div className="flex items-center gap-4">
                                    <FiMove className="opacity-20 group-hover:opacity-100 transition-opacity" />
                                    <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Intelligence Spotlight: AI Forensics</div>
                                </div>
                                <FiMinusCircle className="opacity-0 group-hover:opacity-100 text-rose-500 cursor-pointer" />
                           </div>
                           <div className="newsletter-block border-dashed border-2 py-12 flex items-center justify-center opacity-40 hover:opacity-100 transition-all cursor-pointer">
                                <div className="text-center">
                                     <FiPlus size={24} className="mx-auto mb-2 text-blue-600" />
                                     <span className="text-[10px] font-black uppercase tracking-widest">Append Content Block</span>
                                </div>
                           </div>
                      </div>
                 </div>

                 <aside className="builder-sidebar">
                      <div className="builder-main" style={{ padding: '1.5rem' }}>
                           <h5 className="font-black lowercase tracking-tighter text-2xl mb-6">Component Library</h5>
                           <div className="grid grid-cols-2 gap-3">
                                {[
                                    { label: 'Headline', icon: <FiType /> },
                                    { label: 'Visual', icon: <FiImage /> },
                                    { label: 'Copytext', icon: <FiFileText /> },
                                    { label: 'Action', icon: <FiTarget /> },
                                    { label: 'Stat Grid', icon: <FiBarChart2 /> },
                                    { label: 'Footer', icon: <FiLayers /> }
                                ].map(lib => (
                                    <div key={lib.label} className="p-4 bg-slate-50 rounded-2xl flex flex-col items-center gap-2 cursor-grab hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200">
                                         <div className="text-xl text-slate-400">{lib.icon}</div>
                                         <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">{lib.label}</span>
                                    </div>
                                ))}
                           </div>
                      </div>

                      <div className="builder-main" style={{ padding: '1.5rem' }}>
                           <h5 className="font-black lowercase tracking-tighter text-2xl mb-6">Presets</h5>
                           <div className="space-y-3">
                                {templates.map(t => (
                                    <div key={t.id} className="p-4 rounded-2xl border border-slate-100 bg-white hover:border-blue-600 transition-all group cursor-pointer shadow-sm">
                                         <div className="text-xs font-black text-slate-800 tracking-tight lowercase">{t.name}</div>
                                         <div className="flex justify-between items-center mt-3">
                                              <span className="text-[8px] font-black uppercase text-blue-600/50">{t.category}</span>
                                              <span className="text-[8px] font-mono opacity-20">{t.last_modified}</span>
                                         </div>
                                    </div>
                                ))}
                           </div>
                      </div>
                 </aside>
             </div>
        </div>
    );

    const content = (
        <div className="announcements-page">
            <header className="dp-header">
                    <div className="dp-title-group">
                        <h1 className="lowercase">announcements & communications</h1>
                        <div className="dp-subtitle">Strategic System Broadcasting & Engagement Logistics Console</div>
                    </div>
                </header>

                <div className="hw-tabs mb-8">
                    {[
                        { id: 'build', label: 'Broadcast Studio' },
                        { id: 'history', label: 'Deployment Logs' },
                        { id: 'banners', label: 'Platform Banners' },
                        { id: 'newsletters', label: 'Engagement Engine' }
                    ].map(tab => (
                        <button 
                            key={tab.id}
                            className={`hw-tab-btn ${activeTab === tab.id ? 'active' : ''}`} 
                            onClick={() => setActiveTab(tab.id as any)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-40">
                         <div className="w-10 h-10 border-4 border-amber-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                         <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Synchronizing Global Airwaves...</p>
                    </div>
                ) : (
                    <>
                        {activeTab === 'build' && renderBuildAnnouncement()}
                        {activeTab === 'history' && renderHistory()}
                        {activeTab === 'banners' && renderBanners()}
                        {activeTab === 'newsletters' && renderNewsletters()}
                    </>
                )}
            </div>
    );

    if (isHubView) return content;
    return <Layout>{content}</Layout>;
};

export default Announcements;
