/**
 * Frontend Analytics Utility
 *
 * Handles user identification and event tracking for Mixpanel.
 * - Uses user.id for authenticated users
 * - Creates persistent anonymous ID for guests (stored in localStorage)
 * - Provides easy-to-use tracking functions
 * - GDPR compliant: Only tracks if user has given consent
 */

import { config } from '../config/env';
import { hasAnalyticsConsent } from '../contexts/CookieConsentContext';

// Key for storing anonymous ID
const ANON_ID_KEY = 'codearena_anon_id';

/**
 * Generate a UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Get or create a persistent anonymous ID for guest users
 * Only creates/reads ID if analytics consent has been given
 */
function getAnonymousId() {
  if (typeof window === 'undefined') return null;

  // Check consent before accessing anonymous ID
  if (!hasAnalyticsConsent()) {
    return null;
  }

  let anonId = localStorage.getItem(ANON_ID_KEY);
  if (!anonId) {
    anonId = generateUUID();
    localStorage.setItem(ANON_ID_KEY, anonId);
  }
  return anonId;
}

/**
 * Get the current user's ID for analytics
 * - Returns user.id if authenticated
 * - Returns persistent anonymous ID if guest
 */
export function getAnalyticsId(user = null) {
  // If user is passed and has an ID, use it
  if (user?.id) {
    return String(user.id);
  }

  // Try to get from localStorage (for when user context isn't available)
  if (typeof window !== 'undefined') {
    const storedUser = localStorage.getItem('auth_user');
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        if (parsed?.id) return String(parsed.id);
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  // Fall back to anonymous ID
  return getAnonymousId();
}

/**
 * Check if the current user is authenticated
 */
export function isAuthenticated() {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('auth_token');
}

/**
 * Get UTM parameters and referral code from URL
 */
function getUtmParams() {
  if (typeof window === 'undefined') return {};

  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get('utm_source'),
    utmMedium: params.get('utm_medium'),
    utmCampaign: params.get('utm_campaign'),
    utmTerm: params.get('utm_term'),
    utmContent: params.get('utm_content'),
    ref: params.get('ref')
  };
}

/**
 * Send tracking event to backend
 * Only sends if user has given analytics consent (GDPR compliance)
 */
async function sendTrackEvent(event, props = {}, user = null) {
  // Check analytics consent before tracking
  if (!hasAnalyticsConsent()) {
    return; // Silently skip tracking if no consent
  }

  try {
    const playerId = getAnalyticsId(user);

    const trackingData = {
      event,
      playerId,
      props: {
        ...props,
        isAuthenticated: isAuthenticated(),
        clientTs: Date.now()
      },
      timestamp: new Date().toISOString()
    };

    const response = await fetch(`${config.backend_url}/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(trackingData),
      credentials: 'include'
    });
    if (!response.ok && process.env.NODE_ENV === 'development') {
      console.warn(`[analytics] Track endpoint returned ${response.status}; skipping ${event}`);
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[analytics] Track endpoint unavailable; skipping ${event}`);
    }
  }
}

// ============================================================================
// PAGE VIEW EVENTS
// ============================================================================

/**
 * Track home page view
 */
export function trackViewHome(user = null) {
  const utmParams = getUtmParams();
  sendTrackEvent('view-home', {
    referrer: typeof document !== 'undefined' ? document.referrer || 'direct' : 'unknown',
    ...utmParams
  }, user);
}

/**
 * Track a homepage call-to-action click (which CTA, where it leads)
 */
export function trackHomeCtaClick(cta, destination, user = null) {
  sendTrackEvent('home-cta-click', { cta, destination }, user);
}

/**
 * Track build-challenge (biweekly prompt-build) engagement
 */
export function trackViewBuildChallenge(user = null, props = {}) {
  sendTrackEvent('view-build-challenge', props, user);
}

export function trackSubmitBuildEntry(props = {}, user = null) {
  sendTrackEvent('submit-build-entry', props, user);
}

export function trackVoteBuildChallenge(props = {}, user = null) {
  sendTrackEvent('vote-build-challenge', props, user);
}

