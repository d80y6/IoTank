import React, { useState, useRef, useEffect } from 'react';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import { logger } from '@/utils/logger';
import './PasswordInput.css';

interface PasswordInputProps {
    value: string;
    onChange: (value: string) => void;
    id?: string;
    placeholder?: string; // fallback
    autoComplete?: string;
    required?: boolean;
    showStrength?: boolean; // Enable/disable advanced features
    onStrengthChange?: (score: number, valid: boolean) => void;
    name?: string;
}

export const PasswordInput: React.FC<PasswordInputProps> = ({
    value,
    onChange,
    id = "password",
    placeholder = "Enter password",
    autoComplete = "current-password",
    required = false,
    showStrength = false,
    onStrengthChange,
    name = "password"
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [touched, setTouched] = useState(false);

    // Press-and-hold logic
    const revealTimeout = useRef<NodeJS.Timeout | null>(null);

    const handleMouseDown = () => {
        setIsVisible(true);
        // Auto-hide after 1.5s as requested
        revealTimeout.current = setTimeout(() => {
            setIsVisible(false);
        }, 1500);
    };

    const handleMouseUp = () => {
        setIsVisible(false);
        if (revealTimeout.current) clearTimeout(revealTimeout.current);
    };

    const handleMouseLeave = () => {
        setIsVisible(false);
        if (revealTimeout.current) clearTimeout(revealTimeout.current);
    };

    // Smart Placeholder Logic
    const getPlaceholder = () => {
        if (isFocused && showStrength) return "Min 8 chars · upper · number · symbol";
        if (touched && value.length === 0) return "Password is required";
        return placeholder;
    };

    // Strength Intelligence
    const rules = [
        { id: 'min', label: '8+ chars', valid: value.length >= 8 },
        { id: 'upper', label: 'Uppercase', valid: /[A-Z]/.test(value) },
        { id: 'number', label: 'Number', valid: /\d/.test(value) },
        { id: 'symbol', label: 'Symbol', valid: /[!@#$%^&*(),.?":{}|<>]/.test(value) },
    ];

    const strengthScore = rules.filter(r => r.valid).length;
    const isValid = strengthScore >= 3;

    useEffect(() => {
        if (onStrengthChange) {
            onStrengthChange(strengthScore, isValid);
        }
    }, [strengthScore, isValid, onStrengthChange]);

    // Anomaly Detection (Basic cadence check stub - extensible)
    const handlePaste = (e: React.ClipboardEvent) => {
        if (value.length === 0 && e.clipboardData.getData('Text').length > 20) {
            logger.warn("Large paste detected - potential manager or dump");
            // Could trigger MFA logic here
        }
    };

    return (
        <div className={`password-input-container ${isFocused ? 'focused' : ''}`}>

            <div className="relative">
                <input
                    id={id}
                    type={isVisible ? "text" : "password"}
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        if (!touched) setTouched(true);
                    }}
                    placeholder={getPlaceholder()}
                    autoComplete={autoComplete}
                    required={required}
                    onPaste={handlePaste}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    name={name}
                    className={`
                        w-full pr-12 pl-4 py-3 
                        bg-elevated border rounded-lg 
                        transition-all duration-200
                        ${isFocused ? 'border-accent ring-2 ring-accent/20' : 'border-divider'}
                        ${touched && required && !value ? 'border-danger' : ''}
                    `}
                    style={{
                        backgroundColor: 'var(--color-bg-elevated)',
                        color: 'var(--color-text-primary)',
                        borderColor: isFocused ? 'var(--color-accent-primary)' : 'var(--color-border)'
                    }}
                />

                {/* Secure Eye Toggle */}
                <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 eye-reveal-button"
                    onMouseDown={handleMouseDown}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    // Touch support for mobile
                    onTouchStart={handleMouseDown}
                    onTouchEnd={handleMouseUp}
                    aria-label={isVisible ? "Hide password" : "Show password"}
                    title="Press and hold to reveal"
                >
                    {isVisible ? <FaEyeSlash /> : <FaEye />}
                </button>
            </div>

            {/* Compact Linear Rule Path */}
            {showStrength && (value.length > 0 || isFocused) && (
                <div className="password-rules-linear animate-in fade-in slide-in-from-top-1 duration-200">
                    {rules.map(rule => (
                        <div
                            key={rule.id}
                            className={`rule-item ${rule.valid ? 'met' : 'unmet'}`}
                        >
                            <span className="dot"></span>
                            {rule.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
