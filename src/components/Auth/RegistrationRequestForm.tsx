/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { sanitizeText, validateEmail } from '@/utils/sanitization';
import { logger } from '@/utils/logger';
import { 
  FiX, 
  FiUser, 
  FiGlobe, 
  FiInfo, 
  FiChevronRight, 
  FiAlertCircle,
  FiLoader
} from 'react-icons/fi';
import './RegistrationRequestForm.css';

interface RegistrationRequestFormProps {
  onBack: () => void;
}


interface FormData {
  full_name: string;
  email: string;
  phone: string;
  station_name: string;
  county: string;
  notes: string;
}

declare global {
  interface Window {
    grecaptcha: {
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

export const RegistrationRequestForm: React.FC<RegistrationRequestFormProps> = ({ onBack }) => {
  const [formData, setFormData] = useState<FormData>({
    full_name: '',
    email: '',
    phone: '',
    station_name: '',
    county: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showRecaptchaModal, setShowRecaptchaModal] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((prev: FormData) => ({ ...prev, [e.target.name]: e.target.value }));
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.full_name || !formData.email || !formData.phone || !formData.station_name || !formData.county) {
      setError('please fill in all required fields to proceed with your request.');
      return;
    }
    if (!validateEmail(formData.email)) {
      setError('please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      // Execute reCAPTCHA v3 with 'register' action
      let recaptchaToken = '';
      try {
        // [HARDENING]: Ensure grecaptcha is ready with a small retry window for slow connections
        let checkCount = 0;
        while (!window.grecaptcha && checkCount < 10) {
            await new Promise(r => setTimeout(r, 500));
            checkCount++;
        }

        if (window.grecaptcha) {
          // Show reCAPTCHA badge
          document.body.classList.add('show-recaptcha');
          // Execute reCAPTCHA v3
          const siteKey = '6LfgSHgsAAAAAHlWl9ZRVO1IvJGsEkyj8_lYVF2i'; // Your v3 site key
          try {
            recaptchaToken = await window.grecaptcha.execute(siteKey, { action: 'register' });
          } catch (execError) {
            logger.error('reCAPTCHA execution failed:', execError);
          }
        } else {
            logger.warn('reCAPTCHA library failed to initialize within 5 seconds.');
            setShowRecaptchaModal(true);
            // Dispatch premium persistent toast
            const toastEvent = new CustomEvent('system-toast', {
              detail: {
                title: 'reCAPTCHA Service',
                message: 'Please check your internet connection and reload to get a reCAPTCHA challenge.',
                type: 'error',
                persistent: true
              }
            });
            window.dispatchEvent(toastEvent);
        }
      } catch (recaptchaError) {
        logger.warn('reCAPTCHA v3 error (non-blocking):', recaptchaError);
        // Continue without token - registration can still proceed
      }

      // 2. SUBMIT: Routing via hardened Edge Function (enforces server-side reCAPTCHA & sanitization)
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/submit-registration-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey || '',
          'Authorization': `Bearer ${anonKey}`
        },
        body: JSON.stringify({
          full_name: sanitizeText(formData.full_name, 120),
          email: formData.email.toLowerCase().trim(),
          phone: sanitizeText(formData.phone, 40),
          station_name: sanitizeText(formData.station_name, 160),
          county: sanitizeText(formData.county, 80),
          notes: sanitizeText(formData.notes, 500),
          recaptcha_token: recaptchaToken || null,
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.statusText}`);
      }

      const functionData = await response.json();
      if (functionData && !functionData.success) throw new Error(functionData.error || 'Registration failed');

      
      // Hide reCAPTCHA badge
      document.body.classList.remove('show-recaptcha');
      
      setSubmitted(true);
    } catch (err: any) {
      logger.error('registration request error:', err);
      const errMsg = err.message || '';
      
      if (errMsg.includes('Email already exists') || errMsg.includes('pending request')) {
        setError(errMsg);
        // Dispatch premium persistent toast
        const toastEvent = new CustomEvent('system-toast', {
          detail: {
            title: 'Registration Error',
            message: errMsg,
            type: 'error',
            persistent: true
          }
        });
        window.dispatchEvent(toastEvent);
      } else {
        setError('failed to submit your request. please try again or contact support.');
      }
      document.body.classList.remove('show-recaptcha');
    } finally {
      setLoading(false);
    }
  };

  const AnimatedSuccessTick = () => (
    <div className="success-tick-container">
      <svg className="success-tick-svg" viewBox="0 0 52 52">
        <circle className="success-tick-circle" cx="26" cy="26" r="25" fill="none" />
        <path className="success-tick-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
      </svg>
    </div>
  );

  if (submitted) {
    return (
      <div className="registration-overlay">
        <div className="registration-modal-content success-mode">
          <div className="registration-success-premium">
            <div className="success-icon-premium">
              <AnimatedSuccessTick />
            </div>
            <h2>request submitted!</h2>
            <p>
              thank you, <strong>{formData.full_name}</strong>! your account request for{' '}
              <strong>{formData.station_name}</strong> has been received.
            </p>
            <p className="text-secondary text-sm mt-4">
              our team will review your details and contact you at{' '}
              <strong>{formData.email}</strong> or <strong>{formData.phone}</strong> within 1–2 business days to
              complete your account setup.
            </p>
            <button className="btn-submit mt-8" onClick={onBack}>
              Return to Portal
              <FiChevronRight />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const counties = [
    'Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Kiambu', 'Machakos',
    'Nyeri', 'Meru', 'Kakamega', 'Kisii', 'Kilifi', 'Garissa', 'Other',
  ];

  return (
    <div className="registration-overlay">
      {showRecaptchaModal && (
        <div className="recaptcha-error-modal-overlay">
          <div className="recaptcha-error-modal-content">
            <div className="modal-icon-header warning">
              <FiAlertCircle size={32} />
            </div>
            <h3>What is the reCAPTCHA Service?</h3>
            <p>
              reCAPTCHA is an automated security gatekeeper designed by Google. It verified that you are a human operator and not a malicious bot attempting to brute-force or spam the enterprise signup pipeline.
            </p>
            <p className="mt-2 text-sm text-secondary">
              Due to a network interruption or ad-blocker filtering, the reCAPTCHA security scripts failed to load.
            </p>
            <div className="action-buttons mt-6">
              <button 
                type="button" 
                className="btn-cancel mr-2" 
                onClick={() => setShowRecaptchaModal(false)}
              >
                Dismiss
              </button>
              <button 
                type="button" 
                className="btn-submit" 
                onClick={() => window.location.reload()}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="registration-modal-content">
        <header className="modal-header">
          <div className="header-text-container">
            <h2>Request Platform Access</h2>
            <p>Initialize your enterprise account for fuel station monitoring</p>
            <div className="modal-header-badges">
                <span className="modal-badge amethyst">Network Link</span>
                <span className="modal-badge violet">SECURE</span>
            </div>
          </div>
          <button className="close-btn" onClick={onBack} title="close form">
            <FiX size={18} />
          </button>
        </header>

        <div className="modal-body-scroll">
          {error && (
            <div className="error-banner">
              <div className="error-icon-container">
                <FiAlertCircle className="error-icon" />
              </div>
              <div className="error-content">
                <strong>Submission Error</strong>
                <p>{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="premium-compact-form">
            
            {/* SECTION 1: IDENTITY */}
            <div className="atm-section amethyst">
                <div className="atm-section-header">
                    <div className="atm-section-icon"><FiUser size={14} /></div>
                    <span className="atm-section-title">Executive Identity</span>
                </div>
                <div className="atm-section-body atm-grid atm-grid-2">
                  <div className="form-group">
                    <label>Full Legal Name</label>
                    <input
                      name="full_name"
                      type="text"
                      value={formData.full_name}
                      onChange={handleChange}
                      placeholder="e.g. John Kamau"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Business Email Address</label>
                    <input
                      name="email"
                      type="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="you@company.com"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Official Contact Number</label>
                    <input
                      name="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="+254..."
                    />
                  </div>
                  <div className="form-group">
                    <label>Station / Company Name</label>
                    <input
                      name="station_name"
                      type="text"
                      value={formData.station_name}
                      onChange={handleChange}
                      placeholder="e.g. Nairobi Central Station"
                      required
                    />
                  </div>
                </div>
            </div>

            {/* SECTION 2: LOCATION */}
            <div className="atm-section violet">
                <div className="atm-section-header">
                    <div className="atm-section-icon"><FiGlobe size={14} /></div>
                    <span className="atm-section-title">Administrative Region</span>
                </div>
                <div className="atm-section-body">
                  <div className="form-group">
                    <label>County / Region Headquarters</label>
                    <select name="county" value={formData.county} onChange={handleChange} title="Select County">
                      <option value="">Select County</option>
                      {counties.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
            </div>

            {/* SECTION 3: DIRECTIVES */}
            <div className="atm-section plum">
                <div className="atm-section-header">
                    <div className="atm-section-icon"><FiInfo size={14} /></div>
                    <span className="atm-section-title">Special Directives</span>
                </div>
                <div className="atm-section-body">
                  <div className="form-group">
                    <label className="flex justify-between">
                      <span>Technical Requirements (Optional)</span>
                      <span className="text-[10px] opacity-40">{formData.notes.length}/100</span>
                    </label>
                    <textarea
                      name="notes"
                      value={formData.notes}
                      onChange={handleChange}
                      placeholder="Any specific installation notes or equipment needs..."
                      rows={2}
                      maxLength={100}
                    />
                  </div>
                </div>
            </div>
            
            <div className="form-actions mt-8">
                <button type="button" className="btn-cancel" onClick={onBack}>Cancel</button>
                <button 
                  type="submit" 
                  className="btn-submit" 
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <FiLoader className="animate-spin" />
                      <span>Transmitting...</span>
                    </>
                  ) : (
                    <>
                      <span>Transmit Request</span>
                      <FiChevronRight />
                    </>
                  )}
                </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