export function trackCreateOpenBuild(props = {}, user = null) {
  sendTrackEvent('create-open-build', props, user);
}

/**
 * Track modes page view
 */
export function trackViewModes(user = null) {
  sendTrackEvent('view-modes', {
    referrerPage: typeof document !== 'undefined' ? document.referrer || 'direct' : 'unknown'
  }, user);
}

// ============================================================================
// USER LIFECYCLE EVENTS
// ============================================================================

/**
 * Track user signup
 */
export function trackSignup(userId, props = {}) {
  sendTrackEvent('user-signup', {
    userId: String(userId),
    ...props
  });
}

/**
 * Track user login
 */
export function trackLogin(user) {
  // Link anonymous ID to authenticated user
  const anonId = getAnonymousId();
  sendTrackEvent('user-login', {
    userId: String(user.id),
    username: user.username,
    previousAnonId: anonId
  }, user);
}

/**
 * Track session start - used for DAU/MAU metrics
 * Called when a user session begins (login or returning from stored auth)
 */
export function trackSessionStart(user, props = {}) {
  const sessionData = {
    userId: user?.id ? String(user.id) : null,
    username: user?.username,
    sessionType: props.sessionType || 'returning', // 'new_login', 'returning', 'google_login'
    referrer: typeof document !== 'undefined' ? document.referrer || 'direct' : 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    screenWidth: typeof window !== 'undefined' ? window.screen?.width : null,
    screenHeight: typeof window !== 'undefined' ? window.screen?.height : null,
    timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
    language: typeof navigator !== 'undefined' ? navigator.language : null,
    platform: typeof navigator !== 'undefined' ? navigator.platform : null
  };

  sendTrackEvent('session-start', sessionData, user);
}

// ============================================================================
// GAME MODE SELECTION EVENTS
// ============================================================================

/**
 * Track game mode selection
 */
export function trackSelectGameMode(modeSelected, user = null) {
  sendTrackEvent('select-game-mode', {
    modeSelected
  }, user);
}

// ============================================================================
// MATCHMAKING EVENTS
// ============================================================================

/**
 * Track begin matchmaking (entering queue)
 */
export function trackBeginMatchmaking(props = {}, user = null) {
  sendTrackEvent('begin-matchmaking', {
    playerName: props.playerName,
    language: props.language,
    queueType: props.queueType || 'QUICK_MATCH'
  }, user);
}

/**
 * Track end matchmaking (match found, timeout, or cancelled)
 */
export function trackEndMatchmaking(props = {}, user = null) {
  sendTrackEvent('end-matchmaking', {
    outcome: props.outcome, // 'MATCH_FOUND', 'TIMEOUT', 'CANCELLED'
    waitTimeSeconds: props.waitTimeSeconds,
    battleId: props.battleId,
    opponentName: props.opponentName
  }, user);
}

// ============================================================================
// BATTLE EVENTS
// ============================================================================

/**
 * Track battle start
 */
export function trackStartBattle(props = {}, user = null) {
  sendTrackEvent('start-battle', {
    battleId: props.battleId,
    problemId: props.problemId,
    problemName: props.problemName,
    battleType: props.battleType,
    language: props.language
  }, user);
}

/**
 * Track solution submission
 */
export function trackSubmitSolution(props = {}, user = null) {
  sendTrackEvent('submit-solution', {
    battleId: props.battleId,
    problemId: props.problemId,
    accepted: props.accepted,
    testcasesPassed: props.testcasesPassed,
    testcasesFailed: props.testcasesFailed
  }, user);
}

/**
 * Track battle end
 */
export function trackEndBattle(props = {}, user = null) {
  sendTrackEvent('end-battle', {
    battleId: props.battleId,
    problemId: props.problemId,
    playerResult: props.playerResult, // 'WIN', 'LOSE', 'FORFEIT', 'ABANDON', 'TIMEOUT'
    durationSeconds: props.durationSeconds,
    problemSolved: props.problemSolved,
    battleType: props.battleType
  }, user);
}

