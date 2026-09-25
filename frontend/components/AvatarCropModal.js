import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import BaseModal from './ui/BaseModal';
import { ZoomIn, ZoomOut, RotateCw, Check, X } from 'lucide-react';

/**
 * LinkedIn-style circular avatar crop modal.
 * User can pan, zoom, and rotate their photo before uploading.
 */
export default function AvatarCropModal({ isOpen, onClose, imageSrc, onCropComplete }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [saving, setSaving] = useState(false);

  const onCropChange = useCallback((c) => setCrop(c), []);
  const onZoomChange = useCallback((z) => setZoom(z), []);

  const handleCropComplete = useCallback((_, croppedPixels) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels || !imageSrc || saving) return;
    setSaving(true);

    try {
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels, rotation);
      onCropComplete(croppedBlob);
      resetAndClose();
    } catch (err) {
      console.error('[AVATAR] Crop failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const resetAndClose = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setCroppedAreaPixels(null);
    onClose();
  };

  return (
    <BaseModal isOpen={isOpen} onClose={resetAndClose} maxWidth="max-w-md" showCloseButton={false}>
      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Edit photo</h3>
          <button
            onClick={resetAndClose}
            className="p-1.5 text-surface-400 hover:text-white hover:bg-surface-800 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Crop area */}
        <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-black" role="img" aria-label="Crop preview">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={onCropChange}
              onZoomChange={onZoomChange}
              onCropComplete={handleCropComplete}
              style={{
                containerStyle: { borderRadius: '0.75rem' },
                cropAreaStyle: {
                  border: '3px solid rgba(255, 255, 255, 0.8)',
                  boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
                },
              }}
            />
          )}
        </div>

        {/* Zoom slider */}
        <div className="flex items-center gap-3 mt-4 px-1">
          <ZoomOut className="h-4 w-4 text-surface-400 flex-shrink-0" aria-hidden="true" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="w-full h-1.5 bg-surface-700 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:border-0
              [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0"
          />
          <ZoomIn className="h-4 w-4 text-surface-400 flex-shrink-0" aria-hidden="true" />
        </div>

        {/* Rotate button */}
        <div className="flex justify-center mt-3">
          <button
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-surface-400 hover:text-white hover:bg-surface-800 rounded-lg transition-colors"
            aria-label="Rotate image 90 degrees"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Rotate
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mt-5">
          <button
            onClick={resetAndClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-surface-300 bg-surface-800 hover:bg-surface-700 border border-surface-600 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {saving ? 'Applying...' : 'Apply'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

/**
 * Creates a cropped image blob from the source image and crop area.
 * Uses a two-canvas approach: one for rotation, one for extraction.
 */
function getCroppedImg(imageSrc, pixelCrop, rotation = 0) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      // Canvas 1: draw the rotated full image
      const rotCanvas = document.createElement('canvas');
      const rotCtx = rotCanvas.getContext('2d');

      const radians = (rotation * Math.PI) / 180;
      const sin = Math.abs(Math.sin(radians));
      const cos = Math.abs(Math.cos(radians));
      const bBoxWidth = Math.floor(image.width * cos + image.height * sin);
      const bBoxHeight = Math.floor(image.width * sin + image.height * cos);

      rotCanvas.width = bBoxWidth;
      rotCanvas.height = bBoxHeight;
      rotCtx.translate(bBoxWidth / 2, bBoxHeight / 2);
      rotCtx.rotate(radians);
      rotCtx.translate(-image.width / 2, -image.height / 2);
      rotCtx.drawImage(image, 0, 0);

      // Canvas 2: extract the cropped area from the rotated image
      const cropCanvas = document.createElement('canvas');
      const cropCtx = cropCanvas.getContext('2d');
      cropCanvas.width = pixelCrop.width;
      cropCanvas.height = pixelCrop.height;

      cropCtx.drawImage(
        rotCanvas,
        pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
        0, 0, pixelCrop.width, pixelCrop.height
      );

      cropCanvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        },
        'image/jpeg',
        0.95
      );
    };
    image.onerror = () => reject(new Error('Failed to load image'));
    image.src = imageSrc;
  });
}
