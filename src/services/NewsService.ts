import { supabase } from '@/config/supabase';
import { MarketSignal } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Service to handle real-time news delivery.
 * Listens to the 'market_news' table and dispatches events to the UI.
 *
 * Circuit Breaker: After 3 consecutive CORS/network failures, the polling
 * interval backs off exponentially (5s → 15s → 45s → max 300s).
 * Resets automatically on the next successful fetch.
 */
export class NewsService {
    private static pollingTimeout: ReturnType<typeof setTimeout> | null = null;
    private static isInitializing = false;
    private static listenerCount = 0;
    private static lastSeenId: string | null = null;

    // ── Circuit Breaker State ─────────────────────────────────────────────────
    private static consecutiveFailures = 0;
    private static readonly BASE_POLL_MS = 5000;        // 5 seconds (normal)
    private static readonly MAX_BACKOFF_MS = 300000;    // 5 minutes (max backoff)
    private static readonly FAILURE_THRESHOLD = 3;      // trips after 3 failures

    private static getBackoffMs(): number {
        if (this.consecutiveFailures < this.FAILURE_THRESHOLD) {
            return this.BASE_POLL_MS;
        }
        // Exponential: 5s * 3^(failures - threshold + 1), capped at 5 min
        const factor = Math.pow(3, this.consecutiveFailures - this.FAILURE_THRESHOLD + 1);
        return Math.min(this.BASE_POLL_MS * factor, this.MAX_BACKOFF_MS);
    }

    private static scheduleNextPoll(fn: () => Promise<void>): void {
        const delay = this.getBackoffMs();
        if (delay > this.BASE_POLL_MS) {
            logger.warn(
                `[NewsService] Circuit breaker active — next poll in ${delay / 1000}s ` +
                `(consecutive failures: ${this.consecutiveFailures})`
            );
        }
        if (this.pollingTimeout) clearTimeout(this.pollingTimeout);
        this.pollingTimeout = setTimeout(fn, delay);
    }
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Start listening for live news updates.
     */
    static async startListening(): Promise<void> {
        this.listenerCount++;

        // [BYPASS] If realtime is globally disabled, skip
        if (import.meta.env.VITE_DISABLE_REALTIME === 'true') {
            return;
        }

        // Already running — just bump the ref count
        if (this.isInitializing || this.pollingTimeout) {
            return;
        }

        this.isInitializing = true;

        logger.debug('Initializing Real-time News Poller...', { listeners: this.listenerCount }, 'NEWS_SERVICE');

        // Fetch initial article to set lastSeenId (failure here is non-critical)
        try {
            const initial = await this.fetchRecentNews(1);
            if (initial.length > 0) this.lastSeenId = initial[0].id;
        } catch {
            this.consecutiveFailures++;
        }

        this.isInitializing = false;
        logger.info('Market News Live Sync Active (Polling)', { listeners: this.listenerCount }, 'NEWS_SERVICE');

        const poll = async (): Promise<void> => {
            // Guard: stop re-scheduling if all listeners have gone
            if (this.listenerCount === 0) return;

            try {
                const latest = await this.fetchRecentNews(1);

                // ✅ SUCCESS — reset circuit breaker
                if (this.consecutiveFailures > 0) {
                    logger.info('[NewsService] Supabase connection restored. Resetting circuit breaker.');
                    this.consecutiveFailures = 0;
                }

                if (latest.length > 0 && latest[0].id !== this.lastSeenId) {
                    this.lastSeenId = latest[0].id;
                    this.dispatchNews({
                        id: latest[0].id,
                        title: latest[0].title,
                        summary: latest[0].summary,
                        source_type: latest[0].sourceType,
                        attribution: latest[0].attribution,
                        priority: latest[0].priority,
                        created_at: new Date(latest[0].timestamp).toISOString(),
                        metadata: latest[0].metadata
                    });
                }
            } catch {
                // ❌ FAILURE — increment and let backoff escalate
                this.consecutiveFailures++;
            }

            // Adaptive reschedule
            this.scheduleNextPoll(poll);
        };

        // Kick off the polling loop
        this.scheduleNextPoll(poll);
    }

    /**
     * Fetch the most recent news from the database for initial hydration.
     */
    static async fetchRecentNews(limit: number = 10): Promise<MarketSignal[]> {
        const { data, error } = await supabase
            .from('market_news')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            logger.error('[NewsService] Failed to fetch historical news:', error);
            return [];
        }

        return (data || []).map(item => ({
            id: item.id,
            title: item.title,
            summary: item.summary,
            sourceType: item.source_type || 'system',
            attribution: item.attribution || 'IoTank Core',
            priority: item.priority || 3,
            timestamp: new Date(item.created_at).getTime(),
            metadata: item.metadata || {}
        }));
    }

    /**
     * Stop listening.
     * @param force Force stop regardless of listener count
     */
    static stopListening(force: boolean = false): void {
        if (!force) {
            this.listenerCount = Math.max(0, this.listenerCount - 1);
        }

        if (force || this.listenerCount === 0) {
            if (this.pollingTimeout) {
                clearTimeout(this.pollingTimeout);
                this.pollingTimeout = null;
            }
            this.isInitializing = false;
            this.consecutiveFailures = 0;
        }
    }

    /**
     * Dispatches a custom event that hooks/UI components listen for.
     */
    private static dispatchNews(data: any): void {
        const signal: MarketSignal = {
            id: data.id,
            title: data.title,
            summary: data.summary,
            sourceType: data.source_type || 'system',
            attribution: data.attribution || 'IoTank Core',
            priority: data.priority || 3,
            timestamp: new Date(data.created_at).getTime(),
            metadata: data.metadata || {}
        };

        window.dispatchEvent(new CustomEvent('market-news-update', { detail: signal }));
    }
}
