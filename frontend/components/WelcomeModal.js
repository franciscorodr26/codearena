import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ChevronRight, ChevronLeft, Swords, Target, Users,
  Trophy, TrendingUp, Zap, Play, Sparkles, Code2,
  User, Check, AlertCircle, Loader2
} from 'lucide-react';
import Button from './ui/Button';
import { config } from '../config/env';

const tutorialSlides = [
  {
    id: 1,
    title: "Welcome to CodeArena",
    subtitle: "Where developers become champions",
    description: "Practice coding and AI prompting, compete in real-time battles, build and share challenges, and connect with other developers.",
    icon: Swords,
    gradient: "from-primary-500 to-secondary-500",
    features: [
      { icon: Zap, text: "Practice & compete" },
      { icon: Trophy, text: "ELO rankings" },
      { icon: Users, text: "Global community" }
    ]
  },
  {
    id: 2,
    title: "Choose Your Mode",
    subtitle: "Multiple ways to compete and improve",
    description: "Whether you want to climb the ranks, practice solo, or challenge friends - we've got you covered.",
    icon: Target,
    gradient: "from-warning to-orange-500",
    modes: [
      { name: "Ranked Match", desc: "Compete for ELO", icon: "" },
      { name: "Practice", desc: "Solo training", icon: "" },
      { name: "Private Battle", desc: "Challenge friends", icon: "" },
      { name: "Weekly Arena", desc: "Mystery challenge", icon: "" }
    ]
  },
  {
    id: 3,
    title: "Track Your Growth",
    subtitle: "Clear insights to level up",
    description: "Monitor your progress, analyze your coding patterns, and use your battle history to choose what to practice next.",
    icon: TrendingUp,
    gradient: "from-success to-emerald-500",
    features: [
      { icon: TrendingUp, text: "Progress dashboard" },
      { icon: Trophy, text: "Battle history" },
      { icon: Sparkles, text: "Achievement tracking" }
    ]
  },
  {
    id: 4,
    title: "Ready to Compete?",
    subtitle: "Your journey starts now",
    description: "Jump into your first battle and see where you stand. Every match makes you stronger.",
    icon: Play,
    gradient: "from-secondary-500 to-primary-500",
    cta: true
  }
];

// Floating particles - using CSS animation for better performance
const FloatingParticle = ({ delay, x, size }) => (
  <div
    className="absolute rounded-full bg-primary-500/20 animate-float-up"
    style={{
      width: size,
      height: size,
      left: `${x}%`,
      animationDelay: `${delay}s`
    }}
  />
);

