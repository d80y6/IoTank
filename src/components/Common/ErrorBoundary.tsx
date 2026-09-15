import React, { ErrorInfo, ReactNode } from 'react';
import { FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { logger } from '@/utils/logger';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        logger.error('Uncaught error:', { error, errorInfo }, 'ErrorBoundary');
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            if (this.fallback) return this.fallback;

            return (
                <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-slate-50 text-center">
                    <div className="ds-card ds-card-panel max-w-md w-full p-8 shadow-2xl border-t-4 border-t-critical">
                        <FiAlertTriangle className="text-critical text-5xl mb-6 mx-auto" />
                        <h2 className="text-2xl font-black text-slate-800 mb-4">Intelligence Interrupted</h2>
                        <p className="text-secondary mb-8 leading-relaxed">
                            A telemetry processing error occurred. The system has automatically logged this event for analysis.
                        </p>

                        {this.state.error && (
                            <div className="bg-slate-100 p-4 rounded-lg mb-8 text-left overflow-auto max-h-32">
                                <code className="text-[10px] text-slate-600 font-mono">
                                    {this.state.error.message}
                                </code>
                            </div>
                        )}

                        <button
                            className="btn btn-primary w-full flex items-center justify-center gap-2 py-3"
                            onClick={this.handleReset}
                        >
                            <FiRefreshCw />
                            <span>Re-Synchronize System</span>
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }

    private get fallback() {
        return this.props.fallback;
    }
}
