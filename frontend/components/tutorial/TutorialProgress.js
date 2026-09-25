import { motion } from 'framer-motion';

// Design system colors for inline style contexts
const PROGRESS_COLORS = {
  active:    '#06b6d4',                // primary-500
  completed: 'rgba(6, 182, 212, 0.4)', // primary-500 @ 40%
  inactive:  'rgba(71, 85, 105, 0.5)', // surface-600 @ 50%
};

export default function TutorialProgress({ currentStep, totalSteps, onStepClick }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: totalSteps }).map((_, index) => {
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;

        return (
          <button
            key={index}
            onClick={() => onStepClick(index)}
            className="relative p-0.5 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 rounded-full"
            aria-label={`Go to step ${index + 1}`}
          >
            <motion.div
              className="rounded-full"
              style={{
                backgroundColor: isActive
                  ? PROGRESS_COLORS.active
                  : isCompleted
                  ? PROGRESS_COLORS.completed
                  : PROGRESS_COLORS.inactive,
              }}
              initial={false}
              animate={{
                width: isActive ? 24 : 8,
                height: 8,
              }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            />
            {isActive && (
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  backgroundColor: PROGRESS_COLORS.active,
                  filter: 'blur(4px)',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                transition={{ duration: 0.2 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
