import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';

const TutorialContext = createContext(null);

const STORAGE_KEYS = {
  COMPLETED: 'codearena_tours_completed',
  PROGRESS: 'codearena_tour_progress',
  DISMISSED: 'codearena_tour_dismissed',
};

const initialState = {
  activeTour: null,
  currentStep: 0,
  totalSteps: 0,
  isVisible: false,
  isPaused: false,
  hasLoadedPersistedState: false,
  completedTours: {},
  dismissedTours: {},
  tourConfig: null,
};

function tutorialReducer(state, action) {
  switch (action.type) {
    case 'START_TOUR':
      return {
        ...state,
        activeTour: action.payload.tourId || action.payload.id,
        currentStep: 0,
        totalSteps: action.payload.steps.length,
        isVisible: true,
        isPaused: false,
        tourConfig: action.payload,
      };

    case 'NEXT_STEP':
      if (state.currentStep >= state.totalSteps - 1) {
        return state;
      }
      return {
        ...state,
        currentStep: state.currentStep + 1,
      };

    case 'PREV_STEP':
      if (state.currentStep <= 0) {
        return state;
      }
      return {
        ...state,
        currentStep: state.currentStep - 1,
      };

    case 'GO_TO_STEP':
      if (action.payload < 0 || action.payload >= state.totalSteps) {
        return state;
      }
      return {
        ...state,
        currentStep: action.payload,
      };

    case 'PAUSE_TOUR':
      return {
        ...state,
        isPaused: true,
      };

    case 'RESUME_TOUR':
      return {
        ...state,
        isPaused: false,
      };

    case 'END_TOUR':
      return {
        ...state,
        activeTour: null,
        currentStep: 0,
        totalSteps: 0,
        isVisible: false,
        isPaused: false,
        tourConfig: null,
        completedTours: action.payload?.completed
          ? { ...state.completedTours, [action.payload.tourId]: true }
          : state.completedTours,
        dismissedTours: action.payload?.dismissed
          ? { ...state.dismissedTours, [action.payload.tourId]: true }
          : state.dismissedTours,
      };

    case 'LOAD_PERSISTED':
      return {
        ...state,
        completedTours: action.payload.completedTours || {},
        dismissedTours: action.payload.dismissedTours || {},
        hasLoadedPersistedState: true,
      };

    default:
      return state;
  }
}

