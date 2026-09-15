/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useRef, useEffect } from 'react';
import { FiX, FiSend, FiUser, FiInfo, FiSmartphone, FiAtSign, FiPlus, FiChevronLeft, FiTrash2, FiPhoneCall } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import './LiveChat.css';
import { ChatAIService, RateLimitError } from '../../services/ChatAIService';
import { formatDistanceToNow } from 'date-fns';
import { logger } from '@/utils/logger';

interface Message {
    id: string;
    text: string;
    sender: 'user' | 'ai';
    timestamp: number;
}

interface LeadData {
    name: string;
    email: string;
    phone: string;
    subject: string;
}

interface ChatSession {
    id: string;
    subject: string;
    lead: LeadData;
    messages: Message[];
    createdAt: number;
    lastUpdatedAt: number;
    status: 'active' | 'finished' | 'rated';
    rating?: number;
}

type ChatView = 'list' | 'chat' | 'form';

export const LiveChat: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [view, setView] = useState<ChatView>('list');

    // Sessions State
    const [sessions, setSessions] = useState<ChatSession[]>(() => {
        const saved = localStorage.getItem('iotank_chat_sessions');
        return saved ? JSON.parse(saved) : [];
    });

    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [rateLimitResetAt, setRateLimitResetAt] = useState<number | null>(null);
    const [secondsRemaining, setSecondsRemaining] = useState(0);
    const [newLead, setNewLead] = useState<LeadData>({ name: '', email: '', phone: '', subject: '' });
    const [hoverRating, setHoverRating] = useState(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const currentSession = sessions.find(s => s.id === currentSessionId);

    // Sync to LocalStorage
    useEffect(() => {
        localStorage.setItem('iotank_chat_sessions', JSON.stringify(sessions));
    }, [sessions]);

    // Rate limit countdown logic
    useEffect(() => {
        if (!rateLimitResetAt) return;

        const interval = setInterval(() => {
            const remaining = Math.max(0, Math.ceil((rateLimitResetAt - Date.now()) / 1000));
            setSecondsRemaining(remaining);
            if (remaining <= 0) {
                setRateLimitResetAt(null);
                setSecondsRemaining(0);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [rateLimitResetAt]);

    // Auto-view logic on open
    useEffect(() => {
        if (isOpen) {
            if (sessions.length === 0) {
                setView('form');
            } else if (!currentSessionId) {
                setView('list');
            }
        }
    }, [isOpen, sessions.length]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (view === 'chat') scrollToBottom();
    }, [view, currentSession?.messages, isTyping]);

    const handleCreateNewChat = (e: React.FormEvent) => {
        e.preventDefault();

        const sessionId = `session-${Date.now()}`;
        const timestamp = Date.now();

        const welcomeMsg: Message = {
            id: 'welcome',
            sender: 'ai',
            text: `Welcome! I've received your inquiry about **${newLead.subject}**. How can I help you today?`,
            timestamp: timestamp
        };

        const newSession: ChatSession = {
            id: sessionId,
            subject: newLead.subject,
            lead: { ...newLead },
            messages: [welcomeMsg],
            createdAt: timestamp,
            lastUpdatedAt: timestamp,
            status: 'active'
        };

        setSessions(prev => [newSession, ...prev]);
        setCurrentSessionId(sessionId);
        setView('chat');
        setNewLead({ name: '', email: '', phone: '', subject: '' });
    };

    const handleSendMessage = async () => {
        if (!inputValue.trim() || !currentSessionId || currentSession?.status !== 'active') return;

        const timestamp = Date.now();
        const userMsg: Message = {
            id: `user-${timestamp}`,
            sender: 'user',
            text: inputValue,
            timestamp
        };

        // Check if the previous message was the AI closing phrase
        const lastMsg = currentSession.messages[currentSession.messages.length - 1];
        const isClosingQuery = lastMsg?.sender === 'ai' && lastMsg.text.includes("I am here for you");

        // Simple contentment detection
        const contentmentPhrases = ['no', 'done', 'satisfied', 'thanks', 'thank you', 'good', 'nothing', 'quit', 'exit'];
        const isContent = contentmentPhrases.some(p => inputValue.toLowerCase().includes(p));

        if (isClosingQuery && isContent) {
            setSessions(prev => prev.map(s =>
                s.id === currentSessionId
                    ? { ...s, messages: [...s.messages, userMsg], status: 'finished', lastUpdatedAt: timestamp }
                    : s
            ));
            setInputValue('');
            return;
        }

        setSessions(prev => prev.map(s =>
            s.id === currentSessionId
                ? { ...s, messages: [...s.messages, userMsg], lastUpdatedAt: timestamp }
                : s
        ));

        setInputValue('');
        setIsTyping(true);

        try {
            const history = currentSession?.messages.map(m => ({
                role: m.sender === 'user' ? 'user' as const : 'assistant' as const,
                content: m.text
            })) || [];

            const response = await ChatAIService.getChatResponse(inputValue, history);

            const aiMsg: Message = {
                id: `ai-${Date.now()}`,
                sender: 'ai',
                text: response,
                timestamp: Date.now()
            };

            setSessions(prev => prev.map(s =>
                s.id === currentSessionId
                    ? {
                        ...s,
                        messages: [...s.messages, aiMsg],
                        lastUpdatedAt: Date.now(),
                    }
                    : s
            ));
        } catch (error: any) {
            logger.error('Chat error:', error);
            if (error instanceof RateLimitError) {
                setRateLimitResetAt(new Date(error.resetAt).getTime());
                setSecondsRemaining(Math.max(0, Math.ceil((new Date(error.resetAt).getTime() - Date.now()) / 1000)));
            } else {
                const errorMsg: Message = {
                    id: `err-${timestamp}`,
                    sender: 'ai',
                    text: "I am having trouble connecting. Please try again or contact us directly.",
                    timestamp: Date.now()
                };
                setSessions(prev => prev.map(s =>
                    s.id === currentSessionId ? { ...s, messages: [...s.messages, errorMsg] } : s
                ));
            }
        } finally {
            setIsTyping(false);
        }
    };

    const handleRateSession = (rating: number) => {
        if (!currentSessionId || !currentSession) return;

        const emailBody = `
IoTank Service Report
═══════════════════════════════════════

CUSTOMER DETAILS:
───────────────
NAME: ${currentSession.lead.name}
EMAIL: ${currentSession.lead.email}
PHONE: ${currentSession.lead.phone}
SUBJECT: ${currentSession.subject}

RATING: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)

═══════════════════════════════════════
Submitted via Landing Page AI Assistant
        `.trim();

        const mailtoLink = `mailto:iotank.com@gmail.com?subject=${encodeURIComponent('IoTank Service Report: ' + currentSession.subject)}&body=${encodeURIComponent(emailBody)}`;
        window.location.href = mailtoLink;

        setSessions(prev => prev.map(s =>
            s.id === currentSessionId
                ? { ...s, status: 'rated', rating }
                : s
        ));
    };

    const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Delete Conversation',
                message: 'Are you sure you want to permanently delete this chat history? This action cannot be undone.',
                type: 'warning',
                persistent: true,
                actions: [
                    {
                        label: 'Keep Chat',
                        onClick: () => {}
                    },
                    {
                        label: 'Delete History',
                        primary: true,
                        onClick: () => {
                            setSessions(prev => prev.filter(s => s.id !== sessionId));
                            if (currentSessionId === sessionId) {
                                setCurrentSessionId(null);
                                setView('list');
                            }
                            window.dispatchEvent(new CustomEvent('system-toast', {
                                detail: {
                                    title: 'Session Purged',
                                    message: 'The conversation history has been removed from your local cache.',
                                    type: 'info'
                                }
                            }));
                        }
                    }
                ]
            }
        }));
    };

    const renderText = (text: string) => {
        // Safe alternative to dangerouslySetInnerHTML using standard elements
        const parts = text.split(/(\*\*.*?\*\*)/g);
        return (
            <>
                {parts.map((part, i) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                        return <strong key={i}>{part.slice(2, -2)}</strong>;
                    }
                    return <span key={i}>{part}</span>;
                })}
            </>
        );
    };

    return (
        <div className="live-chat-container">
            {isOpen && (
                <div className="chat-window">
                    {/* Header */}
                    <div className="chat-header">
                        {view !== 'list' && sessions.length > 0 && (
                            <button className="back-btn neo-btn" onClick={() => setView('list')}>
                                <FiChevronLeft size={18} />
                            </button>
                        )}
                        <div style={{ flex: 1 }}>
                            <h3>IoTank Intelligent Assistant</h3>
                            <p>
                                {view === 'list' ? 'Your Conversations' :
                                    view === 'form' ? 'New Support Ticket' :
                                        currentSession?.subject}
                            </p>
                        </div>
                        <button className="close-btn" onClick={() => setIsOpen(false)}>
                            <FiX size={20} />
                        </button>
                    </div>

                    {/* Content Area */}
                    <div className="chat-content-wrapper">
                        {view === 'list' && (
                            <div className="session-list">
                                {sessions.map(s => (
                                    <div
                                        key={s.id}
                                        className="session-item"
                                        onClick={() => {
                                            setCurrentSessionId(s.id);
                                            setView('chat');
                                        }}
                                    >
                                        <div className="session-info">
                                            <span className="session-subject">{s.subject}</span>
                                            <span className="session-time">
                                                Active {formatDistanceToNow(s.lastUpdatedAt)} ago
                                            </span>
                                        </div>
                                        <button
                                            className="delete-session-btn"
                                            onClick={(e) => handleDeleteSession(e, s.id)}
                                            title="Delete conversation"
                                        >
                                            <FiTrash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                                <button className="new-chat-btn neo-btn advanced" onClick={() => setView('form')}>
                                    <FiPlus /> New Conversation
                                </button>
                            </div>
                        )}

                        {view === 'form' && (
                            <div className="chat-content">
                                <div className="support-notice">
                                    <FiInfo size={14} />
                                    <span>Your contact details will be shared with customer support if you need further assistance.</span>
                                </div>
                                <form className="lead-form compact" onSubmit={handleCreateNewChat}>
                                    <div className="form-row">
                                        <div className="relative">
                                            <input required className="form-input w-full pl-9" placeholder="Full Name" value={newLead.name} onChange={e => setNewLead({ ...newLead, name: e.target.value })} />
                                            <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                        </div>
                                        <div className="relative">
                                            <input required type="email" className="form-input w-full pl-9" placeholder="Email" value={newLead.email} onChange={e => setNewLead({ ...newLead, email: e.target.value })} />
                                            <FiAtSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                        </div>
                                    </div>
                                    <div className="form-row">
                                        <div className="relative">
                                            <input required type="tel" className="form-input w-full pl-9" placeholder="Phone" value={newLead.phone} onChange={e => setNewLead({ ...newLead, phone: e.target.value })} />
                                            <FiSmartphone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                        </div>
                                        <div className="relative">
                                            <input required className="form-input w-full pl-9" placeholder="Subject" value={newLead.subject} onChange={e => setNewLead({ ...newLead, subject: e.target.value })} />
                                            <FiInfo className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                        </div>
                                    </div>
                                    <button type="submit" className="submit-btn uppercase text-sm">
                                        Launch AI Assistant <FiSend />
                                    </button>

                                    <div className="direct-contact-teaser">
                                        <p className="contact-teaser-text">
                                            Are you struggling to get some info quickly? Check us through:
                                        </p>
                                        <div className="teaser-actions">
                                            <a href="https://wa.me/254111746901" target="_blank" rel="noopener noreferrer" className="teaser-icon-btn whatsapp" title="WhatsApp Us">
                                                <FaWhatsapp size={28} />
                                            </a>
                                            <a href="tel:+254111746901" className="teaser-icon-btn phone" title="Call Us Directly">
                                                <FiPhoneCall size={24} />
                                            </a>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        )}

                        {view === 'chat' && currentSession && (
                            <>
                                <div className="chat-content">
                                    {currentSession.messages.map(msg => (
                                        <div
                                            key={msg.id}
                                            className={`message ${msg.sender}`}
                                        >
                                            {renderText(msg.text)}
                                        </div>
                                    ))}
                                    {isTyping && (
                                        <div className="typing">
                                            <span></span><span></span><span></span>
                                        </div>
                                    )}
                                    {currentSession.status === 'finished' && (
                                        <div className="rating-overlay">
                                            <h4>Rate our assistance:</h4>
                                            <div className="stars" onMouseLeave={() => setHoverRating(0)}>
                                                {[1, 2, 3, 4, 5].map(star => (
                                                    <button
                                                        key={star}
                                                        className={`star-btn ${(hoverRating || currentSession.rating || 0) >= star ? 'active' : ''}`}
                                                        onMouseEnter={() => setHoverRating(star)}
                                                        onClick={() => handleRateSession(star)}
                                                    >
                                                        ★
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="rating-hint">Rating closes the ticket & sends us the details.</p>
                                        </div>
                                    )}
                                    {currentSession.status === 'rated' && (
                                        <div className="rating-success">
                                            <FiInfo /> <span>Thank you! Your feedback and ticket have been submitted.</span>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>
                                {currentSession.status === 'active' && (
                                    <div className="chat-input-area-wrapper">
                                        {secondsRemaining > 0 && (
                                            <div className="rate-limit-notice">
                                                <FiInfo size={14} />
                                                <span>Public rate limit hit. Resuming in <strong>{secondsRemaining}s</strong></span>
                                            </div>
                                        )}
                                        <div className={`chat-input-area ${secondsRemaining > 0 ? 'disabled' : ''}`}>
                                            <textarea
                                                className="chat-input"
                                                placeholder={secondsRemaining > 0 ? "Rate limit reached..." : "Type your question..."}
                                                rows={1}
                                                value={inputValue}
                                                disabled={secondsRemaining > 0}
                                                onChange={e => setInputValue(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && !e.shiftKey && secondsRemaining <= 0) {
                                                        e.preventDefault();
                                                        handleSendMessage();
                                                    }
                                                }}
                                            />
                                            <button
                                                className="send-btn"
                                                onClick={handleSendMessage}
                                                disabled={!inputValue.trim() || secondsRemaining > 0}
                                            >
                                                <FiSend size={18} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            <button
                className={`chat-trigger ${isOpen ? 'active' : ''} ${!isOpen ? 'has-bot' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                {isOpen ? (
                    <FiX />
                ) : (
                    <div className="bot-animation-wrapper">
                        <video
                            className="bot-iframe"
                            src="https://v1.pinimg.com/videos/iht/expMp4/69/bf/86/69bf86ec14b1484ce9b725359405b7a3_720w.mp4"
                            autoPlay
                            muted
                            loop
                            playsInline
                            title="AI Bot"
                            onCanPlay={(e) => (e.currentTarget.muted = true)}
                        />
                    </div>
                )}
            </button>
        </div>
    );
};
