import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../components/Logo';
import { useRouter } from 'next/router';
import { Eye, EyeOff, Loader2, CheckCircle, XCircle, Camera, X, Gift } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { trackViewRegisterForm, trackSignupError } from '../utils/analytics';
import Button from '../components/ui/Button';
import GoogleSignInButton from '../components/GoogleSignInButton';
import GitHubSignInButton from '../components/GitHubSignInButton';
import TwoFactorLogin from '../components/TwoFactorLogin';
import { saveAuthRedirect, postAuthDestination } from '../utils/authRedirect';
import { AVATARS, getAvatarEmoji } from '../utils/avatars';
import { config } from '../config/env';

// Filter avatars for registration (subset of full list)
const REGISTER_AVATARS = AVATARS.filter(a =>
  a.category === 'Default' ||
  a.category === 'Gaming' && ['gaming-1', 'gaming-2', 'gaming-3', 'gaming-4', 'gaming-5'].includes(a.id) ||
  a.category === 'Developer' && ['dev-1', 'dev-2', 'dev-3', 'dev-4', 'dev-5'].includes(a.id) ||
  ['flag-us', 'flag-gb', 'flag-ca', 'flag-de', 'flag-fr', 'flag-br', 'flag-jp', 'flag-in', 'flag-kr', 'flag-au'].includes(a.id)
);