// ============================================================================
// REMATCH EVENTS
// ============================================================================

/**
 * Track rematch request
 */
export function trackRequestRematch(props = {}, user = null) {
  sendTrackEvent('request-rematch', {
    originalBattleId: props.battleId,
    opponentName: props.opponentName
  }, user);
}

/**
 * Track rematch response
 */
export function trackRespondRematch(props = {}, user = null) {
  sendTrackEvent('respond-rematch', {
    originalBattleId: props.battleId,
    response: props.accepted ? 'ACCEPT' : 'DECLINE'
  }, user);
}

// ============================================================================
// ONBOARDING EVENTS
// ============================================================================

/**
 * Track onboarding started
 */
export function trackOnboardingStarted(user = null) {
  sendTrackEvent('onboarding-started', {}, user);
}

/**
 * Track onboarding step viewed
 */
export function trackOnboardingStep(props = {}, user = null) {
  sendTrackEvent('onboarding-step', {
    stepNumber: props.stepNumber,
    stepTitle: props.stepTitle,
    totalSteps: props.totalSteps
  }, user);
}

/**
 * Track onboarding completed
 */
export function trackOnboardingCompleted(props = {}, user = null) {
  sendTrackEvent('onboarding-completed', {
    completedSteps: props.completedSteps,
    totalSteps: props.totalSteps,
    timeSpentSeconds: props.timeSpentSeconds
  }, user);
}

/**
 * Track onboarding skipped
 */
export function trackOnboardingSkipped(props = {}, user = null) {
  sendTrackEvent('onboarding-skipped', {
    skippedAtStep: props.skippedAtStep,
    totalSteps: props.totalSteps,
    timeSpentSeconds: props.timeSpentSeconds
  }, user);
}

// ============================================================================
// PRACTICE MODE EVENTS
// ============================================================================

/**
 * Track practice session start
 */
export function trackPracticeStart(props = {}, user = null) {
  sendTrackEvent('practice-start', {
    problemId: props.problemId,
    problemName: props.problemName,
    difficulty: props.difficulty,
    category: props.category,
    language: props.language
  }, user);
}

/**
 * Track practice problem attempt (submission)
 */
export function trackPracticeAttempt(props = {}, user = null) {
  sendTrackEvent('practice-attempt', {
    problemId: props.problemId,
    problemName: props.problemName,
    difficulty: props.difficulty,
    language: props.language,
    passed: props.passed,
    testcasesPassed: props.testcasesPassed,
    testcasesTotal: props.testcasesTotal,
    timeSpentSeconds: props.timeSpentSeconds
  }, user);
}

/**
 * Track practice problem completed (solved)
 */
export function trackPracticeComplete(props = {}, user = null) {
  sendTrackEvent('practice-complete', {
    problemId: props.problemId,
    problemName: props.problemName,
    difficulty: props.difficulty,
    category: props.category,
    language: props.language,
    solveTimeSeconds: props.solveTimeSeconds,
    attemptCount: props.attemptCount
  }, user);
}

/**
 * Track next problem in practice mode
 */
export function trackPracticeNextProblem(props = {}, user = null) {
  sendTrackEvent('practice-next-problem', {
    previousProblemId: props.previousProblemId,
    previousProblemSolved: props.previousProblemSolved,
    newProblemId: props.newProblemId,
    sessionProblemCount: props.sessionProblemCount
  }, user);
}

// ============================================================================
// AUTH FUNNEL EVENTS
// ============================================================================

/**
 * Track user logout
 */
export function trackLogout(props = {}, user = null) {
  sendTrackEvent('user-logout', {
    sessionDurationSeconds: props.sessionDurationSeconds,
    userId: user?.id ? String(user.id) : null
  }, user);
}

/**
 * Track register form view (signup funnel)
 */
export function trackViewRegisterForm(user = null) {
  sendTrackEvent('view-register-form', {
    referrer: typeof document !== 'undefined' ? document.referrer || 'direct' : 'unknown'
  }, user);
}

/**
 * Track login form view (login funnel)
 */