export function TutorialProvider({ children }) {
  const [state, dispatch] = useReducer(tutorialReducer, initialState);
  const router = useRouter();
  const { user } = useAuth();
  const startTimeRef = useRef(null);
  const stepTimeRef = useRef(null);

  // Load persisted state on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const completed = JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPLETED) || '{}');
      const dismissed = JSON.parse(localStorage.getItem(STORAGE_KEYS.DISMISSED) || '{}');
      dispatch({
        type: 'LOAD_PERSISTED',
        payload: { completedTours: completed, dismissedTours: dismissed },
      });
    } catch (e) {
      console.error('Failed to load tour state:', e);
    }
  }, []);

  // Persist state changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem(STORAGE_KEYS.COMPLETED, JSON.stringify(state.completedTours));
      localStorage.setItem(STORAGE_KEYS.DISMISSED, JSON.stringify(state.dismissedTours));
    } catch (e) {
      console.error('Failed to persist tour state:', e);
    }
  }, [state.completedTours, state.dismissedTours]);

  // End tour on route change
  useEffect(() => {
    if (state.isVisible && state.activeTour) {
      // Give a moment for navigation to complete
      const timeout = setTimeout(() => {
        if (router.pathname !== state.tourConfig?.requiredPath) {
          dispatch({ type: 'END_TOUR', payload: { tourId: state.activeTour } });
        }
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [router.pathname, state.isVisible, state.activeTour, state.tourConfig?.requiredPath]);

  // Keyboard navigation
  useEffect(() => {
    if (!state.isVisible) return;

    const handleKeyDown = (e) => {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'Escape') {
        skipTour();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        nextStep();
      } else if (e.key === 'ArrowLeft') {
        prevStep();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isVisible, state.currentStep]);

  const startTour = useCallback((tourConfig, { force = false } = {}) => {
    if (!tourConfig || !tourConfig.steps || tourConfig.steps.length === 0) {
      console.error('Invalid tour config');
      return;
    }

    if (!state.hasLoadedPersistedState) {
      return;
    }

    if (!force) {
      // Don't start if already completed or dismissed
      if (state.completedTours[tourConfig.id] || state.dismissedTours[tourConfig.id]) {
        return;
      }

      // Direct localStorage check (catches race where state hasn't hydrated yet)
      try {
        const completed = JSON.parse(localStorage.getItem('codearena_tours_completed') || '{}');
        const dismissed = JSON.parse(localStorage.getItem('codearena_tour_dismissed') || '{}');
        if (completed[tourConfig.id] || dismissed[tourConfig.id]) {
          return;
        }
      } catch (e) {}
    }

    startTimeRef.current = Date.now();
    stepTimeRef.current = Date.now();

    dispatch({ type: 'START_TOUR', payload: tourConfig });
  }, [state.completedTours, state.dismissedTours]);

  const nextStep = () => {
    if (state.currentStep >= state.totalSteps - 1) {
      const tourId = state.activeTour;
      const totalTime = startTimeRef.current
        ? Math.round((Date.now() - startTimeRef.current) / 1000)
        : 0;

      // Persist immediately to localStorage before dispatch
      if (tourId) {
        try {
          const completed = JSON.parse(localStorage.getItem('codearena_tours_completed') || '{}');
          completed[tourId] = true;
          localStorage.setItem('codearena_tours_completed', JSON.stringify(completed));
        } catch (e) {}
      }

      dispatch({
        type: 'END_TOUR',
        payload: { tourId, completed: true },
      });

      if (state.tourConfig?.onComplete) {
        state.tourConfig.onComplete({
          tourId,
          totalTimeSeconds: totalTime,
          stepsCompleted: state.totalSteps,
        });
      }
    } else {
      stepTimeRef.current = Date.now();
      dispatch({ type: 'NEXT_STEP' });
    }
  };

  const prevStep = () => {
    stepTimeRef.current = Date.now();
    dispatch({ type: 'PREV_STEP' });
  };

  const goToStep = useCallback((stepIndex) => {
    stepTimeRef.current = Date.now();
    dispatch({ type: 'GO_TO_STEP', payload: stepIndex });
  }, []);

  const completeTour = () => {
    const totalTime = startTimeRef.current
      ? Math.round((Date.now() - startTimeRef.current) / 1000)
      : 0;

    dispatch({
      type: 'END_TOUR',
      payload: { tourId: state.activeTour, completed: true },
    });

    // Callback for analytics
    if (state.tourConfig?.onComplete) {
      state.tourConfig.onComplete({
        tourId: state.activeTour,
        totalTimeSeconds: totalTime,
        stepsCompleted: state.totalSteps,
      });
    }
  };

  const skipTour = () => {
    const tourId = state.activeTour;
    const totalTime = startTimeRef.current
      ? Math.round((Date.now() - startTimeRef.current) / 1000)
      : 0;

    // Persist immediately to localStorage before dispatch
    if (tourId) {
      try {
        const dismissed = JSON.parse(localStorage.getItem('codearena_tour_dismissed') || '{}');
        dismissed[tourId] = true;
        localStorage.setItem('codearena_tour_dismissed', JSON.stringify(dismissed));
      } catch (e) {}
    }

    dispatch({
      type: 'END_TOUR',
      payload: { tourId, dismissed: true },
    });

    if (state.tourConfig?.onSkip) {
      state.tourConfig.onSkip({
        tourId,
        skippedAtStep: state.currentStep,
        totalSteps: state.totalSteps,
        timeSpentSeconds: totalTime,
      });
    }
  };

  const pauseTour = useCallback(() => {
    dispatch({ type: 'PAUSE_TOUR' });
  }, []);

  const resumeTour = useCallback(() => {
    dispatch({ type: 'RESUME_TOUR' });
  }, []);

  const resetTour = useCallback((tourId) => {
    if (typeof window === 'undefined') return;

    const completed = { ...state.completedTours };
    const dismissed = { ...state.dismissedTours };
    delete completed[tourId];
    delete dismissed[tourId];

    localStorage.setItem(STORAGE_KEYS.COMPLETED, JSON.stringify(completed));
    localStorage.setItem(STORAGE_KEYS.DISMISSED, JSON.stringify(dismissed));

    dispatch({
      type: 'LOAD_PERSISTED',
      payload: { completedTours: completed, dismissedTours: dismissed },
    });
  }, [state.completedTours, state.dismissedTours]);

  const isTourCompleted = useCallback((tourId) => {
    return !!state.completedTours[tourId];
  }, [state.completedTours]);

  const isTourDismissed = useCallback((tourId) => {
    return !!state.dismissedTours[tourId];
  }, [state.dismissedTours]);

  const getCurrentStep = useCallback(() => {
    if (!state.tourConfig || !state.tourConfig.steps) return null;
    return state.tourConfig.steps[state.currentStep] || null;
  }, [state.tourConfig, state.currentStep]);

  const value = {
    // State
    activeTour: state.activeTour,
    currentStep: state.currentStep,
    totalSteps: state.totalSteps,
    isVisible: state.isVisible && !state.isPaused,
    isPaused: state.isPaused,
    hasLoadedPersistedState: state.hasLoadedPersistedState,
    tourConfig: state.tourConfig,

    // Actions
    startTour,
    nextStep,
    prevStep,
    goToStep,
    completeTour,
    skipTour,
    pauseTour,
    resumeTour,
    resetTour,

    // Helpers
    isTourCompleted,
    isTourDismissed,
    getCurrentStep,
  };

  // Expose test functions globally for debugging
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__tutorialTest = {
        startSiteTour: async () => {
          const { siteTour } = await import('./tours/siteTour');
          resetTour('site');
          setTimeout(() => {
            dispatch({ type: 'START_TOUR', payload: siteTour });
          }, 100);
        },
        resetTour,
        state: () => state,
      };
    }
  }, [resetTour, state]);

  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error('useTutorial must be used within a TutorialProvider');
  }
  return context;
}

export default TutorialProvider;
