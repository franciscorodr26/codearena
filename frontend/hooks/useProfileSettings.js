import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AVATARS } from '../utils/avatars';
import { fetchWithTimeout } from '../utils/fetch';
import { config } from '../config/env';

/**
 * Custom hook for profile-related state management.
 * Handles username, bio, avatar, social links, password, email change,
 * editor preferences, data export, and account deletion.
 */
export function useProfileSettings() {
  const {
    user,
    token,
    updateProfile,
    checkUsernameAvailability,
    changePassword,
    setPassword,
    initiateEmailChange,
    refreshUser,
    logout
  } = useAuth();

  // Profile fields
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('default-1');
  const [usernameStatus, setUsernameStatus] = useState({ checking: false, available: null, reason: null });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeCategory, setActiveCategory] = useState('Default');
  const [flagSearch, setFlagSearch] = useState('');

  // Profile photo upload state
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState(null);

  // Password modal state
  const [hasPassword, setHasPassword] = useState(true);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Email change state
  const [showEmailChangeForm, setShowEmailChangeForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailChangePassword, setEmailChangePassword] = useState('');
  const [showEmailPassword, setShowEmailPassword] = useState(false);
  const [emailChangeLoading, setEmailChangeLoading] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState('');
  const [emailChangeSuccess, setEmailChangeSuccess] = useState('');

  // Editor preferences state
  const [editorPrefs, setEditorPrefs] = useState({ vimMode: false });

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Data export state
  const [exportLoading, setExportLoading] = useState(false);

  // Reauth modal state
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [reauthCallback, setReauthCallback] = useState(null);

  // Username cooldown calculation
  const getUsernameCooldown = () => {
    if ((user?.username_change_count || 0) < 2) return null;
    if (!user?.username_changed_at) return null;
    const lastChange = new Date(user.username_changed_at);
    const daysSinceChange = (Date.now() - lastChange.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceChange >= 7) return null;
    const daysRemaining = Math.ceil(7 - daysSinceChange);
    return { daysRemaining };
  };
  const usernameCooldown = getUsernameCooldown();

  const categories = [...new Set(AVATARS.map(a => a.category))];

  // Auto-dismiss success messages
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Fetch user data to check if they have a password + refresh user (single /auth/me call)
  useEffect(() => {
    const fetchUserData = async () => {
      if (!token) return;
      try {
        const res = await fetchWithTimeout(`${config.backend_url}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setHasPassword(data.user.has_password !== false);
        }
      } catch (err) {
        console.error('Failed to fetch user data:', err);
      }
    };
    fetchUserData();
  }, [token]);

  // Load editor preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('editor_preferences');
    if (saved) {
      try {
        setEditorPrefs(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse editor preferences:', e);
      }
    }
  }, []);

  // Load current user data
  useEffect(() => {
    if (user) {
      setUsername(user.username || '');
      setBio(user.bio || '');
      setGithubUrl(user.github_url || '');
      setLinkedinUrl(user.linkedin_url || '');
      setTwitterUrl(user.twitter_url || '');
      setSelectedAvatar(user.avatar || 'default-1');
    }
    // Populate once per account so refreshUser() cannot wipe unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Debounced username check
  useEffect(() => {
    if (!username || username.length < 3 || username === user?.username) {
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
      const result = await checkUsernameAvailability(username);
      setUsernameStatus({
        checking: false,
        available: result.available,
        reason: result.reason
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [username, user?.username, checkUsernameAvailability]);

  // Save editor preferences
  const handleEditorPrefChange = (key) => {
    const newPrefs = { ...editorPrefs, [key]: !editorPrefs[key] };
    setEditorPrefs(newPrefs);
    localStorage.setItem('editor_preferences', JSON.stringify(newPrefs));
  };

  // Helper to handle API responses that may require re-authentication
  const handleApiResponseWithReauth = async (response, retryCallback) => {
    if (!response.ok) {
      const data = await response.json();
      if (data.requiresReauth) {
        setReauthCallback(() => retryCallback);
        setShowReauthModal(true);
        return { requiresReauth: true };
      }
      return { error: data.error || 'An error occurred' };
    }
    return response.json();
  };

  // Export data handler
  const handleExportData = async () => {
    setExportLoading(true);
    try {
      const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const res = await fetch(`${config.backend_url}/auth/export-data`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `codearena-data-export-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExportLoading(false);
    }
  };

  // Delete account handler
  const handleDeleteAccount = async (router) => {
    if (deleteConfirmText !== 'DELETE' || !deletePassword) return;

    setDeleteLoading(true);
    setDeleteError('');

    try {
      const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const res = await fetchWithTimeout(`${config.backend_url}/auth/delete-account`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ password: deletePassword })
      });

      const data = await res.json();

      if (!res.ok) {
        setDeleteError(data.error || 'Failed to delete account');
        setDeleteLoading(false);
        return;
      }

      logout();
      router.push('/?deleted=true');
    } catch (err) {
      console.error('Delete account error:', err);
      setDeleteError('An error occurred. Please try again.');
      setDeleteLoading(false);
    }
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    setError('');
    setSuccess('');

    if (username !== user?.username) {
      if (username.length < 3) {
        setError('Username must be at least 3 characters');
        return;
      }
      if (!usernameStatus.available) {
        setError('Please choose an available username');
        return;
      }
    }

    // Normalize and validate GitHub URL
    let normalizedGithub = githubUrl.trim();
    if (normalizedGithub && !normalizedGithub.match(/^https?:\/\//)) {
      normalizedGithub = 'https://' + normalizedGithub;
    }
    if (normalizedGithub && !/^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+\/?$/.test(normalizedGithub)) {
      setError('Invalid GitHub URL. Use format: github.com/username');
      return;
    }

    // Normalize and validate LinkedIn URL
    let normalizedLinkedin = linkedinUrl.trim();
    if (normalizedLinkedin && !normalizedLinkedin.match(/^https?:\/\//)) {
      normalizedLinkedin = 'https://' + normalizedLinkedin;
    }
    if (normalizedLinkedin && !/^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?$/.test(normalizedLinkedin)) {
      setError('Invalid LinkedIn URL. Use format: linkedin.com/in/username');
      return;
    }

    // Normalize and validate Twitter/X URL
    let normalizedTwitter = twitterUrl.trim();
    if (normalizedTwitter && !normalizedTwitter.match(/^https?:\/\//)) {
      normalizedTwitter = 'https://' + normalizedTwitter;
    }
    if (normalizedTwitter && !/^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/?$/.test(normalizedTwitter)) {
      setError('Invalid Twitter/X URL. Use format: x.com/username');
      return;
    }

    setIsLoading(true);

    // Update state with normalized URLs
    if (normalizedGithub !== githubUrl) setGithubUrl(normalizedGithub);
    if (normalizedLinkedin !== linkedinUrl) setLinkedinUrl(normalizedLinkedin);
    if (normalizedTwitter !== twitterUrl) setTwitterUrl(normalizedTwitter);

    try {
      const updates = {};

      if (username !== user?.username) {
        updates.username = username;
      }
      if (selectedAvatar !== user?.avatar) {
        updates.avatar = selectedAvatar;
        // If user has a profile picture and is switching to emoji, remove the photo first
        if (user?.avatar_url) {
          const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
          await fetch(`${config.backend_url}/auth/avatar`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${authToken}` }
          });
        }
      }
      if (bio !== (user?.bio || '')) {
        updates.bio = bio;
      }
      if (normalizedGithub !== (user?.github_url || '')) {
        updates.github_url = normalizedGithub;
      }
      if (normalizedLinkedin !== (user?.linkedin_url || '')) {
        updates.linkedin_url = normalizedLinkedin;
      }
      if (normalizedTwitter !== (user?.twitter_url || '')) {
        updates.twitter_url = normalizedTwitter;
      }

      if (Object.keys(updates).length === 0) {
        setSuccess('No changes to save');
        setIsLoading(false);
        return;
      }

      const oldUsername = user?.username;
      await updateProfile(updates);
      setSuccess('Profile updated successfully!');

      if (updates.username && updates.username !== oldUsername) {
        window.history.replaceState(null, '', '/settings/profile');
      }
    } catch (err) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async ({ currentPassword, newPassword }) => {
    setPasswordLoading(true);
    try {
      if (hasPassword) {
        await changePassword(currentPassword, newPassword);
      } else {
        await setPassword(newPassword);
        setHasPassword(true);
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleEmailChange = async () => {
    if (emailChangeLoading) return;
    setEmailChangeError('');
    setEmailChangeSuccess('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      setEmailChangeError('Please enter a valid email address');
      return;
    }

    if (newEmail.toLowerCase() === user?.email?.toLowerCase()) {
      setEmailChangeError('New email must be different from your current email');
      return;
    }

    if (!emailChangePassword) {
      setEmailChangeError('Please enter your password to confirm');
      return;
    }

    setEmailChangeLoading(true);

    try {
      await initiateEmailChange(newEmail, emailChangePassword);
      setEmailChangeSuccess('Verification email sent! Check your new email inbox.');
      setNewEmail('');
      setEmailChangePassword('');
      setShowEmailChangeForm(false);
    } catch (err) {
      setEmailChangeError(err.message || 'Failed to initiate email change');
    } finally {
      setEmailChangeLoading(false);
    }
  };

  const getAvatarEmojiLocal = (avatarId) => {
    const avatar = AVATARS.find(a => a.id === avatarId);
    return avatar?.emoji || '';
  };

  // Profile photo - open crop modal with selected file
  const handlePhotoSelect = (file) => {
    if (!file) return;

    // Client-side validation
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      setPhotoError('Image must be under 5MB');
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    if (file.type && !allowedTypes.includes(file.type)) {
      setPhotoError('Supported formats: JPEG, PNG, GIF, WebP, HEIC');
      return;
    }

    setPhotoError('');
    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result);
      setCropModalOpen(true);
    };
    reader.onerror = () => {
      setPhotoError('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  };

  // Upload cropped image blob
  const handleCroppedUpload = async (blob) => {
    setPhotoUploading(true);
    setPhotoError('');

    try {
      const formData = new FormData();
      formData.append('avatar', blob, 'avatar.jpg');

      const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const res = await fetch(`${config.backend_url}/auth/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData
      });

      let data;
      try {
        data = await res.json();
      } catch {
        setPhotoError('Server error. Please try again.');
        return;
      }

      if (!res.ok) {
        setPhotoError(data.error || 'Upload failed');
        return;
      }

      // Refresh user data
      const freshRes = await fetch(`${config.backend_url}/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}`, 'Cache-Control': 'no-cache' },
      });
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        const userData = freshData.user || freshData;
        localStorage.setItem('auth_user', JSON.stringify(userData));
        if (refreshUser) await refreshUser();
      }
      setCropImageSrc(null);
      setSuccess('Profile photo updated!');
    } catch (err) {
      console.error('[AVATAR] Upload error:', err);
      setPhotoError('Upload failed. Please try again.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handlePhotoRemove = async () => {
    setPhotoUploading(true);
    setPhotoError('');

    try {
      const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const res = await fetch(`${config.backend_url}/auth/avatar`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (!res.ok) {
        const data = await res.json();
        setPhotoError(data.error || 'Failed to remove photo');
        return;
      }

      // Force fresh fetch to bypass browser cache
      const freshRes = await fetch(`${config.backend_url}/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}`, 'Cache-Control': 'no-cache' },
      });
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        const userData = freshData.user || freshData;
        localStorage.setItem('auth_user', JSON.stringify(userData));
        if (refreshUser) await refreshUser();
      }
      setSuccess('Profile photo removed');
    } catch (err) {
      setPhotoError('Failed to remove photo. Please try again.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setDeletePassword('');
    setDeleteConfirmText('');
    setDeleteError('');
  };

  return {
    // Auth context values needed by the UI
    user,
    token,
    refreshUser,

    // Profile fields
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

    // Profile photo
    photoUploading,
    photoError,
    handlePhotoSelect,
    handleCroppedUpload,
    handlePhotoRemove,
    cropModalOpen,
    setCropModalOpen,
    cropImageSrc,

    // Password
    hasPassword,
    showPasswordModal,
    setShowPasswordModal,
    passwordLoading,

    // Email change
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

    // Editor prefs
    editorPrefs,
    handleEditorPrefChange,

    // Delete account
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

    // Data export
    exportLoading,
    handleExportData,

    // Reauth
    showReauthModal,
    setShowReauthModal,
    reauthCallback,
    setReauthCallback,

    // Handlers
    handleProfileSubmit,
    handlePasswordSubmit,
    handleEmailChange,
    handleDeleteAccount,
    handleApiResponseWithReauth,
    getAvatarEmojiLocal,
  };
}