export default function Register() {
  const router = useRouter();
  const { register, login, loginWithGoogle, complete2FALogin, user, isAuthenticated, loading: authLoading, checkUsernameAvailability } = useAuth();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState({ checking: false, available: null, reason: null });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('default-1');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showSocialLinks, setShowSocialLinks] = useState(false);
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [emailOptIn, setEmailOptIn] = useState(true); // Default to opted in
  const [profilePicFile, setProfilePicFile] = useState(null);
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const fileInputRef = useRef(null);

  // Referral system
  const [referralCode, setReferralCode] = useState(null);
  const [referralInfo, setReferralInfo] = useState(null);

  // Capture referral code from URL (?ref=CODE)
  useEffect(() => {
    const ref = router.query.ref;
    if (ref && !referralCode) {
      setReferralCode(ref);
      // Validate the referral code
      fetch(`${config.backend_url}/api/ai/referral/validate/${ref}`)
        .then(r => r.json())
        .then(data => {
          if (data.valid) {
            setReferralInfo(data);
          }
        })
        .catch(() => {});
    }
  }, [router.query.ref, referralCode]);

  // Track page view on mount and store redirect param
  useEffect(() => {
    if (!router.isReady) return;
    trackViewRegisterForm();
    // Store redirect param from URL if present (e.g., from pricing page)
    if (router.query.redirect) {
      saveAuthRedirect(router.query.redirect);
    }
  }, [router.isReady, router.query.redirect]);

  // Redirect if already authenticated (wait for router.isReady so redirect param is stored first)
  useEffect(() => {
    if (!router.isReady) return;
    if (!authLoading && isAuthenticated) {
      router.replace(postAuthDestination(user));
    }
  }, [router.isReady, isAuthenticated, authLoading, router, user]);

  // Debounced username check
  useEffect(() => {
    if (!username || username.length < 3) {
      setUsernameStatus({ checking: false, available: null, reason: null });
      return;
    }

    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      setUsernameStatus({
        checking: false,
        available: false,
        reason: 'Letters, numbers, and underscores only'
      });
      return;
    }

    setUsernameStatus({ checking: true, available: null, reason: null });

    const timer = setTimeout(async () => {
      try {
        const result = await checkUsernameAvailability(username);
        setUsernameStatus({
          checking: false,
          available: result.available,
          reason: result.reason
        });
      } catch (err) {
        // On error, allow proceeding - server will validate on submit
        console.error('Username check failed:', err);
        setUsernameStatus({
          checking: false,
          available: true, // Allow proceeding, server will validate
          reason: null
        });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [username, checkUsernameAvailability]);

  // Password validation
  const passwordRequirements = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'Contains a number', met: /\d/.test(password) },
    { label: 'Contains uppercase letter', met: /[A-Z]/.test(password) },
  ];

  const isPasswordValid = passwordRequirements.every((req) => req.met);
  const doPasswordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleProfilePicChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowed.includes(file.type)) {
      setError('Invalid image type. Supported: JPEG, PNG, GIF, WebP, HEIC.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB.');
      return;
    }

    setProfilePicFile(file);
    setProfilePicPreview(URL.createObjectURL(file));
    setError('');
  };

  const removeProfilePic = () => {
    setProfilePicFile(null);
    if (profilePicPreview) URL.revokeObjectURL(profilePicPreview);
    setProfilePicPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return; // Prevent double-click
    setError('');

    // Only block if explicitly unavailable (false), allow if null or true
    if (usernameStatus.available === false) {
      setError('Please choose an available username');
      return;
    }

    // Basic username validation for mobile fallback
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      setError('Username must be 3-20 characters (letters, numbers, underscores)');
      return;
    }

    if (!isPasswordValid) {
      setError('Please meet all password requirements');
      return;
    }

    if (!doPasswordsMatch) {
      setError('Passwords do not match');
      return;
    }

    // Normalize social URLs (add https:// if missing)
    const normalizeUrl = (url) => {
      if (!url || !url.trim()) return '';
      let normalized = url.trim();
      if (normalized && !normalized.match(/^https?:\/\//)) {
        normalized = 'https://' + normalized;
      }
      return normalized;
    };

    const normalizedLinkedin = normalizeUrl(linkedinUrl);
    const normalizedGithub = normalizeUrl(githubUrl);
    const normalizedTwitter = normalizeUrl(twitterUrl);

    // Validate social URLs before submitting
    if (normalizedLinkedin && !/^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?$/.test(normalizedLinkedin)) {
      setError('Invalid LinkedIn URL. Use format: linkedin.com/in/username');
      return;
    }
    if (normalizedGithub && !/^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+\/?$/.test(normalizedGithub)) {
      setError('Invalid GitHub URL. Use format: github.com/username');
      return;
    }
    if (normalizedTwitter && !/^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/?$/.test(normalizedTwitter)) {
      setError('Invalid Twitter/X URL. Use format: x.com/username');
      return;
    }

    setIsLoading(true);

    try {
      await register(email, password, username, selectedAvatar, emailOptIn, {
        linkedin: normalizedLinkedin,
        github: normalizedGithub,
        twitter: normalizedTwitter
      }, referralCode);

      // Auto-login after successful registration
      // Login sets isAuthenticated=true, which triggers the useEffect redirect above
      try {
        await login(username, password, true); // Remember me = true

        // Upload profile picture if selected (after login so we have auth token)
        if (profilePicFile) {
          try {
            const authToken = localStorage.getItem('auth_token');
            if (authToken) {
              const formData = new FormData();
              formData.append('avatar', profilePicFile);
              await fetch(`${config.backend_url}/auth/avatar`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}` },
                body: formData,
              });
            }
          } catch (uploadErr) {
            // Non-blocking - user can upload later from settings
            console.warn('Profile pic upload failed:', uploadErr);
          }
        }
      } catch (loginErr) {
        // If auto-login fails, fall back to login page
        console.warn('Auto-login failed, redirecting to login:', loginErr);
        setSuccess(true);
        setTimeout(() => {
          router.push('/login?welcome=new');
        }, 1500);
      }
    } catch (err) {
      const errorMessage = err.message || 'Registration failed';
      setError(errorMessage);
      trackSignupError({
        errorType: 'registration_failed',
        errorMessage,
        username,
        email
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSuccess = async (credential) => {
    if (isGoogleLoading || isLoading) return; // Prevent double-click
    setError('');
    setIsGoogleLoading(true);

    try {
      const result = await loginWithGoogle(credential, true);
      if (result?.requires2FA) setTwoFactorChallenge(result);
      // Auth-state effect performs a single redirect after authentication completes.
    } catch (err) {
      const errorMessage = err.message || 'Google sign-up failed';
      setError(errorMessage);
      trackSignupError({
        errorType: 'google_signup_failed',
        errorMessage
      });
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleGoogleError = (err) => {
    console.error('Google Sign-Up Error:', err);
    setError('Google sign-up failed. Please try again.');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-surface-400 animate-spin" />
      </div>
    );
  }

  if (success) {
    return (
      <>
        <Head>
          <title>Registration Successful - CodeArena</title>
        </Head>
        <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center px-6">
          <div className="text-center">
            <div className="w-20 h-20 bg-success rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold mb-4 text-white">Welcome, {username}!</h1>
            <p className="text-surface-400 mb-4">Redirecting you to login...</p>
            <Loader2 className="h-6 w-6 text-surface-400 mx-auto animate-spin" />
          </div>
        </div>
      </>
    );
  }

  if (twoFactorChallenge) {
    return (
      <div className="min-h-[100dvh] bg-surface-950 text-white flex items-center justify-center p-4">
        <Head><title>Verify Sign-In - CodeArena</title></Head>
        <TwoFactorLogin
          tempToken={twoFactorChallenge.tempToken}
          username={twoFactorChallenge.email || 'Google User'}
          rememberMe
          onSuccess={async ({ token, user: userData }) => {
            try {
              await complete2FALogin(token, userData, true);
            } catch {
              setTwoFactorChallenge(null);
              setError('Failed to complete login. Please try again.');
            }
          }}
          onCancel={() => setTwoFactorChallenge(null)}
        />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Create Account - CodeArena</title>
        <meta name="description" content="Join CodeArena to practice coding and prompting, compete in live battles, create games, and meet other developers." />
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="min-h-[100dvh] bg-surface-950 text-white flex flex-col">
        {/* Header */}
        <header className="px-4 sm:px-6 py-4 sm:py-6">
          <nav className="max-w-7xl mx-auto">
            <Link href="/" className="inline-block">
              <Logo />
            </Link>
          </nav>
        </header>

        {/* Register Form */}
        <div className="flex-1 flex items-start md:items-center justify-center px-4 sm:px-6 py-4 sm:py-8">
          <div className="w-full max-w-md">
            <div className="bg-surface-900 border border-surface-800 rounded-2xl p-4 sm:p-8">
              {/* Header */}
              <div className="text-center mb-5 sm:mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-white">Create Account</h1>
                <p className="text-surface-400">Create your account to get started</p>
              </div>

              {/* Referral invitation banner */}
              {referralInfo && (
                <div className="mb-5 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <Gift className="h-5 w-5 text-green-400" />
                    </div>
                    <div>
                      <div className="text-white font-semibold">{referralInfo.referrerUsername} invited you to CodeArena</div>
                      <div className="text-sm text-green-400">Create an account to practice, battle, and build together.</div>
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                {(config.google_client_id || config.github_client_id) && (
                  <>
                    {/* Fastest path: show social signup first */}
                    <GoogleSignInButton
                      onSuccess={handleGoogleSuccess}
                      onError={handleGoogleError}
                      text="signup_with"
                      disabled={isLoading || isGoogleLoading}
                    />

                    {/* GitHub Sign-Up */}
                    <GitHubSignInButton
                      text="Sign up with GitHub"
                      disabled={isLoading || isGoogleLoading}
                    />

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-surface-700" />
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="px-4 bg-surface-900/50 text-surface-500">or sign up with email</span>
                      </div>
                    </div>
                  </>
                )}

                {/* Username Input */}
                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-surface-300 mb-2">
                    Username
                  </label>
                  <div className="relative">
                    <input
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      required
                      maxLength={20}
                      placeholder="your_username"
                      className={`w-full px-4 pr-10 py-3 bg-surface-800 border rounded-xl text-white text-base placeholder-surface-500 focus:outline-none transition-all ${
                        username.length >= 3
                          ? usernameStatus.checking
                            ? 'border-warning focus:ring-warning/50'
                            : usernameStatus.available
                              ? 'border-success focus:ring-success/50'
                              : 'border-danger focus:ring-danger/50'
                          : 'border-surface-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50'
                      }`}
                    />
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      {usernameStatus.checking && (
                        <Loader2 className="h-5 w-5 text-warning animate-spin" />
                      )}
                      {!usernameStatus.checking && username.length >= 3 && (
                        usernameStatus.available ? (
                          <CheckCircle className="h-5 w-5 text-success" />
                        ) : (
                          <XCircle className="h-5 w-5 text-danger" />
                        )
                      )}
                    </div>
                  </div>
                  {username.length > 0 && username.length < 3 && (
                    <p className="mt-1 text-xs text-surface-500">At least 3 characters required</p>
                  )}
                  {usernameStatus.reason && !usernameStatus.available && (
                    <p className="mt-1 text-xs text-danger">{usernameStatus.reason}</p>
                  )}
                  {usernameStatus.available && (
                    <p className="mt-1 text-xs text-success">Username is available!</p>
                  )}
                </div>

                {/* Email Input */}
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-surface-300 mb-2">
                    Email Address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-xl text-white text-base placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                  />
                </div>

                {/* Password Input */}
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-surface-300 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Create a strong password"
                      className="w-full px-4 pr-12 py-3 bg-surface-800 border border-surface-700 rounded-xl text-white text-base placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>

                  {/* Password Requirements */}
                  {password.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {passwordRequirements.map((req, index) => (
                        <div
                          key={index}
                          className={`flex items-center space-x-2 text-xs ${
                            req.met ? 'text-success' : 'text-surface-500'
                          }`}
                        >
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${req.met ? 'bg-success' : 'bg-surface-600'}`} />
                          <span>{req.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Confirm Password Input */}
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-surface-300 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      placeholder="Confirm your password"
                      className={`w-full px-4 pr-12 py-3 bg-surface-800 border rounded-xl text-white text-base placeholder-surface-500 focus:outline-none transition-all ${
                        confirmPassword.length > 0
                          ? doPasswordsMatch
                            ? 'border-success focus:ring-success/50'
                            : 'border-danger focus:ring-danger/50'
                          : 'border-surface-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                      aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {confirmPassword.length > 0 && !doPasswordsMatch && (
                    <p className="mt-1 text-xs text-danger">Passwords do not match</p>
                  )}
                </div>

                {/* Email Opt-in */}
                <div className="flex items-start space-x-3 p-4 bg-surface-800/30 rounded-xl border border-surface-700/50">
                  <div className="flex items-center h-5 mt-0.5">
                    <input
                      id="emailOptIn"
                      name="emailOptIn"
                      type="checkbox"
                      checked={emailOptIn}
                      onChange={(e) => setEmailOptIn(e.target.checked)}
                      className="h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary-500 focus:ring-primary-500 focus:ring-offset-0 focus:ring-offset-surface-800 cursor-pointer"
                    />
                  </div>
                  <div className="flex-1">
                    <label htmlFor="emailOptIn" className="text-sm font-medium text-white cursor-pointer">
                      Email me weekly challenges
                    </label>
                    <p className="text-xs text-surface-400 mt-0.5">
                      Get notified when new Arena Challenges drop every Monday. You can unsubscribe anytime.
                    </p>
                  </div>
                </div>

                {/* Optional avatar customization kept below core signup fields */}
                <div className="bg-surface-800/30 rounded-xl border border-surface-700/50 p-3 sm:p-4">
                  <button
                    type="button"
                    onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                    className="w-full flex items-center justify-between text-left"
                    aria-expanded={showAvatarPicker}
                    aria-controls="avatar-picker-panel"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">Customize avatar (optional)</p>
                      <p className="text-xs text-surface-400 mt-0.5">Upload a photo or pick an emoji avatar.</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-surface-700 flex-shrink-0 flex items-center justify-center overflow-hidden">
                      {profilePicPreview ? (
                        <img src={profilePicPreview} alt="Profile preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-lg">
                          {getAvatarEmoji(selectedAvatar)}
                        </div>
                      )}
                    </div>
                  </button>

                  {showAvatarPicker && (
                    <div
                      id="avatar-picker-panel"
                      className="mt-3 pt-3 border-t border-surface-700"
                    >
                      {/* Profile picture upload */}
                      <div className="mb-3">
                        <p className="text-xs font-medium text-surface-400 mb-2">Upload a photo</p>
                        <div className="flex items-center gap-3">
                          <div className="w-16 h-16 rounded-full bg-surface-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {profilePicPreview ? (
                              <img src={profilePicPreview} alt="Profile preview" className="w-full h-full object-cover" />
                            ) : (
                              <Camera className="w-6 h-6 text-surface-500" />
                            )}
                          </div>
                          <div className="flex-1 flex flex-col gap-2">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="px-3 py-1.5 text-xs font-medium bg-surface-700 hover:bg-surface-600 text-white rounded-lg transition-colors"
                            >
                              {profilePicPreview ? 'Change photo' : 'Choose photo'}
                            </button>
                            {profilePicPreview && (
                              <button
                                type="button"
                                onClick={removeProfilePic}
                                className="px-3 py-1.5 text-xs font-medium text-surface-400 hover:text-red-400 transition-colors flex items-center gap-1"
                              >
                                <X className="w-3 h-3" /> Remove
                              </button>
                            )}
                            <p className="text-[10px] text-surface-500">JPEG, PNG, GIF, or WebP. Max 5MB.</p>
                          </div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
                            onChange={handleProfilePicChange}
                            className="hidden"
                          />
                        </div>
                      </div>

                      {/* Emoji avatar picker */}
                      <div className="pt-3 border-t border-surface-700">
                        <p className="text-xs font-medium text-surface-400 mb-2">Or pick an emoji</p>
                        <div className="grid grid-cols-5 gap-2">
                          {REGISTER_AVATARS.map((avatar) => (
                            <button
                              key={avatar.id}
                              type="button"
                              onClick={() => { setSelectedAvatar(avatar.id); removeProfilePic(); }}
                              className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-xl transition-all ${
                                selectedAvatar === avatar.id && !profilePicPreview
                                  ? 'ring-2 ring-primary-400 bg-primary-500/20'
                                  : 'bg-surface-700 hover:bg-surface-600'
                              }`}
                              aria-label={`Select ${avatar.name || avatar.id} avatar`}
                              aria-pressed={selectedAvatar === avatar.id && !profilePicPreview}
                            >
                              {avatar.emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Optional social links */}
                <div className="bg-surface-800/30 rounded-xl border border-surface-700/50 p-3 sm:p-4">
                  <button
                    type="button"
                    onClick={() => setShowSocialLinks(!showSocialLinks)}
                    className="w-full flex items-center justify-between text-left"
                    aria-expanded={showSocialLinks}
                    aria-controls="social-links-panel"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">Add social links (optional)</p>
                      <p className="text-xs text-surface-400 mt-0.5">Show your LinkedIn, GitHub, or X on your profile.</p>
                    </div>
                    <div className="flex -space-x-1">
                      <div className="w-6 h-6 rounded-full bg-[#0A66C2] flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                      </div>
                      <div className="w-6 h-6 rounded-full bg-surface-700 flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                      </div>
                      <div className="w-6 h-6 rounded-full bg-surface-700 flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                      </div>
                    </div>
                  </button>

                  {showSocialLinks && (
                    <div
                      id="social-links-panel"
                      className="mt-3 pt-3 border-t border-surface-700 space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <label htmlFor="linkedin-url" className="w-8 h-8 rounded-lg bg-[#0A66C2] flex items-center justify-center flex-shrink-0 cursor-pointer">
                          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                        </label>
                        <input
                          id="linkedin-url"
                          type="url"
                          value={linkedinUrl}
                          onChange={(e) => setLinkedinUrl(e.target.value)}
                          placeholder="linkedin.com/in/username"
                          aria-label="LinkedIn profile URL"
                          className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-white text-sm placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label htmlFor="github-url" className="w-8 h-8 rounded-lg bg-surface-700 flex items-center justify-center flex-shrink-0 cursor-pointer">
                          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                        </label>
                        <input
                          id="github-url"
                          type="url"
                          value={githubUrl}
                          onChange={(e) => setGithubUrl(e.target.value)}
                          placeholder="github.com/username"
                          aria-label="GitHub profile URL"
                          className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-white text-sm placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label htmlFor="twitter-url" className="w-8 h-8 rounded-lg bg-surface-700 flex items-center justify-center flex-shrink-0 cursor-pointer">
                          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        </label>
                        <input
                          id="twitter-url"
                          type="url"
                          value={twitterUrl}
                          onChange={(e) => setTwitterUrl(e.target.value)}
                          placeholder="x.com/username"
                          aria-label="X (Twitter) profile URL"
                          className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-white text-sm placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Error Message */}
                {error && (
                  <p className="text-sm text-red-400">{error}</p>
                )}

                {/* Terms Notice */}
                <p className="text-xs text-surface-500 text-center">
                  By creating an account, you agree to our{' '}
                  <Link href="/terms" className="text-primary-400 hover:text-primary-300">
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link href="/privacy" className="text-primary-400 hover:text-primary-300">
                    Privacy Policy
                  </Link>
                </p>

                {/* Submit Button */}
                <Button
                  type="submit"
                  variant="secondary"
                  fullWidth
                  size="lg"
                  loading={isLoading}
                  disabled={isLoading || !isPasswordValid || !doPasswordsMatch || usernameStatus.available === false || usernameStatus.checking}
                >
                  {isLoading ? 'Creating account...' : usernameStatus.checking ? 'Checking username...' : 'Create Account'}
                </Button>

              </form>

              {/* Login Link */}
              <div className="mt-6 text-center">
                <p className="text-surface-400">
                  Already on CodeArena?{' '}
                  <Link
                    href="/login"
                    className="text-primary-400 hover:underline transition-all"
                  >
                    Sign in
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
