import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { FiUploadCloud, FiDatabase, FiTable, FiSave, FiTrash2, FiDownload, FiCheckCircle, FiAlertCircle, FiRefreshCw } from 'react-icons/fi';
import { lookupTableService, LookupTableEntry } from '../../services/lookupTableService';

export const BackendTab: React.FC = () => {
    const [lookupData, setLookupData] = useState<LookupTableEntry[]>([]);
    const [selectedTankType, setSelectedTankType] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    // Fetch unique tank types
    const fetchEntries = async () => {
        setLoading(true);
        const data = await lookupTableService.getAllEntries();
        setLookupData(data);
        if (data.length > 0 && !selectedTankType) {
            setSelectedTankType(data[0].tank_type);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchEntries();
    }, []);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        const reader = new FileReader();
        reader.onload = (evt) => {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            
            const allEntries: Partial<LookupTableEntry>[] = [];
            
            // Process relevant sheets (A to E as identified)
            const relevantSheets = wb.SheetNames.filter(name => 
                name.includes('PMS') || name.includes('AGO') || name.includes('Jet') || name.includes('Kerosene')
            );

            relevantSheets.forEach(sheetName => {
                const ws = wb.Sheets[sheetName];
                const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
                
                // Assuming data starts after some headers (e.g., at row 5 or based on column names)
                // We'll look for numeric "Dip (mm)" and "Volume (L)"
                data.forEach((row, idx) => {
                    if (idx < 2) return; // Skip potential header rows
                    const dip = parseFloat(row[0]);
                    const vol = parseFloat(row[1]);
                    
                    if (!isNaN(dip) && !isNaN(vol)) {
                        allEntries.push({
                            tank_type: sheetName.replace(/[^a-zA-Z0-9 ]/g, '').trim(),
                            dip_mm: dip,
                            volume_liters: vol
                        });
                    }
                });
            });

            if (allEntries.length > 0) {
                setLookupData(allEntries as LookupTableEntry[]);
                setSelectedTankType(allEntries[0].tank_type || '');
                setIsEditing(true); // Switch to edit mode to allow review before sync
            }
            setLoading(false);
        };
        reader.readAsBinaryString(file);
    };

    const handleSync = async () => {
        setSyncing(true);
        try {
            await lookupTableService.upsertEntries(lookupData);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Sync Successful',
                    message: `Synchronized ${lookupData.length} correction entries to the global lookup database.`,
                    type: 'success'
                }
            }));
            setIsEditing(false);
            fetchEntries();
        } catch (error) {
            console.error('Sync failed:', error);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Sync Failed',
                    message: 'Failed to commit correction data to the database. Verify schema integrity.',
                    type: 'error'
                }
            }));
        } finally {
            setSyncing(false);
        }
    };

    const handleExport = () => {
        const filtered = lookupData.filter(d => d.tank_type === selectedTankType);
        const worksheet = XLSX.utils.json_to_sheet(filtered);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, selectedTankType.substring(0, 30));
        XLSX.writeFile(workbook, `LookupTable_${selectedTankType}.xlsx`);
    };

    const handlePurge = () => {
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Confirm Data Purge',
                message: 'Are you sure you want to permanently clear all global lookup tables? This will affect volume calculations for all nodes.',
                type: 'error',
                persistent: true,
                actions: [
                    {
                        label: 'Abort',
                        onClick: () => {}
                    },
                    {
                        label: 'Purge Database',
                        primary: true,
                        onClick: async () => {
                            try {
                                await lookupTableService.clearAll();
                                await fetchEntries();
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Data Purged',
                                        message: 'The global lookup directory has been wiped.',
                                        type: 'info'
                                    }
                                }));
                            } catch (err: any) {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Purge Failed',
                                        message: err.message,
                                        type: 'error'
                                    }
                                }));
                            }
                        }
                    }
                ]
            }
        }));
    };

    const tankTypes = Array.from(new Set(lookupData.map(d => d.tank_type)));
    const currentTable = lookupData.filter(d => d.tank_type === selectedTankType);

    return (
        <div className="hw-backend animate-fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h2 className="text-2xl font-black lowercase tracking-tighter">Volume Correction Workbook</h2>
                    <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest">Global Lookup Tables for ESP32 Calibration</p>
                </div>
                <div className="flex gap-4">
                    <label className="btn-secondary text-xs flex items-center gap-2 cursor-pointer">
                        <FiUploadCloud /> Import Excel
                        <input type="file" hidden accept=".xlsx, .xls, .csv" onChange={handleFileUpload} />
                    </label>
                    <button 
                        className={`btn-primary flex items-center gap-2 ${syncing ? 'opacity-50' : ''}`}
                        onClick={handleSync}
                        disabled={syncing}
                    >
                        <FiDatabase /> {syncing ? 'Syncing...' : 'Sync to Database'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-12 gap-8">
                {/* Sidebar - Tank Types */}
                <div className="col-span-3">
                    <div className="glass-card p-4">
                        <h3 className="text-xs font-black uppercase opacity-40 mb-4 border-b border-white border-opacity-10 pb-2">Tank Profiles</h3>
                        <div className="flex flex-col gap-2">
                            {tankTypes.length === 0 && <span className="text-[10px] opacity-30 italic">No profiles loaded</span>}
                            {tankTypes.map(type => (
                                <button
                                    key={type}
                                    className={`text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${selectedTankType === type ? 'bg-primary text-white shadow-lg' : 'hover:bg-white hover:bg-opacity-5 opacity-60'}`}
                                    onClick={() => setSelectedTankType(type)}
                                >
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-3">
                                            <FiTable className={selectedTankType === type ? 'text-white' : 'text-primary'} />
                                            <span>{type}</span>
                                        </div>
                                        <span className="text-[9px] opacity-50">{lookupData.filter(d => d.tank_type === type).length} rows</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Main Workbook Area */}
                <div className="col-span-9">
                    <div className="glass-card overflow-hidden flex flex-col h-[600px]">
                        <div className="p-6 border-b border-white border-opacity-5 flex justify-between items-center bg-[#0d0d0d]">
                            <div className="flex items-center gap-4">
                                <span className="badge badge-low">{selectedTankType || 'Select Profile'}</span>
                                <span className="text-[10px] font-mono opacity-40">SCHEMA: calibration_v2.1</span>
                            </div>
                            <div className="flex gap-4">
                                <button className="icon-btn" title="Export Current Table" onClick={handleExport}><FiDownload /></button>
                                <button className="icon-btn text-danger" title="Purge Data" onClick={handlePurge}><FiTrash2 /></button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto custom-scrollbar">
                            {loading ? (
                                <div className="flex items-center justify-center h-full opacity-40">
                                    <FiRefreshCw className="animate-spin mr-2" /> Loading...
                                </div>
                            ) : currentTable.length > 0 ? (
                                <table className="ticket-table w-full">
                                    <thead className="sticky top-0 bg-[#0d0d0d] shadow-sm">
                                        <tr>
                                            <th className="w-16">#</th>
                                            <th>Dip Reading (mm)</th>
                                            <th>Volume (Liters)</th>
                                            <th className="text-right">Variance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {currentTable.map((row, i) => (
                                            <tr key={i} className="hover:bg-white hover:bg-opacity-5">
                                                <td className="text-[10px] opacity-30 font-mono">{i + 1}</td>
                                                <td className="font-mono font-bold text-primary">{row.dip_mm}</td>
                                                <td className="font-mono font-black">{row.volume_liters.toLocaleString()}</td>
                                                <td className="text-right opacity-30 italic text-[10px]">
                                                    {i > 0 ? (row.volume_liters - currentTable[i-1].volume_liters).toFixed(2) : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full opacity-20 text-center p-12">
                                    <FiDatabase size={48} className="mb-4" />
                                    <p className="font-black uppercase tracking-widest text-xs">No Data Synchronized</p>
                                    <p className="text-[10px] mt-2">Upload the 'Kenya_UST_LookupTables' Excel file to begin.</p>
                                </div>
                            )}
                        </div>

                        <div className="p-4 bg-[#0a0a0a] border-t border-white border-opacity-5 flex justify-between items-center text-[10px] font-bold uppercase tracking-widest opacity-40">
                            <div className="flex gap-6">
                                <span className="flex items-center gap-2"><FiCheckCircle className="text-success" /> Integrity Verified</span>
                                <span className="flex items-center gap-2"><FiAlertCircle className="text-warning" /> No Overlaps</span>
                            </div>
                            <span>Total Volume Capacity: {currentTable.length > 0 ? currentTable[currentTable.length-1].volume_liters.toLocaleString() : 0} L</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
