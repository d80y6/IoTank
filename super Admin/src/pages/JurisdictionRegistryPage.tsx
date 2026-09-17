import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPlus, FiEdit, FiTrash2, FiRefreshCw, FiGlobe, FiDollarSign, FiSettings, FiAlertTriangle, FiShield, FiCheckCircle, FiX, FiExternalLink } from 'react-icons/fi';
import { listJurisdictions, createJurisdiction, updateJurisdiction, deleteJurisdiction, CreateJurisdictionInput, UpdateJurisdictionInput } from '../services/jurisdictionsService';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../config/supabase';
import Layout from '../components/Layout';
import './JurisdictionRegistry.css';

const JurisdictionRegistryPage: React.FC = () => {
  const { systemUser } = useAuth();
  const navigate = useNavigate();
  const [jurisdictions, setJurisdictions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingJurisdiction, setEditingJurisdiction] = useState<any | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [configRows, setConfigRows] = useState<any[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [configCode, setConfigCode] = useState('');
  const [configKey, setConfigKey] = useState('');
  const [configValue, setConfigValue] = useState('{}');
  const [configSaving, setConfigSaving] = useState(false);
  const [formData, setFormData] = useState<CreateJurisdictionInput>({
    code: '',
    name: '',
    currency: 'USD',
    currency_symbol: '$',
    locale: 'en',
    timezone: 'UTC',
    phone_prefix: '+1',
    regulatory_body: null,
    country_code: 'US',
    is_active: true,
    is_global: false,
    config: {},
  });

  const loadJurisdictions = async () => {
    try {
      setLoading(true);
      const data = await listJurisdictions();
      setJurisdictions(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load jurisdictions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJurisdictions();
  }, []);

  const loadConfigRows = async () => {
    setConfigLoading(true);
    try {
      const { data, error } = await supabase
        .from('jurisdiction_configs')
        .select('*')
        .order('jurisdiction_code', { ascending: true })
        .order('config_key', { ascending: true });
      if (error) throw error;
      setConfigRows(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load jurisdiction configs');
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    loadConfigRows();
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configCode || !configKey) return;
    setConfigSaving(true);
    try {
      let parsed: unknown = {};
      try { parsed = JSON.parse(configValue); } catch { throw new Error('Config value must be valid JSON'); }
      const { error } = await supabase
        .from('jurisdiction_configs')
        .upsert(
          { jurisdiction_code: configCode, config_key: configKey, config_value: parsed, is_active: true, updated_at: new Date().toISOString() },
          { onConflict: 'jurisdiction_code,config_key' }
        );
      if (error) throw error;
      setShowConfigForm(false);
      setConfigKey('');
      setConfigValue('{}');
      loadConfigRows();
    } catch (err: any) {
      alert(err.message || 'Failed to save config row');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleToggleConfig = async (row: any) => {
    try {
      const { error } = await supabase
        .from('jurisdiction_configs')
        .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) throw error;
      loadConfigRows();
    } catch (err: any) {
      alert(err.message || 'Toggle failed');
    }
  };

  const handleDeleteConfig = async (row: any) => {
    if (!window.confirm(`Delete config "${row.config_key}" for ${row.jurisdiction_code}?`)) return;
    try {
      const { error } = await supabase.from('jurisdiction_configs').delete().eq('id', row.id);
      if (error) throw error;
      loadConfigRows();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingJurisdiction) {
        await updateJurisdiction({ ...formData, code: editingJurisdiction.code });
      } else {
        await createJurisdiction(formData);
      }
      setShowModal(false);
      setEditingJurisdiction(null);
      resetForm();
      loadJurisdictions();
    } catch (err: any) {
      alert(err.message || 'Operation failed');
    }
  };

  const handleEdit = (jurisdiction: any) => {
    setEditingJurisdiction(jurisdiction);
    setFormData({
      code: jurisdiction.code,
      name: jurisdiction.name,
      currency: jurisdiction.currency,
      currency_symbol: jurisdiction.currency_symbol,
      locale: jurisdiction.locale,
      timezone: jurisdiction.timezone,
      phone_prefix: jurisdiction.phone_prefix,
      regulatory_body: jurisdiction.regulatory_body,
      country_code: jurisdiction.country_code,
      is_active: jurisdiction.is_active,
      is_global: jurisdiction.is_global,
      config: jurisdiction.config,
    });
    setShowModal(true);
  };

  const handleDelete = async () => {
    if (!deletingCode) return;
    try {
      await deleteJurisdiction(deletingCode);
      setDeletingCode(null);
      loadJurisdictions();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  const resetForm = () => {
    setFormData({
      code: '',
      name: '',
      currency: 'USD',
      currency_symbol: '$',
      locale: 'en',
      timezone: 'UTC',
      phone_prefix: '+1',
      regulatory_body: null,
      country_code: 'US',
      is_active: true,
      is_global: false,
      config: {},
    });
  };

  const openCreateModal = () => {
    resetForm();
    setEditingJurisdiction(null);
    setShowModal(true);
  };

  const confirmDelete = (code: string) => {
    if (window.confirm('Delete this jurisdiction? This action cannot be undone.')) {
      setDeletingCode(code);
      handleDelete();
    }
  };

  const formatConfig = (config: Record<string, unknown> | null) => {
    if (!config || Object.keys(config).length === 0) return '{}';
    return JSON.stringify(config, null, 2);
  };

  return (
    <Layout>
    <div className="jurisdiction-registry-page">
      <header className="page-header">
        <div className="header-content">
          <div className="header-icon"><FiGlobe className="text-cyan" size={24} /></div>
          <div>
            <h1 className="page-title">Jurisdiction Registry</h1>
            <p className="page-subtitle">Manage global regulatory jurisdictions, currencies, and localization settings</p>
          </div>
        </div>
        <button className="btn-primary" onClick={openCreateModal}>
          <FiPlus /> Add Jurisdiction
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="table-container">
        {loading ? (
          <div className="loading-state">
            <FiRefreshCw className="animate-spin" size={24} />
            <span>Loading jurisdictions...</span>
          </div>
        ) : (
          <table className="jurisdiction-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Regulatory Body</th>
                <th>Currency</th>
                <th>Locale</th>
                <th>Phone Prefix</th>
                <th>Status</th>
                <th>Type</th>
                <th>Config</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jurisdictions.map((j) => (
                <tr key={j.code}>
                  <td className="code-cell">{j.code}</td>
                  <td className="name-cell">{j.name}</td>
                  <td>{j.regulatory_body || <span className="text-muted">—</span>}</td>
                  <td>{j.currency_symbol} {j.currency}</td>
                  <td>{j.locale}</td>
                  <td>{j.phone_prefix}</td>
                  <td>
                    <span className={`status-badge ${j.is_active ? 'active' : 'inactive'}`}>
                      {j.is_active ? <FiCheckCircle size={12} /> : <FiX size={12} />}
                      {j.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <span className={`type-badge ${j.is_global ? 'global' : 'regional'}`}>
                      {j.is_global ? <FiGlobe size={12} /> : <FiShield size={12} />}
                      {j.is_global ? 'Global' : 'Regional'}
                    </span>
                  </td>
                  <td className="config-cell">
                    <pre className="config-preview">{formatConfig(j.config)}</pre>
                  </td>
                  <td className="actions-cell">
                    <button className="icon-btn edit" onClick={() => handleEdit(j)} title="Edit">
                      <FiEdit />
                    </button>
                    <button className="icon-btn delete" onClick={() => confirmDelete(j.code)} title="Delete" disabled={j.is_global}>
                      <FiTrash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Row-level config overrides (jurisdiction_configs) */}
      <div className="table-container" style={{ marginTop: '32px' }}>
        <div className="page-header" style={{ marginBottom: '16px' }}>
          <div className="header-content">
            <div className="header-icon"><FiSettings className="text-cyan" size={20} /></div>
            <div>
              <h2 className="page-title" style={{ fontSize: '18px' }}>Configuration Overrides</h2>
              <p className="page-subtitle">Key/value runtime config applied per jurisdiction (e.g. data_smoothing_url, pricing)</p>
            </div>
          </div>
          <button className="btn-primary" onClick={() => setShowConfigForm(!showConfigForm)}>
            <FiPlus /> Add Override
          </button>
        </div>

        {showConfigForm && (
          <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', padding: '16px', borderBottom: '1px solid var(--border-color, #eee)' }}>
            <div className="form-group" style={{ minWidth: '140px' }}>
              <label>Jurisdiction</label>
              <select value={configCode} onChange={(e) => setConfigCode(e.target.value)} required>
                <option value="">Select…</option>
                {jurisdictions.map(j => <option key={j.code} value={j.code}>{j.code} — {j.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ minWidth: '180px' }}>
              <label>Config Key</label>
              <input type="text" value={configKey} onChange={(e) => setConfigKey(e.target.value)} placeholder="e.g. data_smoothing_url" required />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: '220px' }}>
              <label>Value (JSON)</label>
              <input type="text" value={configValue} onChange={(e) => setConfigValue(e.target.value)} placeholder='{"url": "https://…"}' />
            </div>
            <button type="submit" className="btn-primary" disabled={configSaving}>
              {configSaving ? 'Saving…' : 'Save Override'}
            </button>
          </form>
        )}

        {configLoading ? (
          <div className="loading-state">
            <FiRefreshCw className="animate-spin" size={20} />
            <span>Loading config overrides...</span>
          </div>
        ) : (
          <table className="jurisdiction-table">
            <thead>
              <tr>
                <th>Jurisdiction</th>
                <th>Config Key</th>
                <th>Value</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {configRows.map((row) => (
                <tr key={row.id}>
                  <td className="code-cell">{row.jurisdiction_code}</td>
                  <td className="name-cell">{row.config_key}</td>
                  <td className="config-cell"><pre className="config-preview">{JSON.stringify(row.config_value, null, 2)}</pre></td>
                  <td>
                    <span className={`status-badge ${row.is_active ? 'active' : 'inactive'}`}>
                      {row.is_active ? <FiCheckCircle size={12} /> : <FiX size={12} />}
                      {row.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</td>
                  <td className="actions-cell">
                    <button className="icon-btn edit" onClick={() => handleToggleConfig(row)} title={row.is_active ? 'Deactivate' : 'Activate'}>
                      {row.is_active ? <FiX /> : <FiCheckCircle />}
                    </button>
                    <button className="icon-btn delete" onClick={() => handleDeleteConfig(row)} title="Delete">
                      <FiTrash2 />
                    </button>
                  </td>
                </tr>
              ))}
              {configRows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '32px', opacity: 0.5 }}>No configuration overrides defined</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setEditingJurisdiction(null); resetForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingJurisdiction ? 'Edit Jurisdiction' : 'Create Jurisdiction'}</h2>
              <button className="modal-close" onClick={() => { setShowModal(false); setEditingJurisdiction(null); resetForm(); }}>
                <FiX />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group">
                    <label>Code <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      placeholder="e.g., KE, NG, ZA, US"
                      maxLength={4}
                      disabled={!!editingJurisdiction}
                    />
                  </div>
                  <div className="form-group">
                    <label>Name <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Kenya, Nigeria, Global Default"
                    />
                  </div>
                  <div className="form-group">
                    <label>Regulatory Body</label>
                    <input
                      type="text"
                      value={formData.regulatory_body || ''}
                      onChange={(e) => setFormData({ ...formData, regulatory_body: e.target.value || null })}
                      placeholder="e.g., EPRA, NMDPRA"
                    />
                  </div>
                  <div className="form-group">
                    <label>Country Code <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.country_code}
                      onChange={(e) => setFormData({ ...formData, country_code: e.target.value.toUpperCase() })}
                      placeholder="e.g., KE, NG, US"
                      maxLength={2}
                    />
                  </div>
                  <div className="form-group">
                    <label>Currency <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.currency}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value.toUpperCase() })}
                      placeholder="e.g., USD, KES, NGN"
                      maxLength={3}
                    />
                  </div>
                  <div className="form-group">
                    <label>Currency Symbol <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.currency_symbol}
                      onChange={(e) => setFormData({ ...formData, currency_symbol: e.target.value })}
                      placeholder="e.g., $, Ksh, ₦"
                      maxLength={4}
                    />
                  </div>
                  <div className="form-group">
                    <label>Locale <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.locale}
                      onChange={(e) => setFormData({ ...formData, locale: e.target.value })}
                      placeholder="e.g., en, en-KE, sw"
                    />
                  </div>
                  <div className="form-group">
                    <label>Timezone <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.timezone}
                      onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                      placeholder="e.g., UTC, Africa/Nairobi"
                    />
                  </div>
                  <div className="form-group">
                    <label>Phone Prefix <span className="required">*</span></label>
                    <input
                      type="text"
                      value={formData.phone_prefix}
                      onChange={(e) => setFormData({ ...formData, phone_prefix: e.target.value })}
                      placeholder="e.g., +1, +254, +234"
                    />
                  </div>
                  <div className="form-group checkbox-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      />
                      Active
                    </label>
                  </div>
                  <div className="form-group checkbox-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={formData.is_global}
                        onChange={(e) => setFormData({ ...formData, is_global: e.target.checked })}
                      />
                      Global Default
                    </label>
                  </div>
                  <div className="form-group full-width">
                    <label>Config (JSON)</label>
                    <textarea
                      value={formData.config ? JSON.stringify(formData.config, null, 2) : ''}
                      onChange={(e) => {
                        try {
                          setFormData({ ...formData, config: JSON.parse(e.target.value) || {} });
                        } catch {
                          setFormData({ ...formData, config: {} });
                        }
                      }}
                      rows={6}
                      placeholder='{ "regulatory": { "adapter": "epra", "body": "EPRA" }, "pricing": { "superPetrol": 190.84, "diesel": 170.19 } }'
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setEditingJurisdiction(null); resetForm(); }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingJurisdiction ? 'Save Changes' : 'Create Jurisdiction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </Layout>
  );
};

export default JurisdictionRegistryPage;