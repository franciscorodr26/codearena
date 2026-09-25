import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Bug, X, Loader2, CheckCircle, Upload, Trash2, Image as ImageIcon, Clipboard, GripVertical } from 'lucide-react';
import { config } from '../config/env';
import { useAuth } from '../contexts/AuthContext';

// ============================================
// IMAGE COMPRESSION UTILITY
// ============================================

// Compress image using canvas - resize if > 1920px or > 2MB
const compressImage = (file, maxWidth = 1920, maxSizeMB = 2) => {
  return new Promise((resolve) => {
    // Skip non-compressible formats
    if (file.type === 'image/gif') {
      resolve(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const needsResize = img.width > maxWidth || img.height > maxWidth;
        const needsCompress = file.size > maxSizeMB * 1024 * 1024;

        // If already small enough, return original
        if (!needsResize && !needsCompress) {
          resolve(file);
          return;
        }

        // Calculate new dimensions
        let width = img.width;
        let height = img.height;

        if (needsResize) {
          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxWidth) {
              width = Math.round((width * maxWidth) / height);
              height = maxWidth;
            }
          }
        }

        // Create canvas and compress
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Determine output format and quality
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        let quality = 0.85;

        // For large files, reduce quality progressively
        if (file.size > 4 * 1024 * 1024) quality = 0.75;
        if (file.size > 6 * 1024 * 1024) quality = 0.65;

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }

            // Create new file with same name but possibly different extension
            const extension = outputType === 'image/png' ? '.png' : '.jpg';
            const baseName = file.name.replace(/\.[^/.]+$/, '');
            const newFile = new File([blob], `${baseName}${extension}`, {
              type: outputType,
              lastModified: Date.now()
            });

            resolve(newFile);
          },
          outputType,
          quality
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
};