export function trackViewLoginForm(user = null) {
  sendTrackEvent('view-login-form', {
    referrer: typeof document !== 'undefined' ? document.referrer || 'direct' : 'unknown'
  }, user);
}

/**
 * Track signup error
 */
export function trackSignupError(props = {}, user = null) {
  sendTrackEvent('signup-error', {
    errorType: props.errorType,
    errorMessage: props.errorMessage,
    username: props.username,
    hasEmail: !!props.email
  }, user);
}

/**
 * Track login error
 */
export function trackLoginError(props = {}, user = null) {
  sendTrackEvent('login-error', {
    errorType: props.errorType,
    errorMessage: props.errorMessage,
    username: props.username
  }, user);
}

// ============================================================================
// SOCIAL / FRIEND EVENTS
// ============================================================================

/**
 * Track friend request sent
 */
export function trackFriendRequestSent(props = {}, user = null) {
  sendTrackEvent('friend-request-sent', {
    targetUserId: props.targetUserId,
    targetUsername: props.targetUsername,
    source: props.source // 'profile', 'leaderboard', 'battle_end', 'search'
  }, user);
}

/**
 * Track friend request accepted
 */
export function trackFriendRequestAccepted(props = {}, user = null) {
  sendTrackEvent('friend-request-accepted', {
    fromUserId: props.fromUserId,
    fromUsername: props.fromUsername
  }, user);
}

/**
 * Track friend request declined
 */
export function trackFriendRequestDeclined(props = {}, user = null) {
  sendTrackEvent('friend-request-declined', {
    fromUserId: props.fromUserId,
    fromUsername: props.fromUsername
  }, user);
}

/**
 * Track friend removed
 */
export function trackFriendRemoved(props = {}, user = null) {
  sendTrackEvent('friend-removed', {
    friendUserId: props.friendUserId,
    friendUsername: props.friendUsername
  }, user);
}

// ============================================================================
// PAGE VIEW EVENTS (ADDITIONAL)
// ============================================================================

/**
 * Track leaderboard view
 */
export function trackViewLeaderboard(props = {}, user = null) {
  sendTrackEvent('view-leaderboard', {
    tab: props.tab // 'global', 'friends', etc.
  }, user);
}

/**
 * Track profile view
 */
export function trackViewProfile(props = {}, user = null) {
  sendTrackEvent('view-profile', {
    profileUserId: props.profileUserId,
    profileUsername: props.profileUsername,
    isOwnProfile: props.isOwnProfile
  }, user);
}

/**
 * Track practice page view
 */
export function trackViewPractice(user = null) {
  sendTrackEvent('view-practice', {
    referrer: typeof document !== 'undefined' ? document.referrer || 'direct' : 'unknown'
  }, user);
}

// ============================================================================
// SUBSCRIPTION / PAYMENT EVENTS
// ============================================================================

/**
 * Track pricing page view
 */
export function trackViewPricing(props = {}, user = null) {
  sendTrackEvent('view-pricing', {
    referrer: typeof document !== 'undefined' ? document.referrer || 'direct' : 'unknown',
    source: props.source // 'navbar', 'upgrade_prompt', 'feature_gate', etc.
  }, user);
}

/**
 * Track when user clicks on a plan (starts checkout intent)
 */
export function trackSelectPlan(props = {}, user = null) {
  sendTrackEvent('select-plan', {
    planType: props.planType, // 'monthly', 'annual'
    planPrice: props.planPrice,
    currency: props.currency || 'USD'
  }, user);
}

/**
 * Track checkout started (redirected to payment)
 */
export function trackCheckoutStarted(props = {}, user = null) {
  sendTrackEvent('checkout-started', {
    planType: props.planType,
    planPrice: props.planPrice,
    currency: props.currency || 'USD',
    checkoutSessionId: props.checkoutSessionId
  }, user);
}

/**
 * Track successful subscription
 */
export function trackSubscriptionCreated(props = {}, user = null) {
  sendTrackEvent('subscription-created', {
    planType: props.planType, // 'monthly', 'annual'
    planPrice: props.planPrice,
    currency: props.currency || 'USD',
    subscriptionId: props.subscriptionId
  }, user);
}

