import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTutorial } from './TutorialProvider';
import TutorialTooltip from './TutorialTooltip';

export default function TutorialOverlay() {
  const { isVisible, getCurrentStep, currentStep, totalSteps } = useTutorial();
  const [targetRect, setTargetRect] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({
    x: 0,
    y: 0,
    placement: 'bottom',
    arrowX: null,
    arrowY: null,
  });
  const [mounted, setMounted] = useState(false);
  const measuredTooltipHeight = useRef(0);

  useEffect(() => { setMounted(true); }, []);

  const step = getCurrentStep();
  const tooltipWidth = typeof window !== 'undefined' ? Math.min(320, window.innerWidth - 40) : 320;

  // Measure the actual tooltip element and store its height
  const measureTooltipHeight = useCallback(() => {
    const el = document.querySelector('[data-tutorial-tooltip]');
    if (el) {
      measuredTooltipHeight.current = el.offsetHeight;
    }
  }, []);

  const getTooltipHeight = () => {
    return measuredTooltipHeight.current > 50 ? measuredTooltipHeight.current : 240;
  };

  const calculateTooltipPosition = useCallback((rect, preferredPosition) => {
    const tw = Math.min(320, window.innerWidth - 40);
    const th = getTooltipHeight();
    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x, y;
    let placement = preferredPosition;
    let arrowX = null;
    let arrowY = null;

    switch (preferredPosition) {
      case 'top':
        x = rect.x + rect.width / 2 - tw / 2;
        y = rect.y - th - margin;
        if (y < margin) {
          placement = 'bottom';
          y = rect.y + rect.height + margin;
        }
        break;

      case 'bottom':
        x = rect.x + rect.width / 2 - tw / 2;
        y = rect.y + rect.height + margin;
        if (y + th > vh - margin) {
          placement = 'top';
          y = rect.y - th - margin;
        }
        break;

      case 'left':
        x = rect.x - tw - margin;
        y = rect.y + rect.height / 2 - th / 2;
        if (x < margin) {
          placement = 'right';
          x = rect.x + rect.width + margin;
        }
        break;

      case 'right':
        x = rect.x + rect.width + margin;
        y = rect.y + rect.height / 2 - th / 2;
        if (x + tw > vw - margin) {
          placement = 'left';
          x = rect.x - tw - margin;
        }
        break;

      default:
        x = rect.x + rect.width / 2 - tw / 2;
        y = rect.y + rect.height + margin;
    }

    // Clamp to viewport
    x = Math.max(margin, Math.min(x, vw - tw - margin));
    y = Math.max(margin, Math.min(y, vh - th - margin - 60));

    // Compute arrow position
    if (placement === 'top' || placement === 'bottom') {
      arrowX = Math.max(24, Math.min(rect.x + rect.width / 2 - x, tw - 24));
    } else {
      arrowY = Math.max(24, Math.min(rect.y + rect.height / 2 - y, th - 24));
    }

    setTooltipPosition({ x, y, placement, arrowX, arrowY });
  }, []);

  // Find and measure the target element
  const measureTarget = useCallback((shouldScroll = false) => {
    if (!step?.target) {
      setTargetRect(null);
      return;
    }

    const element = document.querySelector(step.target);
    if (!element) {
      setTargetRect(null);
      return;
    }

    const rect = element.getBoundingClientRect();
    const padding = step.spotlightPadding || 8;

    setTargetRect({
      x: Math.max(0, rect.x - padding),
      y: Math.max(0, rect.y - padding),
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    });

    // Measure current tooltip height before calculating position
    measureTooltipHeight();
    calculateTooltipPosition(rect, step.position || 'bottom');

    if (shouldScroll) {
      const isInView = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!isInView) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => measureTarget(false), 400);
      }
    }
  }, [step, measureTooltipHeight, calculateTooltipPosition]);

  // Measure on step change and window resize
  useEffect(() => {
    if (!isVisible) return;

    // Initial measurement
    measureTarget(true);

    // Re-measure after tooltip renders using rAF chain for reliable post-paint timing
    let raf1, raf2, timeout1, timeout2;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        measureTarget(false);
      });
    });
    // Safety net: remeasure after animation settles
    timeout1 = setTimeout(() => measureTarget(false), 150);
    timeout2 = setTimeout(() => measureTarget(false), 350);

    const handleResize = () => measureTarget(false);
    const handleScroll = () => measureTarget(false);

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    const interval = setInterval(() => measureTarget(false), 500);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timeout1);
      clearTimeout(timeout2);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
      clearInterval(interval);
    };
  }, [isVisible, currentStep, measureTarget]);

  if (!isVisible || !step || !mounted) return null;

  const overlay = (
    <AnimatePresence>
      <motion.div
        key="tutorial-overlay"
        className="fixed inset-0"
        style={{ zIndex: 9998 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        {/* Spotlight cutout: box-shadow creates dark overlay with clear window at target */}
        {targetRect && (
          <div
            className="pointer-events-none"
            style={{
              position: 'fixed',
              left: targetRect.x,
              top: targetRect.y,
              width: targetRect.width,
              height: targetRect.height,
              borderRadius: 12,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.85)',
              zIndex: 9998,
              transition: 'left 0.2s ease, top 0.2s ease, width 0.2s ease, height 0.2s ease',
            }}
          />
        )}
        {!targetRect && (
          <div
            className="fixed inset-0 pointer-events-none"
            style={{ background: 'rgba(0, 0, 0, 0.85)', zIndex: 9998 }}
          />
        )}

        {/* Spotlight border glow */}
        {targetRect && (
          <div
            className="pointer-events-none"
            style={{
              position: 'fixed',
              left: targetRect.x - 2,
              top: targetRect.y - 2,
              width: targetRect.width + 4,
              height: targetRect.height + 4,
              zIndex: 9999,
              transition: 'left 0.2s ease, top 0.2s ease, width 0.2s ease, height 0.2s ease',
            }}
          >
            <div
              className="w-full h-full rounded-xl"
              style={{
                border: '2px solid rgba(6, 182, 212, 0.5)',
                boxShadow: '0 0 20px rgba(6, 182, 212, 0.3)',
              }}
            />
          </div>
        )}

        {/* Click blocker for non-target areas */}
        <div
          className="fixed inset-0"
          onClick={(e) => e.stopPropagation()}
          style={{ pointerEvents: 'auto', zIndex: 9998 }}
        />

        {/* Tooltip */}
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'none' }}>
          <TutorialTooltip
            step={step}
            position={tooltipPosition}
            tooltipWidth={tooltipWidth}
            stepNumber={currentStep}
            totalSteps={totalSteps}
          />
        </div>
      </motion.div>
    </AnimatePresence>
  );

  // Render via portal to document.body to bypass any ancestor transforms
  return createPortal(overlay, document.body);
}
