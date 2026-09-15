/**
 * Telemetry Error Boundary
 * Catches and logs telemetry processing errors to prevent system crashes
 */

import { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '@/utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class TelemetryErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log the error for analysis
    logger.error('🚨 Telemetry Processing Error Detected:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent
    });

    // Store error state for debugging
    this.setState({
      error,
      errorInfo
    });

    // You could also send this to an error reporting service
    // reportError(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="telemetry-error-boundary p-6 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            <h3 className="text-lg font-semibold text-red-800">Intelligence Interrupted</h3>
          </div>
          
          <p className="text-red-700 mb-4">
            A telemetry processing error occurred. The system has automatically logged this event for analysis.
          </p>

          <div className="bg-red-100 p-4 rounded border border-red-200">
            <p className="text-sm text-red-600 font-mono mb-2">
              Error: {this.state.error?.message || 'Unknown error'}
            </p>
            <p className="text-xs text-red-500">
              Timestamp: {new Date().toLocaleString()}
            </p>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Reload Intelligence System
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook to wrap telemetry calculations with error handling
 */
export function useTelemetryErrorHandling<T>(
  calculation: () => T,
  fallback: T,
  context: string
): T {
  try {
    return calculation();
  } catch (error) {
    logger.error(`🚨 Telemetry Error in ${context}:`, error);
    
    // Log detailed error information
    logger.error('Telemetry Error Details:', {
      context,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });

    return fallback;
  }
}

/**
 * Safe telemetry calculation wrapper
 */
export function safeTelemetryCalculation<T>(
  calculation: () => T,
  fallback: T,
  context: string
): T {
  try {
    return calculation();
  } catch (error) {
    logger.error(`🚨 Safe Telemetry Calculation Failed [${context}]:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      fallback: typeof fallback === 'object' ? 'Object provided' : fallback,
      timestamp: new Date().toISOString()
    });
    
    return fallback;
  }
}
