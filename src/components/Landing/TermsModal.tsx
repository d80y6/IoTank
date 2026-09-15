/* eslint-disable react/no-unescaped-entities */
import React, { useState, useRef, useEffect } from 'react';
import './TermsModal.css';

interface TermsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onComplete: () => void;
    initialStep?: number;
    readOnly?: boolean;
}

const termsSections = [
    {
        title: "Part A — Platform Governance, Ethics & Information Architecture",
        content: (
            <>
                <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                    <h2 style={{ margin: '0 0 10px 0', fontSize: '26px', color: '#111827', fontWeight: 700 }}>iotank fuel intelligence hub</h2>
                    <h3 style={{ margin: '0 0 20px 0', fontSize: '18px', color: '#4B5563', fontWeight: 600 }}>comprehensive legal agreement &amp; terms of service</h3>
                    <p style={{ fontSize: '13px', color: '#6B7280' }}>
                        <strong>version:</strong> 3.2.0 (master enterprise edition) | <strong>effective:</strong> march 21, 2026<br />
                        <strong>regulatory framework:</strong> kenya energy act 2019, petroleum act 2019, dpa 2019 &amp; nfpa 70/77 aligned
                    </p>
                </div>

                <div className="terms-notice">
                    <strong>master preamble:</strong> this master service agreement (the "agreement") constitutes the complete and exclusive legal framework governing your access, utilization, and professional engagement with the iotank fuel intelligence hub (the "platform"). under the <strong>law of contract act (chapter 23, laws of kenya)</strong> and the <strong>kenya information and communications act (kica)</strong>, your electronic acceptance of these terms creates a binding, irrevocable, and enforceable obligation between you (the "user" or "operator") and joe engineering company (trading as <strong>iotank systems kenya</strong>). failure to adhere to any provision herein constitutes a material breach, potentially resulting in immediate suspension, legal litigation, and referral to regulatory authorities.
                </div>

                <span className="terms-section-title">section i: master terms of use &amp; operational eligibility</span>
                <p><strong>1.1 Age and Legal Competence:</strong> In strict accordance with the <strong>Age of Majority Act</strong>, you must be at least 18 years of age to create an account or interact with IoTank assets. The industrial nature of fuel monitoring involves high-voltage telemetry and hazardous vapor environments; therefore, minors are strictly prohibited from platform access. Any account found to be operated by a minor will be terminated immediately without notice or refund of subscription fees, as such access constitutes a safety risk.</p>
                <p><strong>1.2 Professional Authorization &amp; Corporate Agency:</strong> If registering on behalf of a corporate entity, fuel retail network, or commercial depot, you represent and warrant that you possess the explicit <strong>Corporate Agency</strong> to bind said entity. This includes, but is not limited to, holding a valid Board Resolution, Power of Attorney, or being a registered Director/Manager with the <strong>Registrar of Companies (Business Registration Service)</strong>. Unauthorized monitoring of assets or interception of telemetry data is a criminal offense under the <strong>Computer Misuse and Cybercrimes Act 2018</strong>.</p>
                <p><strong>1.3 Business Property Verification:</strong> For facilities with a collective storage capacity exceeding 10,000 liters, IoTank requires enhanced due diligence. You must provide a valid <strong>EPRA Retail/Storage License</strong>, KRA PIN Certificate, and a current <strong>County Government Fire Safety Certificate</strong>. Misrepresentation of facility capacity or licensing status is grounds for immediate termination without reward for any fees paid and may be reported to the Energy &amp; Petroleum Regulatory Authority.</p>
                <p><strong>1.4 Site Ownership &amp; Landlord Consent:</strong> The User warrants that they either own the underlying real estate occupied by the fuel assets or possess written <strong>Landlord Consent</strong> for the installation of ultrasonic sensors, gateways, and associated cabling. The installation involves physical attachment to tank manholes and flanges; you accept full responsibility for any permanent modification to the tank structure required for sensor deployment and any associated impact on tank warranties.</p>
                <p><strong>1.5 Single Account Integrity:</strong> To ensure system consistency and prevent data fragmentation, each legal entity is restricted to one Master Account. We utilize advanced <strong>Hardware ID (UUID)</strong> and <strong>ESP32 MAC-address fingerprinting</strong> to detect and neutralize duplicate accounts created to exploit trial periods or circumvent subscription debts. All linked devices will be quarantined upon detection of account spoofing or identity obfuscation.</p>

                <span className="terms-section-title">section ii: technical scope &amp; blueprint visualization</span>
                <p><strong>2.1 Proprietary Correction Algorithms:</strong> IoTank utilizes the <strong>Newton-Laplace Acoustic Correction</strong> logic (v = √[(γ × R × T) / M]) to calculate the real-time speed of sound in volatile fuel vapors. This proprietary model compensates for temperature stratifications, humidity fluctuations, and atmospheric pressure variables, reducing raw sensor measurement error from ±7% to a commercial-grade ±0.2% precision. You acknowledge that calibration stability is dependent on regular maintenance of the sensor vapor barrier and adherence to installation heights.</p>
                <p><strong>2.2 High-Density Blueprint Engines:</strong> The Platform provides a <strong>2D Blueprint Visualization</strong> of the storage asset. This spatial model utilizes real-time telemetry to visualize fuel levels and temperature gradients. You acknowledge that visual representations are for orientation and should be cross-referenced with raw metric data.</p>
                <p><strong>2.3 Cloud Infrastructure &amp; Latency:</strong> Data is processed via a multi-layered cloud architecture hosted on <strong>Google Cloud Platform (GCP)</strong> and <strong>Supabase</strong> with 99.9% uptime targets. You acknowledge that network latency (latency &gt; 500ms) on local GSM/LTE networks may cause delayed alert delivery. The platform performs massive parallel computation to render 3D scenes; low-end mobile devices may experience interface lag. Use of the system on 2G/EDGE networks is discouraged and voidance of performance SLAs applies to all low-bandwidth connections.</p>
                <p><strong>2.4 API Access &amp; Webhooks:</strong> Standard subscriptions include rate-limited API access (100 calls/hour). Excessive polling or "scraping" of the metrics endpoint will trigger an automated <strong>DDoS Mitigation</strong> block via our Cloudflare WAF. Webhook delivery is provided on a "best-effort" basis via encrypted HTTPS POST requests. You are responsible for the security, uptime, and proper response status codes (2xx) of your own receiving endpoints.</p>
                <p><strong>2.5 System Maintenance Windows:</strong> Strategic updates to the neural forecasting models and telemetry shaders are performed weekly (Sundays, 02:00–04:00 EAT). During these windows, real-time telemetry visualization may be intermittently unavailable, though local data caching on the IoT Gateway will ensure no telemetry continuity loss occurred. Routine maintenance is not counted towards downtime in our uptime SLAs provided notice was displayed in-app.</p>

                <span className="terms-section-title">section iii: privacy policy, sovereignty &amp; data protection</span>
                <p><strong>3.1 Adherence to DPA 2019:</strong> In strict compliance with the <strong>Kenya Data Protection Act 2019</strong>, IoTank operates as a Data Processor for operational telemetry (tank levels, temperatures) and a Data Controller for account identifiers (emails, phone numbers). We are registered with the <strong>Office of the Data Protection Commissioner (ODPC)</strong> and follow the principles of data minimization, purpose limitation, and storage limitation.</p>
                <p><strong>3.2 Data Residency &amp; Sovereignty:</strong> Operational data is hosted in geographically resilient clusters. By utilizing the Platform, you provide explicit <strong>Cross-Border Transfer Consent</strong> for data processing on designated secure nodes, provided that such nodes maintain "Adequacy Standards" as defined by the ODPC. We utilize end-to-end encryption for all data in transit (TLS 1.3) and at rest using AES-256-GCM protocols within the Supabase vault.</p>
                <p><strong>3.3 Retention &amp; Secure Purging:</strong> Telemetry data is retained for the active duration of your subscription plus a mandatory 12-month "Audit Period" to comply with <strong>EPRA Petroleum Regulations</strong> for retail station records. Upon expiration of the Audit Period, all data is purged using <strong>DoD 5220.22-M</strong> wipe standards to ensure non-recoverability. Account records are kept as required by the <strong>Statute of Limitations</strong> for financial and tax audits.</p>
                <p><strong>3.4 Third-Party Interaction:</strong> IoTank NEVER sells, rents, or barters your specific facility metrics to competitors or commodity traders. We may share anonymized, aggregated secondary metadata (e.g., regional consumption trends) for the purpose of improving regional demand-forecasting models, provided no individual facility, brand, or owner can be identified by any reasonably foreseeable means.</p>

                <span className="terms-section-title">section iv: user responsibilities, security &amp; safety</span>
                <p><strong>4.1 Credential Integrity:</strong> You are the sole custodian of your password, API keys, and 2FA secrets. Any action performed via your account is legally attributed to you as a digital signature. **Multi-Factor Authentication (MFA)** is mandatory for all user levels with 'Admin' or 'Staff' roles. Shared accounts are strictly prohibited and will trigger automated account locks for suspicious concurrent sessions.</p>
                <p><strong>4.2 IoT Network Isolation:</strong> To prevent lateral network attacks, all IoTank Gateways MUST be deployed on a isolated <strong>IoT VLAN</strong> with no direct access to your internal Point-of-Sale (POS) or Office networks. Failure to segment the network voids our Security SLA and Joe Engineering Company accepts no liability for subsequent breach of your local network assets or data loss in auxiliary systems.</p>
                <p><strong>4.3 Mandatory Firmware Compliance:</strong> Joe Engineering Company pushes critical security and safety patches via <strong>Over-the-Air (OTA)</strong> updates. You agree to leave hardware powered on and connected. Gateways offline for &gt;45 days will be automatically quarantined and disconnected from the platform until physical factory reset and re-verification by an authorized technician.</p>
                <p><strong>4.4 Prohibition of Reverse Engineering:</strong> You are strictly prohibited from: (a) Attempting to decompile the gateway firmware, (b) Intercepting sensor-to-gateway BLE packets using third-party sniffers, or (c) Attempting to reconstruct the Newton-Laplace correction tables via empirical testing. Such actions are violations of the **Industrial Property Act** and will be prosecuted to the maximum extent of the law.</p>

                <span className="terms-section-title">section v: intellectual property &amp; algorithmic protection</span>
                <p><strong>5.1 Ownership of Innovations:</strong> All software code, visualization assets, neural network weights, and technical documentation are the exclusive <strong>Intellectual Property</strong> of Joe Engineering Company. The "IoTank" name and logo are registered trademarks with the <strong>Kenya Industrial Property Institute (KIPI)</strong>. Use of these marks without written consent is an infringement of trademark law and will be met with immediate legal cease-and-desist orders.</p>
                <p><strong>5.2 Limited User License:</strong> You are granted a non-exclusive, non-transferable, revocable license to access the Platform for the sole purpose of monitoring your verified assets. Any attempt to "Whitelabel", scrape, or redistribute the Platform metrics to third parties without a <strong>Master Distributor Agreement</strong> is strictly prohibited and will result in permanent platform exclusion and potential civil damages.</p>

                <span className="terms-section-title">section vi: procurement ai assistant &amp; market volatility</span>
                <p><strong>6.1 Forecasting Limitations:</strong> The AI Assistant utilizes historical data and global commodity feeds (Brent/WTI). You acknowledge that markets are volatile and subject to unforeseen disruption (geopolitical events, EPRA policy shifts). **DISCLAIMER:** All "Buy", "Hold", or "Order" signals are probabilistic estimates. final financial commitment is the sole responsibility of the User; we do not provide financial, investment, or legal advice regarding procurement timing.</p>
            </>
        )
    },
    {
        title: "Part B — Safety, Compliance & Liability Risk Allocation",
        content: (
            <>
                <div className="terms-notice">
                    <strong>section vii: legal &amp; safety disclaimers (critical):</strong> operation in petroleum environments (zone 0/1/2) carries inherent risk of explosion, fire, and catastrophic environmental contamination. every iotank hardware installation must strictly adhere to <strong>"safety-by-isolation"</strong> protocols. the user accepts full and exclusive liability for any ignition source introduced by circumventing these standards.
                </div>

                <span className="terms-section-title">section viii: mandatory hardware safety standards</span>
                <p><strong>8.1 Zone Classification:</strong> Sensors are designed for use in hazardous areas. However, you certify that your facility follows <strong>NFPA 70 Article 500</strong> for Class I, Division 1/2 locations. Joe Engineering Company is not an "Electrical Inspectorate" and relies on your local compliance certificate for the safe operation of the site overall. The presence of non-certified hazardous area equipment on the same site voids all system guarantees.</p>
                <p><strong>8.2 PTFE/PVDF Vapor Barrier Integrity:</strong> All sensors deployed in tanks containing Class I or II flammable liquids (Petrol/Diesel/Jet-A1) must be isolated from fuel vapors by a <strong>PTFE (Teflon™) or PVDF membrane</strong> of no less than 110-130 microns. This barrier ensures zero gas-to-electronics interaction. Removing, puncturing, or failing to replace a degraded barrier voids all safety certifications, effectively creates an ignition risk, and automatically terminates this Agreement with immediate effect.</p>
                <p><strong>8.3 Grounding &amp; Electrostatic Mitigation:</strong> All guide tubes, sensor housings, and gateway enclosures must be electrically bonded to the facility's main earthing system. The resistance path to earth must be verified at &lt;10Ω. Static discharge in a vapor-rich environment is a catastrophic risk; periodic grounding verification is the Operator's ongoing legal duty under the **Petroleum (Strategic Stock) Regulations** and local OSH protocols.</p>
                <p><strong>8.4 Intrinsic Safety &amp; Isolation:</strong> Any modification to the sensor housing, use of non-approved batteries (non-Saft/non-Tadiran), or introduction of auxiliary power sources will compromise the <strong>Intrinsically Safe</strong> nature of the device. Users found using unauthorized power sources will have their accounts locked for "Immediate Safety Breach" and safety authorities (EPRA/FIRE) may be notified.</p>
                <p><strong>8.5 Installation Liability:</strong> Proper installation requires technical expertise in hazardous areas. If you elect to self-install, you accept all risks associated with sensor falling, vapor leaks, or incorrect assembly. Joe Engineering Company assumes zero liability for property damage or bodily injury resulting from improper hardware deployment by non-certified personnel.</p>

                <span className="terms-section-title">section ix: epra &amp; kenyan regulatory compliance</span>
                <p><strong>9.1 Admissibility of Records:</strong> You acknowledge that IoTank telemetry records are admissible in regulatory disputes with <strong>EPRA</strong> or the <strong>Kenya Bureau of Standards (KEBS)</strong>. Misrepresenting stock levels to avoid taxes or regulatory scrutiny via fake data injection or software manipulation is a punishable offense under the Energy Act 2019 and may lead to license revocation.</p>
                <p><strong>9.2 NEMA Environmental Reporting:</strong> In accordance with the <strong>Environmental Management and Coordination Act (EMCA)</strong>, any anomaly detection (Rapid Loss Signal) suggesting a subsurface leak (UST) or spill must be investigated and remediated immediately. The Platform serves as an alerting tool, but the legal duty to report incidents to <strong>NEMA</strong> rests solely with the Operator. Failure to report a detected leak is a violation of environmental law.</p>

                <span className="terms-section-title">section x: limitation of liability &amp; industrial indemnity</span>
                <p><strong>10.1 Disclaimer of Warranties:</strong> The Service is provided "AS IS" and "AS AVAILABLE". To the maximum extent permitted by the <strong>Laws of Kenya</strong>, we disclaim all implied warranties of merchantability or fitness for a particular purpose. We do not warrant that measurements will be "perfectly accurate" given the myriad environmental factors (fuel density shifts, tank expansion/contraction, sensor fouling, or acoustic reflection anomalies).</p>
                <p><strong>10.2 Exclusion of Damages:</strong> Joe Engineering Company and its directors, employees, and hardware partners shall NOT be liable for: (a) Direct or indirect loss of fuel due to leaks, (b) Theft or pilferage by staff/third-parties, (c) Fire or explosion arising from installation errors by fourth-party contractors, or (d) Environmental remediation costs from tank corrosion. Your insurance coverage (Industrial All-Risk) must account for these liabilities as a primary layer of protection.</p>
                <p><strong>10.3 Maximum Liability Cap:</strong> In any event, our total cumulative liability for all claims arising from this Agreement—whether in contract, tort, or otherwise—shall NOT exceed the total subscription fees paid by you to the Company in the twelve (12) months preceding the claim. This cap applies regardless of the number of incidents, claims, or sites involved.</p>

                <span className="terms-section-title">section xi: subscription, billing &amp; payment</span>
                <p><strong>11.1 Billing Cycle:</strong> Subscriptions are billed monthly or annually in advance. Payments are processed via MPESA Business Till, Direct Bank Transfer, or Stripe (International). All fees are exclusive of VAT and Withholding Tax unless stated otherwise. Late payments accrue interest at 2% above the Central Bank of Kenya lending rate calculated daily from the due date.</p>
                <p><strong>11.2 Suspension Protocol:</strong> Failure to settle invoices within seven (7) days of the due date will trigger automated <strong>Alert Suspension</strong>. Your hardware will remain powered, but dashboard access and SMS/Email alerts will be disabled until the balance is cleared. Data generated during suspension may not be recoverable and will not be displayed post-reactivation unless an "Archive Recovery" fee is paid.</p>
                <p><strong>11.3 Rate Adjustments:</strong> We reserve the right to adjust subscription rates to account for inflation, increased AWS/GCP hosting costs, or EPRA regulatory changes. We will provide thirty (30) days' notice via the Platform notifications panel and registered email addresses. Continued use of the platform after the rate change constitutes acceptance of the new pricing.</p>

                <span className="terms-section-title">section xii: termination &amp; data retention</span>
                <p><strong>12.1 Rights of Termination:</strong> You may terminate your account at any time via written notice to Joe Engineering Company. We reserve the right to terminate access for: (a) Safety breaches, (b) Non-payment, (c) Unauthorized scraping, or (d) Conduct detrimental to the IoTank community. **12.2 Post-Termination Data:** Suspended accounts will reach "End-of-Life" (EOL) status after 90 days of inactivity, resulting in the permanent, non-recoverable deletion of all telemetry archives from our production and backup clusters.</p>

                <span className="terms-section-title">section xiii: dispute resolution &amp; governing law</span>
                <p><strong>13.1 Governing Law:</strong> This Agreement is governed by the <strong>Laws of the Republic of Kenya</strong>. **13.2 Amicable Settlement:** Any dispute arising from this Agreement shall first be submitted to senior-level negotiation between the parties for a period of 14 days. **13.3 Arbitration:** If unresolved, the dispute shall be referred to a single arbitrator in Nairobi, Kenya, under the rules of the <strong>Chartered Institute of Arbitrators (Kenya Branch)</strong>. The arbitrator's award shall be final and binding on both parties and may be entered as a judgment in any court of competent jurisdiction.</p>

                <div style={{ marginTop: '40px', padding: '24px', border: '2px solid #2563EB', borderRadius: '12px', background: '#EFF6FF' }}>
                    <p style={{ fontWeight: 700, color: '#1E40AF', fontSize: '15.5px', margin: '0 0 12px 0' }}>master affirmation &amp; digital signature</p>
                    <p style={{ fontWeight: 400, color: '#1E40AF', fontSize: '14.5px', margin: 0, lineHeight: '1.7' }}>
                        By clicking "Accept &amp; Sign Up", you certify that you have read and understood all 13 comprehensive sections of this Master Service Agreement. You represent that your facility implements all mandatory safety protocols described herein and you possess the legal authority to bind your organization. This action constitutes a digital signature under <strong>Section 83P of the Information and Communications Act</strong>, creating a legally binding and enforceable contract between you and Joe Engineering Company.
                    </p>
                </div>
            </>
        )
    },
    {
        title: "Part C — Acceptable Use Policy (AUP) & Professional Conduct",
        content: (
            <>
                <div className="terms-notice">
                    <strong>master directive:</strong> the iotank platform is a high-precision industrial tool. the following policy defines the ethical and operational boundaries for all registered users. violation of the aup will result in immediate "blackballing" from the platform and potential reporting to cybercrime units.
                </div>

                <span className="terms-section-title">section xiv: ethical usage & telemetry integrity</span>
                <p><strong>14.1 Data Falsification:</strong> You are strictly prohibited from attempting to inject, spoof, or manipulate telemetry packets to show false fuel levels. This includes using hardware emulators or modifying sensor payloads. Any detection of "Synthetic Level Injection" will be treated as industrial fraud.</p>
                <p><strong>14.2 Systematic Abuse:</strong> Automated scraping, botting, or "stress-testing" our production API without prior written authorization is a violation of the AUP. We utilize <strong>AI-driven behavior analysis</strong> to detect non-human interaction patterns.</p>
                <p><strong>14.3 Account Sovereignty:</strong> You may not share your professional credentials with third-party consultants or competitors. Every user must have a unique identity bound to their corporate email. "Shadow Accounts" created to bypass station-count limits will be purged without recovery.</p>

                <span className="terms-section-title">section xv: hardware & network safety</span>
                <p><strong>15.1 Physical Tampering:</strong> Modifying the IoTank Gateway firmware or attempting to bypass the encrypted secure-boot sequence is strictly prohibited. Hardware found with "JTAG" or "UART" tampering will be permanently blacklisted from our Cloud nodes.</p>
                <p><strong>15.2 Interference with Neighbors:</strong> You may not use IoTank sensor arrays to interfere with or intercept telemetry from neighboring fuel stations or third-party IoT networks. Industrial espionage via our platform is a crime.</p>

                <div className="terms-footer-seal">
                    <p>© 2026 Joe Engineering Company | IoTank Systems Kenya</p>
                    <p>Verified Compliant with DPA 2019 & Energy Act 2019</p>
                </div>
            </>
        )
    }
];


