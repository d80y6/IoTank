import React, { useState } from 'react';
import { FiCheckCircle, FiChevronRight, FiChevronLeft, FiMapPin, FiBox, FiCpu } from 'react-icons/fi';
import { supabase } from '@/config/supabase';
import { User, Tank } from '@/types';
import { logger } from '@/utils/logger';
import './OnboardingModal.css';

interface OnboardingModalProps {
    isOpen: boolean;
    user: User;
    onComplete: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, user, onComplete }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [saveStatus, setSaveStatus] = useState('');

    // Form State
    const [companyInfo, setCompanyInfo] = useState({
        name: '',
        street: '',
        unit: '',
        city: '',
        state: '',
        zip: ''
    });

    const [tankInfo, setTankInfo] = useState({
        name: 'Main Tank',
        capacity: 5000,
        fuelType: 'diesel' as Tank['fuelType']
    });

    const [hardwareInfo, setHardwareInfo] = useState({
        esp32Address: ''
    });

    const handleSave = async () => {
        setLoading(true);
        setSaveStatus('Initializing');
        try {
            const stationId = user.stationId;
            const authUserId = user.authUserId;
            const tankId = `tank-${authUserId}-${Date.now()}`;
            const siteId = 'site-default';


            // 1. Update User Profile
            setSaveStatus('User Profile');
            const { error: profileError } = await supabase
                .from('profiles')
                .update({
                    role: 'admin',
                    display_name: user.displayName || 'Admin',
                    station_id: stationId,
                    site_ids: [siteId]
                })
                .eq('auth_user_id', authUserId);
            if (profileError) throw profileError;

            // 2. Create/Update Organization (Client Billing)
            setSaveStatus('Organization');
            const { error: orgError } = await supabase
                .from('fuel_stations')
                .upsert({
                    id: stationId,
                    auth_user_id: authUserId,
                    email: user.email,
                    station_name: companyInfo.name,
                    station_location: companyInfo.city,
                    county: companyInfo.state
                });
            if (orgError) throw orgError;

            // 3. Create/Update Site
            setSaveStatus('Site Init');
            const { error: siteError } = await supabase
                .from('sites')
                .upsert({
                    id: siteId,
                    station_id: stationId,
                    site_name: 'Main Facility',
                    location: `${companyInfo.street}, ${companyInfo.city}`,
                    tank_count: 1
                });
            if (siteError) throw siteError;

            // 4. Create Initial Tank
            setSaveStatus('Tank Deploy');
            const { error: tankError } = await supabase
                .from('tanks')
                .upsert({
                    id: tankId,
                    station_id: stationId,
                    site_id: siteId,
                    auth_user_id: authUserId,
                    tank_name: tankInfo.name,
                    fuel_type: tankInfo.fuelType,
                    tank_capacity: tankInfo.capacity,
                    status: 'active'
                });
            if (tankError) throw tankError;

            onComplete();
        } catch (error: any) {
            logger.error(`Onboarding Save Error (${saveStatus}):`, error);
            const errorMsg = error.message || 'Unknown error';
            setLoading(false);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Initialization Failed',
                    message: `Failed at step: [${saveStatus}]\n\nError: ${errorMsg}\n\nPlease try again or contact support.`,
                    type: 'error',
                    attribution: 'PROVISIONING SYSTEM'
                }
            }));
        } finally {
            setLoading(false);
            setSaveStatus('');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="onboarding-overlay">
            <div className="onboarding-modal">
                <div className="onboarding-header">
                    <h2 className="onboarding-title">
                        {step === 1 && "Company Profile"}
                        {step === 2 && "Tank Configuration"}
                        {step === 3 && "Hardware Setup"}
                    </h2>
                    <div className="onboarding-progress">Step {step} of 3</div>
                </div>

                <div className="onboarding-content">
                    {step === 1 && (
                        <div className="onboarding-step-content">
                            <p className="text-secondary mb-6"><FiMapPin className="inline mr-2" /> Please provide your business identity and location.</p>
                            <div className="form-grid">
                                <div className="form-field col-span-2">
                                    <label className="form-label">Company Name *</label>
                                    <input
                                        className="form-input"
                                        value={companyInfo.name}
                                        onChange={e => setCompanyInfo({ ...companyInfo, name: e.target.value })}
                                        placeholder="e.g. Industrial Fuel Solutions *"
                                        required
                                    />
                                </div>
                                <div className="form-field col-span-2">
                                    <label className="form-label">Street Address</label>
                                    <input
                                        className="form-input"
                                        value={companyInfo.street}
                                        onChange={e => setCompanyInfo({ ...companyInfo, street: e.target.value })}
                                        placeholder="123 Industrial Way"
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="form-label">Unit / Suite</label>
                                    <input
                                        className="form-input"
                                        value={companyInfo.unit}
                                        onChange={e => setCompanyInfo({ ...companyInfo, unit: e.target.value })}
                                        placeholder="Suite 101"
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="form-label">City</label>
                                    <input
                                        className="form-input"
                                        value={companyInfo.city}
                                        onChange={e => setCompanyInfo({ ...companyInfo, city: e.target.value })}
                                        placeholder="Nairobi"
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="form-label">State / Province</label>
                                    <input
                                        className="form-input"
                                        value={companyInfo.state}
                                        onChange={e => setCompanyInfo({ ...companyInfo, state: e.target.value })}
                                        placeholder="Nairobi"
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="form-label">Zip / Postal Code</label>
                                    <input
                                        className="form-input"
                                        value={companyInfo.zip}
                                        onChange={e => setCompanyInfo({ ...companyInfo, zip: e.target.value })}
                                        placeholder="00100"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="onboarding-step-content">
                            <p className="text-secondary mb-6"><FiBox className="inline mr-2" /> Define your primary fuel storage asset.</p>
                            <div className="form-grid">
                                <div className="form-field col-span-2">
                                    <label className="form-label">Tank Name *</label>
                                    <input
                                        className="form-input"
                                        value={tankInfo.name}
                                        onChange={e => setTankInfo({ ...tankInfo, name: e.target.value })}
                                        placeholder="e.g. South Yard Diesel *"
                                        required
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="form-label">Total Volume (Liters) *</label>
                                    <input
                                        type="number"
                                        className="form-input"
                                        value={tankInfo.capacity}
                                        onChange={e => setTankInfo({ ...tankInfo, capacity: Number(e.target.value) })}
                                        placeholder="e.g. 5000 *"
                                        required
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="form-label">Fuel Type</label>
                                    <select
                                        className="form-input"
                                        title="Select Fuel Type"
                                        value={tankInfo.fuelType}
                                        onChange={e => setTankInfo({ ...tankInfo, fuelType: e.target.value as Tank['fuelType'] })}
                                    >
                                        <option value="diesel">Diesel</option>
                                        <option value="petrol">Petrol/Gasoline</option>
                                        <option value="kerosene">Kerosene</option>
                                        <option value="jet_fuel">Jet Fuel</option>
                                        <option value="biodiesel">Biodiesel</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="onboarding-step-content">
                            <p className="text-secondary mb-6"><FiCpu className="inline mr-2" /> Link your IoT monitoring device.</p>
                            <div className="form-field">
                                <label className="form-label">ESP32 Board Address</label>
                                <input
                                    className="form-input"
                                    value={hardwareInfo.esp32Address}
                                    onChange={e => setHardwareInfo({ ...hardwareInfo, esp32Address: e.target.value })}
                                    placeholder="Scan QR code manually and enter the code here"
                                />
                                <p className="text-xs text-secondary mt-2">The board address is typically found on a sticker on the ESP32 module or external casing.</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="onboarding-actions">
                    <button
                        className="onboarding-btn onboarding-btn-outline"
                        onClick={() => step > 1 ? setStep(step - 1) : null}
                        disabled={step === 1}
                    >
                        <FiChevronLeft className="inline mr-1" /> Back
                    </button>

                    {step < 3 ? (
                        <button
                            className="onboarding-btn onboarding-btn-primary"
                            onClick={() => setStep(step + 1)}
                            disabled={(step === 1 && !companyInfo.name) || (step === 2 && (!tankInfo.name || !tankInfo.capacity))}
                        >
                            Continue <FiChevronRight className="inline ml-1" />
                        </button>
                    ) : (
                        <button
                            className="btn btn-primary"
                            onClick={handleSave}
                            disabled={loading}
                        >
                            {loading ? (
                                <div className="flex items-center gap-2">
                                    <div className="spinner" />
                                    <span>{saveStatus}...</span>
                                </div>
                            ) : (
                                <>
                                    {'Finish Setup'} <FiCheckCircle className="inline ml-1" />
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
