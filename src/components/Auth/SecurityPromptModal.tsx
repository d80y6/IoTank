import React from 'react';
import { FiShield, FiLock, FiAlertTriangle, FiArrowRight, FiCheckCircle } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import './SecurityPromptModal.css';

interface SecurityPromptModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const SecurityPromptModal: React.FC<SecurityPromptModalProps> = ({ isOpen, onClose }) => {
    const navigate = useNavigate();

    if (!isOpen) return null;

    return (
        <div className="security-prompt-overlay">
            <div className="security-prompt-modal">
                <div className="security-prompt-header">
                    <div className="security-prompt-icon">
                        <FiShield size={32} />
                    </div>
                    <div className="header-text">
                        <h3>Strengthen Your Account</h3>
                        <p>Protect your fuel assets with a secondary security layer.</p>
                    </div>
                </div>

                <div className="security-prompt-body">
                    <div className="security-benefit-card">
                        <div className="benefit-icon">
                            <FiLock />
                        </div>
                        <div className="benefit-text">
                            <h4>6-Digit Security PIN</h4>
                            <p>Prevent unauthorized access to price controls and inventory settings even if your password is compromised.</p>
                        </div>
                    </div>

                    <div className="security-notice-box">
                        <FiAlertTriangle className="notice-icon" />
                        <p>
                            We've detected you don't have Multi-Factor Authentication (MFA) enabled. 
                            <strong> A 6-digit PIN is highly recommended</strong> for your account type to ensure compliance with Kenyan SaaS security standards.
                        </p>
                    </div>

                    <div className="security-steps">
                        <div className="step-item">
                            <FiCheckCircle className="step-check" />
                            <span>Compliant with DPA 2019</span>
                        </div>
                        <div className="step-item">
                            <FiCheckCircle className="step-check" />
                            <span>Identity Theft Protection</span>
                        </div>
                        <div className="step-item">
                            <FiCheckCircle className="step-check" />
                            <span>Secure Price Updates</span>
                        </div>
                    </div>
                </div>

                <div className="security-prompt-actions">
                    <button className="btn-skip" onClick={onClose}>
                        I'll do it later
                    </button>
                    <button className="btn-setup" onClick={() => {
                        onClose();
                        navigate('/settings?tab=security&setupPin=true');
                    }}>
                        Set Security PIN
                        <FiArrowRight />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SecurityPromptModal;
