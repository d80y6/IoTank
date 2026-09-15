/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useRef } from 'react';
import { FiX, FiSend, FiCpu, FiTrash2, FiShare2, FiFileText, FiPlus, FiChevronLeft } from 'react-icons/fi';
import { ChatMessage } from '@/services/IntelligenceAIService';
import { TankIQService } from '@/services/TankIQService';
import { useAuth } from '@/hooks/useAuth';
import { ExportService } from '@/services/ExportService';
import { formatDistanceToNow } from 'date-fns';
import { logger } from '@/utils/logger';
import './TankIQSidebar.css';

interface Message extends ChatMessage {
    id: string;
    timestamp: number;
}

interface ChatSession {
    id: string;
    subject: string;
    messages: Message[];
    createdAt: number;
    lastUpdatedAt: number;
}

type ChatView = 'list' | 'chat';

interface TankIQSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    onToggle: () => void;
}

export const TankIQSidebar: React.FC<TankIQSidebarProps> = ({ isOpen, onClose, onToggle }) => {
    const { currentUser } = useAuth();
    const [view, setView] = useState<ChatView>('list');
    
    // Sessions State
    const [sessions, setSessions] = useState<ChatSession[]>(() => {
        if (!currentUser?.stationId) return [];
        const saved = localStorage.getItem(`tankiq_sessions_${currentUser.stationId}`);
        return saved ? JSON.parse(saved) : [];
    });

    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const serviceRef = useRef<TankIQService | null>(null);
    
    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [inputValue]);

    // Sync to LocalStorage
    useEffect(() => {
        if (currentUser?.stationId) {
            localStorage.setItem(`tankiq_sessions_${currentUser.stationId}`, JSON.stringify(sessions));
        }
    }, [sessions, currentUser?.stationId]);

    // Handle session switching
    useEffect(() => {
        if (currentSessionId && currentUser?.stationId) {
            serviceRef.current = new TankIQService(currentUser.stationId, currentSessionId);
            setMessages(serviceRef.current.getHistory());
            setView('chat');
        } else {
            serviceRef.current = null;
            setMessages([]);
        }
    }, [currentSessionId, currentUser?.stationId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping, view]);

    const handleCreateNewChat = () => {
        const sessionId = `iq-session-${Date.now()}`;
        const timestamp = Date.now();
        
        const newSession: ChatSession = {
            id: sessionId,
            subject: 'New Operational Inquiry',
            messages: [],
            createdAt: timestamp,
            lastUpdatedAt: timestamp
        };

        setSessions(prev => [newSession, ...prev]);
        setCurrentSessionId(sessionId);
        setView('chat');
    };

    const handleSendMessage = async (text: string = inputValue) => {
        if (!text.trim() || !serviceRef.current || !currentSessionId) return;

        setInputValue('');
        setIsTyping(true);

        try {
            await serviceRef.current.sendMessage(text, (updatedHistory) => {
                setMessages(updatedHistory);
                
                // Update session preview/last updated
                setSessions(prev => prev.map(s => 
                    s.id === currentSessionId 
                        ? { 
                            ...s, 
                            lastUpdatedAt: Date.now(), 
                            subject: text.length > 60 ? text.substring(0, 60) + '...' : text 
                          } 
                        : s
                ));
            });
        } catch (error) {
            logger.error('TankIQ Error:', error);
        } finally {
            setIsTyping(false);
        }
    };

    const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Purge Intelligence Session',
                message: 'Are you sure you want to permanently delete this TankIQ conversation? This will wipe the session metadata and associated history from this device.',
                type: 'warning',
                persistent: true,
                actions: [
                    {
                        label: 'Keep Session',
                        onClick: () => {}
                    },
                    {
                        label: 'Delete Forever',
                        primary: true,
                        onClick: () => {
                            setSessions(prev => prev.filter(s => s.id !== sessionId));
                            if (currentSessionId === sessionId) {
                                setCurrentSessionId(null);
                                setView('list');
                            }
                            localStorage.removeItem(`tankiq_history_${currentUser?.stationId}_${sessionId}`);
                            window.dispatchEvent(new CustomEvent('system-toast', {
                                detail: {
                                    title: 'Intelligence Purged',
                                    message: 'The selected session has been removed from the local registry.',
                                    type: 'info'
                                }
                            }));
                        }
                    }
                ]
            }
        }));
    };

    const handleExportWhatsApp = () => {
        const lastMsg = messages.filter(m => m.role === 'assistant').pop();
        if (!lastMsg) return;
        
        const session = sessions.find(s => s.id === currentSessionId);
        const subject = session?.subject || 'Operational Inquiry';
        const summary = lastMsg.content.substring(0, 500) + (lastMsg.content.length > 500 ? '...' : '');
        
        const message = `*TankIQ Intelligence Report*
*Subject:* ${subject}
*Organization:* ${currentUser?.companyName || 'IoTank Site'}
*Date:* ${new Date().toLocaleDateString()}

*Key Insight:*
${summary}

_Generated by IoTank V2.0.0 Premium_`;

        const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    };

    const handleExportPDF = () => {
        if (!currentSessionId) return;
        const session = sessions.find(s => s.id === currentSessionId);
        if (!session) return;

        ExportService.exportTankIQChat(
            messages,
            session.subject,
            currentUser?.companyName || 'IoTank Site',
            currentUser?.displayName || currentUser?.email || 'Authorized User'
        );
    };

    const quickSuggestions = [
        "When was my last refuel?",
        "Show my AGO daily burn rate",
        "Market price outlook",
        "Any active alerts?",
    ];

    const renderMessageContent = (content: string) => {
        if (!content) return null;
        const parts = content.split(/(\*\*.*?\*\*)/g);
        return parts.map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={index}>{part.slice(2, -2)}</strong>;
            }
            return (
                <span key={index}>
                    {part.split('\n').map((line, i, arr) => (
                        <React.Fragment key={i}>
                            {line}
                            {i !== arr.length - 1 && <br />}
                        </React.Fragment>
                    ))}
                </span>
            );
        });
    };

    if (!currentUser) return null;

    return (
        <div className="tankiq-assistant-container">
            {isOpen && (
                <div className="tankiq-window">
                    <div className="tankiq-header">
                        {view !== 'list' && (
                            <button className="back-btn" onClick={() => setView('list')} title="Back to list">
                                <FiChevronLeft size={20} />
                            </button>
                        )}
                        <div style={{ flex: 1 }}>
                            <h3>TankIQ Intelligence</h3>
                            <p>{view === 'list' ? 'Operational Overview' : 'Active Session'}</p>
                        </div>
                        <button className="close-btn" onClick={onClose} title="Close Assistant">
                            <FiX size={20} />
                        </button>
                    </div>

                    <div className="tankiq-content-wrapper">
                        {view === 'list' ? (
                            <div className="session-list custom-scrollbar">
                                {sessions.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 px-8 text-center opacity-60">
                                        <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-6">
                                            <FiCpu size={40} className="text-slate-400" />
                                        </div>
                                        <h4 className="text-xl font-bold text-slate-800">TankIQ Operations Center</h4>
                                        <p className="text-sm mt-3 text-slate-500">I analyze your telemetry, inventory trends, and market signals. Start an intelligence session to begin.</p>
                                    </div>
                                ) : (
                                    sessions.map(s => (
                                        <div
                                            key={s.id}
                                            className="session-item"
                                            onClick={() => setCurrentSessionId(s.id)}
                                        >
                                            <div className="session-info">
                                                <span className="session-subject">{s.subject}</span>
                                                <span className="session-time">
                                                    {formatDistanceToNow(s.lastUpdatedAt)} ago
                                                </span>
                                            </div>
                                            <button
                                                className="delete-session-btn"
                                                onClick={(e) => handleDeleteSession(e, s.id)}
                                            >
                                                <FiTrash2 size={16} />
                                            </button>
                                        </div>
                                    ))
                                )}
                                <button className="new-chat-btn advanced" onClick={handleCreateNewChat}>
                                    <FiPlus /> New Intelligence Session
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="iq-chat-content custom-scrollbar" ref={scrollRef}>
                                    {messages.length === 0 && (
                                        <div className="p-4">
                                            <div className="flex flex-col gap-3">
                                                <div className="suggestion-chip" onClick={() => handleSendMessage(quickSuggestions[0])}>{quickSuggestions[0]}</div>
                                                <div className="suggestion-chip" onClick={() => handleSendMessage(quickSuggestions[1])}>{quickSuggestions[1]}</div>
                                                <div className="suggestion-chip" onClick={() => handleSendMessage(quickSuggestions[2])}>{quickSuggestions[2]}</div>
                                            </div>
                                        </div>
                                    )}

                                    {messages.filter(msg => (msg.role === 'user' || msg.role === 'assistant') && msg.content).map((msg, i) => (
                                        <div key={i} className={`message ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
                                            <div className="message-text">{renderMessageContent(msg.content)}</div>
                                        </div>
                                    ))}

                                    {isTyping && (
                                        <div className="iq-typing">
                                            <span></span><span></span><span></span>
                                        </div>
                                    )}
                                </div>

                                <div className="iq-input-area">
                                    <div className="iq-input-container">
                                        <textarea 
                                            ref={textareaRef}
                                            className="iq-textarea"
                                            placeholder="Message TankIQ..." 
                                            rows={1}
                                            value={inputValue}
                                            onChange={(e) => setInputValue(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleSendMessage();
                                                }
                                            }}
                                        />
                                        <button 
                                            className="iq-send-btn" 
                                            onClick={() => handleSendMessage()} 
                                            disabled={isTyping || !inputValue.trim()}
                                        >
                                            <FiSend size={20} />
                                        </button>
                                    </div>
                                    <div className="iq-export-actions">
                                        <button className="export-btn whatsapp" onClick={handleExportWhatsApp}>
                                            <div className="export-icon-circle">
                                                <FiShare2 size={14} />
                                            </div>
                                            <span>WhatsApp</span>
                                        </button>
                                        <button className="export-btn pdf" onClick={handleExportPDF}>
                                            <div className="export-icon-circle">
                                                <FiFileText size={14} />
                                            </div>
                                            <span>Export PDF</span>
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            <button
                className={`iq-trigger ${isOpen ? 'active' : ''}`}
                onClick={onToggle}
                title="TankIQ Assistant"
            >
                {isOpen ? (
                    <FiX />
                ) : (
                    <div className="bot-wrapper">
                        <video
                            className="bot-video"
                            src="https://v1.pinimg.com/videos/iht/expMp4/69/bf/86/69bf86ec14b1484ce9b725359405b7a3_720w.mp4"
                            autoPlay
                            muted
                            loop
                            playsInline
                            onCanPlay={(e) => (e.currentTarget.muted = true)}
                        />
                    </div>
                )}
            </button>
        </div>
    );
};
