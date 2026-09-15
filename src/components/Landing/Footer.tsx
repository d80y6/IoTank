import React from 'react';
import { FiTwitter, FiLinkedin, FiFacebook, FiMail } from 'react-icons/fi';
import './Footer.css';
import brandMark from '@/assets/iotank-official-logo.png';

const Footer: React.FC = () => {
    return (
        <footer className="footer-section">
            <div className="footer-container">
                <div className="footer-content">
                    {/* Brand Column */}
                    <div className="footer-brand-col">
                        <div className="footer-logo">
                            <img src={brandMark} alt="Joe Engineering" />
                            <span>Joe Engineering</span>
                        </div>
                        <p className="footer-desc">
                            Pioneering Industrial IoT & AI for the fuel energy sector in Kenya.
                            <br />
                            <span className="hq-text">Headquartered in Nairobi, Kenya.</span>
                        </p>
                        <div className="footer-tags">
                            <span className="footer-tag">Registered in Kenya</span>
                            <span className="footer-tag">Serving Retail, Fleet & Infrastructure</span>
                            <span className="footer-tag">Nairobi | Mombasa | Nakuru</span>
                        </div>
                    </div>

                    {/* Platform Links */}
                    <div className="footer-col">
                        <h4 className="footer-col-title">Platform</h4>
                        <div className="footer-links">
                            <a href="#" className="footer-link">IoTank System</a>
                            <a href="#" className="footer-link">Hardware Device</a>
                            <a href="#" className="footer-link">AI Engine</a>
                            <a href="#" className="footer-link">Deployment & Install</a>
                            <a href="#" className="footer-link">Security Architecture</a>
                        </div>
                    </div>

                    {/* Compliance Links */}
                    <div className="footer-col">
                        <h4 className="footer-col-title">Compliance</h4>
                        <div className="footer-links">
                            <a href="/aup" className="footer-link">Acceptable Use Policy (AUP)</a>
                            <a href="#" className="footer-link">EPRA Standards</a>
                            <a href="#" className="footer-link">Environmental Monitoring</a>
                            <a href="#" className="footer-link">Audit Reporting</a>
                            <a href="#" className="footer-link">AI Governance</a>
                            <a href="#" className="footer-link">Safety & Isolation</a>
                        </div>
                    </div>

                    {/* Resources Links */}
                    <div className="footer-col">
                        <h4 className="footer-col-title">Resources</h4>
                        <div className="footer-links">
                            <a href="#" className="footer-link">How It Works</a>
                            <a href="#" className="footer-link">Technical Docs</a>
                            <a href="#" className="footer-link">Case Studies</a>
                            <a href="#" className="footer-link">Fuel Risk Calculator</a>
                            <a href="#" className="footer-link">Updates</a>
                        </div>
                    </div>

                    {/* Support Links */}
                    <div className="footer-col">
                        <h4 className="footer-col-title">Support</h4>
                        <div className="footer-links">
                            <a href="#" className="footer-link">WhatsApp Support</a>
                            <a href="mailto:iotank.com@gmail.com" className="footer-link">iotank.com@gmail.com</a>
                            <a href="tel:+254111746901" className="footer-link">+254 111 746 901</a>
                            <a href="#" className="footer-link">Help Center</a>
                            <a href="#" className="footer-link">System Status</a>
                        </div>
                    </div>
                </div>

                {/* System Info Bar */}
                <div className="footer-info-bar">
                    <div className="info-left">
                        <span>IoTank Platform v2.0.0</span>
                        <span className="dot">•</span>
                        <span>Firmware Baseline v2.1.4-Stable</span>
                        <span className="dot">•</span>
                        <span>System Uptime: 99.98%</span>
                    </div>
                    <div className="info-right">
                        <span>Powered by Secure Cloud Infrastructure</span>
                        <span className="dot">•</span>
                        <span>AES-256 Encryption</span>
                        <span className="dot">•</span>
                        <span>Built for EPRA Compliance</span>
                    </div>
                </div>

                {/* Copyright Bar */}
                <div className="footer-bottom">
                    <div className="copyright">
                        © 2026 Joe Engineering Ltd. All rights reserved.
                    </div>

                    <div className="social-links">
                        <a href="#" className="social-icon"><FiTwitter /></a>
                        <a href="#" className="social-icon"><FiLinkedin /></a>
                        <a href="#" className="social-icon"><FiFacebook /></a>
                        <a href="#" className="social-icon"><FiMail /></a>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;

