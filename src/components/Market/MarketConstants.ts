export const STRATEGIC_CAPABILITIES = [
    'Predictive procurement window analysis',
    'Supply chain bottleneck pre-emption',
    'Regulatory compliance & safety auditing',
    'Rule-based price & supply trend inference',
    'Cached intelligence — offline-resilient',
];

export function getOperationalBoundaries(regBody = 'EPRA'): string[] {
    return [
        'Does not bypass regional price controls',
        'Not an automated procurement executor',
        `Consult official ${regBody} gazettes for finality`,
        'News is client-fetched — not AI-generated',
        'Cache max age: 15 minutes per source',
    ];
}

export function getActiveFeeds(jurisdiction?: { regulator?: string }): {
    name: string;
    type: string;
    status: string;
    lastSync: string;
    region: string;
    ttl: string;
}[] {
    const regulator = jurisdiction?.regulator || 'National Regulator';
    return [
        { name: `${regulator} — Petroleum Pricing`, type: 'Regulatory', status: 'Live', lastSync: '< 15m', region: 'Domestic', ttl: '15 min' },
        { name: 'National Central Bank', type: 'Regulatory', status: 'Live', lastSync: '< 1h', region: 'Domestic', ttl: '60 min' },
        { name: 'National Ports Authority', type: 'Logistics', status: 'Live', lastSync: '< 1h', region: 'Domestic', ttl: '60 min' },
        { name: 'Domestic Business Press', type: 'News', status: 'Live', lastSync: '< 15m', region: 'Domestic', ttl: '15 min' },
        { name: 'Reuters — Commodities', type: 'News / Global', status: 'Live', lastSync: '< 15m', region: 'Global', ttl: '15 min' },
        { name: 'OilPrice.com', type: 'Commodity / Global', status: 'Live', lastSync: '< 15m', region: 'Global', ttl: '15 min' },
    ];
}