import React, { useState } from 'react';
import { FiCopy, FiEye, FiEyeOff, FiCheck, FiAlertTriangle } from 'react-icons/fi';

interface KeyConfig {
    live_secret_key: string;
    live_public_key: string;
    test_secret_key: string;
    test_public_key: string;
}

interface ApiKeyManagerProps {
    initialConfig?: Partial<KeyConfig> & { is_live_mode?: boolean };
}

const STORAGE_KEY = 'iotank.admin.api.keys';

const envPublicKey = (import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string | undefined) || '';
const envSecretKey = (import.meta.env.VITE_PAYSTACK_SECRET_KEY as string | undefined) || '';

const defaultConfig = (): KeyConfig => ({
    live_secret_key: envSecretKey || 'sk_live_NOT_CONFIGURED_PROVISION_SERVER_SIDE',
    live_public_key: envPublicKey || 'pk_live_NOT_CONFIGURED',
    test_secret_key: envSecretKey || 'sk_test_NOT_CONFIGURED_PROVISION_SERVER_SIDE',
    test_public_key: envPublicKey || 'pk_test_NOT_CONFIGURED'
});

const loadConfig = (initialConfig?: Partial<KeyConfig> & { is_live_mode?: boolean }): KeyConfig => {
    if (initialConfig) return { ...defaultConfig(), ...initialConfig };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return { ...defaultConfig(), ...(JSON.parse(raw) as Partial<KeyConfig>) };
    } catch (error) {
        console.error('Error loading stored API config:', error);
    }
    return defaultConfig();
};

export const ApiKeyManager: React.FC<ApiKeyManagerProps> = ({ initialConfig }) => {
    const [isLive, setIsLive] = useState(initialConfig?.is_live_mode || false);
    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
    const [copied, setCopied] = useState<string | null>(null);
    const [config, setConfig] = useState<KeyConfig>(() => loadConfig(initialConfig));

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    const toggleKey = (id: string) => {
        setShowKeys(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const saveConfig = () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Configuration Saved',
                    message: 'Configuration saved (server-side provisioning unchanged)',
                    type: 'success'
                }
            }));
        } catch (error) {
            console.error('Error saving API config:', error);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Save Failed',
                    message: 'Unable to persist configuration locally.',
                    type: 'error'
                }
            }));
        }
    };

    const cancelConfig = () => {
        setConfig(loadConfig(initialConfig));
    };

    const renderKeyRow = (label: string, value: string, id: string, field: keyof KeyConfig) => (
        <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</label>
            </div>
            <div className="relative group">
                <input 
                    type={showKeys[id] ? "text" : "password"} 
                    value={value} 
                    onChange={(e) => setConfig(prev => ({ ...prev, [field]: e.target.value }))}
                    className="form-input font-mono text-xs pr-24 bg-slate-50 border-slate-200"
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                    <button 
                        onClick={() => copyToClipboard(value, id)}
                        className="p-1.5 hover:bg-slate-200 rounded transition-colors text-slate-400 hover:text-slate-600"
                        title="Copy to clipboard"
                    >
                        {copied === id ? <FiCheck className="text-green-500" /> : <FiCopy />}
                    </button>
                    <button 
                        onClick={() => toggleKey(id)}
                        className="p-1.5 hover:bg-slate-200 rounded transition-colors text-slate-400 hover:text-slate-600"
                        title={showKeys[id] ? "Hide key" : "Show key"}
                    >
                        {showKeys[id] ? <FiEyeOff /> : <FiEye />}
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="api-manager-container animate-fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h3 className="text-lg font-black text-slate-800">Platform API Configuration</h3>
                    <p className="text-xs text-slate-400">Master Paystack integration keys for the entire IoTank ecosystem.</p>
                </div>
                <div className="flex items-center gap-3 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
                    <button 
                        className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${!isLive ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400'}`}
                        onClick={() => setIsLive(false)}
                    >
                        Test Mode
                    </button>
                    <button 
                        className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${isLive ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400'}`}
                        onClick={() => setIsLive(true)}
                    >
                        Live Mode
                    </button>
                </div>
            </div>

            <div className={`mb-12 transition-opacity ${!isLive ? 'opacity-40 grayscale pointer-events-none' : 'opacity-100'}`}>
                <div className="flex items-center justify-between mb-6 pb-2 border-b border-slate-100">
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">API Configuration - Live Mode</h4>
                </div>
                {renderKeyRow('Live Secret Key', config.live_secret_key, 'live_secret', 'live_secret_key')}
                {renderKeyRow('Live Public Key', config.live_public_key, 'live_public', 'live_public_key')}
            </div>

            <div className={`transition-opacity ${isLive ? 'opacity-40 grayscale pointer-events-none' : 'opacity-100'}`}>
                <div className="bg-red-50 border border-red-100 p-4 rounded-xl mb-8 flex items-start gap-3">
                    <FiAlertTriangle className="text-red-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-700 font-medium">
                        These keys are for testing only. Transactions in this mode will not be processed for real funds.
                    </p>
                </div>

                <div className="flex items-center justify-between mb-6 pb-2 border-b border-slate-100">
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">API Configuration - Test Mode</h4>
                </div>
                {renderKeyRow('Test Secret Key', config.test_secret_key, 'test_secret', 'test_secret_key')}
                {renderKeyRow('Test Public Key', config.test_public_key, 'test_public', 'test_public_key')}
            </div>

            <div className="mt-12 pt-8 border-t border-slate-100 flex justify-end gap-3">
                <button className="px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border border-slate-200 text-slate-500 hover:bg-slate-50" onClick={cancelConfig}>Cancel</button>
                <button className="px-8 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700" onClick={saveConfig}>Save Configuration</button>
            </div>
        </div>
    );
};