// ResizablePanel.js - Drag-to-resize split panel component with mobile support
import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import { motion } from 'framer-motion';
import { GripVertical, FileText, Code2 } from 'lucide-react';

/**
 * ResizablePanel - A horizontal split panel with drag-to-resize functionality
 * On mobile (< 768px), displays a tabbed interface instead of split view
 *
 * @param {React.ReactNode} leftPanel - Content for the left panel (problem description)
 * @param {React.ReactNode} rightPanel - Content for the right panel (code editor)
 * @param {string} storageKey - localStorage key to persist panel width
 * @param {number} defaultLeftWidth - Default left panel width percentage (default: 50)
 * @param {number} minLeftWidth - Minimum left panel width percentage (default: 25)
 * @param {number} maxLeftWidth - Maximum left panel width percentage (default: 75)
 * @param {string} className - Additional container classes
 * @param {string} leftLabel - Label for left panel tab on mobile (default: 'Problem')
 * @param {string} rightLabel - Label for right panel tab on mobile (default: 'Code')
 * @param {'left'|'right'} defaultMobilePanel - Initially visible mobile panel
 */
export default function ResizablePanel({
  leftPanel,
  rightPanel,
  storageKey = 'panelWidth',
  defaultLeftWidth = 50,
  minLeftWidth = 25,
  maxLeftWidth = 75,
  className = '',
  leftLabel = 'Problem',
  rightLabel = 'Code',
  defaultMobilePanel = 'right',
}) {
  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  const [activeTab, setActiveTab] = useState(defaultMobilePanel);
  const instanceId = useId().replace(/:/g, '');
  const leftTabId = `${instanceId}-left-tab`;
  const rightTabId = `${instanceId}-right-tab`;
  const leftPanelId = `${instanceId}-left-panel`;
  const rightPanelId = `${instanceId}-right-panel`;

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Render the same width on the server and during the first browser pass so
  // a persisted preference cannot cause a hydration mismatch. Restore it once
  // the component has mounted, then allow subsequent changes to persist.
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [hasRestoredWidth, setHasRestoredWidth] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      const parsed = saved == null ? NaN : parseFloat(saved);

      if (!Number.isNaN(parsed) && parsed >= minLeftWidth && parsed <= maxLeftWidth) {
        setLeftWidth(parsed);
      }
    } catch (_) {
      // Resizing remains usable when storage is blocked by browser policy.
    }
    setHasRestoredWidth(true);
  }, [storageKey, minLeftWidth, maxLeftWidth]);

  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const containerRef = useRef(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Save to localStorage when width changes
  useEffect(() => {
    if (hasRestoredWidth) {
      try {
        localStorage.setItem(storageKey, leftWidth.toString());
      } catch (_) {
        // Persisting the preference is optional.
      }
    }
  }, [hasRestoredWidth, leftWidth, storageKey]);

  // Handle mouse down on resize handle
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = leftWidth;

    // Add cursor style to body during drag
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [leftWidth]);

  // Handle mouse move during drag
  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const deltaX = e.clientX - startXRef.current;
    const deltaPercent = (deltaX / containerWidth) * 100;
    const newWidth = Math.min(maxLeftWidth, Math.max(minLeftWidth, startWidthRef.current + deltaPercent));

    setLeftWidth(newWidth);
  }, [isDragging, minLeftWidth, maxLeftWidth]);

  // Handle mouse up to end drag
  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Dispatch a resize event so Monaco editors re-layout after panel resize
      window.dispatchEvent(new Event('resize'));
    }
  }, [isDragging]);

  // Touch event handlers for mobile
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.touches[0].clientX;
    startWidthRef.current = leftWidth;
    document.body.style.userSelect = 'none';
  }, [leftWidth]);

  const handleTouchMove = useCallback((e) => {
    if (!isDragging || !containerRef.current || e.touches.length !== 1) return;
    e.preventDefault();

    const containerRect = containerRef.current.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const deltaX = e.touches[0].clientX - startXRef.current;
    const deltaPercent = (deltaX / containerWidth) * 100;
    const newWidth = Math.min(maxLeftWidth, Math.max(minLeftWidth, startWidthRef.current + deltaPercent));

    setLeftWidth(newWidth);
  }, [isDragging, minLeftWidth, maxLeftWidth]);

  const handleTouchEnd = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      document.body.style.userSelect = '';
      window.dispatchEvent(new Event('resize'));
    }
  }, [isDragging]);

  // Add global mouse and touch event listeners during drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  // Double-click to reset to default
  const handleDoubleClick = useCallback(() => {
    setLeftWidth(defaultLeftWidth);
  }, [defaultLeftWidth]);

  const handleResizeKeyDown = useCallback((event) => {
    let nextWidth = leftWidth;
    if (event.key === 'ArrowLeft') nextWidth -= 2;
    else if (event.key === 'ArrowRight') nextWidth += 2;
    else if (event.key === 'Home') nextWidth = minLeftWidth;
    else if (event.key === 'End') nextWidth = maxLeftWidth;
    else return;

    event.preventDefault();
    setLeftWidth(Math.min(maxLeftWidth, Math.max(minLeftWidth, nextWidth)));
    window.dispatchEvent(new Event('resize'));
  }, [leftWidth, maxLeftWidth, minLeftWidth]);

  const activateMobileTab = useCallback((nextTab) => {
    setActiveTab(nextTab);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }, []);

  const handleTabKeyDown = useCallback((event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === 'ArrowLeft' || event.key === 'Home' ? 'left' : 'right';
    activateMobileTab(nextTab);
    requestAnimationFrame(() => {
      document.getElementById(nextTab === 'left' ? leftTabId : rightTabId)?.focus();
    });
  }, [activateMobileTab, leftTabId, rightTabId]);

  // Mobile tabbed view
  if (isMobile) {
    return (
      <div
        className={`flex h-full min-h-0 flex-col overflow-hidden ${className}`}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}
      >
        {/* Tab buttons */}
        <div className="flex bg-surface-800 border-b border-surface-700 flex-shrink-0" role="tablist" aria-label={`${leftLabel} and ${rightLabel} panels`}>
          <button
            id={leftTabId}
            type="button"
            role="tab"
            aria-selected={activeTab === 'left'}
            aria-controls={leftPanelId}
            tabIndex={activeTab === 'left' ? 0 : -1}
            onClick={() => activateMobileTab('left')}
            onKeyDown={handleTabKeyDown}
            className={`flex-1 py-3 px-4 flex items-center justify-center space-x-2 text-sm font-medium transition-colors ${
              activeTab === 'left'
                ? 'bg-surface-700 text-primary-400 border-b-2 border-primary-400'
                : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>{leftLabel}</span>
          </button>
          <button
            id={rightTabId}
            type="button"
            role="tab"
            aria-selected={activeTab === 'right'}
            aria-controls={rightPanelId}
            tabIndex={activeTab === 'right' ? 0 : -1}
            onClick={() => activateMobileTab('right')}
            onKeyDown={handleTabKeyDown}
            className={`flex-1 py-3 px-4 flex items-center justify-center space-x-2 text-sm font-medium transition-colors ${
              activeTab === 'right'
                ? 'bg-surface-700 text-primary-400 border-b-2 border-primary-400'
                : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            <Code2 className="h-4 w-4" />
            <span>{rightLabel}</span>
          </button>
        </div>
        {/* Panel content - use overflow-auto for text content, overflow-hidden for code editor */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <div
            id={leftPanelId}
            role="tabpanel"
            aria-labelledby={leftTabId}
            hidden={activeTab !== 'left'}
            className="h-full overflow-auto"
          >
            {leftPanel}
          </div>
          <div
            id={rightPanelId}
            role="tabpanel"
            aria-labelledby={rightTabId}
            hidden={activeTab !== 'right'}
            className="h-full overflow-hidden"
          >
            {rightPanel}
          </div>
        </div>
      </div>
    );
  }

  // Desktop split view
  return (
    <div
      ref={containerRef}
      className={`flex h-full overflow-hidden relative ${className}`}
    >
      {/* Left Panel */}
      <div
        className="h-full overflow-hidden flex flex-col"
        style={{ width: `${leftWidth}%` }}
      >
        {leftPanel}
      </div>

      {/* Resize Handle */}
      <div
        className={`relative flex-shrink-0 group ${isDragging ? 'z-50' : 'z-10'}`}
        style={{ width: '10px', marginLeft: '-5px', marginRight: '-5px' }}
        role="separator"
        aria-label={`Resize ${leftLabel} and ${rightLabel} panels`}
        aria-orientation="vertical"
        aria-valuemin={minLeftWidth}
        aria-valuemax={maxLeftWidth}
        aria-valuenow={Math.round(leftWidth)}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleResizeKeyDown}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Visible handle bar */}
        <motion.div
          className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1 rounded-full transition-all duration-200 ${
            isDragging
              ? 'bg-primary-400 w-1.5 shadow-lg shadow-primary-500/50'
              : isHovering
                ? 'bg-primary-400/80 w-1.5'
                : 'bg-surface-600 group-hover:bg-surface-500'
          }`}
          animate={isDragging ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 0.3, repeat: isDragging ? Infinity : 0 }}
        />

        {/* Invisible larger hit area for easier grabbing */}
        <div
          className="absolute inset-0 cursor-col-resize"
          style={{ left: '-8px', right: '-8px', width: 'calc(100% + 16px)' }}
        />

        {/* Grip indicator (shows on hover/drag) */}
        <motion.div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-200 ${
            isDragging || isHovering ? 'opacity-100' : 'opacity-0'
          }`}
          initial={false}
          animate={{
            opacity: isDragging || isHovering ? 1 : 0,
            scale: isDragging ? 1.1 : 1
          }}
        >
          <div className={`p-1.5 rounded-lg ${
            isDragging
              ? 'bg-primary-500/30 border border-primary-400/50'
              : 'bg-surface-700/90 border border-surface-600'
          }`}>
            <GripVertical className={`h-4 w-4 ${
              isDragging ? 'text-primary-300' : 'text-surface-400'
            }`} />
          </div>
        </motion.div>

        {/* Width indicator tooltip */}
        {(isDragging || isHovering) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 whitespace-nowrap"
          >
            <div className={`px-2 py-1 rounded text-xs font-mono ${
              isDragging
                ? 'bg-primary-500 text-white'
                : 'bg-surface-700 text-surface-300 border border-surface-600'
            }`}>
              {Math.round(leftWidth)}%
            </div>
          </motion.div>
        )}
      </div>

      {/* Right Panel */}
      <div
        className="h-full overflow-hidden flex flex-col border-l border-surface-700"
        style={{ width: `${100 - leftWidth}%` }}
      >
        {rightPanel}
      </div>

      {/* Overlay during drag to prevent text selection in panels */}
      {isDragging && (
        <div className="fixed inset-0 z-40 cursor-col-resize" />
      )}
    </div>
  );
}

