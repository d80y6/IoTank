/* eslint-disable react/no-unescaped-entities */
import React, { useState } from 'react';
import { FiMail, FiDownload, FiCheck, FiArrowRight } from 'react-icons/fi';
import './LeadMagnetNewsletter.css';
import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

const LeadMagnetNewsletter: React.FC = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    
    setStatus('loading');
    setErrorMessage('');
    
    try {
      const { error } = await supabase
        .from('marketing_leads')
        .insert([{ 
          email: email.toLowerCase().trim(),
          source: 'lead_magnet_newsletter',
          metadata: {
            user_agent: navigator.userAgent,
            referrer: document.referrer,
            timestamp: new Date().toISOString()
          }
        }]);

      if (error) {
        // Handle duplicate email specifically if needed (though RLS might just ignore or error)
        if (error.code === '23505') {
          // Unique violation - they are already signed up!
          setStatus('success');
          setEmail('');
          return;
        }
        throw error;
      }

      setStatus('success');
      setEmail('');
    } catch (err: any) {
      logger.error('Lead capture error:', err);
      setStatus('error');
      setErrorMessage('Something went wrong. Please try again.');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  return (
    <section className="lmn-section">
      <div className="lmn-container">
        <div className="lmn-card">
          <div className="lmn-content">
            <div className="lmn-icon-badge">
              <FiDownload size={24} />
            </div>
            <h2 className="lmn-title">Download the 2026 Fuel Management <span className="text-violet">Best Practices Guide</span></h2>
            <p className="lmn-description">
              Stop guessing your margins. Join 500+ station owners receiving our weekly AI-driven market insights and EPRA price projections.
            </p>
            
            <ul className="lmn-benefits">
              <li><FiCheck className="check-icon" /> <strong>Weekly EPRA Predictor:</strong> Know the price before it hits.</li>
              <li><FiCheck className="check-icon" /> <strong>Theft Prevention Checklist:</strong> 12 signs your staff might be siphoning.</li>
              <li><FiCheck className="check-icon" /> <strong>Compliance Audit Guide:</strong> How to pass any NEMA/EPRA inspection.</li>
            </ul>

            <form className="lmn-form" onSubmit={handleSubmit}>
              <div className="lmn-input-group">
                <FiMail className="input-icon" />
                <input 
                  type="email" 
                  placeholder="Enter your work email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === 'success'}
                  required
                />
              </div>
              <button 
                type="submit" 
                className={`lmn-submit-btn ${status}`}
                disabled={status !== 'idle'}
              >
                {status === 'idle' && (
                  <>Get the Guide <FiArrowRight className="arrow" /></>
                )}
                {status === 'loading' && (
                  <div className="spinner-small"></div>
                )}
                {status === 'success' && (
                  <>Check Your Inbox! <FiCheck /></>
                )}
              </button>
            </form>
            {status === 'error' && (
              <p className="lmn-error-msg">{errorMessage}</p>
            )}
            <p className="lmn-privacy">
              Zero spam. Unsubscribe anytime. Powered by IoTank Intelligence.
            </p>
          </div>

          <div className="lmn-visual">
            <div className="guide-mockup-stack">
              <div className="guide-card card-3"></div>
              <div className="guide-card card-2"></div>
              <div className="guide-card card-1">
                <div className="guide-header">
                  <div className="guide-logo">IoTank</div>
                  <div className="guide-tag">2026 INDUSTRY REPORT</div>
                </div>
                <div className="guide-body">
                  <div className="guide-title-line"></div>
                  <div className="guide-title-line short"></div>
                  <div className="guide-circle">
                    <FiDownload className="dl-icon" />
                  </div>
                  <div className="guide-text-lines">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            </div>
            <div className="lmn-glow"></div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LeadMagnetNewsletter;
