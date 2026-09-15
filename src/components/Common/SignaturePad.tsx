import React, { useRef, useState, useEffect } from 'react';
import { FiDelete, FiCheck, FiPenTool, FiShield } from 'react-icons/fi';

interface SignaturePadProps {
    onSave: (signatureDataUrl: string) => void;
    onClear?: () => void;
    height?: number;
    placeholder?: string;
}

export const SignaturePad: React.FC<SignaturePadProps> = ({ 
    onSave, 
    onClear, 
    height = 150,
    placeholder = "Sign here to witness delivery..." 
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawingRef = useRef(false);
    const [isDrawing, setIsDrawing] = useState(false);
    const [isEmpty, setIsEmpty] = useState(true);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set high DPI support
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        
        ctx.strokeStyle = '#6366f1'; // Indigo (Premium)
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }, []);

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        isDrawingRef.current = true;
        setIsDrawing(true);
        setIsEmpty(false);
        draw(e);
    };

    const stopDrawing = () => {
        isDrawingRef.current = false;
        setIsDrawing(false);
        const canvas = canvasRef.current;
        if (canvas) {
            onSave(canvas.toDataURL('image/png'));
        }
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawingRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;

        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        if (e.type === 'mousedown' || e.type === 'touchstart') {
            ctx.beginPath();
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
            ctx.stroke();
        }
    };

    const clear = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            setIsEmpty(true);
            if (onClear) onClear();
            onSave(''); // Clear the saved signature
        }
    };

    return (
        <div className="signature-pad-container flex flex-col gap-3 bg-white border border-slate-200 rounded-xl p-4 shadow-sm relative overflow-hidden">
            {/* Decorative top border */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
            
            {/* Header section with premium styling */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-6 h-6 rounded-md bg-indigo-50 border border-indigo-100 text-indigo-500">
                        <FiPenTool size={12} />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Digital Witness Handshake</span>
                </div>
                <button 
                    type="button" 
                    onClick={clear}
                    className="flex items-center gap-1.5 text-[10px] font-bold text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 px-2 py-1 rounded transition-colors uppercase"
                >
                    <FiDelete size={12} /> Clear
                </button>
            </div>
            
            {/* Signature Canvas Area */}
            <div 
                className={`relative rounded-xl bg-slate-50/50 overflow-hidden group transition-all duration-300
                    ${isEmpty ? 'border-2 border-dashed border-slate-300 hover:border-indigo-300 hover:bg-indigo-50/30' : 'border-2 border-solid border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.15)] bg-white'}`}
            >
                {/* Visual signature baseline */}
                <div className="absolute left-6 right-6 bottom-8 border-b-2 border-slate-200 border-dotted pointer-events-none opacity-60"></div>
                
                <canvas
                    ref={canvasRef}
                    height={height}
                    className="w-full cursor-crosshair touch-none relative z-10"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                />
                
                {isEmpty && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-50 z-0">
                        <span className="text-slate-400 text-[13px] font-medium tracking-wide">{placeholder}</span>
                    </div>
                )}
                
                {!isEmpty && !isDrawing && (
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-emerald-500 text-white px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm border border-emerald-600 animate-in fade-in slide-in-from-top-2 z-20">
                        <FiCheck size={12} strokeWidth={3} /> Captured
                    </div>
                )}
            </div>

            {/* Legal Disclaimer Box */}
            <div className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <FiShield className="text-indigo-500 shrink-0 mt-0.5" size={14} />
                <p className="text-[10px] text-slate-500 leading-snug m-0">
                    <span className="font-semibold text-slate-700">Legal Acknowledgment:</span> By signing, you confirm that the measured ATG volume matches or has been reconciled against the provided Bill of Lading.
                </p>
            </div>
        </div>
    );
};