const TermsModal: React.FC<TermsModalProps> = ({ isOpen, onClose, onComplete, initialStep = 0, readOnly = false }) => {
    // Clamp initialStep to valid range
    const safeInitialStep = Math.min(Math.max(0, initialStep), termsSections.length - 1);
    const [currentStep, setCurrentStep] = useState(safeInitialStep);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    // Reset when modal opens
    useEffect(() => {
        if (isOpen) {
            setCurrentStep(initialStep);
            setHasScrolledToBottom(false);
        }
    }, [isOpen, initialStep]);

    // Handle Scroll Detection
    const handleScroll = () => {
        if (contentRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
            // Allow a small buffer (e.g. 10px) to account for browser sizing differences
            if (scrollTop + clientHeight >= scrollHeight - 50) {
                setHasScrolledToBottom(true);
            }
        }
    };

    // Auto-check scroll logic when step changes (if content is short)
    useEffect(() => {
        setHasScrolledToBottom(false);
        if (contentRef.current) {
            // If content is smaller than container, auto-enable
            if (contentRef.current.scrollHeight <= contentRef.current.clientHeight + 20) {
                setHasScrolledToBottom(true);
            } else {
                contentRef.current.scrollTop = 0; // Reset scroll
            }
        }
    }, [currentStep, isOpen]);


    const handleNext = () => {
        if (currentStep < termsSections.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            onComplete();
        }
    };

    if (!isOpen) return null;

    const currentSection = termsSections[currentStep] || termsSections[0];
    const isLastStep = currentStep === termsSections.length - 1;

    return (
        <div className="terms-overlay">
            <div className="terms-modal">
                <div className="terms-header">
                    <h3 className="terms-title">{currentSection.title}</h3>
                    <div className="terms-progress">Section {currentStep + 1} of {termsSections.length}</div>
                </div>

                <div className="terms-content" ref={contentRef} onScroll={handleScroll}>
                    <div className="terms-text">
                        {currentSection.content}
                    </div>
                </div>

                <div className="terms-actions">
                    {readOnly ? (
                        <button className="terms-accept" onClick={onClose}>Close</button>
                    ) : (
                        <>
                            <button className="terms-cancel" onClick={onClose}>Cancel</button>
                            <button
                                className="terms-accept"
                                onClick={handleNext}
                                disabled={!hasScrolledToBottom}
                                title={!hasScrolledToBottom ? "Please scroll to the bottom to continue" : ""}
                            >
                                {isLastStep ? "Accept & Sign Up" : "Accept & Continue"}
                            </button>
                        </>
                    )}
                </div>

                {!hasScrolledToBottom && (
                    <div className="scroll-prompt visible">
                        Scroll to bottom ↓
                    </div>
                )}
            </div>
        </div>
    );
};

export default TermsModal;