export default function WelcomeModal({ isOpen, onClose, onComplete, onStepChange, user, token, refreshUser }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState(false);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [hasCustomizedUsername, setHasCustomizedUsername] = useState(false);

  // Initialize username from user prop
  useEffect(() => {
    if (user?.username) {
      setUsername(user.username);
    }
  }, [user]);

  // Debounced username validation
  useEffect(() => {
    if (!username || username === user?.username) {
      setUsernameError('');
      setUsernameSuccess(false);
      return;
    }

    // Basic validation
    if (username.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      setUsernameSuccess(false);
      return;
    }
    if (username.length > 20) {
      setUsernameError('Username must be 20 characters or less');
      setUsernameSuccess(false);
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setUsernameError('Only letters, numbers, and underscores allowed');
      setUsernameSuccess(false);
      return;
    }

    const reserved = ['admin', 'administrator', 'moderator', 'mod', 'support', 'help', 'codearena', 'system'];
    if (reserved.includes(username.toLowerCase())) {
      setUsernameError('This username is reserved');
      setUsernameSuccess(false);
      return;
    }

    // Check availability
    setIsCheckingUsername(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`${config.backend_url}/auth/check-username?username=${encodeURIComponent(username)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        // Handle rate limiting gracefully - allow submission, server will validate
        if (res.status === 429) {
          setUsernameError('');
          setUsernameSuccess(false);
          return;
        }
        const data = await res.json();
        if (data.available) {
          setUsernameError('');
          setUsernameSuccess(true);
        } else {
          setUsernameError(data.reason || 'This username is already taken');
          setUsernameSuccess(false);
        }
      } catch (err) {
        setUsernameError('');
        setUsernameSuccess(false);
      } finally {
        setIsCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [username, user?.username, token]);

  const saveUsername = async () => {
    if (!username || username === user?.username || usernameError || isSavingUsername) return true;

    setIsSavingUsername(true);
    try {
      const res = await fetch(`${config.backend_url}/auth/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ username })
      });

      if (res.ok) {
        setHasCustomizedUsername(true);
        // Refresh user data so the new username shows in the UI
        if (refreshUser) {
          await refreshUser();
        }
        return true;
      } else {
        const data = await res.json();
        setUsernameError(data.error || 'Failed to save username');
        return false;
      }
    } catch (err) {
      setUsernameError('Failed to save username');
      return false;
    } finally {
      setIsSavingUsername(false);
    }
  };

  if (!isOpen) return null;

  // Username selection is handled by /complete-profile page for Google users
  // WelcomeModal only shows tutorial slides
  const slides = tutorialSlides;

  const slide = slides[currentSlide];
  const isUsernameSlide = slide.type === 'username';
  const isLastSlide = currentSlide === slides.length - 1;
  const isFirstSlide = currentSlide === 0;
  const SlideIcon = slide.icon;

  const handleNext = async () => {
    // If on username slide, save username first
    if (isUsernameSlide && username !== user?.username) {
      const saved = await saveUsername();
      if (!saved) return; // Don't proceed if save failed
    }

    if (isLastSlide) {
      onComplete();
    } else {
      const nextSlide = currentSlide + 1;
      setCurrentSlide(nextSlide);
      onStepChange?.(nextSlide + 1); // 1-indexed for analytics
    }
  };

  const handlePrev = () => {
    if (!isFirstSlide) {
      const prevSlide = currentSlide - 1;
      setCurrentSlide(prevSlide);
      onStepChange?.(prevSlide + 1); // 1-indexed for analytics
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  // Simplified animation variants for better performance
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.05
      }
    },
    exit: { opacity: 0 }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.25, ease: 'easeOut' }
    }
  };

  const iconVariants = {
    hidden: { scale: 0.8, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: { duration: 0.3, ease: 'easeOut' }
    }
  };

  const featureVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: (i) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: 0.2 + i * 0.08,
        duration: 0.25,
        ease: 'easeOut'
      }
    })
  };

  const modeVariants = {
    hidden: { opacity: 0, x: -15 },
    visible: (i) => ({
      opacity: 1,
      x: 0,
      transition: {
        delay: 0.2 + i * 0.06,
        duration: 0.25,
        ease: 'easeOut'
      }
    })
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && handleSkip()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="relative w-full max-w-md sm:max-w-lg bg-surface-900 rounded-2xl overflow-hidden shadow-2xl border border-surface-700"
        >
          {/* Background particles - reduced count for performance */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <FloatingParticle delay={0} x={20} size={6} />
            <FloatingParticle delay={2} x={50} size={5} />
            <FloatingParticle delay={4} x={80} size={6} />
          </div>

          {/* Skip button */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSkip();
            }}
            className="absolute top-4 right-4 text-surface-400 hover:text-white transition-colors z-20 p-2"
          >
            <X className="h-6 w-6" />
          </button>

          {/* Progress dots */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
            {slides.map((_, idx) => (
              <motion.button
                key={idx}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.3 + idx * 0.05 }}
                onClick={() => setCurrentSlide(idx)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  idx === currentSlide
                    ? 'bg-primary-500 w-6'
                    : 'bg-surface-600 hover:bg-surface-500 w-2'
                }`}
              />
            ))}
          </div>

          {/* Slide content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="p-5 sm:p-8 pt-12 sm:pt-14 relative z-10"
            >
              {/* Username Step */}
              {isUsernameSlide ? (
                <>
                  {/* User Icon */}
                  <motion.div variants={iconVariants} className="flex justify-center mb-6">
                    <div className="flex flex-col items-center">
                      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-600 flex items-center justify-center shadow-lg shadow-primary-500/30 mb-3">
                        <User className="h-10 w-10 sm:h-12 sm:w-12 text-white" />
                      </div>
                    </div>
                  </motion.div>

                  {/* Title */}
                  <motion.h2
                    variants={itemVariants}
                    className="text-xl sm:text-2xl font-bold text-white text-center mb-2"
                  >
                    Choose Your Username
                  </motion.h2>

                  {/* Subtitle */}
                  <motion.p
                    variants={itemVariants}
                    className="text-surface-400 text-center text-xs sm:text-sm mb-5"
                  >
                    This is how other players will see you in battles
                  </motion.p>

                  {/* Username Input */}
                  <motion.div variants={itemVariants} className="mb-6">
                    <div className="relative">
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        placeholder="Enter username"
                        maxLength={20}
                        className={`w-full px-4 py-3 bg-surface-800 border rounded-lg text-white placeholder-surface-500 focus:outline-none focus:ring-2 transition-all ${
                          usernameError
                            ? 'border-red-500 focus:ring-red-500/50'
                            : usernameSuccess
                            ? 'border-green-500 focus:ring-green-500/50'
                            : 'border-surface-600 focus:ring-primary-500/50'
                        }`}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {isCheckingUsername ? (
                          <Loader2 className="h-5 w-5 text-surface-400 animate-spin" />
                        ) : usernameSuccess ? (
                          <Check className="h-5 w-5 text-green-500" />
                        ) : usernameError ? (
                          <AlertCircle className="h-5 w-5 text-red-500" />
                        ) : null}
                      </div>
                    </div>
                    {usernameError && (
                      <motion.p
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-red-400 text-xs mt-2"
                      >
                        {usernameError}
                      </motion.p>
                    )}
                    {usernameSuccess && username !== user?.username && (
                      <motion.p
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-green-400 text-xs mt-2"
                      >
                        Username is available!
                      </motion.p>
                    )}
                    <p className="text-surface-500 text-xs mt-2">
                      3-20 characters, letters, numbers, and underscores only
                    </p>
                  </motion.div>
                </>
              ) : (
                <>
                  {/* Logo & Icon for tutorial slides */}
                  <motion.div variants={iconVariants} className="flex justify-center mb-6">
                    {slide.id === 1 ? (
                      // First tutorial slide: Show CodeArena logo prominently
                      <div className="flex flex-col items-center">
                        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-600 flex items-center justify-center shadow-lg shadow-primary-500/30 mb-3">
                          <Code2 className="h-10 w-10 sm:h-12 sm:w-12 text-white" />
                        </div>
                        <motion.span
                          className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.3 }}
                        >
                          CodeArena
                        </motion.span>
                      </div>
                    ) : (
                      // Other slides: Show slide icon with pulse effect
                      <motion.div
                        className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br ${slide.gradient} flex items-center justify-center shadow-lg`}
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <SlideIcon className="h-8 w-8 sm:h-10 sm:w-10 text-white" />
                      </motion.div>
                    )}
                  </motion.div>

                  {/* Title */}
                  <motion.h2
                    variants={itemVariants}
                    className="text-xl sm:text-2xl font-bold text-white text-center mb-2"
                  >
                    {slide.id === 1 ? 'Welcome!' : slide.title}
                  </motion.h2>

                  {/* Subtitle */}
                  <motion.p
                    variants={itemVariants}
                    className="text-primary-400 text-center text-xs sm:text-sm mb-3 sm:mb-4"
                  >
                    {slide.subtitle}
                  </motion.p>

                  {/* Description */}
                  <motion.p
                    variants={itemVariants}
                    className="text-surface-300 text-center text-sm sm:text-base mb-5 sm:mb-6"
                  >
                    {slide.description}
                  </motion.p>

                  {/* Features (slides 1 & 3) */}
                  {slide.features && (
                    <div className="flex justify-center gap-4 sm:gap-6 mb-5 sm:mb-6">
                      {slide.features.map((feature, idx) => (
                        <motion.div
                          key={idx}
                          custom={idx}
                          variants={featureVariants}
                          initial="hidden"
                          animate="visible"
                          className="flex flex-col items-center gap-1.5 sm:gap-2 cursor-default hover:scale-105 transition-transform"
                        >
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-surface-800 flex items-center justify-center border border-surface-700 hover:border-primary-500 transition-colors">
                            <feature.icon className="h-5 w-5 sm:h-6 sm:w-6 text-primary-400" />
                          </div>
                          <span className="text-[10px] sm:text-xs text-surface-400 font-medium text-center">{feature.text}</span>
                        </motion.div>
                      ))}
                    </div>
                  )}

                  {/* Game modes (slide 2) */}
                  {slide.modes && (
                    <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-5 sm:mb-6">
                      {slide.modes.map((mode, idx) => (
                        <motion.div
                          key={idx}
                          custom={idx}
                          variants={modeVariants}
                          initial="hidden"
                          animate="visible"
                          className="bg-surface-800 rounded-lg sm:rounded-xl p-2.5 sm:p-3 flex items-center gap-2 sm:gap-3 border border-surface-700 cursor-default hover:border-surface-600 transition-colors"
                        >
                          <span className="text-xl sm:text-2xl">{mode.icon}</span>
                          <div>
                            <p className="text-white text-xs sm:text-sm font-medium">{mode.name}</p>
                            <p className="text-surface-400 text-[10px] sm:text-xs">{mode.desc}</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}

                  {/* CTA (slide 4) */}
                  {slide.cta && (
                    <div className="flex justify-center gap-4 sm:gap-6 mb-5 sm:mb-6">
                      {[
                        { emoji: "", label: "10 Languages" },
                        { emoji: "", label: "1000+ Problems" },
                        { emoji: "", label: "Global Ranks" }
                      ].map((item, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, y: 15 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            delay: 0.2 + idx * 0.1,
                            duration: 0.25,
                            ease: 'easeOut'
                          }}
                          className="text-center cursor-default hover:scale-110 transition-transform"
                        >
                          <div className="text-3xl sm:text-4xl mb-1.5 sm:mb-2">
                            {item.emoji}
                          </div>
                          <p className="text-[10px] sm:text-xs text-surface-400 font-medium">{item.label}</p>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="px-5 sm:px-8 pb-5 sm:pb-8 flex items-center justify-between relative z-10"
          >
            <motion.button
              onClick={handlePrev}
              disabled={isFirstSlide}
              whileHover={!isFirstSlide ? { x: -3 } : {}}
              whileTap={!isFirstSlide ? { scale: 0.95 } : {}}
              className={`flex items-center gap-1 px-3 sm:px-4 py-2 rounded-lg transition-colors text-sm sm:text-base ${
                isFirstSlide
                  ? 'text-surface-600 cursor-not-allowed'
                  : 'text-surface-300 hover:text-white hover:bg-surface-800'
              }`}
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Back</span>
            </motion.button>

            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button
                variant="primary"
                onClick={handleNext}
                disabled={isUsernameSlide && (usernameError || !username || isSavingUsername)}
                className="px-4 sm:px-6"
              >
                {isSavingUsername ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : isLastSlide ? (
                  <>
                    <span>Let's Go</span>
                    <motion.span
                      animate={{ x: [0, 3, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      <Play className="h-4 w-4 ml-2" />
                    </motion.span>
                  </>
                ) : (
                  <>
                    <span>Next</span>
                    <motion.span
                      animate={{ x: [0, 3, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </motion.span>
                  </>
                )}
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