/**
 * Track subscription cancelled
 */
export function trackSubscriptionCancelled(props = {}, user = null) {
  sendTrackEvent('subscription-cancelled', {
    planType: props.planType,
    reason: props.reason, // optional cancellation reason
    subscriptionDurationDays: props.subscriptionDurationDays
  }, user);
}

/**
 * Track subscription renewed
 */
export function trackSubscriptionRenewed(props = {}, user = null) {
  sendTrackEvent('subscription-renewed', {
    planType: props.planType,
    planPrice: props.planPrice,
    renewalCount: props.renewalCount
  }, user);
}

/**
 * Track payment failed
 */
export function trackPaymentFailed(props = {}, user = null) {
  sendTrackEvent('payment-failed', {
    planType: props.planType,
    errorType: props.errorType,
    errorMessage: props.errorMessage
  }, user);
}

/**
 * Track plan change (upgrade/downgrade)
 */
export function trackPlanChanged(props = {}, user = null) {
  sendTrackEvent('plan-changed', {
    fromPlan: props.fromPlan,
    toPlan: props.toPlan,
    changeType: props.changeType // 'upgrade', 'downgrade'
  }, user);
}

/**
 * Track Pro feature gate hit (user tried to access Pro feature without subscription)
 */
export function trackProFeatureGate(props = {}, user = null) {
  sendTrackEvent('pro-feature-gate', {
    feature: props.feature, // 'ai_coach', 'advanced_analytics', etc.
    action: props.action // 'viewed', 'clicked_upgrade'
  }, user);
}

// ============================================================================
// TOURNAMENT ANALYTICS
// ============================================================================

/**
 * Track tournament page view
 */
export function trackViewTournament(props = {}, user = null) {
  sendTrackEvent('view-tournament', {
    tournamentId: props.tournamentId,
    tournamentName: props.tournamentName,
    status: props.status
  }, user);
}

/**
 * Track tournament registration
 */
export function trackTournamentRegister(props = {}, user = null) {
  sendTrackEvent('tournament-register', {
    tournamentId: props.tournamentId,
    tournamentName: props.tournamentName,
    participantCount: props.participantCount
  }, user);
}

/**
 * Track tournament unregister
 */
export function trackTournamentUnregister(props = {}, user = null) {
  sendTrackEvent('tournament-unregister', {
    tournamentId: props.tournamentId,
    tournamentName: props.tournamentName
  }, user);
}

/**
 * Track tournament match start
 */
export function trackTournamentMatchStart(props = {}, user = null) {
  sendTrackEvent('tournament-match-start', {
    tournamentId: props.tournamentId,
    tournamentName: props.tournamentName,
    matchId: props.matchId,
    round: props.round,
    opponentId: props.opponentId,
    opponentName: props.opponentName,
    problemId: props.problemId
  }, user);
}

/**
 * Track tournament match complete
 */
export function trackTournamentMatchComplete(props = {}, user = null) {
  sendTrackEvent('tournament-match-complete', {
    tournamentId: props.tournamentId,
    tournamentName: props.tournamentName,
    matchId: props.matchId,
    round: props.round,
    result: props.result, // 'win', 'lose'
    opponentId: props.opponentId,
    opponentName: props.opponentName,
    durationSeconds: props.durationSeconds
  }, user);
}

/**
 * Track tournament complete (final placement)
 */
export function trackTournamentComplete(props = {}, user = null) {
  sendTrackEvent('tournament-complete', {
    tournamentId: props.tournamentId,
    tournamentName: props.tournamentName,
    placement: props.placement,
    totalParticipants: props.totalParticipants,
    matchesPlayed: props.matchesPlayed,
    matchesWon: props.matchesWon
  }, user);
}

// ============================================================================
// WEEKLY CHALLENGE ANALYTICS
// ============================================================================

/**
 * Track weekly challenge view
 */
