import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../config/supabase';
import Layout from '../components/Layout';
import { FiPhone, FiMail, FiCheckCircle, FiXCircle, FiInfo, FiLoader, 
    FiPlus, FiRefreshCw, FiUser, FiShield, FiMapPin, FiCalendar, 
    FiSearch, FiAlertCircle, FiActivity, FiX, FiGlobe, FiZap,
    FiChevronLeft, FiChevronRight, FiDatabase, FiExternalLink, 
    FiDownload, FiTrendingUp, FiTrendingDown, FiArchive, FiClock
} from 'react-icons/fi';
import { useAuth } from '../hooks/useAuth';
import './PendingRegistrations.css';

interface PendingReg {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  station_name: string;
  county: string;
  notes: string;
  status: 'pending' | 'approved' | 'rejected' | 'contacted';
  created_at: string;
}

// Internal Pagination Component
const TablePagination = ({ 
    currentPage, 
    totalItems, 
    pageSize, 
    onPageChange 
}: { 
    currentPage: number, 
    totalItems: number, 
    pageSize: number, 
    onPageChange: (p: number) => void 
}) => {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalItems);

    return (
        <div className="table-pagination-footer">
            <div className="pagination-info">
                Showing <b>{start}</b> to <b>{end}</b> of <b>{totalItems}</b> entries
            </div>
            <div className="pagination-controls">
                <button 
                    className="pagination-btn" 
                    disabled={currentPage === 1}
                    onClick={() => onPageChange(currentPage - 1)}
                >
                    Previous
                </button>
                <button 
                    className="pagination-btn" 
                    disabled={currentPage === totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                >
                    Next
                </button>
            </div>
        </div>
    );
};

