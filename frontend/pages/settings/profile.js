import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../../components/Logo';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  User,
  Save,
  Code2,
  XCircle,
  Lock,
  Eye,
  EyeOff,
  Search,
  Play,
  Settings,
  Bell,
  Mail,
  Smartphone,
  Trash2,
  AlertTriangle,
  Download,
  HelpCircle,
  RotateCcw,
  Users,
  ChevronDown,
  ArrowUp,
  TrendingUp,
  Camera,
  Upload,
  X,
  Heart,
  MessageSquare
} from 'lucide-react';
import { useTutorial } from '../../components/tutorial';
import { siteTour } from '../../components/tutorial/tours/siteTour';
import { withAuth } from '../../components/withAuth';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useProfileSettings } from '../../hooks/useProfileSettings';
import { useNotificationSettings } from '../../hooks/useNotificationSettings';
import { usePrivacySettings } from '../../hooks/usePrivacySettings';
import Button from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { AVATARS, FLAG_NAMES, getAvatarEmoji } from '../../utils/avatars';
import {
  ChangePasswordModal,
  SettingsSidebar,
  SettingsSection,
  ToggleRow,
  ActiveSessions,
  TwoFactorAuth
} from '../../components/settings';
import ReauthModal from '../../components/ReauthModal';
import AvatarCropModal from '../../components/AvatarCropModal';
import { useToast } from '../../contexts/ToastContext';

// Section order for keyboard navigation (defined outside component)
const SECTION_ORDER = ['profile', 'security', 'email', 'notifications', 'privacy', 'editor', 'subscription', 'data', 'help', 'danger'];

// Mobile section header (outside the page so it is not recreated on every render)
const MobileSectionHeader = ({ id, icon: Icon, title, iconColor = 'text-primary-400', expandedSections, activeSection, onToggle }) => {
  const isExpanded = expandedSections.includes(id);
  const isActive = activeSection === id;

  return (
    <motion.button
      type="button"
      onClick={() => onToggle(id)}
      whileTap={{ scale: 0.98 }}
      className={`lg:hidden w-full flex items-center justify-between p-4 rounded-xl border mb-3 transition-all ${
        isActive
          ? 'bg-surface-800 border-primary-500/50 shadow-lg shadow-primary-500/5'
          : 'bg-surface-800/50 border-surface-700 hover:border-surface-600'
      }`}
    >
      <div className="flex items-center space-x-3">
        <div className={`p-1.5 rounded-lg ${isActive ? 'bg-primary-500/20' : 'bg-surface-700/50'}`}>
          <Icon className={`h-4 w-4 ${isActive ? iconColor : 'text-surface-400'}`} />
        </div>
        <span className={`font-medium ${isActive ? 'text-white' : 'text-surface-300'}`}>{title}</span>
      </div>
      <motion.div
        animate={{ rotate: isExpanded ? 180 : 0 }}
        transition={{ duration: 0.2 }}
      >
        <ChevronDown className={`h-5 w-5 ${isActive ? 'text-primary-400' : 'text-surface-500'}`} />
      </motion.div>
    </motion.button>
  );
};

