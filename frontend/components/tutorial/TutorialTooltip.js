import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X, Sparkles } from 'lucide-react';
import { useTutorial } from './TutorialProvider';
import TutorialProgress from './TutorialProgress';

const tooltipVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.25, ease: 'easeOut' },
  },
  exit: { opacity: 0, y: -10, scale: 0.95 },
};

const navVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { delay: 0.15, duration: 0.2 } },
  exit: { opacity: 0, y: 10 },
};

export default function TutorialTooltip({ step, position, stepNumber, totalSteps, tooltipWidth = 320 }) {
  const { nextStep, prevStep, skipTour, goToStep, activeTour, tourConfig } = useTutorial();

  if (!step) return null;

  const isFirstStep = stepNumber === 0;
  const isLastStep = stepNumber === totalSteps - 1;
  const Icon = step.icon || Sparkles;

  const handleNext = () => {
    const tourId = activeTour || tourConfig?.id;
    if (isLastStep && tourId) {
      try {
        const completed = JSON.parse(localStorage.getItem('codearena_tours_completed') || '{}');
        completed[tourId] = true;
        localStorage.setItem('codearena_tours_completed', JSON.stringify(completed));
      } catch {
        // Ignore localStorage failures
      }
    }

    nextStep();
  };

  const handleSkip = () => {
    const tourId = activeTour || tourConfig?.id;
    if (tourId) {
      try {
        const dismissed = JSON.parse(localStorage.getItem('codearena_tour_dismissed') || '{}');
        dismissed[tourId] = true;
        localStorage.setItem('codearena_tour_dismissed', JSON.stringify(dismissed));
      } catch {
        // Ignore localStorage failures
      }
    }

    skipTour();
  };

  return (
    <>
      {/* Tooltip card: follows the highlighted feature */}
      <motion.div
        key={`tooltip-${stepNumber}`}
        data-tutorial-tooltip
        className="absolute z-[9999]"
        style={{
          left: position.x,
          top: position.y,
          width: tooltipWidth,
          maxHeight: 'calc(100vh - 32px)',
          pointerEvents: 'auto',
        }}
        variants={tooltipVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div
          className="relative rounded-2xl overflow-hidden flex flex-col"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.99) 100%)',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            boxShadow: '0 0 30px rgba(6, 182, 212, 0.15), 0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          }}
        >
          <button
            onClick={handleSkip}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700/50 transition-colors z-10"
            aria-label="Skip tutorial"
          >
            <X size={16} />
          </button>

          <div className="px-5 pt-5 pb-3">
            <div className="flex items-start gap-3">
              <div
                className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                }}
              >
                <Icon size={20} className="text-cyan-400" />
              </div>
              <div className="flex-1 pr-6">
                <h3 className="text-lg font-bold text-white leading-tight">
                  {step.title}
                </h3>
                {step.subtitle && (
                  <p className="text-xs text-cyan-400/80 mt-0.5">{step.subtitle}</p>
                )}
              </div>
            </div>
          </div>

          <div className="px-5 pb-4 flex-1 min-h-0 overflow-y-auto">
            <p className="text-sm text-surface-300 leading-relaxed">
              {step.content}
            </p>

            {step.tip && (
              <div className="mt-3 p-2.5 rounded-lg bg-surface-800/50 border border-surface-700/50">
                <p className="text-xs text-surface-400">
                  <span className="text-cyan-400 font-medium">Tip:</span> {step.tip}
                </p>
              </div>
            )}
          </div>

          {/* Progress dots and step counter */}
          <div className="px-5 pb-4">
            <div className="mb-2 text-[11px] font-medium tracking-wide text-surface-500">
              Step {stepNumber + 1} of {totalSteps}
            </div>
            <TutorialProgress
              currentStep={stepNumber}
              totalSteps={totalSteps}
              onStepClick={goToStep}
            />
          </div>

          {/* Decorative gradient line at top */}
          <div
            className="absolute top-0 left-0 right-0 h-0.5"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, rgba(6, 182, 212, 0.5) 50%, transparent 100%)',
            }}
          />
        </div>

        {/* Arrow pointer */}
        <div
          className="absolute w-3 h-3 rotate-45"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.99) 100%)',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            borderRight: 'none',
            borderBottom: 'none',
            ...(position.placement === 'bottom' && {
              top: -7,
              left: `${position.arrowX ?? tooltipWidth / 2}px`,
              transform: 'translateX(-50%) rotate(45deg)',
            }),
            ...(position.placement === 'top' && {
              bottom: -7,
              left: `${position.arrowX ?? tooltipWidth / 2}px`,
              transform: 'translateX(-50%) rotate(225deg)',
            }),
            ...(position.placement === 'left' && {
              right: -7,
              top: `${position.arrowY ?? 50}px`,
              transform: 'translateY(-50%) rotate(135deg)',
            }),
            ...(position.placement === 'right' && {
              left: -7,
              top: `${position.arrowY ?? 50}px`,
              transform: 'translateY(-50%) rotate(-45deg)',
            }),
          }}
        />
      </motion.div>

      {/* Navigation bar: fixed at bottom of screen, smoothly shifts on last step */}
      <motion.div
        className="fixed inset-x-0 z-[10000] flex justify-center"
        style={{ pointerEvents: 'none', bottom: isLastStep ? '6rem' : '2rem', transition: 'bottom 0.4s ease' }}
        variants={navVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div
          className="flex items-center gap-3 px-5 py-3 rounded-xl"
          style={{
            pointerEvents: 'auto',
            marginLeft: isLastStep ? '-25rem' : '0',
            transition: 'margin-left 0.4s ease',
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.97) 100%)',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            boxShadow: '0 0 20px rgba(6, 182, 212, 0.1), 0 10px 30px -10px rgba(0, 0, 0, 0.5)',
          }}
        >
          <button
            onClick={prevStep}
            disabled={isFirstStep}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              isFirstStep
                ? 'text-surface-600 cursor-not-allowed'
                : 'text-surface-300 hover:text-white hover:bg-surface-700/50'
            }`}
          >
            <ChevronLeft size={16} />
            Back
          </button>

          <button
            onClick={handleSkip}
            className="px-2.5 py-2 rounded-lg text-sm font-medium text-surface-400 hover:text-surface-200 hover:bg-surface-700/40 transition-colors"
          >
            Skip tour
          </button>

          <button
            onClick={handleNext}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all"
            style={{
              background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
              boxShadow: '0 0 20px rgba(6, 182, 212, 0.3)',
            }}
          >
            {isLastStep ? (
              <>
                Get Started
                <Sparkles size={16} />
              </>
            ) : (
              <>
                Next
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </>
  );
}
