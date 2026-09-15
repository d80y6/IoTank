import ReactDOM from 'react-dom/client';
import App from './App';
import '@/config/i18n';
import { registerSW } from 'virtual:pwa-register';

// Register PWA Service Worker
const updateSW = registerSW({
    onNeedRefresh() {
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Platform Update',
                message: 'A new version of IoTank Kernel is available. Synchronize now?',
                type: 'info',
                persistent: true,
                action: {
                    label: 'Sync Now',
                    onClick: () => updateSW(true)
                }
            }
        }));
    },
    onOfflineReady() {
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'System Ready',
                message: 'IoTank is now cached and available for offline monitoring.',
                type: 'success'
            }
        }));
    },
});

import { seoDefaults, structuredData } from '@/config/seo';

// 1. DYNAMIC SEO & JSON-LD INJECTION
// Standardizing security: Removing inline scripts from index.html
const injectSEO = () => {
    document.title = seoDefaults.title;

    const setMeta = (name: string, content: string) => {
        let meta = document.querySelector(`meta[name="${name}"]`);
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', name);
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', content);
    };

    setMeta('description', seoDefaults.description);
    setMeta('keywords', seoDefaults.keywords);

    // Inject JSON-LD
    let script = document.querySelector('script[type="application/ld+json"]');
    if (!script) {
        script = document.createElement('script');
        script.setAttribute('type', 'application/ld+json');
        document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(structuredData);
};

injectSEO();

// Remove preload class to enable theme transitions
setTimeout(() => {
    document.body.classList.remove('preload');
}, 100);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <App />
);