const PendingRegistrations: React.FC<{ isHubView?: boolean }> = ({ isHubView }) => {
  const { systemUser } = useAuth();
  const [registrations, setRegistrations] = useState<PendingReg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [showManualModal, setShowManualModal] = useState(false);
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Notification States
  const [toast, setToast] = useState<{show: boolean, type: 'error' | 'success', title: string, message: string, step?: string} | null>(null);

  const fetchRegistrations = async () => {
    setLoading(true);
    setError('');
    try {
      await supabase.rpc('repair_my_identity');
      const { data: regData, error: regError } = await supabase
        .from('pending_registrations')
        .select('*')
        .order('created_at', { ascending: false });

      if (regError) throw regError;
      setRegistrations(regData as PendingReg[]);

    } catch (err: any) {
      console.error("Fetch error:", err);
      setError(err.message);
    } finally {
      setTimeout(() => setLoading(false), 800); 
    }
  };

  useEffect(() => {
    fetchRegistrations();

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_registrations' }, () => {
          fetchRegistrations();
      })
      .subscribe((status) => {
          if (status === 'SUBSCRIBED') setIsRealtimeActive(true);
      });

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (toast?.show) {
      const duration = toast.type === 'success' ? 10000 : 20000;
      const timer = setTimeout(() => setToast(null), duration);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const [selectedReg, setSelectedReg] = useState<PendingReg | null>(null);

  // Intelligence Metrics
  const metrics = useMemo(() => {
    const total = registrations.length;
    const pending = registrations.filter(r => r.status === 'pending').length;
    const approved = registrations.filter(r => r.status === 'approved').length;
    const exceptions = registrations.filter(r => r.status === 'rejected').length;
    
    return { total, pending, approved, exceptions };
  }, [registrations]);

  const handleApproveAdmin = async (reg: PendingReg) => {
    setApproving(true);
    setProcessingId(reg.id);
    setToast(null);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
          setToast({ show: true, type: 'error', title: 'Session Expired', message: 'Your session has ended. Please sign in again.' });
          setTimeout(() => window.location.href = '/', 1500);
          return;
      }

      const { data, error } = await supabase.functions.invoke('approve-registration', {
        body: { registrationId: reg.id, approvedBy: session.user.id }
      });

      if (error) {
          console.error("[PROVISIONING_HANDSHAKE_FAIL] Full Error Object:", error);
          
          const isAuthError = error.status === 401 || 
                             (error.message && error.message.toLowerCase().includes('unauthorized'));

          if (isAuthError) {
              const hint = (error as any).hint || (error as any).detail?.hint || 'Your administrative session has timed out. Please sign in again.';
              setToast({ 
                show: true, 
                type: 'error', 
                title: 'Security Session Expired', 
                message: hint
              });
              
              supabase.auth.signOut().then(() => {
                localStorage.clear();
                setTimeout(() => window.location.href = '/', 3500);
              });
              return;
          }

          // Handle generic invocation error
          setToast({
              show: true,
              type: 'error',
              title: "Provisioning Failed",
              message: error.message || "The provisioning hub could not be reached.",
              step: 'NETWORK_ERROR'
          });
          return;
      }
      
      if (data && data.success === false) {
          setToast({
              show: true,
              type: 'error',
              title: "Provisioning Interrupted",
              message: data.error || (data.detail && typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) || "Logical desync in handshake.",
              step: data.detail?.step || 'PIPELINE_DESYNC'
          });
          return;
      }
      
      setToast({
          show: true,
          type: 'success',
          title: 'Provisioning Success',
          message: `${reg.full_name} has been synchronized as Executive Administrator.`
      });
      setSelectedReg(null); // Close modal IMMEDIATELY on success
      await fetchRegistrations();
    } catch (err: any) {
      setToast({ show: true, type: 'error', title: "Critical Exception", message: err.message });
    } finally {
      setApproving(false);
      setProcessingId(null);
    }
  };

  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const handleReject = async (reg: PendingReg) => {
    try {
      const { error } = await supabase.from('pending_registrations').update({ status: 'rejected' }).eq('id', reg.id);
      if (error) throw error;
      
      setToast({ 
          show: true, 
          type: 'success', 
          title: 'Request Archived', 
          message: `Administrative access for ${reg.full_name} has been declined and moved to blacklist.` 
      });
      setRejectingId(null);
      setSelectedReg(null); // Close modal if open
      await fetchRegistrations();
    } catch (err: any) {
      setToast({ show: true, type: 'error', title: "Rejection Logic Failed", message: err.message });
    }
  };

  const handleExport = () => {
    const csvRows = [
      ['Full Name', 'Email', 'Phone', 'Station Name', 'County', 'Status', 'Date'],
      ...registrations.map(r => [
        r.full_name,
        r.email,
        r.phone,
        r.station_name,
        r.county || 'N/A',
        r.status,
        new Date(r.created_at).toLocaleDateString()
      ])
    ];

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `IoTank_Registration_Log_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setToast({ show: true, type: 'success', title: 'Export Generated', message: 'Registry has been compiled into CSV format.' });
  };

  const filteredAdmins = registrations.filter(item => {
    const matchesStatus = filterStatus === 'all' ? true : item.status === filterStatus;
    const term = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm || 
        item.full_name?.toLowerCase().includes(term) || 
        item.email?.toLowerCase().includes(term) || 
        item.station_name?.toLowerCase().includes(term);
    return matchesStatus && matchesSearch;
  });

  // Calculate Pagination
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredAdmins.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredAdmins.length / itemsPerPage);

  const ManualProvisionModal = () => {
    const [formData, setFormData] = useState({
        full_name: '',
        email: '',
        phone: '',
        station_name: '',
        county: '',
        notes: ''
    });
    const [submitting, setSubmitting] = useState(false);
    const [localError, setLocalError] = useState('');

    const counties = [
        'Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Kiambu', 'Machakos',
        'Nyeri', 'Meru', 'Kakamega', 'Kisii', 'Kilifi', 'Garissa', 'Other',
    ];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError('');

        if (!formData.full_name || !formData.email || !formData.phone || !formData.station_name || !formData.county || !formData.notes) {
            setLocalError('All fields must be filled before direct deployment.');
            return;
        }

        setSubmitting(true);
        try {
            const { data: reg, error: regError } = await supabase
                .from('pending_registrations')
                .insert([{ ...formData, status: 'pending' }])
                .select()
                .single();

            if (regError) throw regError;

            await handleApproveAdmin(reg as PendingReg);
            setShowManualModal(false);
        } catch (err: any) {
            setLocalError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return createPortal(
        <div className="registration-overlay" style={{ zIndex: 9999 }}>
            <div className="registration-modal-content max-w-2xl w-full animate-in zoom-in-95 duration-200">
                <header className="px-6 py-6 border-b border-slate-100 flex items-start justify-between bg-slate-50 rounded-t-2xl">
                    <div className="header-text-container">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-100 rounded-lg">
                                <FiUser size={20} className="text-indigo-600" />
                            </div>
                            <h2 className="text-xl font-bold text-slate-800 m-0">Provision Executive Identity</h2>
                        </div>
                        <p className="text-slate-500 text-sm m-0 mt-1">Direct system-level deployment of administrative credentials.</p>
                        <div className="flex gap-2 mt-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700">Kernel Direct</span>
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700">SECURE_DEPLOY</span>
                        </div>
                    </div>
                <button className="text-slate-400 hover:text-slate-600 bg-slate-200/50 hover:bg-slate-200 p-2 rounded-full transition-colors" onClick={() => setShowManualModal(false)}>
                        <FiX size={16} />
                    </button>
                </header>

                <div className="max-h-[70vh] overflow-y-auto px-6 pb-8 pt-4 bg-white rounded-b-2xl">
                    {localError && (
                        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl flex gap-3 text-sm font-medium mb-6">
                            <FiAlertCircle size={18} className="shrink-0 mt-0.5" />
                            <div>
                                <strong className="block mb-1">Deployment Error</strong>
                                <p className="m-0">{localError}</p>
                            </div>
                        </div>
                    )}
                    
                    <form onSubmit={handleSubmit} className="space-y-8 mt-2">
                        {/* SECTION 1: IDENTITY */}
                        <div className="atm-section">
                            <div className="flex items-center gap-2 text-slate-400 text-sm font-bold mb-4 uppercase tracking-widest border-b border-slate-100 pb-2">
                                <FiUser size={14} /> Executive Identity
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="form-group flex flex-col gap-1.5">
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Full Legal Name</label>
                                    <input required type="text" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none" placeholder="John Kamau" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} />
                                </div>
                                <div className="form-group flex flex-col gap-1.5">
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Business Email Address</label>
                                    <input required type="email" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none" placeholder="you@company.com" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                                </div>
                                <div className="form-group flex flex-col gap-1.5">
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Official Contact Number</label>
                                    <input required type="tel" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none" placeholder="+254..." value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                                </div>
                                <div className="form-group flex flex-col gap-1.5">
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Station / Company Name</label>
                                    <input required type="text" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none" placeholder="e.g. Nairobi Central Station" value={formData.station_name} onChange={e => setFormData({...formData, station_name: e.target.value})} />
                                </div>
                            </div>
                        </div>

                        {/* SECTION 2: LOCATION */}
                        <div className="atm-section">
                            <div className="flex items-center gap-2 text-slate-400 text-sm font-bold mb-4 uppercase tracking-widest border-b border-slate-100 pb-2">
                                <FiGlobe size={14} /> Administrative Region
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                <div className="form-group flex flex-col gap-1.5">
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">County / Region Headquarters</label>
                                    <select required className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none" value={formData.county} onChange={e => setFormData({...formData, county: e.target.value})}>
                                        <option value="">Select County</option>
                                        {counties.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* SECTION 3: DIRECTIVES */}
                        <div className="atm-section">
                            <div className="flex items-center gap-2 text-slate-400 text-sm font-bold mb-4 uppercase tracking-widest border-b border-slate-100 pb-2">
                                <FiInfo size={14} /> Special Directives
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                <div className="form-group flex flex-col gap-1.5">
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Technical Requirements (Optional)</label>
                                    <textarea 
                                        rows={2}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all outline-none resize-y"
                                        placeholder="Any specific installation notes or equipment needs..." 
                                        value={formData.notes} 
                                        onChange={e => setFormData({...formData, notes: e.target.value})} 
                                    />
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex gap-4 pt-4 border-t border-slate-100">
                            <button type="button" className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-sm transition-colors" onClick={() => setShowManualModal(false)}>Cancel</button>
                            <button type="submit" className="flex-[2] py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-colors shadow-md shadow-indigo-600/20 flex justify-center items-center gap-2" disabled={submitting}>
                                {submitting ? <FiLoader className="animate-spin" /> : <FiZap />}
                                <span>PROVISION EXECUTIVE ACCOUNT</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>,
        document.body
    );
  };

  const DetailAuditModal = ({ reg, onClose }: { reg: PendingReg; onClose: () => void }) => {
    return createPortal(
        <div className="registration-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
            <div className="registration-modal-content max-w-[640px] w-full animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <header className="px-8 py-6 relative rounded-t-2xl flex items-start justify-between" style={{ background: 'linear-gradient(135deg, #0f172a, #064e3b)' }}>
                    <div className="text-white">
                        <div className="flex items-center gap-3 mb-1">
                            <FiActivity size={20} className="text-emerald-400" />
                            <h2 className="text-[22px] font-bold m-0 tracking-tight text-white">Forensic Audit: {reg.full_name}</h2>
                        </div>
                        <p className="text-emerald-100/70 text-[13px] m-0 pl-[32px]">Identity bundle verification and station deployment metadata.</p>
                    </div>
                    <button className="text-white bg-rose-500 hover:bg-rose-600 p-2 rounded-full shadow-lg transition-transform hover:scale-105" onClick={onClose}>
                        <FiX size={14} />
                    </button>
                </header>

                <div className="max-h-[70vh] overflow-y-auto bg-white rounded-b-2xl px-8 pb-8 pt-6">
                    <div className="space-y-6">
                        {/* Executive Identity */}
                        <div>
                            <h4 className="flex items-center gap-2 text-slate-400 text-sm font-bold mb-3">
                                <FiUser size={14} /> Executive Identity
                            </h4>
                            <div className="space-y-2">
                                <div className="flex flex-col gap-1">
                                    <span className="text-slate-500 text-[13px]">Legal Name</span>
                                    <span className="text-slate-800 font-bold text-base bg-slate-50 px-3 py-2 rounded-lg">{reg.full_name}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-slate-500 text-[13px]">Primary Email</span>
                                    <span className="text-indigo-600 font-mono text-base bg-indigo-50 px-3 py-2 rounded-lg">{reg.email}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-slate-500 text-[13px]">Contact Phone</span>
                                    <span className="text-slate-700 text-base bg-slate-50 px-3 py-2 rounded-lg">{reg.phone}</span>
                                </div>
                            </div>
                        </div>

                        {/* Station Deployment */}
                        <div>
                            <h4 className="flex items-center gap-2 text-slate-400 text-sm font-bold mb-3">
                                <FiMapPin size={14} /> Station Deployment
                            </h4>
                            <div className="space-y-2">
                                <div className="flex flex-col gap-1">
                                    <span className="text-slate-500 text-[13px]">Station Entity</span>
                                    <span className="text-slate-800 font-bold text-base bg-slate-50 px-3 py-2 rounded-lg">{reg.station_name}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-slate-500 text-[13px]">Assigned County</span>
                                    <span className="text-slate-700 text-base bg-slate-50 px-3 py-2 rounded-lg">{reg.county}</span>
                                </div>
                            </div>
                        </div>

                        {/* Notes */}
                        <div>
                            <h4 className="flex items-center gap-2 text-slate-400 text-sm font-bold mb-3">
                                <FiInfo size={14} /> Technical Objectives & Notes
                            </h4>
                            <div className="text-slate-700 text-sm bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
                                {reg.notes || "No additional technical directives provided."}
                            </div>
                        </div>

                        {/* Protocol History */}
                        <div className="pb-4">
                            <h4 className="flex items-center gap-2 text-slate-400 text-sm font-bold mb-3">
                                <FiClock size={14} /> Protocol History
                            </h4>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-800 font-bold">Initial Handshake</span>
                                    <span className="text-slate-600">{new Date(reg.created_at).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-800 font-bold">Current Status</span>
                                    <span className="text-slate-600">{reg.status}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {reg.status === 'pending' && (
                        <div className="mt-8">
                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-center mb-1">
                                    <button 
                                        className="text-slate-800 hover:text-rose-600 text-[15px] font-medium transition-colors" 
                                        onClick={() => setRejectingId(rejectingId === reg.id ? null : reg.id)}
                                    >
                                        Reject Identity
                                    </button>
                                </div>
                                
                                {rejectingId === reg.id && (
                                    <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 mb-2 animate-in slide-in-from-top-2 duration-300">
                                        <div className="text-rose-800 text-sm font-bold mb-3">Confirm Executive Identity Rejection?</div>
                                        <div className="flex gap-3">
                                            <button className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 rounded-lg text-sm transition-colors" onClick={() => handleReject(reg)}>Yes, Reject</button>
                                            <button className="flex-1 bg-white border border-rose-200 text-slate-700 hover:bg-slate-50 font-bold py-2 rounded-lg text-sm transition-colors" onClick={() => setRejectingId(null)}>Cancel</button>
                                        </div>
                                    </div>
                                )}
                                
                                <button 
                                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-4 rounded-xl text-[15px] transition-all shadow-md flex items-center justify-center gap-2" 
                                    onClick={() => handleApproveAdmin(reg)} 
                                    disabled={(approving && processingId === reg.id) || systemUser?.auth_level !== 1}
                                >
                                    {approving && processingId === reg.id ? <FiLoader className="animate-spin" /> : <FiZap />}
                                    <span className="uppercase tracking-wide">Provision Executive Account</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>, document.body
    );
  };

  const content = (
      <div className="pending-reg-container animate-in fade-in duration-500">
        
        {toast?.show && (
            <div className="toast-container">
                <div className={`premium-toast type--${toast.type} shadow-2xl`}>
                    <div className={`toast-icon-wrapper ${toast.type}`}>
                        {toast.type === 'error' ? <FiXCircle size={24} /> : <FiCheckCircle size={24} />}
                    </div>
                    <div className="toast-content">
                        <h4 className="toast-title">{toast.title}</h4>
                        <p className="toast-msg">{toast.message}</p>
                    </div>
                    <button className="absolute top-4 right-4 text-slate-300 hover:text-slate-600 transition-colors" onClick={() => setToast(null)}>
                        <FiXCircle size={18} />
                    </button>
                    <div className="toast-timer-bar"></div>
                </div>
            </div>
        )}

        {showManualModal && <ManualProvisionModal />}
        {selectedReg && <DetailAuditModal reg={selectedReg} onClose={() => setSelectedReg(null)} />}

        {/* Cloned Header */}
        <header className="dp-header">
          <div className="dp-header-left">
            <div className="dp-icon-box">
                <FiShield size={24} />
            </div>
            <div>
                <h1>Fleet Intelligence Hub</h1>
                <p className="dp-subtitle">Continuous registration audit and forensic headquarters provisioning.</p>
            </div>
          </div>
          
          <div className="dp-header-actions">
             <button className="dp-btn dp-btn--primary" onClick={handleExport}>
                <FiDownload /> Export Bulk Registry (.csv)
             </button>
             <button className="dp-btn btn-provision-trigger" onClick={() => setShowManualModal(true)}>
                <FiPlus />
                <span>Provision Identity</span>
             </button>
             <button className={`sync-refresher ${loading ? 'is-syncing' : ''}`} onClick={() => fetchRegistrations()} title="Sync Registry">
                <FiRefreshCw size={18} />
                {isRealtimeActive && <div className="active-dot"></div>}
             </button>
          </div>
        </header>

        {/* Intelligence Stats Grid (Cloned) */}
        <section className="dp-stats-grid">
            <div className="dp-premium-stat-card card-blue">
                <div className="dp-stat-icon-wrapper"><FiDatabase size={22} className="text-indigo-600" /></div>
                <div className="dp-stat-content">
                   <span className="dp-stat-label">Total Fleet</span>
                   <span className="dp-stat-value">{metrics.total} Entities</span>
                   <span className="dp-stat-footer">Active Archive</span>
                </div>
            </div>
            <div className="dp-premium-stat-card card-amber">
                <div className="dp-stat-icon-wrapper"><FiTrendingUp size={22} className="text-amber-600" /></div>
                <div className="dp-stat-content">
                   <span className="dp-stat-label">Pending Clearance</span>
                   <span className="stat-value">{metrics.pending} Requests</span>
                   <span className="dp-stat-footer">Audit Required</span>
                </div>
            </div>
            <div className="dp-premium-stat-card card-emerald">
                <div className="dp-stat-icon-wrapper"><FiCheckCircle size={22} className="text-emerald-600" /></div>
                <div className="dp-stat-content">
                   <span className="dp-stat-label">Sync Success</span>
                   <span className="dp-stat-value">{metrics.approved} Synced</span>
                   <span className="dp-stat-footer">Operational Hubs</span>
                </div>
            </div>
            <div className="dp-premium-stat-card card-rose">
                <div className="dp-stat-icon-wrapper"><FiArchive size={22} className="text-rose-600" /></div>
                <div className="dp-stat-content">
                   <span className="dp-stat-label">Audit Exceptions</span>
                   <span className="dp-stat-value">{metrics.exceptions} Entries</span>
                   <span className="dp-stat-footer">Blacklisted Logs</span>
                </div>
            </div>
        </section>

        {/* Forensic Table Card */}
        <div className="tdv-section-card mt-6">
            <div className="section-header flex items-center justify-between p-6">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                        <FiActivity className="text-indigo-600" />
                        <h3 className="section-title">Pending Registrations Registry</h3>
                    </div>
                    
                    <div className="header-search-box">
                        <FiSearch className="search-icon" />
                        <input 
                          type="text" 
                          placeholder="Find identity, email or station..." 
                          value={searchTerm}
                          onChange={(e) => {setSearchTerm(e.target.value); setCurrentPage(1);}}
                        />
                    </div>
                </div>

                <div className="filter-pill-cloud">
                    {['pending', 'approved', 'rejected', 'all'].map(s => (
                        <button 
                            key={s} 
                            className={`filter-btn ${filterStatus === s ? `active type--${s}` : ''}`} 
                            onClick={() => {setFilterStatus(s); setCurrentPage(1);}}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            <div className="table-responsive">
                <table className="tdv-transaction-table">
                    <thead>
                        <tr>
                            <th>IDENTITY</th>
                            <th>STATION ENTITY</th>
                            <th>REGION</th>
                            <th>CONTACT</th>
                            <th>INITIATED</th>
                            <th>STATUS</th>
                            <th className="text-right">COMMAND</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="py-24 text-center">
                                    <div className="flex flex-col items-center">
                                        <div className="w-10 h-10 border-2 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Synchronizing Archive...</p>
                                    </div>
                                </td>
                            </tr>
                        ) : currentItems.length > 0 ? (
                            currentItems.map((reg) => (
                                <tr key={reg.id} onClick={() => setSelectedReg(reg)}>
                                    <td>
                                        <div className="flex flex-col">
                                            <span className="td-bold">{reg.full_name}</span>
                                            <span className="text-[10px] font-mono text-slate-400">{reg.email}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <span className="td-bold">{reg.station_name}</span>
                                    </td>
                                    <td>
                                        <span className="td-region">{reg.county}</span>
                                    </td>
                                    <td>
                                        <span className="td-mono">{reg.phone}</span>
                                    </td>
                                    <td>
                                        <div className="forensic-time-cell">
                                            <span className="date-part">{new Date(reg.created_at).toLocaleDateString()}</span>
                                            <span className="time-part"><FiClock size={8} /> {new Date(reg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`dp-status-badge dp-status-badge--${reg.status === 'pending' ? 'pending' : reg.status === 'approved' ? 'approved' : 'rejected'}`}>
                                            {reg.status}
                                        </span>
                                    </td>
                                    <td className="text-right">
                                        {reg.status === 'pending' ? (
                                            <div className="flex justify-end gap-2 pr-2">
                                                {rejectingId === reg.id ? (
                                                    <div className="flex items-center justify-end gap-3 pr-2 animate-in fade-in duration-200">
                                                        <button 
                                                            className="text-[14px] font-medium text-slate-800 hover:text-rose-600 transition-colors" 
                                                            onClick={(e) => { e.stopPropagation(); handleReject(reg); }}
                                                        >
                                                            Confirm Reject
                                                        </button>
                                                        <button 
                                                            className="text-slate-800 hover:text-slate-500 transition-colors pt-0.5" 
                                                            onClick={(e) => { e.stopPropagation(); setRejectingId(null); }} 
                                                        >
                                                            <FiX size={18} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <button 
                                                            className="action-circle approve" 
                                                            onClick={(e) => { e.stopPropagation(); handleApproveAdmin(reg); }} 
                                                            disabled={(approving && processingId === reg.id) || systemUser?.auth_level !== 1} 
                                                            title={systemUser?.auth_level !== 1 ? "Super Admin Clearance Required" : "Approve Request"}
                                                        >
                                                            {approving && processingId === reg.id ? <FiLoader className="animate-spin" /> : <FiCheckCircle size={18} />}
                                                        </button>
                                                        <button 
                                                            className="action-circle reject" 
                                                            onClick={(e) => { e.stopPropagation(); setRejectingId(reg.id); }} 
                                                            disabled={approving && processingId === reg.id}
                                                            title="Reject Request"
                                                        >
                                                            <FiXCircle size={18} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="flex justify-end pr-4">
                                                <button className="action-circle view" title="View Details">
                                                    <FiExternalLink size={16} />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={7} className="py-24 text-center">
                                    <div className="flex flex-col items-center opacity-30">
                                        <FiDatabase size={40} className="mb-4" />
                                        <p className="text-xs font-bold uppercase tracking-widest">No procurement records found.</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <TablePagination 
                currentPage={currentPage}
                totalItems={filteredAdmins.length}
                pageSize={itemsPerPage}
                onPageChange={setCurrentPage}
            />
        </div>
      </div>
  );

  if (isHubView) return content;
  return <Layout>{content}</Layout>;
};

export default PendingRegistrations;
