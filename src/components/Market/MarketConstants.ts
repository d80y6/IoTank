export const STRATEGIC_CAPABILITIES = [
    'Predictive procurement window analysis',
    'Supply chain bottleneck pre-emption',
    'Regulatory compliance & safety auditing',
    'Rule-based price & supply trend inference',
    'Cached intelligence — offline-resilient',
];

export const OPERATIONAL_BOUNDARIES = [
    'Does not bypass regional price controls',
    'Not an automated procurement executor',
    'Consult official EPRA Gazettes for finality',
    'News is client-fetched — not AI-generated',
    'Cache max age: 15 minutes per source',
];

export const ACTIVE_FEEDS = [
    // Tier 1 — Kenya Regulatory
    { name: 'EPRA — Petroleum Pricing', type: 'Regulatory / Kenya', status: 'Live', lastSync: '< 15m', region: 'Kenya', ttl: '15 min' },
    { name: 'Central Bank of Kenya', type: 'Regulatory / Kenya', status: 'Live', lastSync: '< 1h', region: 'Kenya', ttl: '60 min' },
    { name: 'Kenya Ports Authority', type: 'Logistics / Kenya', status: 'Live', lastSync: '< 1h', region: 'Kenya', ttl: '60 min' },
    // Tier 2 — Kenya News
    { name: 'Business Daily Africa', type: 'News / Kenya', status: 'Live', lastSync: '< 15m', region: 'Kenya', ttl: '15 min' },
    { name: 'Nation Africa Business', type: 'News / Kenya', status: 'Live', lastSync: '< 15m', region: 'Kenya', ttl: '15 min' },
    { name: 'Standard Media', type: 'News / Kenya', status: 'Live', lastSync: '< 15m', region: 'Kenya', ttl: '15 min' },
    // Tier 3 — Global
    { name: 'Reuters — Commodities', type: 'News / Global', status: 'Live', lastSync: '< 15m', region: 'Global', ttl: '15 min' },
    { name: 'OilPrice.com', type: 'Commodity / Global', status: 'Live', lastSync: '< 15m', region: 'Global', ttl: '15 min' },
];
