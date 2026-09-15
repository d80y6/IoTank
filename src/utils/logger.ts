/**
 * Centralized Logging Utility for IoTank V2.0.0
 * 
 * Provides a standardized way to log across the platform with support for:
 * - Different log levels (DEBUG, INFO, WARN, ERROR)
 * - Component/Context tags
 * - Environment-based filtering (e.g., silence DEBUG in production)
 * - Forensic consistency for audit readiness
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const IS_PRODUCTION = import.meta.env.PROD;

class Logger {
    private static instance: Logger;
    
    private constructor() {}

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private log(level: LogLevel, message: string, data?: any, context?: string) {
        if (IS_PRODUCTION && level === 'DEBUG') return;

        const timestamp = new Date().toISOString();
        const tag = context ? `[${context}] ` : '';
        const formattedMessage = `[${timestamp}] [${level}] ${tag}${message}`;

        switch (level) {
            case 'DEBUG':
                console.debug(formattedMessage, data || '');
                break;
            case 'INFO':
                console.info(formattedMessage, data || '');
                break;
            case 'WARN':
                console.warn(formattedMessage, data || '');
                break;
            case 'ERROR':
                console.error(formattedMessage, data || '');
                break;
        }
    }

    public debug(message: string, data?: any, context?: string) {
        this.log('DEBUG', message, data, context);
    }

    public info(message: string, data?: any, context?: string) {
        this.log('INFO', message, data, context);
    }

    public warn(message: string, data?: any, context?: string) {
        this.log('WARN', message, data, context);
    }

    public error(message: string, data?: any, context?: string) {
        this.log('ERROR', message, data, context);
    }
}

export const logger = Logger.getInstance();
