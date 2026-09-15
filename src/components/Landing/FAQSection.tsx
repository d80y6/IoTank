/* eslint-disable react/no-unescaped-entities */
import React, { useState } from 'react';
import { FiPlus } from 'react-icons/fi'; // Only need Plus, we rotate it for X
import './FAQSection.css';

interface FAQItem {
    id: number;
    question: string;
    answer: string;
}

const FAQSection: React.FC = () => {
    const [openId, setOpenId] = useState<number | null>(1);
    const [emailBody, setEmailBody] = useState("");

    const toggleFAQ = (id: number) => {
        setOpenId(openId === id ? null : id);
    };

    const handleSendEmail = () => {
        // Construct mailto link
        const recipient = "Josephvundi26@gmail.com";
        const subject = encodeURIComponent("Asking a Question");
        const body = encodeURIComponent(emailBody);
        window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
    };

    const faqs: FAQItem[] = [
        {
            id: 1,
            question: "How is IoTank more accurate than traditional manual \"dipping\"?",
            answer: "Traditional manual dipping or standard gauges assume that the conditions inside your tank never change. However, fuel is highly sensitive to temperature and vapor density. IoTank uses the proprietary Newton-Laplace Physics Engine on our ESP32 processors to calculate the \"True Speed of Sound\" in real-time. By accounting for temperature and the specific molar mass of fuel vapors, the IoTank system eliminates the 3–5% error margin common in other systems, providing you with a precision level of +/- 1mm."
        },
        {
            id: 2,
            question: "Is it safe to have electronics near a fuel tank?",
            answer: "Safety is our highest priority at IoTank. We utilize a \"Safety-by-Isolation\" engineering strategy. Physically, the IoTank electronics are separated from fuel vapors by a chemically inert, acoustically transparent PTFE (Teflon) membrane. Electrically, we use Opto-Isolators and current limiters to ensure that the energy near the tank stays below 0.2 mJ—well below the point of ignition. Additionally, our system includes a Thermal Kill-Switch that automatically cuts all power if the temperature reaches a critical threshold."
        },
        {
            id: 3,
            question: "Can the system detect small leaks or fuel siphoning (theft)?",
            answer: "Yes. Unlike standard monitors that only show a \"snapshot,\" IoTank uses Statistical Behavior Analysis. The IoTank algorithms can distinguish between a \"Natural Trend\" (fuel being used by your engines), \"Fouling\" (sensor residue), and \"Anomalous Loss\" (theft or leaks). If the IoTank system detects a consistent, unauthorized drop in volume—even a slow one—it triggers an immediate Silent Leak Alert to your mobile device and web dashboard."
        },
        {
            id: 4,
            question: "What exactly is \"Standardized Volume\", and why does it matter?",
            answer: "Fuel expands when it’s hot and contracts when it’s cold. This means you might have the same amount of \"energy\" in your tank, but the physical volume looks different on a gauge. IoTank automatically standardizes your volume to the industry-standard. This allows you to see the \"IoTank Billable Volume,\" ensuring you are never overcharged for \"expanded\" fuel or losing money due to \"apparent\" shrinkage."
        },
        {
            id: 5,
            question: "How does the \"Procurement AI\" help me save money?",
            answer: "The IoTank \"Fuel Intelligence Hub\" is more than a monitor; it’s a financial consultant. Our AI scans global market trends and local fuel news using Natural Language Processing (NLP). By comparing your current consumption rate (how fast you are using fuel) with market price forecasts, the IoTank system advises you on the best time to buy. For example, if a price hike is expected in 48 hours and your tank is at 30%, IoTank will recommend an immediate refill to \"lock in\" current rates."
        },
        {
            id: 6,
            question: "Does the sensor require frequent maintenance?",
            answer: "Hardly ever. One of our key innovations is the \"IoTank Ghost in the Machine\" Diagnostic. The system constantly monitors its own \"Acoustic Cleanliness.\" If paraffin or residue begins to build up on the protective PTFE window, the IoTank system will detect a spike in data \"jitter\" (variance) and send you a Maintenance Alert. This allows for \"Condition-Based Maintenance,\" meaning you only clean the sensor when it actually needs it."
        },
        {
            id: 7,
            question: "What happens if the Wi-Fi or Internet goes down?",
            answer: "The IoTank is an Edge-Computing device. This means the critical logic—level calculation, safety monitoring, and theft detection—happens directly on the IoTank hardware at your tank site. If your connection is lost, the IoTank device will continue to log data locally. Once the connection is restored, it will \"sync\" the missed data to the cloud, ensuring your historical graphs and financial reports remain unbroken."
        }
    ];

    return (
        <section id="faq" className="faq-section" style={{ paddingTop: '20px' }}>
            <div className="faq-container">

                {/* Left Column: Header + Contact */}
                <div className="faq-left-col">
                    <div className="faq-header">
                        <span className="faq-eyebrow">Support</span>
                        <h2 className="faq-title">Frequently Asked Questions</h2>
                    </div>

                    <div className="faq-contact-card">
                        <h3 className="contact-card-title">Still have a question?</h3>
                        <p className="contact-card-text">
                            Can't find the answer you're looking for? Send us a message directly and we'll get back to you as soon as possible.
                        </p>
                        <div className="contact-input-wrapper">
                            <textarea
                                className="contact-textarea"
                                placeholder="Type your question here..."
                                value={emailBody}
                                onChange={(e) => setEmailBody(e.target.value)}
                            />
                            <button className="contact-send-btn" onClick={handleSendEmail}>
                                Send Message
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Column: FAQ List */}
                <div className="faq-list">
                    {faqs.map((faq) => (
                        <div
                            key={faq.id}
                            className={`faq-item ${openId === faq.id ? 'active' : ''}`}
                        >
                            <div className="faq-question-row" onClick={() => toggleFAQ(faq.id)}>
                                <h3 className="faq-question">{faq.question}</h3>
                                <button className="faq-toggle-btn">
                                    <FiPlus />
                                </button>
                            </div>
                            <div className="faq-answer">
                                <div className="faq-answer-content">
                                    <p>{faq.answer}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default FAQSection;
