import { IntelligenceAIService, ChatMessage } from './IntelligenceAIService';
import { TankIQToolset, TANKIQ_TOOLS_METADATA } from './TankIQToolset';
import { logger } from '@/utils/logger';

const STORAGE_KEY = 'tankiq_history';
const MAX_HISTORY = 20;
const MAX_TOOL_TURNS = 5; // Increased from 3 for deeper forensic analysis

export class TankIQService {
    private aiService: IntelligenceAIService;
    private history: ChatMessage[] = [];
    private sessionId: string;
    private stationId: string;

    constructor(stationId: string, sessionId: string = 'default') {
        this.aiService = new IntelligenceAIService();
        this.stationId = stationId;
        this.sessionId = sessionId;
        this.loadHistory();
    }

    private loadHistory() {
        const saved = localStorage.getItem(`${STORAGE_KEY}_${this.stationId}_${this.sessionId}`);
        if (saved) {
            try {
                this.history = JSON.parse(saved);
            } catch (e) {
                this.history = [];
            }
        }
    }

    private saveHistory() {
        localStorage.setItem(`${STORAGE_KEY}_${this.stationId}_${this.sessionId}`, JSON.stringify(this.history.slice(-MAX_HISTORY)));
    }

    getHistory() {
        return this.history;
    }

    clearHistory() {
        this.history = [];
        this.saveHistory();
    }

    async sendMessage(text: string, onUpdate: (history: ChatMessage[]) => void) {
        // Add user message
        const userMsg: ChatMessage = { role: 'user', content: text };
        this.history.push(userMsg);
        onUpdate([...this.history]);

        let retryCount = 0;
        const providers: ('gemini' | 'groq' | 'deepseek')[] = ['groq', 'gemini', 'deepseek'];
        
        const systemMessage: ChatMessage = {
            role: 'system',
            content: `You are TankIQ, the AI operations assistant for the IoTank fuel management platform. You act as a bridge between complex telemetry statistics and the user, explaining operational data in clear, professional English.

OPERATIONAL LOGIC & THRESHOLDS:
Follow these established SaaS rules when interpreting tank levels and providing advice:
- 98% and above: CRITICAL OVERFILL. Immediate action required to prevent spillage/safety risks.
- 95% to 97.9%: OPERATOR WARNING. Tank is approaching capacity.
- 50%: MID-POINT CHECK. Routine status.
- 20%: REORDER POINT. Recommend ordering fuel now to avoid stockouts.
- 5% and below: EMERGENCY STOP. Critical low level; operation should cease to protect equipment.

YOUR MANDATE:
1. ALWAYS use 'get_station_summary' first to identify the station name, location, and current tank states.
2. Use 'get_consumption_analytics' and 'get_shift_analytics' to analyze daily burn rates, pump sales, and variances before suggesting strategies.
3. Be forensic: if a sensor is blackout (0 burn reported while tanks are active), use 'get_hardware_health' to diagnose signal strength or sensor quality.
4. Provide data-driven strategies for procurement and sales based on EPRA market prices (via 'get_market_context') and tank inventory.
5. Use 'get_financial_status' to advise on debt management, invoice payments, and subscription standing.
6. Use 'get_audit_logs' and 'get_support_summary' to investigate historical system changes, user activities, and the status of technical issues reported to engineers.
7. Use 'get_usage_insights' to provide a cost-benefit analysis of platform usage (SMS, AI, data) and suggest optimization for the station's subscription budget.
8. Do NOT give generic advice. Use the specific station name, tank labels, and exact volumes provided by your tools.`
        };

        // Loop for tool calls (prevent infinite loops)
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
            let response: any = null;
            let currentProvider = providers[retryCount % providers.length];

            const messagesToSend = [systemMessage, ...this.history];

            try {
                response = await this.aiService.chat(currentProvider, messagesToSend, TANKIQ_TOOLS_METADATA);
            } catch (err) {
                logger.warn(`TankIQ: Provider ${currentProvider} failed, retrying...`, err);
                retryCount++;
                if (retryCount >= providers.length) throw new Error('All AI providers failed.');
                turn--; // Retry the same turn with new provider
                continue;
            }

            const message = response.message;
            if (!message) throw new Error('Invalid AI response format.');

            // Add assistant message to history
            this.history.push(message);
            onUpdate([...this.history]);

            if (message.tool_calls && message.tool_calls.length > 0) {
                // Execute tools
                for (const toolCall of message.tool_calls) {
                    const toolName = toolCall.function.name;
                    let args = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        logger.error('[TankIQ] Tool argument parse failed:', e);
                        this.history.push({
                            role: 'tool',
                            content: JSON.stringify({ error: "Invalid JSON in function arguments. Please retry with valid JSON." }),
                            tool_call_id: toolCall.id,
                            name: toolName
                        });
                        continue;
                    }
                    
                    let toolResult;
                    if (toolName === 'get_station_summary') {
                        toolResult = await TankIQToolset.get_station_summary(this.stationId);
                    } else if (toolName === 'get_consumption_analytics') {
                        toolResult = await TankIQToolset.get_consumption_analytics(this.stationId, args);
                    } else if (toolName === 'get_delivery_logs') {
                        toolResult = await TankIQToolset.get_delivery_logs(this.stationId, args);
                    } else if (toolName === 'get_market_context') {
                        toolResult = await TankIQToolset.get_market_context();
                    } else if (toolName === 'get_shift_analytics') {
                        toolResult = await TankIQToolset.get_shift_analytics(this.stationId, args);
                    } else if (toolName === 'get_financial_status') {
                        toolResult = await TankIQToolset.get_financial_status(this.stationId);
                    } else if (toolName === 'get_hardware_health') {
                        toolResult = await TankIQToolset.get_hardware_health(this.stationId);
                    } else if (toolName === 'get_audit_logs') {
                        toolResult = await TankIQToolset.get_audit_logs(this.stationId, args);
                    } else if (toolName === 'get_support_summary') {
                        toolResult = await TankIQToolset.get_support_summary(this.stationId);
                    } else if (toolName === 'get_usage_insights') {
                        toolResult = await TankIQToolset.get_usage_insights(this.stationId, args);
                    } else {
                        toolResult = { error: 'Unknown tool.' };
                    }

                    this.history.push({
                        role: 'tool',
                        content: JSON.stringify(toolResult),
                        tool_call_id: toolCall.id,
                        name: toolName
                    });
                }
                onUpdate([...this.history]);
                // Continue loop to send tool results back to AI
                continue;
            } else {
                // Final response received
                break;
            }
        }

        this.saveHistory();
    }
}
