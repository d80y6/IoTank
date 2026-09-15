import React, { useEffect } from 'react';
import { FiShield, FiAlertTriangle, FiInfo, FiCheckCircle } from 'react-icons/fi';
import './AcceptableUsePolicy.css';

const AcceptableUsePolicy: React.FC = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="aup-page">
            <div className="aup-container">
                <header className="aup-header">
                    <div className="aup-header-icon">
                        <FiShield size={48} />
                    </div>
                    <h1>Acceptable Use Policy (AUP)</h1>
                    <p className="aup-subtitle">IoTANK FUEL INTELLIGENCE HUB — MASTER GOVERNANCE FRAMEWORK</p>
                    <div className="aup-meta">
                        <span>Version 2.0.0</span>
                        <span className="dot">•</span>
                        <span>Effective: May 15, 2026</span>
                        <span className="dot">•</span>
                        <span>Region: Republic of Kenya</span>
                    </div>
                </header>

                <div className="aup-content">
                    <section className="aup-section">
                        <h2>1. Preamble & Regulatory Alignment</h2>
                        <p>
                            This Acceptable Use Policy ("Policy") governs the access and use of the IoTank platform and its associated hardware assets. 
                            This Policy is designed to ensure the safety, security, and integrity of critical fuel infrastructure in accordance with the 
                            <strong> Laws of the Republic of Kenya</strong>, including but not limited to the <strong>Energy Act 2019</strong>, 
                            the <strong>Petroleum Act 2019</strong>, and the <strong>Data Protection Act 2019 (DPA)</strong>.
                        </p>
                    </section>

                    <section className="aup-section">
                        <h2>2. Data Privacy & Sovereignty (DPA 2019)</h2>
                        <div className="aup-notice-box">
                            <FiInfo className="notice-icon" />
                            <p>
                                IoTank is a registered Data Processor under the Office of the Data Protection Commissioner (ODPC) in Kenya.
                            </p>
                        </div>
                        <p>
                            <strong>2.1 Data Collection:</strong> We collect operational telemetry (tank levels, temperatures) and personal identifiers 
                            (names, emails) solely for the purpose of industrial monitoring and safety alerting.
                        </p>
                        <p>
                            <strong>2.2 Data Residency:</strong> All personal data is processed and stored in compliance with the DPA 2019. 
                            Where cross-border transfers occur, we ensure "Adequacy Standards" as defined by the ODPC are met.
                        </p>
                        <p>
                            <strong>2.3 User Rights:</strong> In accordance with Section 26 of the DPA, users have the right to access, rectify, 
                            and erase their personal data. Requests can be sent to <strong>iotank.privacy@gmail.com</strong>.
                        </p>
                    </section>

                    <section className="aup-section">
                        <h2>3. Hardware Safety & Hazardous Areas</h2>
                        <div className="aup-warning-box">
                            <FiAlertTriangle className="notice-icon" />
                            <p>
                                <strong>DANGER:</strong> Fuel environments are Class I, Division 1 hazardous areas. Unauthorized modification 
                                of IoTank hardware is strictly prohibited and constitutes a safety breach.
                            </p>
                        </div>
                        <p>
                            <strong>3.1 Intrinsic Safety:</strong> Users must not attempt to open, repair, or modify any sensor or gateway device. 
                            The intrinsic safety certification is voided upon unauthorized tampering, creating an immediate fire risk.
                        </p>
                        <p>
                            <strong>3.2 Environmental Compliance:</strong> Users are legally obligated under the <strong>Environmental Management 
                            and Coordination Act (EMCA)</strong> to report any leaks or spills detected by the platform to NEMA.
                        </p>
                    </section>

                    <section className="aup-section">
                        <h2>4. Prohibited Activities</h2>
                        <p>Users are strictly prohibited from the following activities:</p>
                        <ul className="aup-list">
                            <li><strong>Reverse Engineering:</strong> Attempting to decompile firmware or intercept BLE packets.</li>
                            <li><strong>Data Manipulation:</strong> Falsifying fuel records to circumvent tax audits or EPRA inspections.</li>
                            <li><strong>Unauthorized Access:</strong> Sharing administrative credentials or bypassing MFA/PIN security gates.</li>
                            <li><strong>System Stress:</strong> Deploying scrapers or automated tools that exceed API rate limits (100 calls/hour).</li>
                        </ul>
                    </section>

                    <section className="aup-section">
                        <h2>5. Identity Protection & Forensic Auditing</h2>
                        <p>
                            To maintain system integrity, IoTank implements 6-digit Security PINs and Two-Factor Authentication (MFA). 
                            All critical actions (price changes, tank deletions, firmware updates) are forensically logged with the user's 
                            digital signature and IP address.
                        </p>
                    </section>

                    <section className="aup-section">
                        <h2>6. Enforcement & Fines</h2>
                        <p>
                            Violations of this AUP may result in immediate account suspension, hardware quarantine, and referral to 
                            regulatory authorities. Under the <strong>Computer Misuse and Cybercrimes Act 2018</strong>, unauthorized 
                            system interference carries significant legal penalties and fines.
                        </p>
                    </section>
                </div>

                <footer className="aup-footer">
                    <p>© 2026 Joe Engineering Company (IoTank Systems Kenya)</p>
                    <div className="aup-footer-links">
                        <FiCheckCircle className="check-icon" />
                        <span>Registered Data Processor (ODPC Kenya)</span>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default AcceptableUsePolicy;
