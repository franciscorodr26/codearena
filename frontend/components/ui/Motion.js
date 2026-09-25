import { motion, AnimatePresence, useMotionValue, useTransform, useSpring, useInView } from 'framer-motion';
import { forwardRef, useRef, useEffect, useState } from 'react';

// Page transition wrapper
const PageTransition = forwardRef(({ children, className = '', ...props }, ref) => {
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      {...props}
    >
      {children}
    </motion.div>
  );
});
PageTransition.displayName = 'PageTransition';

// Fade in animation
const FadeIn = forwardRef(({
  children,
  className = '',
  delay = 0,
  duration = 0.5,
  direction = 'up', // up, down, left, right
  ...props
}, ref) => {
  const directionOffsets = {
    up: { y: 20 },
    down: { y: -20 },
    left: { x: 20 },
    right: { x: -20 },
  };

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, ...directionOffsets[direction] }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration, delay, ease: 'easeOut' }}
      {...props}
    >
      {children}
    </motion.div>
  );
});
FadeIn.displayName = 'FadeIn';

// Scale in animation
const ScaleIn = forwardRef(({
  children,
  className = '',
  delay = 0,
  duration = 0.3,
  ...props
}, ref) => {
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration, delay, ease: 'easeOut' }}
      {...props}
    >
      {children}
    </motion.div>
  );
});
ScaleIn.displayName = 'ScaleIn';

// Stagger children animation container
const StaggerContainer = forwardRef(({
  children,
  className = '',
  staggerDelay = 0.1,
  ...props
}, ref) => {
  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        visible: {
          transition: {
            staggerChildren: staggerDelay,
          },
        },
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
});
StaggerContainer.displayName = 'StaggerContainer';

// Stagger child item
const StaggerItem = forwardRef(({
  children,
  className = '',
  ...props
}, ref) => {
  return (
    <motion.div
      ref={ref}
      className={className}
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      {...props}
    >
      {children}
    </motion.div>
  );
});
StaggerItem.displayName = 'StaggerItem';

// Hover scale effect
const HoverScale = forwardRef(({
  children,
  className = '',
  scale = 1.05,
  ...props
}, ref) => {
  return (
    <motion.div
      ref={ref}
      className={className}
      whileHover={{ scale }}
      whileTap={{ scale: scale * 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      {...props}
    >
      {children}
    </motion.div>
  );
});
HoverScale.displayName = 'HoverScale';

// Float animation
const Float = forwardRef(({
  children,
  className = '',
  amplitude = 10, // pixels to float
  duration = 3, // seconds for one cycle
  ...props
}, ref) => {
  return (
    <motion.div
      ref={ref}
      className={className}
      animate={{
        y: [0, -amplitude, 0],
      }}
      transition={{
        duration,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
});
Float.displayName = 'Float';

// Pulse glow animation
const PulseGlow = forwardRef(({
  children,
  className = '',
  glowColor = 'rgba(6, 182, 212, 0.4)',
  ...props
}, ref) => {
  return (
    <motion.div
      ref={ref}
      className={className}
      animate={{
        boxShadow: [
          `0 0 20px ${glowColor}`,
          `0 0 40px ${glowColor}`,
          `0 0 20px ${glowColor}`,
        ],
      }}
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
});
PulseGlow.displayName = 'PulseGlow';

// Typewriter text effect
const TypewriterText = ({ text, className = '', speed = 50 }) => {
  return (
    <span className={className}>
      {text.split('').map((char, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: index * (speed / 1000) }}
        >
          {char}
        </motion.span>
      ))}
    </span>
  );
};

// Number counter animation - animates counting up when visible
const CountUp = ({
  end,
  start = 0,
  duration = 1.5,
  className = '',
  suffix = '',
  prefix = '',
  decimals = 0,
}) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const [displayValue, setDisplayValue] = useState(start);

  useEffect(() => {
    if (!isInView) return;

    let rafId = null;
    const startTime = Date.now();

    const animate = () => {
      const now = Date.now();
      const progress = Math.min((now - startTime) / (duration * 1000), 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * eased;

      setDisplayValue(decimals > 0 ? current.toFixed(decimals) : Math.round(current));

      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isInView, start, end, duration, decimals]);

  return (
    <span ref={ref} className={className}>
      {prefix}{displayValue}{suffix}
    </span>
  );
};

// 3D Tilt card effect on hover
const TiltCard = forwardRef(({
  children,
  className = '',
  tiltAmount = 10, // degrees
  glareEnabled = true,
  ...props
}, ref) => {
  const cardRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotateX = useTransform(y, [-0.5, 0.5], [tiltAmount, -tiltAmount]);
  const rotateY = useTransform(x, [-0.5, 0.5], [-tiltAmount, tiltAmount]);

  const springRotateX = useSpring(rotateX, { stiffness: 300, damping: 30 });
  const springRotateY = useSpring(rotateY, { stiffness: 300, damping: 30 });

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set((e.clientX - centerX) / rect.width);
    y.set((e.clientY - centerY) / rect.height);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={(node) => {
        cardRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      className={`${className} perspective-1000`}
      style={{
        rotateX: springRotateX,
        rotateY: springRotateY,
        transformStyle: 'preserve-3d',
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      whileHover={{ scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      {...props}
    >
      {children}
      {glareEnabled && isHovered && (
        <motion.div
          className="absolute inset-0 rounded-inherit pointer-events-none"
          style={{
            background: `radial-gradient(circle at ${(x.get() + 0.5) * 100}% ${(y.get() + 0.5) * 100}%, rgba(255,255,255,0.15) 0%, transparent 50%)`,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      )}
    </motion.div>
  );
});
TiltCard.displayName = 'TiltCard';

// Modal/Dialog animation wrapper
const ModalMotion = forwardRef(({
  children,
  className = '',
  isOpen,
  onClose,
  ...props
}, ref) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          {/* Modal */}
          <motion.div
            ref={ref}
            className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${className}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            {...props}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});
ModalMotion.displayName = 'ModalMotion';

// Export all components
export {
  PageTransition,
  FadeIn,
  ScaleIn,
  StaggerContainer,
  StaggerItem,
  HoverScale,
  Float,
  PulseGlow,
  TypewriterText,
  CountUp,
  TiltCard,
  ModalMotion,
  AnimatePresence,
};

// Re-export motion for convenience
export { motion };
