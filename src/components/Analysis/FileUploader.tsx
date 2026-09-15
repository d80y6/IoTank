import React, { useState } from 'react';
import { FiUploadCloud, FiLoader, FiAlertCircle } from 'react-icons/fi';
import classNames from 'classnames';

interface FileUploaderProps {
    isUploading: boolean;
    uploadProgress: number;
    error: string | null;
    onUploadStarted: (file: File) => void;
}

const FileUploader: React.FC<FileUploaderProps> = ({
    isUploading,
    uploadProgress,
    error,
    onUploadStarted
}) => {
    const [dragActive, setDragActive] = useState(false);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleFile = (file: File) => {
        const type = file.name.split('.').pop()?.toLowerCase();
        if (type !== 'csv' && type !== 'pdf') {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Invalid File',
                    message: 'Only CSV and PDF files are supported',
                    type: 'error',
                    attribution: 'FILE UPLOADER'
                }
            }));
            return;
        }

        if (file.size > 100 * 1024 * 1024) { // 100MB
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'File Too Large',
                    message: 'File size exceeds 100MB limit',
                    type: 'error',
                    attribution: 'FILE UPLOADER'
                }
            }));
            return;
        }

        onUploadStarted(file);
    };

    return (
        <div className="w-full max-w-xl mx-auto">
            <form
                onDragEnter={handleDrag}
                className={classNames(
                    "relative p-8 border-2 border-dashed rounded-xl transition-all duration-300 flex flex-col items-center justify-center min-h-[250px]",
                    dragActive ? "border-primary bg-primary/5 scale-[1.02]" : "border-slate-700 bg-slate-900/50",
                    isUploading ? "opacity-50 pointer-events-none" : "hover:border-primary/50"
                )}
            >
                <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    accept=".csv,.pdf"
                    onChange={handleChange}
                    disabled={isUploading}
                />

                <div className="flex flex-col items-center text-center space-y-4">
                    {isUploading ? (
                        <div className="space-y-4 w-full px-8">
                            <FiLoader className="w-12 h-12 text-primary animate-spin mx-auto" />
                            <div className="w-full bg-slate-800 rounded-full h-2.5">
                                <div
                                    className="bg-primary h-2.5 rounded-full transition-all duration-300"
                                    style={{ width: `${uploadProgress}%` }}
                                ></div>
                            </div>
                            <p className="text-slate-400 text-sm">Uploading... {Math.round(uploadProgress)}%</p>
                        </div>
                    ) : (
                        <>
                            <div className="p-4 bg-primary/10 rounded-full">
                                <FiUploadCloud className="w-10 h-10 text-primary" />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-white">Upload industrial document</h3>
                                <p className="text-slate-400 text-sm mt-1">
                                    Drag and drop your CSV or PDF file here, or click to browse
                                </p>
                            </div>
                            <label
                                htmlFor="file-upload"
                                className="px-8 py-3 bg-primary hover:bg-primary-dark text-white rounded-lg font-bold cursor-pointer transition-all shadow-lg shadow-primary/20 border border-primary/50 hover:scale-[1.02] active:scale-[0.98]"
                            >
                                Select File
                            </label>
                            <p className="text-xs text-slate-500">
                                Max file size: 100MB (Gemini Optimized)
                            </p>
                        </>
                    )}
                </div>

                {dragActive && (
                    <div
                        className="absolute inset-0 z-10 w-full h-full"
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                    ></div>
                )}
            </form>

            {error && (
                <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-400">
                    <FiAlertCircle className="shrink-0" />
                    <span className="text-sm">{error}</span>
                </div>
            )}
        </div>
    );
};

export default FileUploader;
