import { memo } from 'react';

/**
 * FloatingOrbs - Subtle background gradient component
 * Renders a static, minimal radial gradient. No animated orbs.
 *
 * Accepts the same props as before for backward compatibility,
 * but all variants now render the same subtle gradient.
 */
const FloatingOrbs = ({ variant = 'default', showCenterOrb = false, desktopOnly = false }) => {
  const containerClass = desktopOnly
    ? "hidden md:block fixed inset-0 pointer-events-none"
    : "fixed inset-0 pointer-events-none";

  return (
    <div className={containerClass} style={{ contain: 'strict' }}>
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgb(139, 92, 246), transparent)',
        }}
      />
    </div>
  );
};

export default memo(FloatingOrbs);
