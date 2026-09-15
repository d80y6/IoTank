/* src/components/Common/ImageCropperModal.tsx */
import React, { useState, useCallback } from 'react';
import Cropper, { Point, Area } from 'react-easy-crop';
import { motion, AnimatePresence } from 'framer-motion';
import { FiX, FiCheck, FiRefreshCw } from 'react-icons/fi';
import { logger } from '@/utils/logger';
import './ImageCropperModal.css';

interface ImageCropperModalProps {
    image: string;
    cropShape?: 'rect' | 'round';
    aspect?: number;
    title?: string;
    subtitle?: string;
    onCropComplete: (croppedBlob: Blob) => void;
    onCancel: () => void;
}

export const ImageCropperModal: React.FC<ImageCropperModalProps> = ({
    image,
    cropShape = 'round',
    aspect = 1,
    title = 'Crop Image',
    subtitle = 'Adjust the frame to your liking.',
    onCropComplete,
    onCancel
}) => {
    const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [cropObjectFit, setCropObjectFit] = useState<'cover' | 'contain'>('cover');

    const onCropChange = (crop: Point) => {
        setCrop(crop);
    };

    const onZoomChange = (zoom: number) => {
        setZoom(zoom);
    };

    const onRotationChange = (rotation: number) => {
        setRotation(rotation);
    };

    const onCropCompleteInternal = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
        setCroppedAreaPixels(croppedAreaPixels);
    }, []);

    const createImage = (url: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
            const image = new Image();
            image.addEventListener('load', () => resolve(image));
            image.addEventListener('error', (error) => reject(error));
            image.setAttribute('crossOrigin', 'anonymous');
            image.src = url;
        });

    const getCroppedImg = async (
        imageSrc: string,
        pixelCrop: Area,
        rotation = 0,
        objectFit: 'cover' | 'contain' = 'cover'
    ): Promise<Blob> => {
        const image = await createImage(imageSrc);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            throw new Error('No 2d context');
        }

        const targetSize = 512; // High-quality industrial target
        canvas.width = targetSize;
        canvas.height = targetSize;

        // White background for 'contain' mode (padding)
        if (objectFit === 'contain') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, targetSize, targetSize);
        }

        // Move to center of canvas for rotation and drawing
        ctx.translate(targetSize / 2, targetSize / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-targetSize / 2, -targetSize / 2);

        ctx.drawImage(
            image,
            pixelCrop.x,
            pixelCrop.y,
            pixelCrop.width,
            pixelCrop.height,
            0,
            0,
            targetSize,
            targetSize
        );

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Canvas toBlob failed'));
                }
            }, 'image/jpeg', 0.95);
        });
    };

    const handleConfirm = async () => {
        if (!croppedAreaPixels) return;
        setIsProcessing(true);
        try {
            const croppedBlob = await getCroppedImg(image, croppedAreaPixels, rotation, cropObjectFit);
            onCropComplete(croppedBlob);
        } catch (e) {
            logger.error('Image crop failed', e);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Crop Failed',
                    message: 'Failed to process image crop.',
                    type: 'error',
                    attribution: 'IMAGE PROCESSOR'
                }
            }));
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <AnimatePresence>
            <motion.div 
                className="cropper-modal-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            >
                <motion.div 
                    className="cropper-modal-container"
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                >
                    <div className="cropper-modal-header">
                        <div>
                            <h3>{title}</h3>
                            <p>{subtitle}</p>
                        </div>
                        <button 
                            className="btn-cropper-close" 
                            onClick={onCancel}
                            title="Close Cropper"
                        >
                            <FiX size={22} />
                        </button>
                    </div>

                    <div className="cropper-viewport-container">
                        <Cropper
                            image={image}
                            crop={crop}
                            zoom={zoom}
                            rotation={rotation}
                            aspect={aspect}
                            cropShape={cropShape}
                            showGrid={true}
                            objectFit={cropObjectFit}
                            onCropChange={onCropChange}
                            onCropComplete={onCropCompleteInternal}
                            onZoomChange={onZoomChange}
                            onRotationChange={onRotationChange}
                        />
                    </div>

                    <div className="cropper-modal-controls">
                        <div className="cropper-controls-row">
                            <div className="control-group flex-1">
                                <div className="flex justify-between items-center">
                                    <label className="control-label uppercase">Optical Zoom</label>
                                    <span className="control-badge">{Math.round(zoom * 100)}%</span>
                                </div>
                                <div className="slider-container">
                                    <input
                                        type="range"
                                        value={zoom}
                                        min={1}
                                        max={3}
                                        step={0.1}
                                        aria-labelledby="Zoom"
                                        title="Adjust Zoom Level"
                                        className="cropper-slider"
                                        onChange={(e) => onZoomChange(Number(e.target.value))}
                                    />
                                </div>
                            </div>

                            <div className="control-group flex-1">
                                <div className="flex justify-between items-center">
                                    <label className="control-label uppercase">Orientation</label>
                                    <span className="control-badge">{rotation}°</span>
                                </div>
                                <div className="slider-container">
                                    <input
                                        type="range"
                                        value={rotation}
                                        min={0}
                                        max={360}
                                        step={1}
                                        aria-labelledby="Rotation"
                                        title="Adjust Rotation Angle"
                                        className="cropper-slider"
                                        onChange={(e) => onRotationChange(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="control-group">
                            <label className="control-label uppercase">Framing Methodology</label>
                            <div className="mode-toggle">
                                <button 
                                    className={`mode-btn ${cropObjectFit === 'cover' ? 'active' : ''}`}
                                    onClick={() => setCropObjectFit('cover')}
                                    title="Automatic dynamic crop to fill square"
                                >
                                    Fill (Crop to Fit)
                                </button>
                                <button 
                                    className={`mode-btn ${cropObjectFit === 'contain' ? 'active' : ''}`}
                                    onClick={() => setCropObjectFit('contain')}
                                    title="Add padding to preserve original composition"
                                >
                                    Contain (Pad to Fit)
                                </button>
                            </div>
                        </div>

                        <div className="cropper-modal-footer">
                            <button className="btn-cancel" onClick={onCancel} disabled={isProcessing}>
                                Cancel
                            </button>
                            <button className="btn-save flex items-center justify-center gap-2" onClick={handleConfirm} disabled={isProcessing}>
                                {isProcessing ? (
                                    <>
                                        <FiRefreshCw className="animate-spin" /> Processing...
                                    </>
                                ) : (
                                    <>
                                        <FiCheck size={18} /> Confirm Selection
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