export function trackViewChallenge(props = {}, user = null) {
  sendTrackEvent('view-challenge', {
    challengeId: props.challengeId,
    problemId: props.problemId,
    problemName: props.problemName,
    difficulty: props.difficulty
  }, user);
}

/**
 * Track challenge attempt start
 */
export function trackChallengeStart(props = {}, user = null) {
  sendTrackEvent('challenge-start', {
    challengeId: props.challengeId,
    problemId: props.problemId,
    problemName: props.problemName,
    difficulty: props.difficulty,
    language: props.language
  }, user);
}

/**
 * Track challenge submission
 */
export function trackChallengeSubmit(props = {}, user = null) {
  sendTrackEvent('challenge-submit', {
    challengeId: props.challengeId,
    problemId: props.problemId,
    language: props.language,
    accepted: props.accepted,
    testcasesPassed: props.testcasesPassed,
    testcasesFailed: props.testcasesFailed,
    attemptNumber: props.attemptNumber
  }, user);
}

/**
 * Track challenge complete (solved)
 */
export function trackChallengeComplete(props = {}, user = null) {
  sendTrackEvent('challenge-complete', {
    challengeId: props.challengeId,
    problemId: props.problemId,
    problemName: props.problemName,
    difficulty: props.difficulty,
    language: props.language,
    solveTimeSeconds: props.solveTimeSeconds,
    attempts: props.attempts,
    leaderboardRank: props.leaderboardRank
  }, user);
}

/**
 * Track challenge leaderboard view
 */
export function trackViewChallengeLeaderboard(props = {}, user = null) {
  sendTrackEvent('view-challenge-leaderboard', {
    challengeId: props.challengeId,
    problemId: props.problemId
  }, user);
}

// ============================================================================
// MESSAGING ANALYTICS
// ============================================================================

/**
 * Track message sent
 */
export function trackMessageSent(props = {}, user = null) {
  sendTrackEvent('message-sent', {
    recipientId: props.recipientId,
    conversationId: props.conversationId,
    messageLength: props.messageLength
  }, user);
}

/**
 * Track conversation opened
 */
export function trackConversationOpened(props = {}, user = null) {
  sendTrackEvent('conversation-opened', {
    recipientId: props.recipientId,
    conversationId: props.conversationId
  }, user);
}

/**
 * Track messages page view
 */
export function trackViewMessages(props = {}, user = null) {
  sendTrackEvent('view-messages', {
    unreadCount: props.unreadCount,
    conversationCount: props.conversationCount
  }, user);
}

// ============================================================================
// PAGE VIEW ANALYTICS
// ============================================================================

/**
 * Track about page view
 */
export function trackViewAbout(props = {}, user = null) {
  sendTrackEvent('view-about', props, user);
}

/**
 * Track terms page view
 */
export function trackViewTerms(props = {}, user = null) {
  sendTrackEvent('view-terms', props, user);
}

/**
 * Track privacy page view
 */
export function trackViewPrivacy(props = {}, user = null) {
  sendTrackEvent('view-privacy', props, user);
}

/**
 * Track tournaments list page view
 */
export function trackViewTournamentsList(props = {}, user = null) {
  sendTrackEvent('view-tournaments-list', {
    tournamentCount: props.tournamentCount
  }, user);
}

/**
 * Track language selection in battle or practice
 */
export function trackLanguageSelect(props = {}, user = null) {
  sendTrackEvent('language-select', {
    language: props.language,
    previousLanguage: props.previousLanguage,
    context: props.context, // 'battle', 'practice', 'challenge'
    problemId: props.problemId
  }, user);
}

/**
 * Track battle abandonment (user leaves mid-battle)
 */
export function trackBattleAbandon(props = {}, user = null) {
  sendTrackEvent('battle-abandon', {
    battleId: props.battleId,
    problemId: props.problemId,
    difficulty: props.difficulty,
    language: props.language,
    timeElapsedSeconds: props.timeElapsedSeconds,
    timeRemainingSeconds: props.timeRemainingSeconds,
    testsPassedBeforeAbandon: props.testsPassedBeforeAbandon,
    hadStartedCoding: props.hadStartedCoding,
    opponentUsername: props.opponentUsername,
    reason: props.reason // 'navigation', 'close_tab', 'disconnect'
  }, user);
}

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Identify user in Mixpanel (sets user properties)
 * Call this after login/signup to set user profile data
 */
