import React from 'react';
import { motion } from 'framer-motion';
import './NebulaLoader.css';

interface NebulaLoaderProps {
    message?: string;
    subtitle?: string;
}

export const NebulaLoader: React.FC<NebulaLoaderProps> = ({ 
    message = "Synchronizing Telemetry", 
    subtitle = "Secure Handshake in Progress" 
}) => {
    return (
        <div className="nebula-loader-overlay">
            <div className="nebula-bg-effect" />
            <div className="nebula-bg-effect nebula-bg-effect--secondary" />
            
            <div className="nebula-content">
                <div className="nebula-geometric-wrap">
                    <div className="nebula-ring nebula-ring--outer" />
                    <div className="nebula-ring" />
                    <div className="nebula-ring nebula-ring--inner" />
                    <div className="nebula-core" />
                </div>

                <div className="nebula-status-group">
                    <motion.span 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="nebula-title"
                    >
                        {message}
                    </motion.span>
                    <motion.span 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.6 }}
                        transition={{ delay: 0.2 }}
                        className="nebula-subtitle"
                    >
                        {subtitle}
                    </motion.span>
                </div>

                <div className="nebula-progress-bar">
                    <div className="nebula-progress-fill" />
                </div>
            </div>
        </div>
    );
};

export default NebulaLoader;
