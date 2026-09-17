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
    const [showPreview, setShowPreview] = useState(false);
    const [previewAnnouncement, setPreviewAnnouncement] = useState<any | null>(null);
    const [contentBlocks, setContentBlocks] = useState<{ id: string; type: string; label: string; text: string }[]>([
        { id: 'block-header', type: 'Headline', label: 'Headline', text: 'GLOBAL HEADLINE NODE' },
        { id: 'block-intel', type: 'Copytext', label: 'Copytext', text: 'Intelligence Spotlight: AI Forensics' }
    ]);
    const [bannerFormOpen, setBannerFormOpen] = useState(false);
    const [editingBanner, setEditingBanner] = useState<DashboardBanner | null>(null);
    const [bannerMessage, setBannerMessage] = useState('');
    const [bannerType, setBannerType] = useState<DashboardBanner['type']>('info');
    const [savingBanner, setSavingBanner] = useState(false);

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

    const totalRecipients = history.reduce((s, h) => s + (h.recipients_count || 0), 0);
    const audienceCoverageWidth = totalRecipients > 0
        ? Math.min(100, Math.round(history.filter(h => (h.recipients_count || 0) > 0).length / Math.max(history.length, 1) * 100))
        : 0;

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

    const handlePreview = () => {
        if (!subject && !body) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Nothing to Preview',
                    message: 'Compose a subject or message body before previewing the broadcast.',
                    type: 'warning'
                }
            }));
            return;
        }
        setShowPreview(!showPreview);
    };

    const blockDefaults: Record<string, { label: string; text: string }> = {
        'Headline': { label: 'Headline', text: 'YOUR HEADLINE HERE' },
        'Visual': { label: 'Visual', text: '[Visual asset slot — paste a media URL]' },
        'Copytext': { label: 'Copytext', text: 'Insert body copy for this section...' },
        'Action': { label: 'Action', text: '[Call to action — button label]' },
        'Stat Grid': { label: 'Stat Grid', text: 'Metric 01 — 42% | Metric 02 — 1,240 | Metric 03 — 99.2%' },
        'Footer': { label: 'Footer', text: '© 2026 The IoTank — Standard Footer' }
    };

    const makeContentBlock = (type: string): { id: string; type: string; label: string; text: string } => {
        const preset = blockDefaults[type] || { label: type, text: '' };
        return {
            id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type,
            label: preset.label,
            text: preset.text
        };
    };

    const appendContentBlock = (type?: string) => {
        setContentBlocks(prev => [...prev, makeContentBlock(type || 'Copytext')]);
    };

    const updateContentBlock = (id: string, text: string) => {
        setContentBlocks(prev => prev.map(b => b.id === id ? { ...b, text } : b));
    };

    const applyTemplate = (t: NewsletterTemplate) => {
        setContentBlocks(prev => [
            ...prev,
            makeContentBlock('Copytext'),
            { id: `block-${Date.now()}`, type: 'Copytext', label: t.name, text: `${t.category} campaign — populate this section with the ${t.name} briefing.` }
        ]);
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Preset Applied',
                message: `Template "${t.name}" staged into the engagement editor.`,
                type: 'success'
            }
        }));
    };

    const removeContentBlock = (index: number) => {
        setContentBlocks(prev => prev.filter((_, i) => i !== index));
    };

    const handleSaveBanner = async () => {
        if (!bannerMessage.trim()) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Missing Banner Message',
                    message: 'Provide a message for the dashboard banner.',
                    type: 'warning'
                }
            }));
            return;
        }
        setSavingBanner(true);
        try {
            const user = (await supabase.auth.getUser()).data.user;
            if (editingBanner) {
                const { error } = await supabase
                    .from('dashboard_banners')
                    .update({ message: bannerMessage.trim(), type: bannerType })
                    .eq('id', editingBanner.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('dashboard_banners')
                    .insert({
                        message: bannerMessage.trim(),
                        type: bannerType,
                        target: 'All',
                        is_dismissible: true,
                        is_active: true,
                        created_by: user?.id
                    });
                if (error) throw error;
            }
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: editingBanner ? 'Banner Updated' : 'Banner Initialized',
                    message: editingBanner ? 'The dashboard banner has been updated.' : 'The dashboard banner is now live across the platform.',
                    type: 'success'
                }
            }));
            setBannerFormOpen(false);
            setEditingBanner(null);
            setBannerMessage('');
            await fetchData();
        } catch (error: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Banner Operation Failed',
                    message: error.message || 'An unexpected error occurred while saving the banner.',
                    type: 'error'
                }
            }));
        } finally {
            setSavingBanner(false);
        }
    };

    const handleDeleteBanner = async (banner: DashboardBanner) => {
        try {
            const { error } = await supabase
                .from('dashboard_banners')
                .delete()
                .eq('id', banner.id);
            if (error) throw error;
            await fetchData();
        } catch (error: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Banner Removal Failed',
                    message: error.message || 'An unexpected error occurred while removing the banner.',
                    type: 'error'
                }
            }));
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

                {showPreview && (
                    <div className="mb-8 p-6 bg-white border border-slate-200 rounded-2xl">
                        <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Broadcast Preview</div>
                        {subject && <div className="text-sm font-black text-slate-800 mb-2">{subject}</div>}
                        <div className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{body}</div>
                        {selectedChannels.length > 0 && (
                            <div className="flex gap-2 mt-4">
                                {selectedChannels.map(ch => (
                                    <span key={ch} className="text-[9px] font-black uppercase text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded-md">{ch}</span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

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
                          <button className="px-6 py-3 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-white transition-all" onClick={handlePreview}>Dry Run Preview</button>
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
                            <option>Region: East Africa</option>
                        </select>
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                             <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 mb-2">
                                 <span>Audience Coverage</span>
                                 <span className="text-blue-600">{totalRecipients > 0 ? `${totalRecipients.toLocaleString()} nodes` : '—'}</span>
                             </div>
                             <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                 <div className="h-full bg-blue-600" style={{width: `${audienceCoverageWidth}%`}}></div>
                             </div>
                        </div>
                    </div>
                </div>
            </aside>
        </div>
    );

    const renderHistory = () => {
        const avgOpen = history.length ? history.reduce((s, h) => s + (h.open_rate || 0), 0) / history.length : null;
        const avgClick = history.length ? history.reduce((s, h) => s + (h.click_rate || 0), 0) / history.length : null;
        const scheduled = history.filter(h => h.status === 'scheduled').length;
        return (
        <div className="history-section animate-fade-in">
             <div className="dp-stats-grid">
                 {[
                    { label: 'Total Deployments', val: history.length, icon: <FiSend />, color: '#f59e0b' },
                    { label: 'Avg Open Rate', val: avgOpen === null ? '—' : `${avgOpen.toFixed(1)}%`, icon: <FiBarChart2 />, color: '#10b981' },
                    { label: 'Engagement Index', val: avgClick === null ? '—' : `${avgClick.toFixed(1)}%`, icon: <FiTarget />, color: '#06b6d4' },
                    { label: 'Scheduled Queue', val: `${scheduled}`, icon: <FiClock />, color: '#8b5cf6' }
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
                                    <button className="action-circle view" onClick={() => setPreviewAnnouncement(h)}><FiEye size={16}/></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
             </div>
        </div>
        );
    };

    const renderBanners = () => (
        <div className="banners-section animate-fade-in">
            <div className="flex justify-between items-end mb-8">
                 <div className="dp-title-group">
                    <h3 className="text-2xl font-black lowercase tracking-tighter">Live dashboard banners</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">active persistent notifications across the platform ecosystem</p>
                 </div>
                 <button className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2" onClick={() => { setEditingBanner(null); setBannerMessage(''); setBannerType('info'); setBannerFormOpen(!bannerFormOpen); }}>
                    <FiPlus /> {bannerFormOpen ? 'Close Panel' : 'Initialize Banner'}
                </button>
            </div>

            {bannerFormOpen && (
                <div className="mb-6 p-6 bg-white rounded-2xl border border-slate-200">
                    <label className="info-label">Banner Message</label>
                    <input
                        className="support-input font-bold"
                        placeholder="e.g., Scheduled maintenance on 2026-09-20"
                        value={bannerMessage}
                        onChange={(e) => setBannerMessage(e.target.value)}
                    />
                    <div className="mt-4 flex items-center gap-4">
                        <select className="support-input font-bold" value={bannerType} onChange={e => setBannerType(e.target.value as DashboardBanner['type'])}>
                            <option value="info">Info</option>
                            <option value="warning">Warning</option>
                            <option value="error">Error</option>
                            <option value="success">Success</option>
                        </select>
                        <button
                            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-50"
                            disabled={savingBanner}
                            onClick={handleSaveBanner}
                        >
                            {savingBanner ? 'Saving...' : editingBanner ? 'Update Banner' : 'Create Banner'}
                        </button>
                    </div>
                </div>
            )}

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
                             <button className="action-circle view" onClick={() => { setEditingBanner(b); setBannerMessage(b.message); setBannerType(b.type); setBannerFormOpen(true); }}><FiEdit3 size={14}/></button>
                             <button className="action-circle delete" onClick={() => handleDeleteBanner(b)}><FiTrash2 size={14}/></button>
                         </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderNewsletters = () => {
        const blockTypeTag: Record<string, string> = {
            'Headline': 'text-blue-600 bg-blue-50 border-blue-100',
            'Visual': 'text-purple-600 bg-purple-50 border-purple-100',
            'Copytext': 'text-slate-500 bg-slate-50 border-slate-100',
            'Action': 'text-amber-600 bg-amber-50 border-amber-100',
            'Stat Grid': 'text-emerald-600 bg-emerald-50 border-emerald-100',
            'Footer': 'text-slate-400 bg-slate-50 border-slate-100'
        };
        return (
        <div className="newsletters-section animate-fade-in">
             <div className="builder-studio">
                 <div className="builder-main">
                      <div className="newsletter-editor-space flex flex-col gap-4">
                           {contentBlocks.map((block, i) => (
                               <div key={block.id} className="newsletter-block group">
                                    <div className="flex items-center gap-4 w-full">
                                        <FiMove className="opacity-20 group-hover:opacity-100 transition-opacity shrink-0" />
                                        <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${blockTypeTag[block.type] || 'text-slate-400 bg-slate-50 border-slate-100'}`}>{block.type}</span>
                                        <input
                                            type="text"
                                            className="flex-1 min-w-0 bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400"
                                            value={block.text}
                                            placeholder="Block content..."
                                            onChange={(e) => updateContentBlock(block.id, e.target.value)}
                                        />
                                    </div>
                                    <FiMinusCircle className="opacity-0 group-hover:opacity-100 text-rose-500 cursor-pointer shrink-0" onClick={() => removeContentBlock(i)} />
                               </div>
                           ))}
                           <div className="newsletter-block border-dashed border-2 py-12 flex items-center justify-center opacity-40 hover:opacity-100 transition-all cursor-pointer" onClick={() => appendContentBlock()}>
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
<div key={lib.label} className="p-4 bg-slate-50 rounded-2xl flex flex-col items-center gap-2 cursor-pointer hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200" onClick={() => appendContentBlock(lib.label)}>
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
                                    <div key={t.id} className="p-4 rounded-2xl border border-slate-100 bg-white hover:border-blue-600 transition-all group cursor-pointer shadow-sm" onClick={() => applyTemplate(t)}>
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
    };

    const content = (
        <>
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

            {previewAnnouncement && (
                <div className="modal-overlay-premium" onClick={() => setPreviewAnnouncement(null)}>
                    <div className="modal-content-premium animate-fade-in" onClick={e => e.stopPropagation()}>
                        <div className="modal-header-section">
                            <div className="modal-header-icon-container"><FiEye /></div>
                            <div>
                                <h3 className="font-black text-2xl tracking-tighter">{previewAnnouncement.subject}</h3>
                                <p className="text-xs font-bold text-slate-400">{new Date(previewAnnouncement.created_at).toLocaleString()}</p>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{previewAnnouncement.body}</div>
                            <div className="flex gap-2">
                                {(previewAnnouncement.channels || []).map((m: string) => (
                                    <span key={m} className="text-[9px] font-black uppercase text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded-md">{m}</span>
                                ))}
                            </div>
                        </div>
                        <div className="modal-actions-premium">
                            <button type="button" className="btn-premium-primary" onClick={() => setPreviewAnnouncement(null)}>Close Preview</button>
                        </div>
                    </div>
                </div>
            )}

            </>
    );

    if (isHubView) return content;
    return <Layout>{content}</Layout>;
};

export default Announcements;
