import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/hooks/useAuth';
import { createTank } from '@/hooks/useSupabase';
import { AuditService } from '@/services/AuditService';
import { supabase } from '@/config/supabase';
import { FiX, FiDroplet, FiCheckCircle, FiCpu, FiActivity, FiServer } from 'react-icons/fi';
import './AddTankModal.css';
import { NotificationService } from '@/services/NotificationService';

interface AddTankModalProps {
    isOpen: boolean;
    onClose: () => void;
    sites: any[];
    onSuccess?: (newTank: any) => void;
}

export const AddTankModal: React.FC<AddTankModalProps> = ({ 
    isOpen, 
    onClose, 
    sites, 
    onSuccess 
}) => {
    const { currentUser, verifySettingsPassword } = useAuth();
    const stationId = currentUser?.stationId || '';
    
    // Auth-lock for Provisioning
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [authPassword, setAuthPassword] = useState('');
    const [verifying, setVerifying] = useState(false);
    
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isHibernating, setIsHibernating] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        siteId: '',
        espId: '',
        fuelType: 'Diesel' as any,
        shape: 'capsule' as any,
        capacity: '' as number | '',
        height: '' as number | '',
        diameter: '' as number | '',
        length: '' as number | '',
        sensorHeight: '' as number | '',
        sensorEmptyDistance: '' as number | '',
        sensorFullDistance: '' as number | '',
        sensorChannel: 1 as number | ''
    });

    useEffect(() => {
        if (!formData.siteId && sites.length === 1) {
            setFormData(prev => ({ ...prev, siteId: sites[0].id }));
        }
    }, [sites, formData.siteId]);

    if (!isOpen) return null;

    const handleAuthorize = async (e?: React.SyntheticEvent) => {
        e?.preventDefault?.();
        if (!authPassword) return;

        setVerifying(true);
        setError(null);
        try {
            await verifySettingsPassword(authPassword);
            setIsAuthorized(true);
        } catch (err: any) {
            setError('Access Denied: Invalid administrative password');
        } finally {
            setVerifying(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        
        if (name === 'espId') {
            let rawHex = value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
            if (rawHex.length > 12) rawHex = rawHex.slice(0, 12);
            // Auto-format: XX:XX:XX...
            const formatted = rawHex.match(/.{1,2}/g)?.join(':') || rawHex;
            setFormData(prev => ({ ...prev, [name]: formatted }));
            return;
        }

        if (type === 'number') {
            if (value === '') {
                setFormData(prev => ({ ...prev, [name]: '' }));
                return;
            }
            // Enforce positive values only
            const numVal = parseFloat(value);
            if (numVal < 0) return;
            setFormData(prev => ({ ...prev, [name]: value }));
            return;
        }

        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleKeyDownNumeric = (e: React.KeyboardEvent) => {
        if (e.key === '-' || e.key === 'e' || e.key === 'E') {
            e.preventDefault();
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.siteId || !formData.espId) {
            setError('Identity and Hardware fields are mandatory');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            // [HARDWARE UNIQUENESS]: Enforce global uniqueness for ESP ID
            const { data: existingHardware } = await supabase
                .from('tanks')
                .select('id, tank_name')
                .eq('sensor_id', formData.espId)
                .maybeSingle();

            if (existingHardware) {
                setError(`Hardware Conflict: Serial ${formData.espId} is assigned to "${existingHardware.tank_name}". Every node must be unique.`);
                setSubmitting(false);
                return;
            }

            const newTank = await createTank({
                stationId,
                siteId: formData.siteId,
                name: formData.name,
                sensorId: formData.espId,
                fuelType: formData.fuelType,
                shape: formData.shape,
                capacity: Number(formData.capacity) || 0,
                height: Number(formData.height) || 0,
                diameter: Number(formData.diameter) || 0,
                length: Number(formData.length) || 0,
                sensorHeight: Number(formData.sensorHeight) || 0,
                sensorEmptyDistance: Number(formData.sensorEmptyDistance) || 0,
                sensorFullDistance: Number(formData.sensorFullDistance) || 0,
                sensorChannel: Number(formData.sensorChannel) || 1,
                lowLevelThreshold: 20,
                criticalLevelThreshold: 10,
                highLevelThreshold: 95,
                temperatureAlertThreshold: 65
            });

            // 🟢 Forensic Audit
            await AuditService.log(
                'SECURITY',
                'HARDWARE_PROVISIONED',
                stationId,
                `Node Provisioned: [${formData.name}] bound to serial ${formData.espId} on Channel ${formData.sensorChannel}`,
                'INFO',
                { tankId: newTank.id, mac: formData.espId }
            );

            NotificationService.show('Provisioning Successful', {
                body: `Hardware node ${formData.espId} is now actively telemetry-linked to ${formData.name}.`
            });

            if (onSuccess) onSuccess(newTank);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Provisioning failed. Check system logs.');
        } finally {
            setSubmitting(false);
        }
    };

    const triggerHibernate = () => {
        setIsHibernating(true);
        setTimeout(() => setIsHibernating(false), 800);
    };

    const renderContent = () => {
        if (!isAuthorized) {
            return (
                <div className="provisioning-lock-screen">
                    <div className="lock-icon-wrapper">
                        <FiCpu className="cpu-pulse" />
                    </div>
                    <div className="lock-text-content">
                        <h3>Security Lock</h3>
                        <p>Enter your password to add new tank hardware.</p>
                    </div>
                    
                    <div className="lock-form" onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') handleAuthorize(); }}>
                        <input 
                            type="password" 
                            placeholder="Your Password"
                            value={authPassword}
                            onChange={e => setAuthPassword(e.target.value)}
                            required
                        />
                        {error && <div className="error-message">{error}</div>}
                        <button type="button" className="unlock-btn" onClick={() => handleAuthorize()} disabled={verifying}>
                            {verifying ? 'Verifying...' : 'Unlock Settings'}
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <div className="max-h-[70vh] overflow-y-auto px-1 pr-3 custom-scrollbar">
                {/* SECTION 1: IDENTITY */}
                <div className="atm-section indigo">
                    <div className="atm-section-header">
                        <div className="atm-section-icon"><FiServer size={14} /></div>
                        <span className="atm-section-title">Identity & Binding</span>
                    </div>
                    <div className="atm-section-body atm-grid atm-grid-2">
                        <div className="form-group">
                            <label>Tank Display Name</label>
                            <input 
                                name="name" 
                                value={formData.name} 
                                onChange={handleChange} 
                                placeholder="e.g. Tank 01 Main" 
                                required 
                            />
                        </div>
                        <div className="form-group">
                            <label>Site Assignment</label>
                            <select 
                                name="siteId" 
                                value={formData.siteId} 
                                onChange={handleChange} 
                                required
                            >
                                <option value="">Select Depot / Site...</option>
                                {sites.map(s => <option key={s.id} value={s.id}>{s.siteName}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Hardware Identity (Serial/MAC)</label>
                            <input 
                                name="espId" 
                                value={formData.espId} 
                                onChange={handleChange} 
                                placeholder="AA:BB:CC:DD:EE:FF" 
                                maxLength={17}
                                required 
                            />
                        </div>
                        <div className="form-group">
                            <label>Hardware Channel (1-4)</label>
                            <select 
                                name="sensorChannel" 
                                value={formData.sensorChannel} 
                                onChange={handleChange}
                            >
                                <option value={1}>Channel 1 (Primary)</option>
                                <option value={2}>Channel 2</option>
                                <option value={3}>Channel 3</option>
                                <option value={4}>Channel 4</option>
                            </select>
                        </div>
                        <div className="form-group atm-col-2">
                            <label>Product Fuel Type</label>
                            <select name="fuelType" value={formData.fuelType} onChange={handleChange}>
                                <option value="Diesel">Automotive Diesel (AGO)</option>
                                <option value="Petrol">Premium Petrol (PMS)</option>
                                <option value="Kerosene">Kerosene (IK)</option>
                                <option value="Jet Fuel">Jet A-1 Aviation Fuel</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* SECTION 2: GEOMETRY */}
                <div className="atm-section blue">
                    <div className="atm-section-header">
                        <div className="atm-section-icon"><FiActivity size={14} /></div>
                        <span className="atm-section-title">Geometry & Calibration</span>
                    </div>
                    <div className="atm-section-body atm-grid atm-grid-2">
                        <div className="form-group">
                            <label>Geometric Profile</label>
                            <select name="shape" value={formData.shape} onChange={handleChange}>
                                <option value="capsule">Horizontal Cylindrical</option>
                                <option value="rectangular">Rectangular / Flat</option>
                                <option value="spherical">Spherical</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Total Capacity (L)</label>
                            <input 
                                type="number" 
                                name="capacity" 
                                value={formData.capacity} 
                                onChange={handleChange} 
                                onKeyDown={handleKeyDownNumeric}
                                placeholder="e.g. 10000" 
                            />
                        </div>
                        <div className="form-group">
                            <label>Tank Height (cm)</label>
                            <input type="number" name="height" value={formData.height} onChange={handleChange} onKeyDown={handleKeyDownNumeric} placeholder="250.0" />
                        </div>
                        <div className="form-group">
                            <label>Tank Length (cm)</label>
                            <input type="number" name="length" value={formData.length} onChange={handleChange} onKeyDown={handleKeyDownNumeric} placeholder="420.0" />
                        </div>
                    </div>
                </div>

                {/* SECTION 3: SENSOR PARAMS */}
                <div className="atm-section cyan">
                    <div className="atm-section-header">
                        <div className="atm-section-icon"><FiDroplet size={14} /></div>
                        <span className="atm-section-title">Sensor Mounting & Delta</span>
                    </div>
                    <div className="atm-section-body atm-grid atm-grid-3">
                        <div className="form-group">
                            <label>Empty Dist (cm)</label>
                            <input type="number" name="sensorEmptyDistance" value={formData.sensorEmptyDistance} onChange={handleChange} onKeyDown={handleKeyDownNumeric} placeholder="260.0" />
                        </div>
                        <div className="form-group">
                            <label>Full Dist (cm)</label>
                            <input type="number" name="sensorFullDistance" value={formData.sensorFullDistance} onChange={handleChange} onKeyDown={handleKeyDownNumeric} placeholder="10.0" />
                        </div>
                        <div className="form-group">
                            <label>Sensor Offset (cm)</label>
                            <input type="number" name="sensorHeight" value={formData.sensorHeight} onChange={handleChange} onKeyDown={handleKeyDownNumeric} placeholder="5.0" />
                        </div>
                    </div>
                </div>

                <div className="tm-verification-card mt-4">
                    <FiCheckCircle size={16} />
                    <p>Provisioning will trigger an immediate hardware handshake to verify real-time telemetry.</p>
                </div>

                {error && <div className="error-message mt-4">{error}</div>}

                <div className="form-actions mt-8 pb-4">
                    <button type="button" className="btn-danger" onClick={onClose}>Discard</button>
                    <button type="submit" className="btn-submit" disabled={submitting}>
                        {submitting ? 'Provisioning...' : 'Initialize Node'}
                    </button>
                </div>
            </div>
        );
    };

    return createPortal(
        <div className="add-tank-modal-overlay animate-in fade-in duration-300" onClick={triggerHibernate}>
            <div className={`add-tank-modal-content ${!isAuthorized ? 'auth-mode' : 'max-w-2xl'}`} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="header-text-container">
                        <h2>Add New Tank</h2>
                        <p>Link a new sensor to your tank system.</p>
                        <div className="modal-header-badges">
                            <span className="modal-badge purple-solid">PROVISIONING</span>
                            <span className="modal-badge cyan-glow">HARDWARE_LOCK</span>
                        </div>
                    </div>
                    <button className={`close-btn ${isHibernating ? 'hibernate' : ''}`} type="button" onClick={onClose} title="Close"><FiX size={18} /></button>
                </div>

                <form onSubmit={handleSubmit} className="add-tank-form">
                    {renderContent()}
                </form>
            </div>
        </div>,
        document.body
    );
};