function ProfileSettings() {
  const router = useRouter();
  const { resetTour, startTour } = useTutorial();
  const toast = useToast();

  // --- Custom hooks for state management ---
  const photoInputRef = useRef(null);
  const profile = useProfileSettings();
  const notifications = useNotificationSettings();
  const privacy = usePrivacySettings();

  // Destructure profile for convenience in JSX
  const {
    user,
    token,
    refreshUser,
    username,
    setUsername,
    bio,
    setBio,
    githubUrl,
    setGithubUrl,
    linkedinUrl,
    setLinkedinUrl,
    twitterUrl,
    setTwitterUrl,
    selectedAvatar,
    setSelectedAvatar,
    usernameStatus,
    isLoading,
    error,
    success,
    activeCategory,
    setActiveCategory,
    flagSearch,
    setFlagSearch,
    usernameCooldown,
    categories,
    photoUploading,
    photoError,
    handlePhotoSelect,
    handleCroppedUpload,
    handlePhotoRemove,
    cropModalOpen,
    setCropModalOpen,
    cropImageSrc,
    hasPassword,
    showPasswordModal,
    setShowPasswordModal,
    passwordLoading,
    showEmailChangeForm,
    setShowEmailChangeForm,
    newEmail,
    setNewEmail,
    emailChangePassword,
    setEmailChangePassword,
    showEmailPassword,
    setShowEmailPassword,
    emailChangeLoading,
    emailChangeError,
    setEmailChangeError,
    emailChangeSuccess,
    setEmailChangeSuccess,
    editorPrefs,
    handleEditorPrefChange,
    showDeleteModal,
    setShowDeleteModal,
    deletePassword,
    setDeletePassword,
    showDeletePassword,
    setShowDeletePassword,
    deleteLoading,
    deleteError,
    deleteConfirmText,
    setDeleteConfirmText,
    closeDeleteModal,
    exportLoading,
    handleExportData,
    showReauthModal,
    setShowReauthModal,
    reauthCallback,
    setReauthCallback,
    handleProfileSubmit,
    handlePasswordSubmit,
    handleEmailChange,
    handleDeleteAccount,
    getAvatarEmojiLocal,
  } = profile;

  const {
    emailPrefs,
    emailPrefsLoading,
    emailPrefsSaving,
    handleEmailPrefChange,
  } = notifications;

  const {
    privacyPrefs,
    privacyPrefsLoading,
    privacyPrefsSaving,
    handlePrivacyPrefChange,
  } = privacy;

  // Section refs for scroll navigation
  const profileRef = useRef(null);
  const securityRef = useRef(null);
  const emailRef = useRef(null);
  const notificationsRef = useRef(null);
  const privacyRef = useRef(null);
  const editorRef = useRef(null);
  const subscriptionRef = useRef(null);
  const dataRef = useRef(null);
  const helpRef = useRef(null);
  const dangerRef = useRef(null);

  // Refs are stable, so the map is built once.
  const sectionRefs = useMemo(() => ({
    profile: profileRef,
    security: securityRef,
    email: emailRef,
    notifications: notificationsRef,
    privacy: privacyRef,
    editor: editorRef,
    subscription: subscriptionRef,
    data: dataRef,
    help: helpRef,
    danger: dangerRef
  }), []);

  const [activeSection, setActiveSection] = useState('profile');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Push notifications
  const {
    isSupported: pushSupported,
    permission: pushPermission,
    isSubscribed: isPushSubscribed,
    loading: pushLoading,
    subscribe: subscribeToPush,
    unsubscribe: unsubscribeFromPush
  } = usePushNotifications(token);

  // Mobile accordion state
  const [expandedSections, setExpandedSections] = useState(['profile']);

  // Scroll to section handler
  const handleSectionChange = useCallback((sectionId) => {
    setActiveSection(sectionId);
    const ref = sectionRefs[sectionId];
    if (ref?.current) {
      const yOffset = -100;
      const y = ref.current.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
    // On mobile, expand the section
    setExpandedSections(prev => prev.includes(sectionId) ? prev : [...prev, sectionId]);
  }, [sectionRefs]);

  // Toggle mobile accordion
  const toggleSection = (sectionId) => {
    setExpandedSections(prev =>
      prev.includes(sectionId)
        ? prev.filter(id => id !== sectionId)
        : [...prev, sectionId]
    );
    setActiveSection(sectionId);
  };

  // Scroll to top
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setActiveSection('profile');
  };

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Intersection Observer for scroll spy
  useEffect(() => {
    if (isMobile) return;

    const observerOptions = {
      root: null,
      rootMargin: '-20% 0px -60% 0px',
      threshold: 0
    };

    const observerCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.id?.replace('-section', '') || entry.target.dataset.section;
          if (sectionId && SECTION_ORDER.includes(sectionId)) {
            setActiveSection(sectionId);
          }
        }
      });
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);

    // Observe all section refs
    Object.entries(sectionRefs).forEach(([key, ref]) => {
      if (ref.current) {
        ref.current.dataset.section = key;
        observer.observe(ref.current);
      }
    });

    return () => observer.disconnect();
  }, [isMobile, sectionRefs]);

  // Scroll position for "back to top" button
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 500);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't navigate if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const currentIndex = SECTION_ORDER.indexOf(activeSection);

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const nextIndex = Math.min(currentIndex + 1, SECTION_ORDER.length - 1);
        handleSectionChange(SECTION_ORDER[nextIndex]);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const prevIndex = Math.max(currentIndex - 1, 0);
        handleSectionChange(SECTION_ORDER[prevIndex]);
      } else if (e.key === 'End') {
        e.preventDefault();
        handleSectionChange(SECTION_ORDER[SECTION_ORDER.length - 1]);
      } else if (e.key === 'Home') {
        e.preventDefault();
        handleSectionChange(SECTION_ORDER[0]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSection, handleSectionChange]);


  return (
    <>
      <Head>
        <title>Settings - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        {/* Header */}
        <header className="bg-surface-900 border-b border-surface-800 px-6 py-4 sticky top-0 z-50">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
              <Logo />
            </Link>
            <div className="flex items-center space-x-4">
              <h1 className="text-lg font-semibold flex items-center space-x-2">
                <Settings className="h-5 w-5 text-primary-400" />
                <span>Settings</span>
              </h1>
              <Button
                variant="primary"
                size="sm"
                icon={Play}
                onClick={() => router.push('/modes')}
              >
                Play
              </Button>
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex gap-8">
            {/* Desktop Sidebar */}
            <div className="hidden lg:block">
              <SettingsSidebar
                activeSection={activeSection}
                onSectionChange={handleSectionChange}
              />
            </div>

            {/* Main Content */}
            <div className="flex-1 space-y-8 max-w-2xl">
              {/* Profile Section */}
              <div ref={profileRef}>
                <MobileSectionHeader id="profile" icon={User} title="Profile" expandedSections={expandedSections} activeSection={activeSection} onToggle={toggleSection} />
                <AnimatePresence>
                  {(expandedSections.includes('profile') || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
                    <SettingsSection
                      id="profile-section"
                      icon={User}
                      title="Profile"
                      description="Customize your public profile"
                    >
                      <form onSubmit={handleProfileSubmit} className="space-y-6">
                        {/* Avatar */}
                        <div>
                          <label className="block text-sm font-medium text-surface-300 mb-3">Avatar</label>

                          {/* Profile Photo Upload */}
                          <div className="flex flex-col items-center mb-6">
                            <input
                              ref={photoInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
                              onChange={(e) => {
                                if (e.target.files?.[0]) handlePhotoSelect(e.target.files[0]);
                                e.target.value = '';
                              }}
                              className="hidden"
                              disabled={photoUploading}
                            />
                            <div
                              className="relative group cursor-pointer w-20 h-20 rounded-full overflow-hidden"
                              onClick={() => photoInputRef.current?.click()}
                            >
                              {user?.avatar_url ? (
                                <img
                                  src={user.avatar_url}
                                  alt="Profile"
                                  className="w-full h-full object-cover border border-surface-700 rounded-full"
                                />
                              ) : (
                                <div className="w-full h-full rounded-full bg-surface-800 border border-surface-700 flex items-center justify-center text-4xl">
                                  {getAvatarEmojiLocal(selectedAvatar)}
                                </div>
                              )}
                              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                <Camera className="h-5 w-5 text-white" />
                              </div>
                            </div>
                            {photoUploading && (
                              <div className="flex items-center gap-2 mt-2 text-surface-400 text-xs">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Uploading...
                              </div>
                            )}
                            {photoError && (
                              <p className="text-red-400 text-xs mt-2">{photoError}</p>
                            )}
                            <div className="flex items-center gap-3 mt-3">
                              <button
                                type="button"
                                onClick={() => photoInputRef.current?.click()}
                                disabled={photoUploading}
                                className="text-xs text-primary-400 hover:text-primary-300 cursor-pointer transition-colors"
                              >
                                <Upload className="h-3 w-3 inline mr-1" />
                                Upload photo
                              </button>
                              {user?.avatar_url && (
                                <button
                                  type="button"
                                  onClick={handlePhotoRemove}
                                  disabled={photoUploading}
                                  className="text-xs text-surface-500 hover:text-red-400 transition-colors"
                                >
                                  Remove photo
                                </button>
                              )}
                            </div>
                          </div>

                          <p className="text-xs text-surface-500 mb-4">Or choose an emoji avatar:</p>

                          {/* Category Tabs */}
                          <div className="flex space-x-2 mb-4 overflow-x-auto pb-2">
                            {categories.map(category => (
                              <motion.button
                                key={category}
                                type="button"
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => {
                                  setActiveCategory(category);
                                  setFlagSearch('');
                                }}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                                  activeCategory === category
                                    ? 'bg-primary-500/20 text-primary-400 border border-primary-500/50'
                                    : 'bg-surface-800/50 text-surface-400 hover:text-white border border-transparent'
                                }`}
                              >
                                {category}
                              </motion.button>
                            ))}
                          </div>

                          {/* Flag Search */}
                          <AnimatePresence>
                            {activeCategory === 'Flags' && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="relative mb-4"
                              >
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-500" />
                                <input
                                  type="text"
                                  value={flagSearch}
                                  onChange={(e) => setFlagSearch(e.target.value)}
                                  placeholder="Search countries..."
                                  className="w-full pl-10 pr-10 py-2 bg-surface-800/50 border border-surface-700 rounded-xl text-white text-sm placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
                                />
                                {flagSearch && (
                                  <button
                                    type="button"
                                    onClick={() => setFlagSearch('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-white"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </button>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Avatar Grid */}
                          <div className="grid grid-cols-6 gap-2">
                            {AVATARS.filter(a => {
                              if (a.category !== activeCategory) return false;
                              if (activeCategory === 'Flags' && flagSearch) {
                                const countryName = FLAG_NAMES[a.id] || '';
                                return countryName.toLowerCase().includes(flagSearch.toLowerCase());
                              }
                              return true;
                            }).map(avatar => (
                              <motion.button
                                key={avatar.id}
                                type="button"
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setSelectedAvatar(avatar.id)}
                                title={FLAG_NAMES[avatar.id] || ''}
                                className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all ${
                                  selectedAvatar === avatar.id
                                    ? 'ring-2 ring-primary-400 bg-primary-500/20 scale-110'
                                    : 'bg-surface-800 hover:bg-surface-700'
                                }`}
                              >
                                {avatar.emoji}
                              </motion.button>
                            ))}
                          </div>
                        </div>

                        {/* Username */}
                        <div>
                          <label className="block text-sm font-medium text-surface-300 mb-2">Username</label>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                            <input
                              type="text"
                              value={username}
                              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                              maxLength={20}
                              placeholder="your_username"
                              className={`w-full pl-10 pr-10 py-3 bg-surface-800/50 border rounded-xl text-white placeholder-surface-500 focus:outline-none transition-all ${
                                username !== user?.username && username.length >= 3
                                  ? usernameStatus.checking
                                    ? 'border-warning'
                                    : usernameStatus.available && !usernameCooldown
                                      ? 'border-success'
                                      : 'border-danger'
                                  : 'border-surface-700 focus:border-primary-500'
                              }`}
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              {usernameStatus.checking && (
                                <Loader2 className="h-5 w-5 text-warning animate-spin" />
                              )}
                              {!usernameStatus.checking && username !== user?.username && username.length >= 3 && (
                                usernameStatus.available && !usernameCooldown ? (
                                  <CheckCircle className="h-5 w-5 text-success" />
                                ) : (
                                  <XCircle className="h-5 w-5 text-danger" />
                                )
                              )}
                            </div>
                          </div>
                          {usernameStatus.reason && !usernameStatus.available && username !== user?.username && (
                            <p className="mt-2 text-sm text-danger">{usernameStatus.reason}</p>
                          )}
                          {usernameCooldown && username !== user?.username && (
                            <p className="mt-2 text-sm text-warning">
                              You can change your username in {usernameCooldown.daysRemaining} day{usernameCooldown.daysRemaining === 1 ? '' : 's'}
                            </p>
                          )}
                          <p className="mt-2 text-xs text-surface-500">3-20 characters, letters, numbers, underscores</p>
                        </div>

                        {/* Bio */}
                        <div>
                          <label className="block text-sm font-medium text-surface-300 mb-2">Bio</label>
                          <textarea
                            value={bio}
                            onChange={(e) => setBio(e.target.value)}
                            maxLength={500}
                            rows={3}
                            placeholder="Tell others about yourself..."
                            className="w-full px-4 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-all resize-none"
                          />
                          <div className="flex justify-end mt-1 text-xs text-surface-500">
                            <span>{bio.length}/500</span>
                          </div>
                        </div>

                        {/* Social Links */}
                        <div className="space-y-4">
                          <label className="block text-sm font-medium text-surface-300">Social Links</label>

                          {/* GitHub */}
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                              <svg className="h-5 w-5 text-surface-500" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <input
                              type="url"
                              value={githubUrl}
                              onChange={(e) => setGithubUrl(e.target.value)}
                              placeholder="https://github.com/username"
                              aria-label="GitHub profile URL"
                              className="w-full pl-12 pr-4 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-all"
                            />
                          </div>

                          {/* LinkedIn */}
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                              <svg className="h-5 w-5 text-surface-500" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                              </svg>
                            </div>
                            <input
                              type="url"
                              value={linkedinUrl}
                              onChange={(e) => setLinkedinUrl(e.target.value)}
                              placeholder="https://linkedin.com/in/username"
                              aria-label="LinkedIn profile URL"
                              className="w-full pl-12 pr-4 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-all"
                            />
                          </div>

                          {/* Twitter/X */}
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                              <svg className="h-5 w-5 text-surface-500" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                              </svg>
                            </div>
                            <input
                              type="url"
                              value={twitterUrl}
                              onChange={(e) => setTwitterUrl(e.target.value)}
                              placeholder="https://x.com/username"
                              aria-label="Twitter/X profile URL"
                              className="w-full pl-12 pr-4 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-all"
                            />
                          </div>
                        </div>

                        {/* Messages */}
                        <AnimatePresence>
                          {error && (
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="flex items-center space-x-2 text-danger bg-danger/10 border border-danger/30 rounded-xl p-3"
                            >
                              <AlertCircle className="h-5 w-5 flex-shrink-0" />
                              <span className="text-sm">{error}</span>
                            </motion.div>
                          )}
                          {success && (
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="flex items-center space-x-2 text-success bg-success/10 border border-success/30 rounded-xl p-3"
                            >
                              <CheckCircle className="h-5 w-5 flex-shrink-0" />
                              <span className="text-sm">{success}</span>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <Button
                          type="submit"
                          variant={success ? 'success' : 'primary'}
                          fullWidth
                          loading={isLoading}
                          disabled={isLoading || (username !== user?.username && username.length >= 3 && !usernameStatus.available)}
                          icon={success ? CheckCircle : Save}
                        >
                          {isLoading ? 'Saving...' : success ? 'Saved!' : 'Save Changes'}
                        </Button>
                      </form>
                    </SettingsSection>
                  )}
                </AnimatePresence>
              </div>

              {/* Security Section */}
              <div ref={securityRef}>
                <MobileSectionHeader id="security" icon={Lock} title="Security" iconColor="text-warning" expandedSections={expandedSections} activeSection={activeSection} onToggle={toggleSection} />
                <AnimatePresence>
                  {(expandedSections.includes('security') || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
                    <SettingsSection
                      id="security-section"
                      icon={Lock}
                      iconColor="text-warning"
                      title="Security"
                      description="Manage your password and account security"
                    >
                      {/* Password */}
                      <div className="p-4 bg-surface-800/50 rounded-xl border border-surface-700">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-warning/20 rounded-lg">
                              <Lock className="h-5 w-5 text-warning" />
                            </div>
                            <div>
                              <h3 className="font-medium text-white">
                                {hasPassword ? 'Password' : 'Set Password'}
                              </h3>
                              <p className="text-sm text-surface-400">
                                {hasPassword
                                  ? 'Last changed: Unknown'
                                  : 'Add password login to your Google account'}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setShowPasswordModal(true)}
                          >
                            {hasPassword ? 'Change' : 'Set'}
                          </Button>
                        </div>
                      </div>

                      {/* Two-Factor Authentication */}
                      <TwoFactorAuth
                        token={token}
                        is2FAEnabled={user?.is_2fa_enabled}
                        twoFAEnabledAt={user?.two_fa_enabled_at}
                        onStatusChange={() => refreshUser()}
                      />

                      {/* Active Sessions */}
                      <div className="pt-4 border-t border-surface-700">
                        <h4 className="text-sm font-medium text-surface-300 mb-4">Active Sessions</h4>
                        <ActiveSessions token={token} />
                      </div>
                    </SettingsSection>
                  )}
                </AnimatePresence>
              </div>

              {/* Email Section */}
              <div ref={emailRef}>
                <MobileSectionHeader id="email" icon={Mail} title="Email" expandedSections={expandedSections} activeSection={activeSection} onToggle={toggleSection} />
                <AnimatePresence>
                  {(expandedSections.includes('email') || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
                    <SettingsSection
                      id="email-section"
                      icon={Mail}
                      title="Email Address"
                      description="Manage your email address"
                    >
                      <div className="p-4 bg-surface-800/50 rounded-xl border border-surface-700">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-surface-400">Current Email</p>
                            <p className="text-white font-medium">{user?.email}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setShowEmailChangeForm(!showEmailChangeForm);
                              setEmailChangeError('');
                              setEmailChangeSuccess('');
                            }}
                            className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
                          >
                            {showEmailChangeForm ? 'Cancel' : 'Change'}
                          </button>
                        </div>
                      </div>

                      {/* Success message */}
                      <AnimatePresence>
                        {emailChangeSuccess && !showEmailChangeForm && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="flex items-center space-x-2 text-success bg-success/10 border border-success/30 rounded-xl p-3"
                          >
                            <CheckCircle className="h-5 w-5 flex-shrink-0" />
                            <span className="text-sm">{emailChangeSuccess}</span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Email Change Form */}
                      <AnimatePresence>
                        {showEmailChangeForm && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="space-y-4 overflow-hidden"
                          >
                            <div>
                              <label className="block text-sm font-medium text-surface-300 mb-2">
                                New Email Address
                              </label>
                              <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                                <input
                                  type="email"
                                  value={newEmail}
                                  onChange={(e) => setNewEmail(e.target.value)}
                                  placeholder="Enter new email address"
                                  className="w-full pl-10 pr-4 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-all"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-surface-300 mb-2">
                                Confirm with Password
                              </label>
                              <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                                <input
                                  type={showEmailPassword ? 'text' : 'password'}
                                  value={emailChangePassword}
                                  onChange={(e) => setEmailChangePassword(e.target.value)}
                                  placeholder="Enter your password"
                                  className="w-full pl-10 pr-12 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-all"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowEmailPassword(!showEmailPassword)}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                                >
                                  {showEmailPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                              </div>
                            </div>

                            <AnimatePresence>
                              {emailChangeError && (
                                <motion.div
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="flex items-center space-x-2 text-danger bg-danger/10 border border-danger/30 rounded-xl p-3"
                                >
                                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                                  <span className="text-sm">{emailChangeError}</span>
                                </motion.div>
                              )}
                            </AnimatePresence>

                            <Button
                              type="button"
                              onClick={handleEmailChange}
                              variant="accent"
                              fullWidth
                              loading={emailChangeLoading}
                              disabled={emailChangeLoading || !newEmail || !emailChangePassword}
                              icon={Mail}
                            >
                              {emailChangeLoading ? 'Sending...' : 'Send Verification Email'}
                            </Button>

                            <p className="text-xs text-surface-500 text-center">
                              A verification link will be sent to your new email.
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </SettingsSection>
                  )}
                </AnimatePresence>
              </div>

              {/* Notifications Section */}
              <div ref={notificationsRef}>
                <MobileSectionHeader id="notifications" icon={Bell} title="Notifications" iconColor="text-secondary-400" expandedSections={expandedSections} activeSection={activeSection} onToggle={toggleSection} />
                <AnimatePresence>
                  {(expandedSections.includes('notifications') || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
                    <SettingsSection
                      id="notifications-section"
                      icon={Bell}
                      iconColor="text-secondary-400"
                      title="Notifications"
                      description="Control what emails and alerts you receive"
                    >
                      {emailPrefsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <ToggleRow
                            icon={Bell}
                            iconBg="bg-secondary-500/20"
                            iconColor="text-secondary-400"
                            title="Weekly Changelog"
                            description="What shipped this week: new features, fixes, and improvements"
                            checked={emailPrefs.marketing}
                            onChange={() => handleEmailPrefChange('marketing')}
                            disabled={emailPrefsSaving}
                          />
                          <ToggleRow
                            icon={Mail}
                            iconBg="bg-primary-500/20"
                            iconColor="text-primary-400"
                            title="Weekly Challenge"
                            description="Get notified when new Arena Challenges drop"
                            checked={emailPrefs.weeklyChallenge}
                            onChange={() => handleEmailPrefChange('weeklyChallenge')}
                            disabled={emailPrefsSaving}
                          />
                          <ToggleRow
                            icon={Bell}
                            iconBg="bg-warning/20"
                            iconColor="text-warning"
                            title="Tournament Alerts"
                            description="New tournaments opening for registration"
                            checked={emailPrefs.tournamentNotifications}
                            onChange={() => handleEmailPrefChange('tournamentNotifications')}
                            disabled={emailPrefsSaving}
                          />
                          <ToggleRow
                            icon={Users}
                            iconBg="bg-success/20"
                            iconColor="text-success"
                            title="Activity Reminders"
                            description="Weekly digest of pending requests and messages"
                            checked={emailPrefs.activityReminders}
                            onChange={() => handleEmailPrefChange('activityReminders')}
                            disabled={emailPrefsSaving}
                          />
                          <ToggleRow
                            icon={Heart}
                            iconBg="bg-error/20"
                            iconColor="text-error"
                            title="CreatorArena Milestones"
                            description="Celebrate when your games hit 10/50/100 likes or get their first comment"
                            checked={emailPrefs.creatorArenaEmails}
                            onChange={() => handleEmailPrefChange('creatorArenaEmails')}
                            disabled={emailPrefsSaving}
                          />
                          <ToggleRow
                            icon={TrendingUp}
                            iconBg="bg-warning/20"
                            iconColor="text-warning"
                            title="Weekly Progress Digest"
                            description="A personalized summary of your weekly progress"
                            badge="PRO"
                            checked={emailPrefs.progressDigest}
                            onChange={() => handleEmailPrefChange('progressDigest')}
                            disabled={emailPrefsSaving}
                          />
                          <ToggleRow
                            icon={MessageSquare}
                            iconBg="bg-primary-500/20"
                            iconColor="text-primary-400"
                            title="Weekly Message Digest"
                            description="Summary of messages you received that week (sent Fridays)"
                            checked={emailPrefs.messageDigest}
                            onChange={() => handleEmailPrefChange('messageDigest')}
                            disabled={emailPrefsSaving}
                          />

                          {/* Push Notifications */}
                          {pushSupported && (
                            <div className="pt-4 border-t border-surface-700">
                              <h4 className="text-sm font-medium text-surface-300 mb-3 flex items-center space-x-2">
                                <Smartphone className="h-4 w-4" />
                                <span>Push Notifications</span>
                              </h4>
                              <ToggleRow
                                icon={Bell}
                                iconBg="bg-secondary-500/20"
                                iconColor="text-secondary-400"
                                title="Friend Activity"
                                description={pushPermission === 'denied'
                                  ? 'Blocked - enable in browser settings'
                                  : 'When friends win battles or earn badges'}
                                checked={isPushSubscribed}
                                onChange={isPushSubscribed ? unsubscribeFromPush : subscribeToPush}
                                disabled={pushLoading || pushPermission === 'denied'}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </SettingsSection>
                  )}
                </AnimatePresence>
              </div>

              {/* Privacy Section */}
              <div ref={privacyRef}>
                <MobileSectionHeader id="privacy" icon={Lock} title="Privacy" expandedSections={expandedSections} activeSection={activeSection} onToggle={toggleSection} />
                <AnimatePresence>
                  {(expandedSections.includes('privacy') || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
                    <SettingsSection
                      id="privacy-section"
                      icon={Lock}
                      title="Privacy"
                      description="Control your privacy settings"
                    >
                      {privacyPrefsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                        </div>
                      ) : (
                        <ToggleRow
                          icon={Eye}
                          iconBg="bg-primary-500/20"
                          iconColor="text-primary-400"
                          title="Read Receipts"
                          description="Let others see when you've read their messages"
                          checked={privacyPrefs.showReadReceipts}
                          onChange={() => handlePrivacyPrefChange('showReadReceipts')}
                          disabled={privacyPrefsSaving}
                        />
                      )}
                    </SettingsSection>
                  )}
                </AnimatePresence>
              </div>

              {/* Editor Section */}
              <div ref={editorRef}>
                <MobileSectionHeader id="editor" icon={Code2} title="Editor" iconColor="text-secondary-400" expandedSections={expandedSections} activeSection={activeSection} onToggle={toggleSection} />
                <AnimatePresence>
                  {(expandedSections.includes('editor') || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
                    <SettingsSection
                      id="editor-section"
                      icon={Code2}
                      iconColor="text-secondary-400"
                      title="Editor"
                      description="Customize your coding experience"
                    >
                      <ToggleRow
                        icon={Code2}
                        iconBg="bg-secondary-500/20"
                        iconColor="text-secondary-400"
                        title="Vim Mode"
                        description="Enable vim keybindings in the code editor"
                        checked={editorPrefs.vimMode}
                        onChange={() => handleEditorPrefChange('vimMode')}
                      />
                    </SettingsSection>
                  )}
                </AnimatePresence>
              </div>

              {/* Billing Section */}
              <div ref={subscriptionRef}>
                <MobileSectionHeader id="subscription" icon={User} title="Billing" iconColor="text-warning" expandedSections={expandedSections} activeSection={activeSection} onToggle={toggleSection} />
                <AnimatePresence>
                  {(expandedSections.includes('subscription') || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
                    <SettingsSection
                      id="subscription-section"
                      icon={User}
                      iconColor="text-warning"
                      title="Billing"
                      description="Core CodeArena access is free"
                    >
                      <div className={`p-4 rounded-xl border ${user?.is_pro ? 'bg-surface-800 border-primary-500/20' : 'bg-surface-800/50 border-surface-700'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${user?.is_pro ? 'bg-primary-500/20' : 'bg-surface-700'}`}>
                              <User className={`h-5 w-5 ${user?.is_pro ? 'text-primary-400' : 'text-surface-400'}`} />
                            </div>
                            <div>
                              <h3 className="font-medium text-white">
                                Free CodeArena
                              </h3>
                              <p className="text-sm text-surface-400">
                                Battles, Practice, rankings, and social features included
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => router.push('/pricing')}
                          >
                            Learn more
                          </Button>
                        </div>
                      </div>
                    </SettingsSection>
                  )}
                </AnimatePresence>
              </div>

              {/* Data Export Section */}
              <div ref={dataRef}>
                <MobileSectionHeader id="data" icon={Download} title="Data Export" iconColor="text-surface-400" expandedSections={expandedSections} activeSection={activeSection} onToggle={toggleSection} />
                <AnimatePresence>
                  {(expandedSections.includes('data') || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
                    <SettingsSection
                      id="data-section"
                      icon={Download}
                      iconColor="text-secondary-400"
                      title="Data Export"
                      description="Download your data"
                    >
                      <div className="p-4 bg-surface-800/50 rounded-xl border border-surface-700">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-medium text-white">Export Your Data</h3>
                            <p className="text-sm text-surface-400 mt-1">
                              Download profile, battle history, messages, and stats
                            </p>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Download}
                            onClick={handleExportData}
                            loading={exportLoading}
                            disabled={exportLoading}
                          >
                            Export
                          </Button>
                        </div>
                      </div>
                    </SettingsSection>
                  )}
                </AnimatePresence>
              </div>

              {/* Help Section */}
              <div ref={helpRef}>
                <MobileSectionHeader id="help" icon={HelpCircle} title="Help" expandedSections={expandedSections} activeSection={activeSection} onToggle={toggleSection} />
                <AnimatePresence>
                  {(expandedSections.includes('help') || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
                    <SettingsSection
                      id="help-section"
                      icon={HelpCircle}
                      title="Help & Support"
                      description="Get help with CodeArena"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          resetTour('site');
                          router.push('/');
                          setTimeout(() => startTour(siteTour), 500);
                        }}
                        className="w-full flex items-center justify-between p-4 bg-surface-800/50 rounded-xl border border-surface-700 hover:border-primary-500/50 transition-colors group"
                      >
                        <div className="flex items-center space-x-3">
                          <RotateCcw className="h-5 w-5 text-surface-400 group-hover:text-primary-400 transition-colors" />
                          <div className="text-left">
                            <p className="font-medium text-white">Retake Site Tour</p>
                            <p className="text-sm text-surface-400">Watch the intro tutorial again</p>
                          </div>
                        </div>
                      </button>
                    </SettingsSection>
                  )}
                </AnimatePresence>
              </div>

              {/* Danger Zone Section */}
              <div ref={dangerRef}>
                <MobileSectionHeader id="danger" icon={AlertTriangle} title="Danger Zone" iconColor="text-danger" expandedSections={expandedSections} activeSection={activeSection} onToggle={toggleSection} />
                <AnimatePresence>
                  {(expandedSections.includes('danger') || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
                    <SettingsSection
                      id="danger-section"
                      icon={AlertTriangle}
                      title="Danger Zone"
                      variant="danger"
                    >
                      <div className="p-4 bg-danger/5 rounded-xl border border-danger/20">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-medium text-white">Delete Account</h3>
                            <p className="text-sm text-surface-400 mt-1">
                              Permanently delete your account and all data
                            </p>
                          </div>
                          <Button
                            variant="danger"
                            size="sm"
                            icon={Trash2}
                            onClick={() => setShowDeleteModal(true)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </SettingsSection>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Password Modal */}
      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        hasPassword={hasPassword}
        onSubmit={handlePasswordSubmit}
        loading={passwordLoading}
      />

      {/* Delete Account Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => !deleteLoading && setShowDeleteModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-900 border border-danger/30 rounded-2xl max-w-md w-full p-6"
            >
              <div className="flex items-center space-x-3 mb-6">
                <div className="p-3 bg-danger/20 rounded-xl">
                  <AlertTriangle className="h-6 w-6 text-danger" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Delete Account</h3>
                  <p className="text-sm text-surface-400">This action is permanent</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-danger/10 border border-danger/20 rounded-xl">
                  <p className="text-sm text-surface-300">This will permanently remove:</p>
                  <ul className="mt-2 text-sm text-surface-400 space-y-1">
                    <li>• Your profile and settings</li>
                    <li>• Battle history and statistics</li>
                    <li>• Messages and friend connections</li>
                    <li>• All achievements and progress</li>
                  </ul>
                </div>

                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Type DELETE to confirm
                  </label>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value.toUpperCase())}
                    placeholder="DELETE"
                    className="w-full px-4 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-danger transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Enter your password
                  </label>
                  {!hasPassword ? (
                    <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl">
                      <p className="text-sm text-warning">
                        Set a password first in the Security section above.
                      </p>
                    </div>
                  ) : (
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-500" />
                      <input
                        type={showDeletePassword ? 'text' : 'password'}
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        placeholder="Your password"
                        className="w-full pl-10 pr-12 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-danger transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDeletePassword(!showDeletePassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-white"
                      >
                        {showDeletePassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  )}
                </div>

                {deleteError && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center space-x-2 text-danger bg-danger/10 border border-danger/30 rounded-xl p-3"
                  >
                    <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    <span className="text-sm">{deleteError}</span>
                  </motion.div>
                )}

                <div className="flex space-x-3 pt-2">
                  <Button
                    variant="ghost"
                    fullWidth
                    onClick={closeDeleteModal}
                    disabled={deleteLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    fullWidth
                    icon={Trash2}
                    onClick={() => handleDeleteAccount(router)}
                    loading={deleteLoading}
                    disabled={deleteConfirmText !== 'DELETE' || !deletePassword || deleteLoading || !hasPassword}
                  >
                    Delete Account
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Back to Top Button */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 p-3 bg-primary-500 hover:bg-primary-400 text-white rounded-full shadow-lg shadow-primary-500/25 z-40 transition-colors"
            aria-label="Scroll to top"
          >
            <ArrowUp className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Reauth Modal */}
      <ReauthModal
        isOpen={showReauthModal}
        onClose={() => {
          setShowReauthModal(false);
          setReauthCallback(null);
        }}
        onSuccess={() => {
          setShowReauthModal(false);
          if (reauthCallback) {
            reauthCallback();
            setReauthCallback(null);
          }
        }}
        token={token}
      />
      <AvatarCropModal
        isOpen={cropModalOpen}
        onClose={() => setCropModalOpen(false)}
        imageSrc={cropImageSrc}
        onCropComplete={handleCroppedUpload}
      />
    </>
  );
}

export default withAuth(ProfileSettings);