export default function BugReportModal({ isOpen, onClose }) {
  const { user, token } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [screenshots, setScreenshots] = useState([]); // Array of { id, file, preview, uploading, progress, url, error }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [viewingImage, setViewingImage] = useState(null); // For lightbox
  const [isDragging, setIsDragging] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const fileInputRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const dropZoneRef = useRef(null);
  const dragCounterRef = useRef(0);
  const screenshotIdRef = useRef(0);

  // Auto-fill email for logged-in users
  useEffect(() => {
    if (user?.email && !email) {
      setEmail(user.email);
    }
  }, [user, isOpen]);

  // Cleanup previews and timers on unmount
  useEffect(() => {
    return () => {
      screenshots.forEach(s => {
        if (s.preview) URL.revokeObjectURL(s.preview);
      });
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  // Escape key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && !submitting && !viewingImage) {
        handleClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, submitting, viewingImage]);

  // Process and validate files (shared by file input, drag-drop, and paste)
  const processFiles = useCallback(async (files) => {
    if (files.length === 0) return;

    // Check max 5 images
    if (screenshots.length + files.length > 5) {
      setError(`Maximum 5 screenshots allowed. You can add ${5 - screenshots.length} more.`);
      return;
    }

    // Validate file types and sizes (allow larger since we'll compress)
    const validFiles = files.filter(file => {
      const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        setError(`Invalid file type: ${file.name}. Only JPEG, PNG, GIF, WebP allowed.`);
        return false;
      }
      // Allow up to 20MB since we'll compress
      if (file.size > 20 * 1024 * 1024) {
        setError(`File too large: ${file.name}. Max 20MB per image.`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    setCompressing(true);
    setError('');

    try {
      // Compress all files in parallel
      const compressedFiles = await Promise.all(
        validFiles.map(file => compressImage(file))
      );

      // Add files with previews
      const newScreenshots = compressedFiles.map(file => ({
        id: `screenshot-${++screenshotIdRef.current}`,
        file,
        preview: URL.createObjectURL(file),
        uploading: false,
        progress: 0,
        url: null,
        error: null
      }));

      setScreenshots(prev => [...prev, ...newScreenshots]);
    } catch (err) {
      setError('Failed to process images. Please try again.');
    } finally {
      setCompressing(false);
    }
  }, [screenshots.length]);

  // Handle file input change
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    processFiles(files);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Drag and drop handlers
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    if (submitting || screenshots.length >= 5) return;

    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith('image/')
    );
    processFiles(files);
  }, [submitting, screenshots.length, processFiles]);

  // Clipboard paste handler
  useEffect(() => {
    const handlePaste = (e) => {
      if (!isOpen || submitting || screenshots.length >= 5) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            // Create a proper filename for pasted images
            const extension = file.type.split('/')[1] || 'png';
            const newFile = new File([file], `pasted-image-${Date.now()}.${extension}`, {
              type: file.type
            });
            imageFiles.push(newFile);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        processFiles(imageFiles);
      }
    };

    if (isOpen) {
      document.addEventListener('paste', handlePaste);
    }
    return () => document.removeEventListener('paste', handlePaste);
  }, [isOpen, submitting, screenshots.length, processFiles]);

  const removeScreenshot = (id) => {
    setScreenshots(prev => {
      const screenshot = prev.find(s => s.id === id);
      if (screenshot?.preview) {
        URL.revokeObjectURL(screenshot.preview);
      }
      return prev.filter(s => s.id !== id);
    });
  };

  // Upload a single image with progress tracking
  const uploadSingleImage = (file, id) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('screenshots', file);

      // Track upload progress
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setScreenshots(prev =>
            prev.map(s => s.id === id ? { ...s, progress } : s)
          );
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.urls && data.urls.length > 0) {
              resolve(data.urls[0]);
            } else {
              reject(new Error('No URL returned'));
            }
          } catch (e) {
            reject(new Error('Invalid response'));
          }
        } else {
          reject(new Error('Upload failed'));
        }
      };

      xhr.onerror = () => reject(new Error('Network error'));

      xhr.open('POST', `${config.backend_url}/api/bug-reports/upload`);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.send(formData);
    });
  };

  const uploadScreenshots = async () => {
    if (screenshots.length === 0) return [];

    // Mark all as uploading
    setScreenshots(prev =>
      prev.map(s => ({ ...s, uploading: true, progress: 0, error: null }))
    );

    const urls = [];

    // Upload each image individually with progress
    for (const screenshot of screenshots) {
      if (!screenshot.file) continue;

      try {
        const url = await uploadSingleImage(screenshot.file, screenshot.id);
        urls.push(url);

        // Mark this one as complete
        setScreenshots(prev =>
          prev.map(s => s.id === screenshot.id
            ? { ...s, uploading: false, progress: 100, url }
            : s
          )
        );
      } catch (err) {
        // Mark this one as failed
        setScreenshots(prev =>
          prev.map(s => s.id === screenshot.id
            ? { ...s, uploading: false, error: err.message }
            : s
          )
        );
        throw new Error(`Failed to upload ${screenshot.file.name}`);
      }
    }

    return urls;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!title.trim()) {
      setError('Please enter a title');
      return;
    }

    if (!description.trim()) {
      setError('Please describe the bug');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      // Upload screenshots first if any
      let screenshotUrls = [];
      if (screenshots.length > 0) {
        screenshotUrls = await uploadScreenshots();
      }

      const headers = {
        'Content-Type': 'application/json'
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${config.backend_url}/api/bug-reports`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          email: email.trim() || null,
          screenshotUrl: screenshotUrls.length > 0 ? screenshotUrls.join(',') : null,
          pageUrl: typeof window !== 'undefined' ? window.location.href : null
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit bug report');
      }

      setSuccess(true);
      closeTimeoutRef.current = setTimeout(() => {
        handleClose();
      }, 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      onClose();
      // Reset form after close animation
      setTimeout(() => {
        setTitle('');
        setDescription('');
        setEmail(user?.email || '');
        screenshots.forEach(s => {
          if (s.preview) URL.revokeObjectURL(s.preview);
        });
        setScreenshots([]);
        setError('');
        setSuccess(false);
      }, 200);
    }
  };

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-surface-950 z-50 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-surface-900 border border-surface-700 rounded-2xl max-w-lg w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-surface-900 bg-gradient-to-r from-orange-600/20 to-red-600/20 border-b border-surface-700 p-4 flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                  <Bug className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Report a Bug</h2>
                  <p className="text-sm text-surface-400">Help us improve CodeArena</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                disabled={submitting}
                className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-surface-400" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {success ? (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-center py-8"
                >
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="h-8 w-8 text-green-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">Bug Report Submitted!</h3>
                  <p className="text-surface-400">Thank you for helping make CodeArena better.</p>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit}>
                  {/* Title */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Bug Title *
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Brief description of the issue"
                      maxLength={200}
                      className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white text-base placeholder-surface-500 focus:outline-none focus:border-primary-500"
                      disabled={submitting}
                    />
                    <p className="text-xs text-surface-500 mt-1">{title.length}/200</p>
                  </div>

                  {/* Description */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Description *
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What happened? What did you expect to happen? Steps to reproduce..."
                      rows={4}
                      maxLength={5000}
                      className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white text-base placeholder-surface-500 focus:outline-none focus:border-primary-500 resize-none"
                      disabled={submitting}
                    />
                    <p className="text-xs text-surface-500 mt-1">{description.length}/5000</p>
                  </div>

                  {/* Email (optional) */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Email (optional)
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-lg text-white text-base placeholder-surface-500 focus:outline-none focus:border-primary-500"
                      disabled={submitting}
                    />
                    <p className="text-xs text-surface-500 mt-1">We'll contact you if we need more info</p>
                  </div>

                  {/* Screenshots Upload - Drag & Drop Zone */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      <span className="flex items-center space-x-2">
                        <ImageIcon className="h-4 w-4" />
                        <span>Screenshots (optional, max 5)</span>
                      </span>
                    </label>

                    {/* Hidden file input */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      multiple
                      className="hidden"
                      disabled={submitting || screenshots.length >= 5}
                    />

                    {/* Drag & Drop Zone */}
                    {screenshots.length < 5 && (
                      <div
                        ref={dropZoneRef}
                        onDragEnter={handleDragEnter}
                        onDragLeave={handleDragLeave}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        onClick={() => !submitting && fileInputRef.current?.click()}
                        className={`
                          relative w-full px-4 py-6 rounded-lg border-2 border-dashed cursor-pointer
                          transition-all duration-200 ease-in-out
                          ${isDragging
                            ? 'border-primary-500 bg-primary-500/10 scale-[1.02]'
                            : 'border-surface-600 bg-surface-800/50 hover:border-surface-500 hover:bg-surface-800'
                          }
                          ${submitting ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                      >
                        {/* Drag overlay */}
                        <AnimatePresence>
                          {isDragging && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 flex items-center justify-center bg-primary-500/20 rounded-lg z-10"
                            >
                              <div className="flex flex-col items-center text-primary-400">
                                <Upload className="h-8 w-8 mb-2 animate-bounce" />
                                <span className="font-medium">Drop images here</span>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Default content */}
                        <div className={`flex flex-col items-center text-center ${isDragging ? 'opacity-0' : ''}`}>
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-surface-700/50 mb-3">
                            <Upload className="h-5 w-5 text-surface-400" />
                          </div>
                          <p className="text-surface-300 text-sm font-medium mb-1">
                            Drag & drop images here
                          </p>
                          <p className="text-surface-500 text-xs mb-2">
                            or click to browse
                          </p>
                          <div className="flex items-center gap-2 text-surface-500 text-xs">
                            <span className="flex items-center gap-1 px-2 py-1 bg-surface-700/50 rounded">
                              <Clipboard className="h-3 w-3" />
                              Paste from clipboard
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Preview Grid with Drag-Drop Reordering */}
                    {screenshots.length > 0 && (
                      <Reorder.Group
                        axis="x"
                        values={screenshots}
                        onReorder={setScreenshots}
                        className="flex flex-wrap gap-2 mt-3"
                      >
                        {screenshots.map((screenshot, index) => (
                          <Reorder.Item
                            key={screenshot.id}
                            value={screenshot}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            whileDrag={{
                              scale: 1.05,
                              boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
                              cursor: 'grabbing',
                              zIndex: 50
                            }}
                            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                            className="relative group w-[calc(33.333%-0.375rem)] aspect-[4/3] cursor-grab active:cursor-grabbing"
                            style={{ touchAction: 'none' }}
                          >
                            {/* Image */}
                            <img
                              src={screenshot.preview}
                              alt={`Screenshot ${index + 1}`}
                              className={`
                                w-full h-full object-cover rounded-lg border transition-colors
                                ${screenshot.error
                                  ? 'border-red-500/50'
                                  : screenshot.uploading
                                    ? 'border-primary-500/50'
                                    : 'border-surface-700 hover:border-primary-500'
                                }
                              `}
                              onClick={() => !screenshot.uploading && setViewingImage(screenshot.preview)}
                              draggable={false}
                            />

                            {/* Upload Progress Overlay */}
                            {screenshot.uploading && (
                              <div className="absolute inset-0 bg-surface-900/70 rounded-lg flex flex-col items-center justify-center">
                                <Loader2 className="h-5 w-5 text-primary-400 animate-spin mb-1" />
                                <span className="text-xs text-primary-400 font-medium">
                                  {screenshot.progress}%
                                </span>
                              </div>
                            )}

                            {/* Error Overlay */}
                            {screenshot.error && (
                              <div className="absolute inset-0 bg-red-900/70 rounded-lg flex items-center justify-center">
                                <span className="text-xs text-red-300 text-center px-2">
                                  Failed
                                </span>
                              </div>
                            )}

                            {/* Progress Bar */}
                            {screenshot.uploading && (
                              <div className="absolute bottom-0 left-0 right-0 h-1 bg-surface-700 rounded-b-lg overflow-hidden">
                                <motion.div
                                  className="h-full bg-primary-500"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${screenshot.progress}%` }}
                                  transition={{ ease: 'easeOut' }}
                                />
                              </div>
                            )}

                            {/* Drag Handle */}
                            <div className="absolute top-1 left-1 p-1 bg-surface-900/80 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
                              <GripVertical className="h-3 w-3 text-surface-400" />
                            </div>

                            {/* Delete Button */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removeScreenshot(screenshot.id); }}
                              disabled={submitting || screenshot.uploading}
                              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3 text-white" />
                            </button>

                            {/* Image Number Badge */}
                            <div className="absolute bottom-1 right-1 w-5 h-5 bg-surface-900/80 rounded text-xs text-white flex items-center justify-center">
                              {index + 1}
                            </div>

                            {/* Success Check */}
                            {screenshot.url && !screenshot.uploading && (
                              <div className="absolute top-1 right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
                                <CheckCircle className="h-3 w-3 text-white" />
                              </div>
                            )}
                          </Reorder.Item>
                        ))}
                      </Reorder.Group>
                    )}

                    {/* Compressing indicator */}
                    <AnimatePresence>
                      {compressing && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="flex items-center gap-2 mt-2 px-3 py-2 bg-primary-500/10 border border-primary-500/30 rounded-lg"
                        >
                          <Loader2 className="h-4 w-4 text-primary-400 animate-spin" />
                          <span className="text-sm text-primary-400">Compressing images...</span>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Helper text */}
                    <div className="flex items-center justify-between mt-2">
                      <div className="text-xs text-surface-500">
                        <span>JPEG, PNG, GIF, WebP</span>
                        <span className="text-surface-600 mx-1">|</span>
                        <span>Auto-compressed</span>
                        {screenshots.length > 0 && (
                          <>
                            <span className="text-surface-600 mx-1">|</span>
                            <span>Drag to reorder</span>
                          </>
                        )}
                      </div>
                      {screenshots.length > 0 && (
                        <p className="text-xs text-surface-400">
                          {screenshots.length}/5 images
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                      <p className="text-sm text-red-400">{error}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex space-x-3">
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={submitting}
                      className="flex-1 px-4 py-3 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg text-white transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || !title.trim() || !description.trim()}
                      className="flex-1 px-4 py-3 bg-primary-600 hover:bg-primary-500 rounded-lg text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                    >
                      {submitting ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          <Bug className="h-4 w-4" />
                          <span>Submit Report</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Image Lightbox - outside modal */}
    <AnimatePresence>
      {viewingImage && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-surface-950 z-[60] flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); setViewingImage(null); }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setViewingImage(null); }}
            className="absolute top-4 right-4 p-2 bg-surface-800 hover:bg-surface-700 rounded-full transition-colors"
          >
            <X className="h-6 w-6 text-white" />
          </button>
          <motion.img
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            src={viewingImage}
            alt="Screenshot preview"
            className="max-w-full max-h-[85vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
