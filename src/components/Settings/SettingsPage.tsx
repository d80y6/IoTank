import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import {
    FiShield, FiLock, FiPlus, FiX, FiBriefcase, FiSave, FiCamera, FiRefreshCw,
    FiUser, FiZap, FiCheckCircle, FiEye, FiEyeOff, FiArrowRight, FiCpu,
    FiActivity, FiTerminal, FiAlertTriangle, FiTrash2, FiAlertCircle
} from 'react-icons/fi';
import { MdWifi, MdRefresh } from 'react-icons/md';
import { DeviceCommandService, DeviceCommand } from '@/services/DeviceCommandService';
import { convertToWebP } from '@/utils/performance';
import { useTanks, updateTank as syncTankToDb, createAlert, useSites, deleteTank } from '@/hooks/useSupabase';
import { AddTankModal } from '../Inventory/AddTankModal';
import { AuditService } from '@/services/AuditService';
import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';
import { Toast } from '../Common/Toast';
import { ImageCropperModal } from '../Common/ImageCropperModal';
import './SettingsPage.css';
export const SettingsPage: React.FC = () => {
    const {
        currentUser, verifySettingsPassword, updateUser, enrollMFA, verifyMFARegistration, unenrollMFA,
        setupSecurityPin, disableSecurityPin
    } = useAuth();
    const { t } = useTranslation();
    const stationId = currentUser?.stationId || '';
    const { sites } = useSites(stationId);

    // Section Refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const profilePhotoInputRef = useRef<HTMLInputElement>(null);

    const [isLocked, setIsLocked] = useState(false); // [REFACTOR] Allow entry by default
    const [protectedTabAttempt, setProtectedTabAttempt] = useState<'profile' | 'security' | 'inventory' | 'devices' | null>(null);
    const [password, setPassword] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showLockPassword, setShowLockPassword] = useState(false);
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingLogo, setIsUploadingLogo] = useState(false);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

    // MFA Enrollment State
    const [mfaStep, setMfaStep] = useState<'idle' | 'qr' | 'verify'>('idle');
    const [mfaQrCode, setMfaQrCode] = useState('');
    const [mfaSecret, setMfaSecret] = useState('');
    const [mfaVerifyCode, setMfaVerifyCode] = useState('');
    const [mfaLoading, setMfaLoading] = useState(false);
    const [mfaEnabled, setMfaEnabled] = useState(false);
    const [mfaEnrollFactorId, setMfaEnrollFactorId] = useState<string | null>(null);

    // Check current MFA status on mount
    useEffect(() => {
        const checkMfaStatus = async () => {
            const { data } = await supabase.auth.mfa.listFactors();
            const hasVerified = data?.totp?.some(f => f.status === 'verified') ?? false;
            setMfaEnabled(hasVerified);
        };
        checkMfaStatus();
    }, []);
    const handleStartMFAEnrollment = async () => {
        setMfaLoading(true);
        try {
            const result = await enrollMFA();
            setMfaQrCode(result.qrCode);
            setMfaSecret(result.secret);
            setMfaEnrollFactorId(result.factorId);
            setMfaStep('qr');
            setShowMFAModal(true);
        
} catch (err: any) {
            setToast({
 message: err.message || 'Failed to start MFA enrollment.', type: 'error' 
});
        
} finally {
            setMfaLoading(false);
        
}    
};
    const handleVerifyMFAEnrollment = async (overrideCode?: string) => {
        const codeToVerify = overrideCode || mfaVerifyCode;
        if (!codeToVerify || codeToVerify.length !== 6 || !mfaEnrollFactorId) return;
                setMfaLoading(true);
        try {
            await verifyMFARegistration(mfaEnrollFactorId, codeToVerify);
            setMfaEnabled(true);
            setMfaStep('idle');
            setMfaVerifyCode('');
            setMfaEnrollFactorId(null);
            setShowMFAModal(false);
            setToast({
 message: '✅ Two-Factor Authentication is now active.', type: 'success' 
});
            await AuditService.log('SECURITY', 'MFA_ENABLED', currentUser?.stationId || 'SYSTEM', 'Identity protection: Two-Factor Authentication enrolled', 'INFO', {});
        
} catch (err: any) {
            setToast({
 message: err.message || 'Invalid code. Please try again.', type: 'error' 
});
        
} finally {
            setMfaLoading(false);
        
}    
};    const handleDisableMFA = async () => {
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Security Alert: Remove Protection',
                message: 'Are you sure you want to remove Two-Factor Authentication? This will significantly decrease your account security level and revert to legacy identity verification.',
                type: 'error',
                persistent: true,
                actions: [
                    {
                        label: 'Maintain Security',
                        onClick: () => {}
                    },
                    {
                        label: 'Disable MFA',
                        primary: true,
                        onClick: async () => {
                            setMfaLoading(true);
                            try {
                                await unenrollMFA();
                                setMfaEnabled(false);
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'MFA Disabled',
                                        message: 'Identity protection has been removed. Account security level decreased.',
                                        type: 'info'
                                    }
                                }));
                                await AuditService.log('SECURITY', 'MFA_DISABLED', currentUser?.stationId || 'SYSTEM', 'Security alert: Two-Factor Authentication de-registered. Manual bypass active.', 'WARNING', {});
                            } catch (err: any) {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Operation Failed',
                                        message: err.message || 'Failed to disable MFA.',
                                        type: 'error'
                                    }
                                }));
                            } finally {
                                setMfaLoading(false);
                            }
                        }
                    }
                ]
            }
        }));
    };

    // Tank Selection & Modal State
    const [showAddTankModal, setShowAddTankModal] = useState(false);
    // Modal visibility
    const [showChangePwModal, setShowChangePwModal] = useState(false);
    const [showMFAModal, setShowMFAModal] = useState(false);
    
    // Change Password modal state
    const [currentPassword, setCurrentPassword] = useState('');
    const [showCurrentPw, setShowCurrentPw] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNewPw, setShowNewPw] = useState(false);
    const [showConfirmPw, setShowConfirmPw] = useState(false);
    const [pwSaving, setPwSaving] = useState(false);

    // PIN Management State
    const [showPinModal, setShowPinModal] = useState(false);
    const [pinCode, setPinCode] = useState('');
    const [confirmPinCode, setConfirmPinCode] = useState('');
    const [pinLoading, setPinLoading] = useState(false);
    const [securityPinEnabled, setSecurityPinEnabled] = useState(currentUser?.securityPinEnabled || false);
    
    // [REACTIVE SYNC]: Ensure security PIN status persists and updates upon profile enrichment
    useEffect(() => {
        if (currentUser?.securityPinEnabled !== undefined) {
            setSecurityPinEnabled(currentUser.securityPinEnabled);
        }
    }, [currentUser?.securityPinEnabled]);

    const [visiblePinIndices, setVisiblePinIndices] = useState<number[]>([]);
    const [visibleConfirmPinIndices, setVisibleConfirmPinIndices] = useState<number[]>([]);

    // Price Draft State (String buffered for decimal entry support)
    const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
    // Tank Deletion State
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deletionStep, setDeletionStep] = useState<'warning' | 'password'>('warning');
    const [tankToDelete, setTankToDelete] = useState<any | null>(null);
    const [deletePassword, setDeletePassword] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    
    // Image Cropper State
    const [cropperState, setCropperState] = useState<{
        isOpen: boolean;
        imageSrc: string;
        mode: 'logo' | 'profile';
    }>({
        isOpen: false,
        imageSrc: '',
        mode: 'logo'
    });

    // Reset Modal States
    const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
    const [showResetAuthModal, setShowResetAuthModal] = useState(false);
    const [resetAuthPassword, setResetAuthPassword] = useState('');

    const handleDeleteTank = async () => {
        if (!deletePassword) {
            setDeleteError("Password is required.");
            return;
        }
        if (!tankToDelete) return;
        
        setIsDeleting(true);
        setDeleteError(null);
        
        // [AUDIT TRAIL]: Log initial administrative purge attempt
        await AuditService.log(
            'SECURITY',
            'DELETE_TANK',
            stationId,
            `User initiated administrative purge attempt for tank: ${tankToDelete.name} (${tankToDelete.id})`,
            'WARNING',
            { tankId: tankToDelete.id, tankName: tankToDelete.name, status: 'attempt' }
        ).catch(() => {});

        try {
            // Step 1: Verify the administrative settings password
            await verifySettingsPassword(deletePassword);
            
            // Step 2: Perform the cascading delete using the robust service helper
            await deleteTank(tankToDelete.id);
            
            setIsDeleteModalOpen(false);
            setTankToDelete(null);
            setDeletePassword('');
            setToast({
                message: `Tank ${tankToDelete.name} and all associated data have been permanently removed.`,
                type: 'success'
            });
            
            // Step 3: Log completed deletion
            await AuditService.log(
                'SYSTEM', 
                'DELETE_TANK', 
                stationId, 
                `Permanently deleted tank: ${tankToDelete.name}`,
                'CRITICAL',
                { tankId: tankToDelete.id, status: 'completed' }
            ).catch(() => {});
            
        } catch (err: any) {
            logger.error('[SettingsPage] Delete tank failed:', err);
            
            // Step 4: Log the failure to the security audit trail
            await AuditService.log(
                'SECURITY',
                'DELETE_TANK',
                stationId,
                `Purge failed for tank: ${tankToDelete.name}. Error: ${err.message || 'unknown'}`,
                'CRITICAL',
                { tankId: tankToDelete.id, error: err, status: 'failed' }
            ).catch(() => {});

            // Step 5: Render highly granular user-friendly errors
            let userFriendlyMsg = 'Verification failed. Incorrect password.';
            if (err.message) {
                if (err.message.includes('password') || err.message.includes('Invalid credentials')) {
                    userFriendlyMsg = 'Incorrect password. Administrative verification failed.';
                } else if (err.code === '23503' || err.message.includes('foreign key') || err.message.includes('violates foreign key constraint')) {
                    userFriendlyMsg = 'Database Integrity Violation: Cannot purge this tank as it is referenced by other records. Please delete dependent records first.';
                } else {
                    userFriendlyMsg = `Purge failed: ${err.message}`;
                }
            }
            
            setDeleteError(userFriendlyMsg);
            setIsDeleting(false);
        }
    };

    const handlePriceCommit = async (tankId: string) => {
        const draftValue = priceDrafts[tankId];
        if (draftValue === undefined) return;
        
        const retailPrice = parseFloat(draftValue);
        if (isNaN(retailPrice)) {
            setToast({ message: 'Invalid price format.', type: 'error' });
            return;
        }

        // [ROBUST VALIDATION]: Prevent extreme fat-finger errors in fuel retail
        if (retailPrice < 50 || retailPrice > 500) {
            setToast({ 
                message: `Price (${retailPrice}) is outside safe range (50 - 500 Ksh). Please verify.`, 
                type: 'error' 
            });
            return;
        }

        // Normalize to 2 decimal places for financial consistency
        const normalizedPrice = Math.round(retailPrice * 100) / 100;

        try {
            const tankToUpdate = tanks.find((t: any) => t.id === tankId);
            if (!tankToUpdate) return;
            
            const oldPrice = (tankToUpdate as any).metadata?.retailPrice || 0;
            const fuelName = (tankToUpdate as any).name || tankToUpdate.fuelType.toUpperCase();
            const currentMetadata = (tankToUpdate as any).metadata || {};

            // [IMMEDIATE FEEDBACK]: Notify user that synchronization has started
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Price Configuration',
                    message: `Synchronizing ${fuelName} price adjustment: ${oldPrice} Ksh ⮕ ${normalizedPrice} Ksh`,
                    type: 'info',
                    attribution: 'FINANCIAL CORE'
                }
            }));

            await syncTankToDb(tankId, {
                metadata: { ...currentMetadata, retailPrice: normalizedPrice }
            } as any);

            // Clear draft state for this specific tank on success
            setPriceDrafts(prev => {
                const next = { ...prev };
                delete next[tankId];
                return next;
            });
            

            await AuditService.log(
                'FINANCE',
                'SETTINGS_CHANGED',
                currentUser?.stationId || 'SYSTEM',
                `Manual Retail Price Correction: [${tankToUpdate.fuelType.toUpperCase()}] price adjusted from ${oldPrice} Ksh to ${normalizedPrice} Ksh per litre.`,
                'INFO',
                { tankId, fuelType: tankToUpdate.fuelType, retailPrice: normalizedPrice, currency: 'Ksh', oldPrice }
            );

            // 🔴 TRIGGER SYSTEM ALERT for Financial Governance
            await createAlert({
                station_id: currentUser?.stationId || '',
                tankId: tankId,
                type: 'compliance_deadline', // Normalized to snake_case
                severity: 'info',
                title: 'Fuel Price Calibration',
                message: `${fuelName} unit price adjusted from ${oldPrice} to ${normalizedPrice} Ksh. Shift valuation updated.`,
                metadata: { oldPrice, newPrice: normalizedPrice, tankName: fuelName }
            }).catch(e => logger.error('[SettingsPage] Failed to trigger price alert:', e));
        } catch (err) {
            logger.error('[SettingsPage] Price update error:', err);
            setToast({ message: 'Update failed. Please check connection.', type: 'error' });
        }
    };

    // Tank Info for Config
    const { tanks } = useTanks(stationId);

    const [profileForm, setProfileForm] = useState({
        displayName: currentUser?.displayName || '',
        address: (currentUser?.address as any)?.street || '',
        photo_url: currentUser?.photoURL || ''
    });

    const [orgForm, setOrgForm] = useState({
        name: currentUser?.companyName || '',
        tax_id: '',
        address: '',
        logo_url: (currentUser as any)?.logo_url || ''
    });

    // Fetch extra org data on mount
    useEffect(() => {
        const fetchOrgData = async () => {
            if (!currentUser?.stationId) return;
            const { data } = await supabase
                .from('fuel_stations')
                .select('*')
                .eq('station_id', currentUser.stationId)
                .maybeSingle();
            
            if (data) {
                setOrgForm(prev => ({
                    ...prev,
                    name: data.station_name || currentUser.companyName || '',
                    tax_id: data.tax_id || '',
                    address: data.billing_address || ''
                }));
            }
        };
        fetchOrgData();
    }, [currentUser?.stationId, currentUser?.companyName]);

    const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setProfileForm(prev => ({ ...prev, [name]: value }));
    };

    const handleOrgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setOrgForm(prev => ({ ...prev, [name]: value }));
    };

    // Tabs State
    const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'inventory' | 'devices'>('profile');

    // Device Management State
    const [recentCommands, setRecentCommands] = useState<DeviceCommand[]>([]);
    const [localPendingIds, setLocalPendingIds] = useState<string[]>([]);
    const [selectedDevice, setSelectedDevice] = useState<string>('');
    const [wifiConfig, setWifiConfig] = useState({ ssid: '', password: '' });
    const [isSendingCommand, setIsSendingCommand] = useState(false);

    // Get unique devices from tanks safely
    // [SCOPING FIX]: Ensure we only show hardware ids for the current station's tanks
    const uniqueDevices = Array.from(new Set(
        tanks
            .filter((t: any) => (t.stationId || t.station_id) === stationId)
            .map((t: any) => t.sensorId || t.sensor_id)
            .filter((id: any) => id)
    ));

    useEffect(() => {
        if (activeTab === 'devices' && currentUser?.stationId) {
            loadCommands();
            const subscription = DeviceCommandService.subscribeToCommands(currentUser.stationId, () => {
                loadCommands();
            });
            return () => {
                subscription.unsubscribe();
            };
        }
    }, [activeTab, currentUser?.stationId]);

    const loadCommands = async () => {
        if (!currentUser?.stationId) return;
        try {
            const cmds = await DeviceCommandService.getRecentCommands(currentUser.stationId);
            setRecentCommands(cmds as any);
            setLocalPendingIds(DeviceCommandService.getLocalPendingIds());
        } catch (err) {
            logger.error('[SettingsPage] Failed to load commands:', err);
        }
    };

    const handleSendCommand = async (command: string, payload: any = {}) => {
        if (!selectedDevice || !currentUser?.stationId) {
            setToast({ message: 'Please select a device first.', type: 'error' });
            return;
        }
        setIsSendingCommand(true);
        try {
            await DeviceCommandService.sendCommand(currentUser.stationId, selectedDevice, command, payload);
            // 🟢 Forensic Log
            await AuditService.log(
                'SYSTEM',
                'DEVICE_COMMAND',
                currentUser.stationId,
                `Hardware instruction broadcasted: ${command} to node ${selectedDevice}`,
                command === 'SET_WIFI' ? 'WARNING' : 'INFO',
                { deviceId: selectedDevice, command, payload }
            );
            setToast({ message: `Instruction [${command}] broadcasted to hardware.`, type: 'success' });
            if (command === 'SET_WIFI') setWifiConfig({ ssid: '', password: '' });
        } catch (err: any) {
            setToast({ message: err.message || 'Failed to send command', type: 'error' });
        } finally {
            setIsSendingCommand(false);
        }
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser?.stationId) return;
        e.target.value = '';
        if (!file.type.startsWith('image/')) {
            setToast({ message: 'Only image files are accepted.', type: 'error' });
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setToast({ message: 'Image size must be less than 5MB.', type: 'error' });
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setCropperState({
                isOpen: true,
                imageSrc: reader.result as string,
                mode: 'logo'
            });
        };
        reader.readAsDataURL(file);
    };

    const handleProfilePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser?.authUserId) return;
        e.target.value = '';
        if (!file.type.startsWith('image/')) {
            setToast({ message: 'Only image files are accepted.', type: 'error' });
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setToast({ message: 'Image size must be less than 5MB.', type: 'error' });
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setCropperState({
                isOpen: true,
                imageSrc: reader.result as string,
                mode: 'profile'
            });
        };
        reader.readAsDataURL(file);
    };

    const handleCropComplete = async (croppedBlob: Blob) => {
        const mode = cropperState.mode;
        setCropperState(prev => ({ ...prev, isOpen: false }));
        if (mode === 'logo') {
            await finalizeLogoUpload(croppedBlob);
        } else {
            await finalizeProfileUpload(croppedBlob);
        }
    };
    const finalizeLogoUpload = async (blob: Blob) => {
        if (!currentUser?.stationId) return;
        setIsUploadingLogo(true);
        try {
            const webpBlob = await convertToWebP(blob);
            const filePath = `stations/${
currentUser.stationId
}/logo.webp`;
                        const file = new File([webpBlob], "logo.webp", {
 type: "image/webp" 
});
            const {
 error: uploadError 
} = await supabase.storage                .from('profile-photos')                .upload(filePath, file, {
 upsert: true 
});
            if (uploadError) throw uploadError;
            const {
 data: {
 publicUrl 
} 
} = supabase.storage                .from('profile-photos')                .getPublicUrl(filePath);
            const {
 error: dbError 
} = await supabase                .from('fuel_stations')                .update({
 logo_url: publicUrl 
})                .eq('station_id', currentUser.stationId);
            if (dbError) throw dbError;
            await updateUser({
 logoUrl: publicUrl 
} as any);
            setOrgForm(prev =>({
 ...prev, logo_url: publicUrl 
}));
            await AuditService.log('SYSTEM', 'UPLOAD_LOGO', currentUser.stationId, `Branding synchronized: Station logo updated to node ${filePath}`);
            setToast({
                message: `Branding synchronized: Station logo updated for ${orgForm.name}.`,
                type: 'success' 
            });
        
} catch (err: any) {
            logger.error('[SettingsPage] Logo upload error:', err);
            setToast({
                message: `Upload failed: ${err.message}`, type: 'error' 
            });
        
} finally {
            setIsUploadingLogo(false);
        
}    
};
    const finalizeProfileUpload = async (blob: Blob) => {
        if (!currentUser?.authUserId) return;
        setIsUploadingPhoto(true);
        try {
            const webpBlob = await convertToWebP(blob);
            const filePath = `users/${currentUser.authUserId}/avatar.webp`;
            const file = new File([webpBlob], "avatar.webp", { type: "image/webp" });
            const { error: uploadError } = await supabase.storage.from('profile-photos').upload(filePath, file, { upsert: true });
            if (uploadError) throw uploadError;
            
            const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(filePath);
            const { error: dbError } = await supabase.from('profiles').update({ photo_url: publicUrl }).eq('auth_user_id', currentUser.authUserId);
            if (dbError) throw dbError;
            
            await updateUser({ photoURL: publicUrl } as any);
            setProfileForm(prev => ({ ...prev, photo_url: publicUrl }));
            await AuditService.log('SYSTEM', 'UPLOAD_AVATAR', currentUser.stationId || 'SYSTEM', `Identity signature updated: Profile photo synchronized to ${filePath}`);
            setToast({ message: 'Profile photo updated.', type: 'success' });
        } catch (err: any) {
            logger.error('[SettingsPage] Profile photo upload error:', err);
            setToast({ message: `Upload failed: ${err.message}`, type: 'error' });
        } finally {
            setIsUploadingPhoto(false);
        }
    };

    const handleOrgSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser?.stationId) return;
        setIsSaving(true);
        try {
            const { error: syncError } = await supabase.from('fuel_stations').update({
                station_name: orgForm.name,
                billing_address: orgForm.address,
                tax_id: orgForm.tax_id
            }).eq('station_id', currentUser.stationId);
            
            if (syncError) throw syncError;
            await AuditService.log('SYSTEM', 'UPDATE_COMPANY', currentUser.stationId, `Operational profile modified: Station identity set to "${orgForm.name}"`, 'INFO', {});
            setToast({ message: `Station profile for "${orgForm.name}" has been synchronized.`, type: 'success' });
        } catch (err) {
            logger.error('[SettingsPage] Station profile sync failed:', err);
            setToast({ message: 'Failed to save station information.', type: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleProfileSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await updateUser({
                displayName: profileForm.displayName,
                address: { ...currentUser?.address, street: profileForm.address } as any
            });
            await AuditService.log('SYSTEM', 'UPDATE_PROFILE', currentUser?.stationId || 'SYSTEM', `Operator identity modified: Profile name set to "${profileForm.displayName}"`, 'INFO', {});
            setToast({ message: `Identity updated: Profile saved for ${profileForm.displayName}.`, type: 'success' });
        } catch (err) {
            logger.error('[SettingsPage] Profile save failed:', err);
            setToast({ message: 'Failed to update profile.', type: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleUnlock = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsVerifying(true);
        setError(null);
        try {
            await verifySettingsPassword(password);
            setIsLocked(false);
            if (protectedTabAttempt) {
                setActiveTab(protectedTabAttempt);
                setProtectedTabAttempt(null);
            }
            setPassword('');
        } catch (err: any) {
            setError(err.message || 'Verification failed.');
        } finally {
            setIsVerifying(false);
        }
    };

    const handleTabChange = (tab: 'profile' | 'security' | 'inventory' | 'devices') => {
        const protectedTabs = ['inventory', 'devices'];
        if (protectedTabs.includes(tab) && isLocked) {
            setProtectedTabAttempt(tab);
            return;
        }
        setActiveTab(tab);
    };

    const handleSetupPin = async () => {
        if (pinCode.length !== 6 || pinCode !== confirmPinCode) {
            setToast({ message: 'PINs must match and be 6 digits.', type: 'error' });
            return;
        }
        setPinLoading(true);
        try {
            await setupSecurityPin(pinCode);
            setSecurityPinEnabled(true);
            setShowPinModal(false);
            setPinCode('');
            setConfirmPinCode('');
            
            // Premium Global Notification
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Security Hardened',
                    message: '6-digit PIN established. Your price controls and inventory are now protected by secondary verification.',
                    type: 'success',
                    attribution: 'SECURITY_VAULT'
                }
            }));

            setToast({ message: '✅ Security PIN established successfully.', type: 'success' });

            await AuditService.log('SECURITY', 'PIN_SETUP', stationId, 'Secondary security layer established via 6-digit PIN', 'INFO');
        } catch (err: any) {
            setToast({ message: err.message || 'Failed to set PIN.', type: 'error' });
        } finally {
            setPinLoading(false);
        }
    };

    const handleDisablePin = async () => {
        setPinLoading(true);
        try {
            await disableSecurityPin();
            setSecurityPinEnabled(false);
            
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Security Layer Removed',
                    message: '6-digit PIN has been de-activated. Critical actions no longer require secondary verification.',
                    type: 'info',
                    attribution: 'SECURITY_VAULT'
                }
            }));

            await AuditService.log('SECURITY', 'SETTINGS_CHANGED', stationId, 'Security alert: Secondary PIN layer de-activated by user.', 'WARNING');
        } catch (err: any) {
            setToast({ message: err.message || 'Failed to disable PIN.', type: 'error' });
        } finally {
            setPinLoading(false);
        }
    };

    const handleExportData = () => {
        const data = {
            profile: currentUser,
            station_id: stationId,
            timestamp: new Date().toISOString(),
            export_region: 'Republic of Kenya (DPA 2019 Compliance)'
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `iotank_data_export_${currentUser?.email}.json`;
        a.click();
        setToast({ message: 'Data export initiated.', type: 'success' });
    };

    const handleDeleteAccountRequest = () => {
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Right to be Forgotten',
                message: 'Under DPA 2019, you may request account deletion. A system administrator will review and purge your records within 30 days.',
                type: 'warning',
                persistent: true,
                actions: [
                    { label: 'Cancel', onClick: () => {} },
                    { 
                        label: 'Submit Deletion Request', 
                        primary: true, 
                        onClick: () => {
                            setToast({ message: 'Deletion request submitted to Compliance Officer.', type: 'success' });
                        } 
                    }
                ]
            }
        }));
    };

    const handleDismissLock = () => {
        setError(null);
        setPassword('');
        setProtectedTabAttempt(null);
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newPassword || newPassword.length < 8) {
            setToast({ message: 'Password must be at least 8 characters.', type: 'error' });
            return;
        }
        if (newPassword !== confirmPassword) {
            setToast({ message: 'Passwords do not match.', type: 'error' });
            return;
        }
        setPwSaving(true);
        try {
            if (currentUser?.email) {
                const { error: verifyErr } = await supabase.auth.signInWithPassword({
                    email: currentUser.email,
                    password: currentPassword
                });
                if (verifyErr) throw new Error('Current password is incorrect.');
            }
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) throw error;
            
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setShowChangePwModal(false);
            setToast({ message: '✅ Password updated successfully.', type: 'success' });
            await AuditService.log('SECURITY', 'UPDATE_SETTINGS', currentUser?.stationId || 'SYSTEM', 'Security gate recalibrated: Account credential rotation verified', 'INFO', {});
        } catch (err: any) {
            setToast({ message: err.message || 'Failed to update password.', type: 'error' });
        } finally {
            setPwSaving(false);
        }
    };

    const handleSecureReset = () => {
        setShowResetConfirmModal(true);
    };

    const confirmSecureResetInitial = () => {
        setShowResetConfirmModal(false);
        setResetAuthPassword('');
        setShowResetAuthModal(true);
    };

    const confirmSecureResetFinal = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            // [IMMEDIATE FEEDBACK]
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Factory Reset',
                    message: 'Initializing global system purge. One moment...',
                    type: 'warning',
                    attribution: 'SYSTEM SETTINGS'
                }
            }));

            await verifySettingsPassword(resetAuthPassword);
            
            setShowResetAuthModal(false);
            window.location.reload();
        } catch (err: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Reset Failed',
                    message: err.message || 'Verification failed.',
                    type: 'error',
                    attribution: 'SYSTEM SETTINGS'
                }
            }));
        }
    };
    if (protectedTabAttempt) {
        return (            
            <>
                <div className="security-lock-overlay">
                    <div className="add-tank-modal-content security-lock-content modal-w-md">
                        <div className="modal-header">
                            <div className="header-text-container">
                                <h2>Security Gate</h2>
                                <p>Authentication required for system parameters</p>
                                <div className="modal-header-badges">
                                    <span className="modal-badge cyan">LOCKED</span>
                                    <span className="modal-badge blue">ADMIN</span>
                                </div>
                            </div>
                        </div>
                        <div className="security-modal-body">
                            <div className="security-lock-header">
                                <FiLock className="security-lock-icon-main" aria-hidden="true" size={40} />
                                <h3 className="security-lock-title">Verify Identity</h3>
                                <p className="security-lock-text">Enter your master password to unlock critical settings.</p>
                            </div>
                            <form onSubmit={handleUnlock} className="security-form security-form-mt">
                                <div className="input-group">
                                    <label htmlFor="master-password" className="master-pass-label">Master Password</label>
                                    <div className="password-input-wrapper">
                                        <input
                                            id="master-password"
                                            className="settings-input master-pass-input"
                                            type={showLockPassword ? "text" : "password"}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="············"
                                            title="Master Password"
                                            autoFocus
                                            disabled={isVerifying}
                                        />
                                        <button
                                            type="button"
                                            className="password-toggle"
                                            onClick={() => setShowLockPassword(!showLockPassword)}
                                            disabled={isVerifying}
                                            aria-label={showLockPassword ? "Hide password" : "Show password"}
                                            title={showLockPassword ? "Hide password" : "Show password"}
                                        >
                                            {showLockPassword ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                                        </button>
                                    </div>
                                    {error && <div className="text-danger text-xs mt-3 font-bold text-center">❌ {error}</div>}
                                </div>
                                <div className="form-actions border-t pt-6 security-form-mt">
                                    <button type="button" className="btn-secondary" onClick={handleDismissLock}>Cancel</button>
                                    <button type="submit" className="btn-primary flex-1" disabled={isVerifying || !password}>
                                        {isVerifying ? <FiRefreshCw className="animate-spin" /> : <>Unlock Access <FiArrowRight className="ml-2" /></>}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
                {/* Global Modals for Gate path */}
                {showPinModal && createPortal(
                    <div className="add-tank-modal-overlay">
                        <div className="add-tank-modal-content modal-w-md">
                            <div className="modal-header security-verify-header">
                                <div className="header-text-container">
                                    <h2>Security PIN Setup</h2>
                                    <p>Set a 6-digit secondary verification code</p>
                                </div>
                                <button className="close-btn" onClick={() => setShowPinModal(false)}><FiX /></button>
                            </div>
                            <div className="security-modal-body">
                                <div className="input-group">
                                    <label>Enter 6-Digit PIN</label>
                                    <input 
                                        type="password" 
                                        maxLength={6} 
                                        className="settings-input text-center text-2xl tracking-[1em]" 
                                        value={pinCode} 
                                        onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ''))}
                                        placeholder="••••••"
                                    />
                                </div>
                                <div className="input-group mt-4">
                                    <label>Confirm PIN</label>
                                    <input 
                                        type="password" 
                                        maxLength={6} 
                                        className="settings-input text-center text-2xl tracking-[1em]" 
                                        value={confirmPinCode} 
                                        onChange={(e) => setConfirmPinCode(e.target.value.replace(/\D/g, ''))}
                                        placeholder="••••••"
                                    />
                                </div>
                                <div className="form-actions mt-8">
                                    <button className="btn-secondary" onClick={() => setShowPinModal(false)}>Cancel</button>
                                    <button className="btn-primary" onClick={handleSetupPin} disabled={pinLoading || pinCode.length !== 6}>
                                        {pinLoading ? <FiRefreshCw className="animate-spin" /> : 'Save PIN'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
                {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
            </>
        );
    }

    return (
        <div className="settings-container">
            {
/* Factory Reset Confirmation Modal */
}            {
showResetConfirmModal && createPortal(                
<div className="add-tank-modal-overlay">
                    
<div className="add-tank-modal-content modal-w-md">
                        
                        <div className="modal-header danger-zone-header">
                            <div className="header-text-container">
                                <h2>Danger Zone</h2>
                                <p>Critical system operation</p>
                                <div className="modal-header-badges">
                                    <span className="modal-badge slate">Irreversible</span>
                                </div>
                            </div>
                            <button className="close-btn" onClick={() => setShowResetConfirmModal(false)} title="Close Reset Modal" aria-label="Close">
                                <FiX />
                            </button>
                        </div>
                        
<div className="security-modal-body">
                            
<div className="text-center-mb-8">
                                
<div className="warning-icon-wrapper" aria-hidden="true">
                                    
<FiAlertTriangle size={
32
} />
                                
</div>
                                
<h3 className="security-lock-title">
Factory Reset
</h3>
                                
<p className="security-lock-text">
This will erase all station configuration and historical telemetry. This cannot be undone.
</p>
                            
</div>
                            
<div className="form-actions">
                                
                                <button className="btn-secondary" onClick={() => setShowResetConfirmModal(false)} title="Keep Current Configuration">
                                    No, Keep System
                                </button>
                                <button className="btn-danger" onClick={confirmSecureResetInitial} title="Proceed to Factory Reset">
                                    Confirm Reset
                                    <FiTrash2 className="ml-2" />
                                </button>
                            
</div>
                        
</div>
                    
</div>
                
</div>
,                document.body            )
}            {
/* Factory Reset Auth Modal */
}            {
showResetAuthModal && createPortal(                
<div className="add-tank-modal-overlay">
                    
<div className="add-tank-modal-content modal-w-md">
                        
                        <div className="modal-header security-verify-header">
                            <div className="header-text-container">
                                <h2>Final Verification</h2>
                                <p>Authorize global system reset</p>
                                <div className="modal-header-badges">
                                    <span className="modal-badge slate">SECURITY</span>
                                </div>
                            </div>
                        </div>
                        
<div className="security-modal-body">
                            
<form onSubmit={
confirmSecureResetFinal
} className="settings-form">
                                
<div className="input-group">
                                    
<label htmlFor="reset-auth-password" className="master-pass-label">
Master Password
</label>
                                    
<input                                         id="reset-auth-password"                                        type="password"                                         className="settings-input final-verify-input"                                         value={
resetAuthPassword
}                                         onChange={
e =>
 setResetAuthPassword(e.target.value)
}                                         placeholder="············"                                        title="Master Password for Authentication"                                        required                                         autoFocus                                    />
                                
</div>
                                
<div className="form-actions security-form-mt">
                                    
                                    <button type="button" className="btn-secondary" onClick={() => setShowResetAuthModal(false)} title="Cancel Reset Authentication">
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn-danger" title="Final Authorization for System Reset">
                                        Authorize Global Reset
                                        <FiZap className="ml-2" />
                                    </button>
                                
</div>
                            
</form>
                        
</div>
                    
</div>
                
</div>
,                document.body            )
}            
<div className="settings-layout">
                
<header className="settings-header">
                    
<div>
                        
<h1>
{
t('settings') || 'System Settings'
}
</h1>
                        
<p className="settings-subtitle">
Configure station parameters and user profile settings.
</p>
                                                
<div className="diagnostic-readout">
                            
<div className="readout-item">
                                
<FiShield />
                                
<span>
Secured
</span>
                            
</div>
                            
<div className="readout-item">
                                
<FiZap />
                                
<span>
Station ID: {
currentUser?.stationId?.slice(0, 8).toUpperCase() || 'OFFLINE'
}
</span>
                            
</div>
                        
</div>
                    
</div>
                                        
                    <button className="btn-factory-reset" onClick={handleSecureReset} title="Trigger Factory Reset Sequence">
                        <FiRefreshCw size={14} />
                        Factory Reset
                    </button>
                
</header>
                
                <div className="settings-tabs-nav">
                    <button className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => handleTabChange('profile')} title="General Profile Settings">
                        <FiUser /> General
                    </button>
                    <button className={`tab-btn ${activeTab === 'inventory' ? 'active' : ''}`} onClick={() => handleTabChange('inventory')} title="Fleet Inventory Management">
                        <FiZap /> Fleet
                    </button>
                    <button className={`tab-btn ${activeTab === 'security' ? 'active' : ''}`} onClick={() => handleTabChange('security')} title="Account Security & MFA">
                        <FiShield /> Security
                    </button>
                    <button className={`tab-btn ${activeTab === 'devices' ? 'active' : ''}`} onClick={() => handleTabChange('devices')} title="Hardware & C2 Console">
                        <FiCpu /> Device Management
                    </button>
                </div>
                
<div className="settings-grid">
                    {
activeTab === 'profile' && (                        
<>
                            {
/* Organization Identity */
}                            
<section className="ds-card-panel">
                                
<div className="settings-section-title">
                                    
<FiBriefcase className="text-blue-600" />
                                    Station Profile                                
</div>
                                
<p className="settings-section-desc">
Manage operational profile and company branding.
</p>
                                
<form onSubmit={
handleOrgSubmit
} className="settings-form">
                                    
<div className="avatar-upload-container">
                                        
<div className="avatar-preview" onClick={
() =>
 fileInputRef.current?.click()
}>
                                            
<img src={
orgForm.logo_url || '/placeholder-company.png'
} alt="Logo" />
                                            
<div className="avatar-overlay">
                                                {
isUploadingLogo ? 
<FiRefreshCw className="animate-spin" />
 : 
<FiCamera size={
20
} />

}                                            
</div>
                                        
</div>
                                        
<div className="flex-1">
                                            
<span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
Station Branding
</span>
                                            
<p className="text-xs text-slate-500 mt-1">
Accepts PNG, JPG, WebP. Max 5MB.
</p>
                                        
</div>
                                        
<input id="logo-upload" type="file" ref={
fileInputRef
} onChange={
handleLogoUpload
} className="hidden" accept="image/*" title="Station Logo Upload" />
                                    
</div>
                                    
<div className="input-group">
                                        
<label htmlFor="station-name">
Station Name
</label>
                                        
<input id="station-name" className="settings-input" name="name" value={
orgForm.name
} onChange={
handleOrgChange
} readOnly title="Station Identity is locked for forensic integrity." />
                                    
</div>
                                    
<div className="form-row">
                                        
<div className="input-group">
                                            
<label htmlFor="tax-id">
Tax ID / PIN
</label>
                                            
<input id="tax-id" className="settings-input" name="tax_id" value={
orgForm.tax_id
} onChange={
handleOrgChange
} placeholder="VAT identifier" title="Tax ID" />
                                        
</div>
                                        
<div className="input-group">
                                            
<label htmlFor="region">
Region
</label>
                                            
<input id="region" className="settings-input" value="East Africa" disabled title="Region" placeholder="Region" />
                                        
</div>
                                    
</div>
                                    
<div className="input-group">
                                        
<label htmlFor="billing-address">
Billing Address
</label>
                                        
<input id="billing-address" className="settings-input" name="address" value={
orgForm.address
} onChange={
handleOrgChange
} placeholder="Physical street address" title="Billing Address" />
                                    
</div>
                                    
<div className="form-actions border-t pt-6 mt-2">
                                        
<button type="submit" disabled={
isSaving
} className="btn btn-primary px-8" title="Update Organization Profile">
                                            
<FiSave className="mr-2" />
 {
isSaving ? 'Saving...' : 'Save Station Profile'
}                                        
</button>
                                    
</div>
                                
</form>
                            
</section>
                            {
/* Personal Identity */
}                            
<section className="ds-card-panel">
                                
<div className="settings-section-title">
                                    
<FiUser className="text-blue-600" />
                                    User Settings                                
</div>
                                
<p className="settings-section-desc">
Manage personal information and profile visibility.
</p>
                                
<form onSubmit={
handleProfileSubmit
} className="settings-form">
                                    
<div className="avatar-upload-container">
                                        
<div className="avatar-preview rounded-full" onClick={
() =>
 profilePhotoInputRef.current?.click()
}>
                                            
<img src={
profileForm.photo_url || '/placeholder-avatar.png'
} alt="Avatar" />
                                            
<div className="avatar-overlay">
                                                {
isUploadingPhoto ? 
<FiRefreshCw className="animate-spin" />
 : 
<FiCamera size={
20
} />

}                                            
</div>
                                        
</div>
                                        
<div className="flex-1">
                                            
<span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
Profile Identity
</span>
                                            
<p className="text-xs text-slate-500 mt-1">
Used for shift recording and audit logs.
</p>
                                        
</div>
                                        
<input id="avatar-upload" type="file" ref={
profilePhotoInputRef
} onChange={
handleProfilePhotoUpload
} className="hidden" accept="image/*" title="Profile Photo Upload" />
                                    
</div>
                                    
<div className="input-group">
                                        
<label htmlFor="display-name">
Display Name
</label>
                                        
<input id="display-name" className="settings-input" name="displayName" value={
profileForm.displayName
} onChange={
handleProfileChange
} readOnly title="Personal Identity is locked for forensic integrity." />
                                    
</div>
                                    
<div className="form-row">
                                        
<div className="input-group">
                                            
<label htmlFor="access-role">
Access Role
</label>
                                            
<input id="access-role" className="settings-input capitalize" value={
currentUser?.role || 'User'
} disabled title="Access Role" placeholder="Role" />
                                        
</div>
                                        
<div className="input-group">
                                            
<label htmlFor="user-status">
Status
</label>
                                            
<input id="user-status" className="settings-input" value="Active" disabled title="Account Status" placeholder="Status" />
                                        
</div>
                                    
</div>
                                    
<div className="input-group">
                                        
<label htmlFor="email-address">
Email Address
</label>
                                        
<input id="email-address" className="settings-input" value={
currentUser?.email || ''
} disabled title="Email Address" placeholder="Email" />
                                    
</div>
                                    
<div className="form-actions border-t pt-6 mt-2">
                                        
<button type="submit" disabled={
isSaving
} className="btn btn-primary px-8" title="Update User Profile">
                                            
<FiSave className="mr-2" />
 {
isSaving ? 'Updating...' : 'Update Account'
}                                        
                                        </button>
                                    </div>
                                </form>
                            </section>

                            {/* Kenyan Compliance & Data Governance (DPA 2019) */}
                            <section className="ds-card-panel compliance-panel border-t-4 border-blue-500">
                                <div className="settings-section-title">
                                    <FiShield className="text-blue-500" />
                                    Compliance & Data Governance
                                </div>
                                <p className="settings-section-desc">
                                    Tools for managing your data rights under the <strong>Kenya Data Protection Act 2019</strong>.
                                </p>
                                <div className="compliance-grid grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                                    <div className="compliance-item p-4 bg-slate-50 rounded-xl border border-slate-200">
                                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2">
                                            <FiRefreshCw className="text-blue-500" /> Data Portability
                                        </h4>
                                        <p className="text-xs text-slate-500 mb-4">Export all your personal and station telemetry data in machine-readable JSON format.</p>
                                        <button className="btn-secondary w-full text-xs py-2" onClick={handleExportData}>Download My Data</button>
                                    </div>
                                    <div className="compliance-item p-4 bg-slate-50 rounded-xl border border-slate-200">
                                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2">
                                            <FiTrash2 className="text-red-500" /> Right to be Forgotten
                                        </h4>
                                        <p className="text-xs text-slate-500 mb-4">Request permanent deletion of your account and all associated telemetry records.</p>
                                        <button className="btn-secondary w-full text-xs py-2 text-red-600 hover:bg-red-50" onClick={handleDeleteAccountRequest}>Delete Account Request</button>
                                    </div>
                                </div>
                                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-center gap-2">
                                    <FiCheckCircle className="text-emerald-500" />
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Registered Data Processor (ODPC Kenya)</span>
                                </div>
                            </section>
                        </>
                    )
}                    {
activeTab === 'inventory' && (                        
<section className="ds-card-panel fleet-card">
                            
<div className="flex justify-between items-center mb-6">
                                
<div>
                                    
<div className="settings-section-title">
                                        
<FiZap className="text-orange-500" />
                                        Fleet Inventory                                    
</div>
                                    
<p className="settings-section-desc mb-0">
Manage volumetric assets and pricing parameters.
</p>
                                
</div>
                                
<button                                     className="btn btn-primary"                                    onClick={
() =>
 setShowAddTankModal(true)
}                                    title="Add New Fuel Asset"                                >
                                    
<FiPlus className="mr-2" />
 Add New Tank                                
</button>
                            
</div>
                            
<div className="fleet-table-container">
                                
<table className="fleet-table">
                                    
<thead>
                                        
<tr>
                                            
<th>
Tank ID
</th>
                                            
<th>
Ref Name
</th>
                                            
<th>
Capacity (L)
</th>
                                            
<th>
Fuel Grade
</th>
                                            
<th>
Delivery Price (Ksh)
</th>
                                            
<th>
Retail Price (Ksh)
</th>
                                            
<th className="text-right">
Action
</th>
                                        
</tr>
                                    
</thead>
                                    
<tbody>
                                        {
tanks.length >
 0 ? tanks.map((tank: any) =>(                                            
<tr key={
tank.id
}>
                                                
<td className="tank-id-tag">
#{
tank.id.slice(0, 8).toUpperCase()
}
</td>
                                                
<td className="font-bold">
{
tank.name
}
</td>
                                                
<td>
{
tank.capacity?.toLocaleString()
} L
</td>
                                                
<td>
                                                    
<span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold text-slate-600 uppercase">
                                                        {
tank.fuelType
}                                                    
</span>
                                                
</td>
                                                
<td className="font-semibold text-slate-500">
                                                {
(tank as any).metadata?.deliveryPrice || '0.00'
}                                                
</td>
                                                
<td>
                                                    
<div className="retail-price-wrap flex items-center gap-2">
                                                        
<div className="relative w-24">
                                                            
<input className={`retail-input !px-2 ${priceDrafts[tank.id] !== undefined ? '!border-emerald-400 !bg-emerald-50/10' : ''}`} value={priceDrafts[tank.id] !== undefined ? priceDrafts[tank.id] : ((tank as any).metadata?.retailPrice || 0)} onChange={(e) => { const val = e.target.value; if (val === '' || /^\d*\.?\d*$/.test(val)) { setPriceDrafts(prev => ({ ...prev, [tank.id]: val })); } }} onFocus={(e) => e.target.select()} aria-label={`Retail price for ${tank.name}`} title={`Retail price for ${tank.name}`} placeholder="0.00" />
                                                        
</div>
                                                        {
priceDrafts[tank.id] !== undefined && (                                                            
<button                                                                 className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-all shadow-sm shadow-emerald-200 animate-in zoom-in-90 duration-200 flex-shrink-0"                                                                onClick={
() =>
 handlePriceCommit(tank.id)
}                                                                title="Commit Price to Database"                                                            >
                                                                
<FiCheckCircle size={
14
} />
                                                            
</button>
                                                        )
}                                                    
</div>
                                                
</td>
                                                
<td className="text-right">
                                                    
<button className="text-blue-600 font-bold text-xs hover:underline mr-4" onClick={
() => {
 setSelectedDevice(tank.sensorId || '');
 setActiveTab('devices');
 
}
} title={
`Open Console for ${
tank.name
}`
}>
C2 Control
</button>

<button 
    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
    onClick={() => {
        setTankToDelete(tank);
        setDeletionStep('warning');
        setIsDeleteModalOpen(true);
    }}
    title={`Permanently delete ${tank.name}`}
>
    <FiTrash2 size={16} />
</button>
                                                
</td>
                                            
</tr>
                                        )) : (                                            
<tr>
                                                
<td colSpan={
7
} className="p-12 text-center text-slate-400 italic">
                                                    No tanks provisioned for this station.                                                
</td>
                                            
</tr>
                                        )
}                                    
</tbody>
                                
</table>
                            
</div>
                        
</section>
                    )
}                    {
activeTab === 'security' && (                        
<section className="ds-card-panel fleet-card security-border-indigo">
                            
<div className="settings-section-title">
                                
<FiShield className="text-indigo-600" aria-hidden="true" />
                                Account Security                            
</div>
                            
<p className="settings-section-desc">
Manage your password and two-factor authentication settings.
</p>
                            
<div className="security-section-grid">
                                {
/* Change Password card */
}                                
<div className="security-card">
                                    
<div className="security-icon-wrapper">
                                        
<FiLock />
                                    
</div>
                                    
<div className="security-info">
                                        
<h4>
Update Password
</h4>
                                        
<p>
Secure your account with a strong unique password.
</p>
                                    
</div>
                                    
<button className="btn-security-action" onClick={
() =>
 setShowChangePwModal(true)
} title="Update Account Password">
Change
</button>
                                
</div>
                                {
/* Two-Factor Authentication card */
}                                
<div className="security-card">
                                    
<div className={
`security-icon-wrapper ${
mfaEnabled ? 'mfa-active-bg' : 'mfa-inactive-bg'
}`
}>
                                        
<FiShield aria-hidden="true" />
                                    
</div>
                                    
<div className="security-info">
                                        
<h4>
Two-Factor Authentication
</h4>
                                        {
mfaEnabled ? (                                            
<div className="mfa-status-badge active">
                                                
<FiCheckCircle />
 
<span>
Active — TOTP Enabled
</span>
                                            
</div>
                                        ) : (                                            
<div className="mfa-status-badge inactive">
                                                
<span>
Protection Disabled
</span>
                                            
</div>
                                        )
}                                    
</div>
                                    {
mfaEnabled ? (                                        
<button className="btn-security-action danger" onClick={
handleDisableMFA
} disabled={
mfaLoading
} title="Disable Two-Factor Authentication">
{
mfaLoading ? '...' : 'Remove'
}
</button>
                                    ) : (                                        
<button className="btn-security-action" onClick={
() =>
 handleStartMFAEnrollment().then(() =>
 setShowMFAModal(true))
} disabled={
mfaLoading
} title="Enable Two-Factor Authentication">
{
mfaLoading ? '...' : 'Enable'
}
</button>
                                    )
}                                
                                </div>

                                {/* Security PIN card - NEW for Kenyan SaaS Security */}
                                <div className="security-card mt-4 border-t pt-6">
                                    <div className={`security-icon-wrapper ${securityPinEnabled ? 'mfa-active-bg' : 'mfa-inactive-bg'}`}>
                                        <FiActivity />
                                    </div>
                                    <div className="security-info">
                                        <h4>Security PIN</h4>
                                        <p>Secondary 6-digit verification layer for critical actions.</p>
                                        {securityPinEnabled ? (
                                            <div className="mfa-status-badge active">
                                                <FiCheckCircle />
                                                <span>6-Digit PIN Configured</span>
                                            </div>
                                        ) : (
                                            <div className="mfa-status-badge warning">
                                                <FiAlertCircle />
                                                <span>PIN Not Set — Recommended</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <button className="btn-security-action" onClick={() => setShowPinModal(true)}>
                                            {securityPinEnabled ? 'Change PIN' : 'Set PIN'}
                                        </button>
                                        {securityPinEnabled && (
                                            <button 
                                                className="btn-security-action danger" 
                                                onClick={handleDisablePin}
                                                disabled={pinLoading}
                                                title="De-activate Security PIN"
                                            >
                                                {pinLoading ? '...' : 'Remove'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>
                    )
}                    {
activeTab === 'devices' && (                        
<>
                            {
/* Device Configuration */
}                            
<section className="ds-card-panel">
                                
<div className="settings-section-title">
                                    
<FiCpu className="text-indigo-600" />
                                    Hardware Console                                
</div>
                                
<p className="settings-section-desc">
Deploy remote instructions to station ESP32 controllers.
</p>
                                
<div className="input-group">
                                    
<label htmlFor="target-device">
Target Hardware ID
</label>
                                    
<select                                         id="target-device"                                        className="settings-input"                                         value={
selectedDevice
}                                         onChange={
(e: React.ChangeEvent<HTMLSelectElement>) =>
 setSelectedDevice(e.target.value)
}                                        aria-label="Select Target Hardware ID"                                        title="Select Device for Remote Commands"                                    >
                                        
<option value="">
Select a registered device...
</option>
                                         {uniqueDevices.map((id: any) => (                                            
                                             <option key={id} value={id}>
                                                 ESP-NODE: {String(id).toUpperCase()}
                                             </option>
                                         ))}                                    
</select>
                                
</div>
                                
<div className="c2-actions-grid mt-6">
                                    
<div className="c2-action-group border rounded-xl p-4 bg-slate-50/50">
                                        
<div className="flex items-center gap-2 mb-3">
                                            
<div className="p-1.5 bg-blue-100 rounded-lg text-blue-600">
                                                
<MdWifi size={
18
} />
                                            
</div>
                                            
<span className="text-xs font-bold uppercase tracking-wider text-slate-700">
Network Provisioning
</span>
                                        
</div>
                                            <div className="wifi-provisioning-layout mt-4">
                                                <div className="wifi-grid-row border-b border-slate-100 pb-3 mb-3">
                                                    <div className="wifi-words-column">
                                                        <h4 className="text-[11px] font-bold text-slate-700">WiFi Name</h4>
                                                    </div>
                                                    <div className="wifi-input-column mt-0">
                                                        <input 
                                                            id="wifi-ssid" 
                                                            className="settings-input !bg-white !text-xs !h-9 border-slate-200" 
                                                            placeholder="WiFi Name" 
                                                            value={wifiConfig.ssid} 
                                                            onChange={e => setWifiConfig(prev => ({ ...prev, ssid: e.target.value }))}
                                                            aria-label="WiFi Name" 
                                                            title="WiFi Name" 
                                                        />
                                                    </div>
                                                </div>

                                                <div className="wifi-grid-row pb-3">
                                                    <div className="wifi-words-column">
                                                        <h4 className="text-[11px] font-bold text-slate-700">WiFi Password</h4>
                                                    </div>
                                                    <div className="wifi-input-column mt-0">
                                                        <input 
                                                            id="wifi-password" 
                                                            className="settings-input !bg-white !text-xs !h-9 border-slate-200" 
                                                            type="password" 
                                                            placeholder="WiFi Password" 
                                                            value={wifiConfig.password} 
                                                            onChange={e => setWifiConfig(prev => ({ ...prev, password: e.target.value }))}
                                                            aria-label="WiFi Password" 
                                                            title="WiFi Password" 
                                                        />
                                                    </div>
                                                </div>

                                                <button 
                                                    className="btn-submit w-full !py-2.5 !text-[11px] !rounded-lg !bg-blue-600 hover:!bg-blue-700 shadow-lg shadow-blue-200 transition-all font-bold mt-2" 
                                                    disabled={isSendingCommand || !wifiConfig.ssid || !selectedDevice} 
                                                    onClick={() => handleSendCommand('SET_WIFI', wifiConfig)} 
                                                    title="Deploy WiFi Configuration"
                                                >
                                                    Execute Over-the-Air Provisioning                                            
                                                </button>
                                            </div>                                    
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-3 mt-4">
                                        
<button                                             className="c2-diagnostic-card ping"                                            disabled={
isSendingCommand || !selectedDevice
}                                            onClick={
() =>
 handleSendCommand('PING')
}                                            title="Send ICMP Ping to hardware node"                                        >
                                            
<div className="card-icon">
                                                
<FiActivity size={
20
} />
                                            
</div>
                                            
<div className="card-content">
                                                
<span className="title">
System Ping
</span>
                                                
<span className="desc">
Diagnostic Diagnostic
</span>
                                            
</div>
                                        
</button>
                                        
<button                                             className="c2-diagnostic-card reboot"                                            disabled={
isSendingCommand || !selectedDevice
}                                            onClick={
() =>
 handleSendCommand('REBOOT')
}                                            title="Request Remote Hardware Reboot"                                        >
                                            
<div className="card-icon">
                                                
<MdRefresh size={
22
} />
                                            
</div>
                                            
<div className="card-content">
                                                
<span className="title">
Hard Reboot
</span>
                                                
<span className="desc">
Hardware Restart
</span>
                                            
</div>
                                        
</button>
                                    
</div>
                                
</div>
                            
</section>
                            {
/* C2 Command Log */
}                            
<section className="ds-card-panel">
                                
<div className="settings-section-title">
                                    
<FiTerminal className="text-slate-600" />
                                    Command & Control Log                                
</div>
                                
<p className="settings-section-desc">
Audit trail of remote execution and hardware pings.
</p>
                                
<div className="c2-log-container overflow-y-auto max-h-[400px]">
                                    {
recentCommands.length >
 0 ? (                                        
<div className="space-y-3">
                                            {recentCommands.map(cmd => (                                                
                                                <div key={cmd.id} className="c2-log-entry p-4 border rounded-xl bg-white hover:shadow-md transition-all flex items-center justify-between group">
                                                    
<div className="flex items-center gap-4">
                                                        
<div className={
`command-icon-box ${
cmd.command.toLowerCase()
}`
}>
                                                            {
cmd.command === 'PING' && 
<FiActivity size={
16
} />

}                                                            {
cmd.command === 'REBOOT' && 
<MdRefresh size={
18
} />

}                                                            {
cmd.command === 'SET_WIFI' && 
<MdWifi size={
18
} />

}                                                        
</div>
                                                        
<div>
                                                            
<div className="flex items-center gap-2">
                                                                
<span className="text-[12px] font-black text-slate-800 tracking-tight uppercase">
{
cmd.command
}
</span>
                                                                
<span className="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded border">
ID_{
cmd.id.slice(0, 6)
}
</span>
                                                            
</div>
                                                            
<p className="text-[11px] font-medium text-slate-500 mt-1 flex items-center gap-1">
                                                                
<FiCpu size={
12
} className="text-slate-300" />
                                                                
<span className="font-mono">
{
cmd.device_id
}
</span>
                                                            
</p>
                                                        
</div>
                                                    
</div>
                                                    
<div className="text-right flex flex-col items-end gap-1.5">
                                                        <span className={`status-glow-pill ${cmd.status}`}>
                                                            {cmd.status === 'pending' && localPendingIds.includes(cmd.id) ? 'SIGNING...' : cmd.status}
                                                        </span>
                                                        
<div className="flex items-center gap-1.5 text-slate-400">
                                                            
<FiTerminal size={
10
} />
                                                            
<p className="text-[10px] font-medium">
{
new Date(cmd.created_at).toLocaleTimeString()
}
</p>
                                                        
</div>
                                                    
</div>
                                                
</div>
                                            ))
}                                        
</div>
                                    ) : (                                        
<div className="text-center py-12 text-slate-400 italic text-sm">
                                            No recent C2 activity detected.                                        
</div>
                                    )
}                                
</div>
                            
</section>
                        
</>
                    )
}                
</div>
            
</div>
            {
/* Change Password Modal */
}            {
showChangePwModal && createPortal(                
<div className="add-tank-modal-overlay">
                    
<div className="add-tank-modal-content modal-w-md">
                        
<div className="modal-header">
                            
<div className="header-text-container">
                                
<h2>
Security Update
</h2>
                                
<p>
Change your account login password
</p>
                            
</div>
                            
<div className="modal-header-badges">
                                
<span className="modal-badge cyan">
Required
</span>
                                
<span className="modal-badge blue">
Identity
</span>
                            
</div>
                            
<button className="close-btn" onClick={
() =>
 setShowChangePwModal(false)
} title="Close Password Modal" aria-label="Close">
                                
<FiX />
                            
</button>
                        
</div>
                        
<div className="security-modal-body">
                            
<form onSubmit={
handleChangePassword
} className="settings-form">
                                
<div className="input-group">
                                    
<label htmlFor="current-password">
Current Password
</label>
                                    
<div className="password-input-wrapper">
                                        
<input                                            id="current-password"                                            className="settings-input"                                            type={
showCurrentPw ? 'text' : 'password'
}                                            value={
currentPassword
}                                            onChange={
(e) =>
 setCurrentPassword(e.target.value)
}                                            placeholder="Verify identity"                                            title="Current Password"                                            required                                        />
                                        
<button type="button" className="password-toggle" onClick={
() =>
 setShowCurrentPw(p =>
 !p)
} aria-label={
showCurrentPw ? "Hide password" : "Show password"
} title={
showCurrentPw ? "Hide password" : "Show password"
}>
                                            {
showCurrentPw ? 
<FiEyeOff size={
16
} />
 : 
<FiEye size={
16
} />

}                                        
</button>
                                    
</div>
                                
</div>
                                
<div className="input-group">
                                    
<label htmlFor="new-password">
New Password
</label>
                                    
<div className="password-input-wrapper">
                                        
<input                                            id="new-password"                                            className="settings-input"                                            type={
showNewPw ? 'text' : 'password'
}                                            value={
newPassword
}                                            onChange={
(e) =>
 setNewPassword(e.target.value)
}                                            placeholder="Min. 8 characters"                                            title="New Password"                                            required                                        />
                                        
<button type="button" className="password-toggle" onClick={
() =>
 setShowNewPw(p =>
 !p)
} aria-label={
showNewPw ? "Hide password" : "Show password"
} title={
showNewPw ? "Hide password" : "Show password"
}>
                                            {
showNewPw ? 
<FiEyeOff size={
16
} />
 : 
<FiEye size={
16
} />

}                                        
</button>
                                    
</div>
                                
</div>
                                
<div className="input-group">
                                    
<label htmlFor="confirm-password">
Confirm Password
</label>
                                    
<div className="password-input-wrapper">
                                        
<input                                            id="confirm-password"                                            className="settings-input"                                            type={
showConfirmPw ? 'text' : 'password'
}                                            value={
confirmPassword
}                                            onChange={
(e) =>
 setConfirmPassword(e.target.value)
}                                            placeholder="Repeat password"                                            title="Confirm New Password"                                            required                                        />
                                        
<button type="button" className="password-toggle" onClick={
() =>
 setShowConfirmPw(p =>
 !p)
} aria-label={
showConfirmPw ? "Hide password" : "Show password"
} title={
showConfirmPw ? "Hide password" : "Show password"
}>
                                            {
showConfirmPw ? 
<FiEyeOff size={
16
} />
 : 
<FiEye size={
16
} />

}                                        
</button>
                                    
</div>
                                    {
confirmPassword && newPassword !== confirmPassword && (                                        
<p className="text-red-600 text-xs mt-1 font-bold">
Passwords do not match
</p>
                                    )
}                                
</div>
                                
<div className="form-actions border-t pt-6 mt-4">
                                    
<button type="button" className="btn-danger" onClick={
() =>
 setShowChangePwModal(false)
} title="Cancel Password Update">
Cancel
</button>
                                    
<button                                        type="submit"                                        className="btn-submit"                                        disabled={
pwSaving || !currentPassword || !newPassword || newPassword !== confirmPassword
}                                        title="Confirm Password Update"                                    >
                                        {
pwSaving ? 'Updating...' : 'Update Password'
}                                    
</button>
                                
</div>
                            
</form>
                        
</div>
                    
</div>
                
</div>
,                document.body            )
}            {
/* MFA Enrollment Modal */
}            {
showMFAModal && createPortal(                
<div className="add-tank-modal-overlay">
                    
<div className="add-tank-modal-content modal-w-md">
                        
<div className="modal-header">
                            
<div className="header-text-container">
                                
<h2>
Two-Factor Auth
</h2>
                                
<p>
Enhance account security with TOTP
</p>
                            
</div>
                            
<div className="modal-header-badges">
                                
<span className="modal-badge emerald">
Secure
</span>
                                
<span className="modal-badge blue">
TOTP
</span>
                            
</div>
                            
<button className="close-btn" onClick={
() =>
 setShowMFAModal(false)
} title="Close MFA Modal" aria-label="Close">
                                
<FiX />
                            
</button>
                        
</div>
                        
<div className="security-modal-body">
                            {
mfaStep === 'qr' && (                                
<div className="text-center">
                                    
<p className="mfa-text-main">
                                        Scan this QR code in your authenticator app (Google Authenticator, Authy, etc.) to link your IoTank account.                                    
</p>
                                    
<div className="mfa-qr-container">
                                        
<img src={
mfaQrCode
} alt="MFA QR" className="w-[180px] h-[180px]" />
                                    
</div>
                                    
<div className="mfa-manual-wrapper">
                                        
<span className="mfa-manual-label">
Manual Entry Key
</span>
                                        
<code className="mfa-manual-code">
{
mfaSecret
}
</code>
                                    
</div>
                                    
<button className="btn-submit w-full" onClick={
() =>
 setMfaStep('verify')
} title="Confirm QR Link and Verify">
                                        Continue to Verification 
<FiArrowRight className="ml-2" />
                                    
</button>
                                
</div>
                            )
}                            {
mfaStep === 'verify' && (                                
<div>
                                    
<p className="mfa-text-main">
                                        Enter the 6-digit code from your authenticator app to finalize the security upgrade.                                    
</p>
                                    <div className="mfa-digit-container">
                                        {[...Array(6)].map((_, i) => (
                                            <input
                                                key={i}
                                                id={`mfa-digit-${i}`}
                                                type="text"
                                                className={`mfa-digit-input ${mfaVerifyCode[i] ? 'filled' : ''}`}
                                                inputMode="numeric"
                                                maxLength={1}
                                                value={mfaVerifyCode[i] || ''}
                                                onChange={(e) => {
                                                    const char = e.target.value.replace(/\D/g, '').slice(-1);
                                                    const currentCode = mfaVerifyCode.split('');
                                                    currentCode[i] = char;
                                                    const newCode = currentCode.join('').slice(0, 6);
                                                    setMfaVerifyCode(newCode);
                                                    
                                                    // Auto-focus next
                                                    if (char && i < 5) {
                                                        const nextInput = document.getElementById(`mfa-digit-${i + 1}`);
                                                        nextInput?.focus();
                                                    }
                                                    
                                                    // Trigger verification if complete
                                                    if (newCode.length === 6 && !mfaLoading) {
                                                        handleVerifyMFAEnrollment(newCode);
                                                    }
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Backspace' && !mfaVerifyCode[i] && i > 0) {
                                                        const prevInput = document.getElementById(`mfa-digit-${i - 1}`);
                                                        prevInput?.focus();
                                                    }
                                                }}
                                                autoFocus={i === 0}
                                                autoComplete="one-time-code"
                                            />
                                        ))}
                                    </div>
                                    
<div className="form-actions">
                                        
<button className="btn-danger" onClick={
() =>
 setMfaStep('qr')
} title="Return to QR Code">
Back
</button>
                                        
<button                                             className="btn-submit flex-1"                                             onClick={
() =>
 handleVerifyMFAEnrollment()
}                                            disabled={
mfaLoading || mfaVerifyCode.length !== 6
}                                            title="Verify Code and Activate MFA"                                        >
                                            {
mfaLoading ? 'Verifying...' : 'Complete Activation'
}                                        
</button>
                                    
</div>
                                
</div>
                            )
}                        
</div>
                    
</div>
                
</div>
,                document.body            )
}            {
                showAddTankModal && (
                <AddTankModal
                    isOpen={showAddTankModal}
                    sites={sites}
                    onClose={() => setShowAddTankModal(false)}
                    onSuccess={() => {
                        setShowAddTankModal(false);
                    }}
                />
            )
}            {
toast && 
<Toast message={
toast.message
} type={
toast.type
} onClose={
() =>
 setToast(null)
} />

}                        {
cropperState.isOpen && (                
<ImageCropperModal                    image={
cropperState.imageSrc
}                    cropShape={
cropperState.mode === 'profile' ? 'round' : 'rect'
}                    aspect={
1
}                    title={
cropperState.mode === 'profile' ? 'Edit Profile Photo' : 'Edit Station Logo'
}                    subtitle="Select the focal area for system display."                    onCropComplete={
handleCropComplete
}                    onCancel={
() =>
 setCropperState(prev =>({
 ...prev, isOpen: false 
}))
}                />
            )
}            {/* Password Protected Deletion Modal - 2 STEP */}
            {isDeleteModalOpen && (
                <div className="add-tank-modal-overlay" onClick={(e) => e.stopPropagation()}>
                    <div className="add-tank-modal-content modal-w-md" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="header-text-container">
                                <h2>Critical Action Required</h2>
                                <p>Permanently purge tank and history</p>
                            </div>
                            <div className="modal-header-badges">
                                <span className="modal-badge red">Danger</span>
                            </div>
                            <button className="close-btn" onClick={() => { setIsDeleteModalOpen(false); setTankToDelete(null); }} title="Cancel">
                                <FiX />
                            </button>
                        </div>
                        
                        <div className="security-modal-body">
                        {deletionStep === 'warning' ? (
                            <>
                                <p className="mb-6 text-sm text-slate-600 leading-relaxed">
                                    You are initiating a <strong>Hard Delete</strong> for <strong>{tankToDelete?.name}</strong>. 
                                    <br /><br />
                                    This will permanently purge all telemetry records, historical consumption data, and configuration logs from the secure vault. This action is <em>irreversible</em>.
                                </p>
                                <div className="form-actions mt-8">
                                    <button
                                        className="btn-danger"
                                        onClick={() => { setIsDeleteModalOpen(false); setTankToDelete(null); }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="btn-submit"
                                        onClick={() => setDeletionStep('password')}
                                    >
                                        I Understand, Proceed
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="input-group">
                                    <label>Admin Authorization Key</label>
                                    <input
                                        type="password"
                                        className="settings-input"
                                        placeholder="Enter secure password"
                                        value={deletePassword}
                                        onChange={(e) => setDeletePassword(e.target.value)}
                                        autoFocus
                                    />
                                    {deleteError && (
                                        <div className="flex items-center gap-2 mt-3 p-2 bg-red-50 text-red-600 border border-red-100 rounded text-sm">
                                            <FiAlertCircle size={14} />
                                            <p className="font-bold">{deleteError}</p>
                                        </div>
                                    )}
                                </div>
                                
                                <div className="form-actions mt-8">
                                    <button
                                        className="btn-secondary"
                                        onClick={() => setDeletionStep('warning')}
                                        disabled={isDeleting}
                                    >
                                        Back
                                    </button>
                                    <button
                                        className="btn-danger"
                                        style={{ backgroundColor: '#dc2626' }}
                                        onClick={handleDeleteTank}
                                        disabled={isDeleting || !deletePassword}
                                    >
                                        {isDeleting ? 'Purging...' : 'Confirm Purge'}
                                    </button>
                                </div>
                            </>
                        )}
                        </div>
                    </div>
                </div>
            )}
            {/* Global Modals for Main path */}
            {showPinModal && createPortal(
                <div className="add-tank-modal-overlay">
                    <div className="add-tank-modal-content modal-w-md">
                        <div className="modal-header security-verify-header">
                            <div className="header-text-container">
                                <h2>Security PIN Setup</h2>
                                <p>Set a 6-digit secondary verification code</p>
                            </div>
                            <button className="close-btn" onClick={() => setShowPinModal(false)}><FiX /></button>
                        </div>
                        <div className="security-modal-body">
                            <div className="input-group">
                                <label className="mb-4 block text-center">Enter 6-Digit PIN</label>
                                <div className="flex justify-center gap-2 mb-8">
                                    {[...Array(6)].map((_, i) => (
                                        <input
                                            key={`pin-${i}`}
                                            id={`pin-input-${i}`}
                                            type={visiblePinIndices.includes(i) ? "text" : "password"}
                                            maxLength={1}
                                            className="w-12 h-14 bg-slate-100 border-2 border-slate-200 rounded-xl text-center text-2xl font-bold focus:border-blue-500 focus:bg-white outline-none transition-all shadow-inner"
                                            value={pinCode[i] || ''}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/\D/g, '');
                                                if (!val && e.target.value) return; // Ignore non-numeric
                                                const newPin = pinCode.split('');
                                                newPin[i] = val;
                                                const finalPin = newPin.join('').slice(0, 6);
                                                setPinCode(finalPin);
                                                
                                                if (val) {
                                                    setVisiblePinIndices(prev => [...prev, i]);
                                                    setTimeout(() => {
                                                        setVisiblePinIndices(prev => prev.filter(idx => idx !== i));
                                                    }, 500);
                                                    
                                                    if (i < 5) {
                                                        document.getElementById(`pin-input-${i + 1}`)?.focus();
                                                    }
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Backspace' && !pinCode[i] && i > 0) {
                                                    document.getElementById(`pin-input-${i - 1}`)?.focus();
                                                }
                                            }}
                                            autoFocus={i === 0}
                                        />
                                    ))}
                                </div>
                            </div>
                            <div className="input-group">
                                <label className="mb-4 block text-center">Confirm PIN</label>
                                <div className="flex justify-center gap-2 mb-4">
                                    {[...Array(6)].map((_, i) => (
                                        <input
                                            key={`confirm-pin-${i}`}
                                            id={`confirm-pin-input-${i}`}
                                            type={visibleConfirmPinIndices.includes(i) ? "text" : "password"}
                                            maxLength={1}
                                            className="w-12 h-14 bg-slate-100 border-2 border-slate-200 rounded-xl text-center text-2xl font-bold focus:border-blue-500 focus:bg-white outline-none transition-all shadow-inner"
                                            value={confirmPinCode[i] || ''}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/\D/g, '');
                                                if (!val && e.target.value) return;
                                                const newPin = confirmPinCode.split('');
                                                newPin[i] = val;
                                                const finalPin = newPin.join('').slice(0, 6);
                                                setConfirmPinCode(finalPin);

                                                if (val) {
                                                    setVisibleConfirmPinIndices(prev => [...prev, i]);
                                                    setTimeout(() => {
                                                        setVisibleConfirmPinIndices(prev => prev.filter(idx => idx !== i));
                                                    }, 500);

                                                    if (i < 5) {
                                                        document.getElementById(`confirm-pin-input-${i + 1}`)?.focus();
                                                    }
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Backspace' && !confirmPinCode[i] && i > 0) {
                                                    document.getElementById(`confirm-pin-input-${i - 1}`)?.focus();
                                                }
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>
                            <div className="form-actions mt-8">
                                <button className="btn-secondary" onClick={() => setShowPinModal(false)}>Cancel</button>
                                <button className="btn-primary" onClick={handleSetupPin} disabled={pinLoading || pinCode.length !== 6}>
                                    {pinLoading ? <FiRefreshCw className="animate-spin" /> : 'Save PIN'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        </div>
    );
};