/**
 * ResizablePanelVertical - A vertical split panel with drag-to-resize
 * (For future use - e.g., resizing editor height vs console)
 */
export function ResizablePanelVertical({
  topPanel,
  bottomPanel,
  storageKey = 'panelHeight',
  defaultTopHeight = 60,
  minTopHeight = 30,
  maxTopHeight = 85,
  revealBottom = false,
  resizeLabel = 'Resize top and bottom panels',
  className = '',
}) {
  const clampHeight = useCallback(
    (height) => Math.min(maxTopHeight, Math.max(minTopHeight, height)),
    [maxTopHeight, minTopHeight]
  );
  const [topHeight, setTopHeight] = useState(() => clampHeight(defaultTopHeight));
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const containerRef = useRef(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const preferenceRef = useRef({
    storageKey,
    height: clampHeight(defaultTopHeight)
  });

  // Restore preferences after mount so SSR and the first browser render agree.
  // Auto-reveal changes only the displayed split; it never overwrites the
  // user's explicit per-mode preference.
  useEffect(() => {
    let preferredHeight = preferenceRef.current.storageKey === storageKey
      ? preferenceRef.current.height
      : clampHeight(defaultTopHeight);

    try {
      const saved = localStorage.getItem(storageKey);
      const parsed = saved == null ? NaN : parseFloat(saved);
      if (!Number.isNaN(parsed) && parsed >= minTopHeight && parsed <= maxTopHeight) {
        preferredHeight = parsed;
      }
    } catch (_) {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }

    preferredHeight = clampHeight(preferredHeight);
    preferenceRef.current = { storageKey, height: preferredHeight };

    const revealTarget = typeof window !== 'undefined' && window.innerWidth < 768 ? 42 : 55;
    setTopHeight(revealBottom
      ? clampHeight(Math.min(preferredHeight, revealTarget))
      : preferredHeight);
  }, [clampHeight, defaultTopHeight, maxTopHeight, minTopHeight, revealBottom, storageKey]);

  const setPreferredHeight = useCallback((height, { notify = false } = {}) => {
    const nextHeight = clampHeight(height);
    preferenceRef.current = { storageKey, height: nextHeight };
    setTopHeight(nextHeight);
    try {
      localStorage.setItem(storageKey, nextHeight.toString());
    } catch (_) {
      // Resizing remains usable when persistence is unavailable.
    }
    if (notify && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('resize'));
    }
  }, [clampHeight, storageKey]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    startYRef.current = e.clientY;
    startHeightRef.current = topHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [topHeight]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const containerHeight = containerRect.height;
    if (!Number.isFinite(containerHeight) || containerHeight <= 0) return;
    const deltaY = e.clientY - startYRef.current;
    const deltaPercent = (deltaY / containerHeight) * 100;
    setPreferredHeight(startHeightRef.current + deltaPercent);
  }, [isDragging, setPreferredHeight]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.dispatchEvent(new Event('resize'));
    }
  }, [isDragging]);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    setIsDragging(true);
    startYRef.current = e.touches[0].clientY;
    startHeightRef.current = topHeight;
    document.body.style.userSelect = 'none';
  }, [topHeight]);

  const handleTouchMove = useCallback((e) => {
    if (!isDragging || !containerRef.current || e.touches.length !== 1) return;
    e.preventDefault();

    const containerHeight = containerRef.current.getBoundingClientRect().height;
    if (!Number.isFinite(containerHeight) || containerHeight <= 0) return;
    const deltaY = e.touches[0].clientY - startYRef.current;
    const deltaPercent = (deltaY / containerHeight) * 100;
    setPreferredHeight(startHeightRef.current + deltaPercent);
  }, [isDragging, setPreferredHeight]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.dispatchEvent(new Event('resize'));
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
      window.addEventListener('touchcancel', handleTouchEnd);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
        window.removeEventListener('touchcancel', handleTouchEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchEnd, handleTouchMove]);

  const handleDoubleClick = useCallback(() => {
    setPreferredHeight(defaultTopHeight, { notify: true });
  }, [defaultTopHeight, setPreferredHeight]);

  const handleKeyDown = useCallback((e) => {
    let nextHeight;
    if (e.key === 'ArrowUp') nextHeight = topHeight - 5;
    if (e.key === 'ArrowDown') nextHeight = topHeight + 5;
    if (e.key === 'Home') nextHeight = minTopHeight;
    if (e.key === 'End') nextHeight = maxTopHeight;
    if (nextHeight === undefined) return;

    e.preventDefault();
    setPreferredHeight(nextHeight, { notify: true });
  }, [maxTopHeight, minTopHeight, setPreferredHeight, topHeight]);

  return (
    <div
      ref={containerRef}
      className={`flex flex-col flex-1 overflow-hidden relative ${className}`}
    >
      {/* Top Panel */}
      <div
        data-testid="resizable-vertical-top"
        className="overflow-hidden flex flex-col"
        style={{ height: `${topHeight}%`, minHeight: 0 }}
      >
        {topPanel}
      </div>

      {/* Resize Handle */}
      <div
        role="separator"
        tabIndex={0}
        aria-label={resizeLabel}
        aria-orientation="horizontal"
        aria-valuemin={minTopHeight}
        aria-valuemax={maxTopHeight}
        aria-valuenow={Math.round(topHeight)}
        className={`relative flex-shrink-0 group rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900 ${isDragging ? 'z-50' : 'z-10'}`}
        style={{ height: '10px', marginTop: '-5px', marginBottom: '-5px', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onKeyDown={handleKeyDown}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <motion.div
          className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded-full transition-all duration-200 ${
            isDragging
              ? 'bg-primary-400 h-1.5 shadow-lg shadow-primary-500/50'
              : isHovering
                ? 'bg-primary-400/80 h-1.5'
                : 'bg-surface-600 group-hover:bg-surface-500'
          }`}
        />

        <div
          className="absolute inset-0 cursor-row-resize"
          style={{ top: '-8px', bottom: '-8px', height: 'calc(100% + 16px)' }}
        />
      </div>

      {/* Bottom Panel */}
      <div
        data-testid="resizable-vertical-bottom"
        className="overflow-hidden flex flex-col border-t border-surface-700"
        style={{ height: `${100 - topHeight}%` }}
      >
        {bottomPanel}
      </div>

      {isDragging && (
        <div className="fixed inset-0 z-40 cursor-row-resize" />
      )}
    </div>
  );
}
