import React, { useState } from 'react';
import {
    FiPhone, FiMail, FiShield, FiCheck, FiX,
    FiLayers, FiSettings, FiChevronDown, FiMessageSquare,
    FiZap, FiClock
} from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { useTanks, useSites } from '@/hooks/useSupabase';
import { useModals } from '@/contexts/ModalContext';
import { useMarketNews } from '@/hooks/useMarketNews';
import { supabase } from '@/config/supabase';
import { SupportCategory, SupportSeverity } from '@/types';
import { FAQ_CATEGORIES } from './HelpConstants';
import { HelpModals } from './HelpModals';
import { logger } from '@/utils/logger';
import './HelpPage.css';

export const HelpPage: React.FC = () => {
    const { currentUser } = useAuth();
    const { openModal } = useModals();
    const stationId = currentUser?.stationId || '';
    const { tanks } = useTanks(stationId);
    const { sites } = useSites(stationId);
    const { status: newsStatus } = useMarketNews();

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [attachSnapshot, setAttachSnapshot] = useState(true);
    const [activeCategory, setActiveCategory] = useState(FAQ_CATEGORIES[0].name);
    const [openFaqId, setOpenFaqId] = useState<number | null>(null);

    const [ticketForm, setTicketForm] = useState({
        category: 'telemetry_offline' as SupportCategory,
        severity: 'medium' as SupportSeverity,
        siteId: '',
        tankId: '',
        description: '',
    });

    const handleTicketSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser || !stationId) return;
        setIsSubmitting(true);
        setShowSuccess(false);
        try {
            const { error } = await supabase
                .from('support_tickets')
                .insert({
                    station_id: stationId,
                    subject: `Escalation: ${ticketForm.category.replace(/_/g, ' ')}`,
                    description: ticketForm.description,
                    status: 'open',
                    priority: ticketForm.severity,
                    created_at: new Date().toISOString()
                });
            if (error) throw error;
            setShowSuccess(true);
            setTicketForm({ category: 'telemetry_offline', severity: 'medium', siteId: '', tankId: '', description: '' });
            setTimeout(() => setShowSuccess(false), 5000);
        } catch (error) {
            logger.error('Error creating ticket:', error);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Submission Failed',
                    message: 'Could not create support ticket. Please try again.',
                    type: 'error',
                    attribution: 'SUPPORT CENTER'
                }
            }));
        } finally {
            setIsSubmitting(false);
        }
    };

    const currentFaqs = FAQ_CATEGORIES.find(c => c.name === activeCategory)?.items || [];

    const statusRows = [
        {
            name: 'Edge Telemetry',
            state: tanks.length > 0 ? 'online' : 'warn',
            label: tanks.length > 0 ? 'Operational' : 'Waiting',
        },
        {
            name: `IoT Nodes (${tanks.length} online)`,
            state: tanks.length > 0 ? 'online' : 'offline',
            label: tanks.length > 0 ? 'All Online' : 'Offline',
        },
        {
            name: 'Market Data Feed',
            state: newsStatus === 'ok' ? 'online' : 'warn',
            label: newsStatus === 'ok' ? 'Nominal' : 'Delayed',
        },
    ];

    return (
        <div className="help-page">
            {/* ── Page Header ─────────────────────────────────────── */}
            <div className="hp-header">
                <div className="hp-header-left">
                    <h1>Support Center</h1>
                    <p>Get help, raise tickets, run diagnostics, and browse the knowledge base.</p>
                </div>
                <div className="hp-header-badge">
                    <span className="hp-header-badge-dot" />
                    Systems operational
                </div>
            </div>

            {/* ── Success toast ────────────────────────────────────── */}
            {showSuccess && (
                <div className="hp-success-toast">
                    <FiCheck size={16} />
                    <span>Support ticket created. Our team will be in touch shortly.</span>
                    <button onClick={() => setShowSuccess(false)} title="Dismiss"><FiX size={14} /></button>
                </div>
            )}

            {/* ── Top row: Ticket form + Right sidebar ────────────── */}
            <div className="hp-grid hp-section-gap">
                {/* Ticket Form */}
                <div className="hp-card">
                    <div className="hp-card-header">
                        <div className="hp-card-title">
                            <div className="hp-card-title-icon"><FiMessageSquare size={14} /></div>
                            <h2>Submit a Support Ticket</h2>
                        </div>
                    </div>
                    <div className="hp-card-body">
                        <form onSubmit={handleTicketSubmit} className="hp-form">
                            <div className="hp-form-row">
                                <div className="hp-form-group">
                                    <label className="hp-form-label">Category</label>
                                    <select
                                        className="hp-form-control"
                                        title="Support Category"
                                        value={ticketForm.category}
                                        onChange={e => setTicketForm({ ...ticketForm, category: e.target.value as SupportCategory })}
                                    >
                                        <option value="telemetry_offline">Telemetry Offline</option>
                                        <option value="calibration_drift">Calibration Drift</option>
                                        <option value="ai_forecasting">AI Sync Error</option>
                                        <option value="billing_subscription">Billing &amp; Plan</option>
                                        <option value="compliance_reporting">Regulatory Reporting</option>
                                        <option value="user_access">Access Control</option>
                                        <option value="other">General Query</option>
                                    </select>
                                </div>
                                <div className="hp-form-group">
                                    <label className="hp-form-label">Severity</label>
                                    <select
                                        className="hp-form-control"
                                        title="Severity"
                                        value={ticketForm.severity}
                                        onChange={e => setTicketForm({ ...ticketForm, severity: e.target.value as SupportSeverity })}
                                    >
                                        <option value="low">Low impact</option>
                                        <option value="medium">Medium impact</option>
                                        <option value="high">High operational</option>
                                        <option value="critical">Critical — system down</option>
                                    </select>
                                </div>
                            </div>
                            <div className="hp-form-row">
                                <div className="hp-form-group">
                                    <label className="hp-form-label">Site (optional)</label>
                                    <select
                                        className="hp-form-control"
                                        title="Select Site"
                                        value={ticketForm.siteId}
                                        onChange={e => setTicketForm({ ...ticketForm, siteId: e.target.value })}
                                    >
                                        <option value="">All sites</option>
                                        {sites.map(s => <option key={s.id} value={s.id}>{s.siteName}</option>)}
                                    </select>
                                </div>
                                <div className="hp-form-group">
                                    <label className="hp-form-label">Tank (optional)</label>
                                    <select
                                        className="hp-form-control"
                                        title="Select Tank"
                                        value={ticketForm.tankId}
                                        onChange={e => setTicketForm({ ...ticketForm, tankId: e.target.value })}
                                    >
                                        <option value="">All tanks</option>
                                        {tanks
                                            .filter((t: import('@/types').Tank) => !ticketForm.siteId || t.siteId === ticketForm.siteId)
                                            .map((t: import('@/types').Tank) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="hp-form-group">
                                <label className="hp-form-label">Description</label>
                                <textarea
                                    className="hp-form-control"
                                    placeholder="Describe the issue in detail — what happened, when it started, and any steps you've already tried."
                                    required
                                    value={ticketForm.description}
                                    onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })}
                                />
                            </div>
                            <div className="hp-form-footer">
                                <label className="hp-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={attachSnapshot}
                                        onChange={e => setAttachSnapshot(e.target.checked)}
                                    />
                                    Attach system snapshot
                                </label>
                                <button
                                    type="submit"
                                    className="hp-btn-submit"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'Submitting…' : 'Submit ticket'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Right column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* System Status */}
                    <div className="hp-card">
                        <div className="hp-card-header">
                            <div className="hp-card-title">
                                <div className="hp-card-title-icon"><FiZap size={14} /></div>
                                <h2>System Status</h2>
                            </div>
                        </div>
                        <div className="hp-card-body" style={{ padding: '0 1.5rem' }}>
                            <div className="hp-status-list">
                                {statusRows.map(row => (
                                    <div className="hp-status-row" key={row.name}>
                                        <div className="hp-status-left">
                                            <div className={`hp-status-dot ${row.state}`} />
                                            <span className="hp-status-name">{row.name}</span>
                                        </div>
                                        <span className={`hp-status-badge ${row.state === 'online' ? 'ok' : 'warn'}`}>
                                            {row.label}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Emergency Contact */}
                    <div className="hp-card">
                        <div className="hp-card-header">
                            <div className="hp-card-title">
                                <div className="hp-card-title-icon" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444' }}>
                                    <FiPhone size={14} />
                                </div>
                                <h2>Emergency Contact</h2>
                            </div>
                        </div>
                        <div className="hp-contact-list">
                            <a href="tel:+254111746901" className="hp-contact-item">
                                <div className="hp-contact-icon phone"><FiPhone size={16} /></div>
                                <div>
                                    <p className="hp-contact-detail-label">Phone support</p>
                                    <p className="hp-contact-detail-value">+254 111 746 901</p>
                                </div>
                            </a>
                            <a href="mailto:iotank.com@gmail.com" className="hp-contact-item">
                                <div className="hp-contact-icon email"><FiMail size={16} /></div>
                                <div>
                                    <p className="hp-contact-detail-label">Email</p>
                                    <p className="hp-contact-detail-value">iotank.com@gmail.com</p>
                                </div>
                            </a>
                        </div>
                        <div className="hp-hours-strip">
                            <div>
                                <div className="hp-hours-label">Business hours</div>
                                <div className="hp-hours-value">Mon – Fri, 08:30 – 18:00 EAT</div>
                            </div>
                            <span className="hp-badge-green">
                                <FiClock size={11} />
                                24/7 Priority
                            </span>
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="hp-card">
                        <div className="hp-card-header">
                            <div className="hp-card-title">
                                <div className="hp-card-title-icon"><FiSettings size={14} /></div>
                                <h2>Quick Actions</h2>
                            </div>
                        </div>
                        <div className="hp-quick-actions">
                            <button className="hp-action-card" onClick={() => openModal('support-setup')}>
                                <div className="hp-action-icon"><FiLayers size={16} /></div>
                                <div>
                                    <h4>Setup Wizard</h4>
                                    <p>Provision nodes and tanks</p>
                                </div>
                            </button>
                            <button className="hp-action-card" onClick={() => openModal('support-diagnostics')}>
                                <div className="hp-action-icon"><FiShield size={16} /></div>
                                <div>
                                    <h4>Diagnostics</h4>
                                    <p>Run a full system scan</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Knowledge Base ───────────────────────────────────── */}
            <div className="hp-kb">
                <aside className="hp-kb-sidebar">
                    <span className="hp-kb-sidebar-label">Knowledge Base</span>
                    <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '0.5rem' }}>
                        {FAQ_CATEGORIES.map(cat => (
                            <button
                                key={cat.name}
                                className={`hp-kb-nav-btn ${activeCategory === cat.name ? 'active' : ''}`}
                                onClick={() => { setActiveCategory(cat.name); setOpenFaqId(null); }}
                            >
                                {cat.icon}
                                {cat.name}
                            </button>
                        ))}
                    </nav>
                </aside>

                <main className="hp-kb-main">
                    <div className="hp-kb-main-header">
                        <div className="hp-card-title-icon"><FiShield size={14} /></div>
                        <h3>{activeCategory}</h3>
                    </div>
                    <div className="hp-faq-list">
                        {currentFaqs.map(item => (
                            <div
                                key={item.id}
                                className={`hp-faq-item ${openFaqId === item.id ? 'open' : ''}`}
                            >
                                <button
                                    className="hp-faq-q"
                                    onClick={() => setOpenFaqId(openFaqId === item.id ? null : item.id)}
                                >
                                    <span className="hp-faq-q-text">{item.question}</span>
                                    <FiChevronDown className="hp-faq-chevron" />
                                </button>
                                {openFaqId === item.id && (
                                    <div className="hp-faq-a">
                                        {item.answer}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </main>
            </div>

            <HelpModals />
        </div>
    );
};