export function identifyUser(user) {
  if (!user?.id) return;

  sendTrackEvent('user-identify', {
    userId: String(user.id),
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    createdAt: user.created_at
  }, user);
}

// ============================================================================
// TUTORIAL/TOUR TRACKING
// ============================================================================

export function trackTourStarted(props = {}, user = null) {
  sendTrackEvent('tour-started', {
    tourId: props.tourId,
    triggerType: props.triggerType, // 'auto' or 'manual'
  }, user);
}

export function trackTourStep(props = {}, user = null) {
  sendTrackEvent('tour-step', {
    tourId: props.tourId,
    stepIndex: props.stepIndex,
    stepId: props.stepId,
    timeOnStepSeconds: props.timeOnStepSeconds,
  }, user);
}

export function trackTourCompleted(props = {}, user = null) {
  sendTrackEvent('tour-completed', {
    tourId: props.tourId,
    totalTimeSeconds: props.totalTimeSeconds,
    stepsCompleted: props.stepsCompleted,
  }, user);
}

export function trackTourSkipped(props = {}, user = null) {
  sendTrackEvent('tour-skipped', {
    tourId: props.tourId,
    skippedAtStep: props.skippedAtStep,
    totalSteps: props.totalSteps,
    timeSpentSeconds: props.timeSpentSeconds,
  }, user);
}

// ============================================================================
// INTERVIEW MODE EVENTS
// ============================================================================

/**
 * Generic event tracking function for custom events
 */
export function trackEvent(eventName, props = {}, user = null) {
  sendTrackEvent(eventName, props, user);
}


export default {
  getAnalyticsId,
  isAuthenticated,
  trackViewHome,
  trackViewModes,
  trackSignup,
  trackLogin,
  trackSessionStart,
  trackLogout,
  trackSelectGameMode,
  trackBeginMatchmaking,
  trackEndMatchmaking,
  trackStartBattle,
  trackSubmitSolution,
  trackEndBattle,
  trackRequestRematch,
  trackRespondRematch,
  identifyUser,
  trackOnboardingStarted,
  trackOnboardingStep,
  trackOnboardingCompleted,
  trackOnboardingSkipped,
  // Practice mode
  trackPracticeStart,
  trackPracticeAttempt,
  trackPracticeComplete,
  trackPracticeNextProblem,
  trackViewPractice,
  // Auth funnel
  trackViewRegisterForm,
  trackViewLoginForm,
  trackSignupError,
  trackLoginError,
  // Social
  trackFriendRequestSent,
  trackFriendRequestAccepted,
  trackFriendRequestDeclined,
  trackFriendRemoved,
  // Page views
  trackViewLeaderboard,
  trackViewProfile,
  // Subscription/Payment
  trackViewPricing,
  trackSelectPlan,
  trackCheckoutStarted,
  trackSubscriptionCreated,
  trackSubscriptionCancelled,
  trackSubscriptionRenewed,
  trackPaymentFailed,
  trackProFeatureGate,
  // Tournament
  trackViewTournament,
  trackTournamentRegister,
  trackTournamentUnregister,
  trackTournamentMatchStart,
  trackTournamentMatchComplete,
  trackTournamentComplete,
  // Weekly Challenge
  trackViewChallenge,
  trackChallengeStart,
  trackChallengeSubmit,
  trackChallengeComplete,
  trackViewChallengeLeaderboard,
  // Messaging
  trackMessageSent,
  trackConversationOpened,
  trackViewMessages,
  // Page views
  trackViewAbout,
  trackViewTerms,
  trackViewPrivacy,
  trackViewTournamentsList,
  // User behavior
  trackLanguageSelect,
  trackBattleAbandon,
  // Tour tracking
  trackTourStarted,
  trackTourStep,
  trackTourCompleted,
  trackTourSkipped,
  trackEvent,
};
