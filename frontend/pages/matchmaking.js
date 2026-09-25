// frontend/pages/matchmaking.js - Updated with new design system
import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../components/Logo';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Users, X, AlertCircle, Clock, ArrowLeft } from 'lucide-react';
import { config } from '../config/env';
import { fetchWithTimeout } from '../utils/fetch';
import { formatTimer as formatTime } from '../utils/formatting';
import { LAUNCH_LANGUAGES, LAUNCH_LANGUAGE_IDS } from '../utils/languages';
import { withAuth } from '../components/withAuth';
import { useAuth } from '../contexts/AuthContext';
import { useMatchmakingQueue } from '../contexts/MatchmakingQueueContext';
import logger from '../utils/logger';

// Import UI components
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
// FloatingOrbs and Float removed for cleaner design

function Matchmaking() {
  const router = useRouter();
  const { user, token } = useAuth();
  const {
    isSearching,
    queueStatus,
    error,
    setError,
    connectionStatus,
    waitTime,
    alreadyInQueue,
    existingPlayerId,
    activeSearchMeta,
    startQuickMatch,
    cancelSearch,
    leaveExistingQueue
  } = useMatchmakingQueue();
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('codearena-preferred-language') || 'python';
    }
    return 'python';
  });
  const [availableLanguages, setAvailableLanguages] = useState(LAUNCH_LANGUAGE_IDS);
  const [isRanked, setIsRanked] = useState(true);
  const [selectedTimeLimit, setSelectedTimeLimit] = useState(600); // Default 10 minutes
  const [quickBattleMode, setQuickBattleMode] = useState('coding'); // 'coding' | 'prompt'
  const [extraTypes, setExtraTypes] = useState([]); // additional battle types to also queue for (multi-type matchmaking)
  const [promptDurationMinutes, setPromptDurationMinutes] = useState(5);
  const [promptAvailableModels, setPromptAvailableModels] = useState([]);
  const [selectedPromptModelId, setSelectedPromptModelId] = useState('');

  // Use shared languages config
  const languages = LAUNCH_LANGUAGES;

  const displayName = activeSearchMeta?.playerName || user?.username || '';
  const displayLanguage = activeSearchMeta?.language || selectedLanguage;
  const displayBattleType = activeSearchMeta?.battleType || (quickBattleMode === 'prompt' ? 'prompt' : 'coding');
  const displayPromptMinutes = activeSearchMeta?.promptDurationMinutes ?? promptDurationMinutes;

  // Read language from URL params (e.g., coming from practice)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const langParam = urlParams.get('language');
    if (langParam && availableLanguages.includes(langParam)) {
      setSelectedLanguage(langParam);
    }
  }, [availableLanguages]);

  // Fetch available languages for this user
  useEffect(() => {
    const fetchLimits = async () => {
      if (!token) return;
      try {
        const res = await fetchWithTimeout(`${config.backend_url}/api/limits`, {
          headers: { Authorization: `Bearer ${token}` }
        }, 15000);
        if (res.ok) {
          const data = await res.json();
          const served = Array.isArray(data.languages) && data.languages.length > 0 ? data.languages : LAUNCH_LANGUAGE_IDS;
          setAvailableLanguages(LAUNCH_LANGUAGE_IDS.filter(id => served.includes(id)));
        }
      } catch (err) {
        logger.error('Failed to fetch limits:', err);
      }
    };
    fetchLimits();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithTimeout(`${config.backend_url}/api/prompt-battle/config`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok || !Array.isArray(data?.availableModels)) return;
        setPromptAvailableModels(data.availableModels);
        const def =
          data.defaultModelId && data.availableModels.some((m) => m.id === data.defaultModelId)
            ? data.defaultModelId
            : (data.availableModels[0]?.id || '');
        setSelectedPromptModelId((prev) => {
          if (prev && data.availableModels.some((m) => m.id === prev)) return prev;
          return def;
        });
      } catch (_) {
        /* optional feature */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const joinMatchmaking = () => {
    const modelMeta = promptAvailableModels.find((m) => m.id === selectedPromptModelId)
    startQuickMatch({
      selectedLanguage,
      isRanked,
      selectedTimeLimit,
      quickBattleMode,
      battleTypes: [...new Set([quickBattleMode, ...extraTypes.filter((t) => t !== quickBattleMode)])],
      promptDurationMinutes,
      selectedPromptModelId,
      promptModelLabel: modelMeta?.label || ''
    })
  }

  return (
    <>
      <Head>
        <title>Quick Match - CodeArena</title>
        <meta name="description" content="Find an opponent in seconds and battle in real-time coding competition. Compete head-to-head with developers at your skill level." />
        <link rel="canonical" href="https://codearena.co/matchmaking" />
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">

        <div className="min-h-screen flex flex-col">
          {/* Header */}
          <motion.header
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="px-6 py-6"
          >
            <div className="flex items-center gap-4">
              <Link href="/modes" className="flex items-center gap-2 text-surface-400 hover:text-white transition-colors group">
                <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
                <span className="font-medium">Back</span>
              </Link>
              <Link href="/" className="hover:opacity-80 transition-opacity">
                <Logo />
              </Link>
            </div>
          </motion.header>

          <div className="flex-1 flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="max-w-md w-full"
            >
              <AnimatePresence mode="wait">
                {!isSearching ? (
                  <motion.div
                    key="setup"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    <Card variant="glass" className="p-8">
                      <div className="text-center mb-8">
                        <h1 className="text-2xl font-bold mb-2 text-white">Quick Match</h1>
                        <p className="text-surface-400">Find an opponent at your skill level</p>
                      </div>

                      {error && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-error/10 border border-error/30 rounded-xl p-3 mb-6 text-error-light text-sm"
                        >
                          <div className="flex items-start space-x-2">
                            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <span>{error}</span>
                          </div>
                          {alreadyInQueue && (
                            <button
                              onClick={leaveExistingQueue}
                              className="mt-3 w-full py-2 px-4 bg-surface-700 hover:bg-surface-600 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                              Leave Queue & Try Again
                            </button>
                          )}
                        </motion.div>
                      )}

                      <div className="space-y-6">
                        <div className="text-center mb-2">
                          <p className="text-sm text-surface-400">Playing as</p>
                          <p className="text-lg font-semibold text-primary-400">
                            {user?.username || 'Loading...'}
                          </p>
                        </div>

                        <div>
                          <p className="text-sm text-surface-400 mb-3 text-center">Battle type</p>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => { setQuickBattleMode('coding'); setError(''); }}
                              disabled={isSearching}
                              className={`py-3 px-3 rounded-xl border-2 text-left transition-all disabled:opacity-50 ${
                                quickBattleMode === 'coding'
                                  ? 'border-primary-500 bg-primary-500/10 text-white'
                                  : 'border-surface-600 bg-surface-800/40 text-surface-400 hover:border-surface-500'
                              }`}
                            >
                              <span className="text-sm font-semibold block">Coding</span>
                              <span className="text-xs text-surface-500 mt-1 block leading-snug">Classic code duel</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => { setQuickBattleMode('prompt'); setError(''); }}
                              disabled={isSearching}
                              className={`py-3 px-3 rounded-xl border-2 text-left transition-all disabled:opacity-50 ${
                                quickBattleMode === 'prompt'
                                  ? 'border-accent-500 bg-accent-500/10 text-white'
                                  : 'border-surface-600 bg-surface-800/40 text-surface-400 hover:border-surface-500'
                              }`}
                            >
                              <span className="text-sm font-semibold block">Prompt</span>
                              <span className="text-xs text-surface-500 mt-1 block leading-snug">Same scenario, model, and round length</span>
                            </button>
                          </div>
                        </div>

                        {quickBattleMode === 'coding' && (
                        <>
                        {(() => {
                          const labels = { prompt: 'Prompt battles' };
                          const extras = ['prompt'];
                          if (!extras.length) return null;
                          const toggle = (t) => {
                            setError('');
                            setExtraTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
                          };
                          return (
                            <div className="space-y-1.5 mb-1">
                              <p className="text-xs text-surface-500">Also match me with (faster):</p>
                              {extras.map((t) => (
                                <label key={t} className="flex items-center gap-2 text-sm text-surface-300 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={extraTypes.includes(t)}
                                    onChange={() => toggle(t)}
                                    disabled={isSearching}
                                    className="h-4 w-4 rounded border-surface-600 bg-surface-700 text-primary-500 focus:ring-primary-500"
                                  />
                                  <span>{labels[t]}</span>
                                </label>
                              ))}
                            </div>
                          );
                        })()}
                        <div>
                          <label className="block text-sm font-medium text-surface-300 mb-3">Preferred Language</label>
                          <select
                            value={selectedLanguage}
                            onChange={(e) => {
                              setSelectedLanguage(e.target.value);
                              setError('');
                              try { localStorage.setItem('codearena-preferred-language', e.target.value); } catch (_) {}
                            }}
                            disabled={isSearching}
                            className="w-full bg-surface-700 text-white text-sm rounded-lg px-4 py-2.5 border border-surface-600 focus:outline-none focus:border-primary-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {languages.filter(lang => availableLanguages.includes(lang.id)).map((lang) => (
                              <option key={lang.id} value={lang.id}>{lang.icon} {lang.name}</option>
                            ))}
                          </select>
                          <p className="text-xs text-surface-500 mt-2 text-center">
                            We'll try to match you with someone using the same language
                          </p>
                        </div>

                        {/* Time Limit Selection */}
                        <div>
                          <p className="text-sm text-surface-400 mb-2 text-center">Time Limit</p>
                          <select
                            value={selectedTimeLimit}
                            onChange={(e) => setSelectedTimeLimit(Number(e.target.value))}
                            disabled={isSearching}
                            className="w-full bg-surface-700 text-white text-sm rounded-lg px-4 py-2.5 border border-surface-600 focus:outline-none focus:border-primary-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value={600}>10 min</option>
                            <option value={1800}>30 min</option>
                            <option value={3600}>60 min</option>
                          </select>
                        </div>

                        {/* Ranked/Unranked Toggle */}
                        <div className="flex items-center justify-center space-x-4">
                          <button
                            onClick={() => setIsRanked(true)}
                            disabled={isSearching}
                            className={`flex-1 py-3 px-4 rounded-lg border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                              isRanked
                                ? 'border-primary-500 bg-primary-500/10 text-white'
                                : 'border-surface-700 bg-surface-800/50 text-surface-400 hover:border-surface-600'
                            }`}
                          >
                            <span className="font-medium">Ranked</span>
                            <p className="text-xs mt-1 opacity-70">Affects your ELO rating</p>
                          </button>
                          <button
                            onClick={() => setIsRanked(false)}
                            disabled={isSearching}
                            className={`flex-1 py-3 px-4 rounded-lg border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                              !isRanked
                                ? 'border-secondary-500 bg-secondary-500/10 text-white'
                                : 'border-surface-700 bg-surface-800/50 text-surface-400 hover:border-surface-600'
                            }`}
                          >
                            <span className="font-medium">Casual</span>
                            <p className="text-xs mt-1 opacity-70">No ELO changes</p>
                          </button>
                        </div>
                        </>
                        )}

                        {quickBattleMode === 'prompt' && (
                        <div className="space-y-5">
                          <div>
                            <label className="block text-sm font-medium text-surface-300 mb-3">Round length</label>
                            <div className="flex flex-wrap gap-2">
                              {[5, 10, 15].map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setPromptDurationMinutes(m)}
                                  disabled={isSearching}
                                  className={`rounded-lg px-4 py-2 text-sm border transition-all disabled:opacity-50 ${
                                    promptDurationMinutes === m
                                      ? 'border-accent-500 bg-accent-500/10 text-white'
                                      : 'border-surface-600 hover:border-surface-500 text-surface-400'
                                  }`}
                                >
                                  {m} min
                                </button>
                              ))}
                            </div>
                            <p className="text-xs text-surface-500 mt-2 text-center">
                              You are matched with someone on the same duration and model
                            </p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-surface-300 mb-3">AI model</label>
                            {!promptAvailableModels.length ? (
                              <p className="text-xs text-warning-light text-center">
                                No models are configured on this server. Prompt Quick Match is unavailable until the admin sets prompt battle models.
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {promptAvailableModels.map((model) => (
                                  <button
                                    key={model.id}
                                    type="button"
                                    onClick={() => setSelectedPromptModelId(model.id)}
                                    disabled={isSearching}
                                    className={`rounded-lg px-4 py-2 text-sm border text-left transition-all disabled:opacity-50 max-w-full ${
                                      selectedPromptModelId === model.id
                                        ? 'border-accent-500 bg-accent-500/10 text-white'
                                        : 'border-surface-600 hover:border-surface-500 text-surface-400'
                                    }`}
                                  >
                                    <span className="block font-medium">{model.label}</span>
                                    <span className="block text-xs text-surface-500 mt-0.5">{model.provider}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        )}

                        <Button
                          variant="primary"
                          fullWidth
                          size="lg"
                          onClick={joinMatchmaking}
                          disabled={
                            !user?.username ||
                            isSearching ||
                            (quickBattleMode === 'prompt' &&
                              (!selectedPromptModelId || !promptAvailableModels.length))
                          }
                          icon={Search}
                        >
                          {quickBattleMode === 'prompt'
                            ? 'Find Prompt Match'
                            : `Find ${isRanked ? 'Ranked' : 'Unranked'} Match`}
                        </Button>

                        <div className="text-center">
                          <p className="text-surface-500 text-sm mb-3">or</p>
                          <div className="flex justify-center space-x-4">
                            <Link href="/practice" className="text-primary-400 hover:text-primary-300 text-sm font-medium">
                              Practice Solo
                            </Link>
                            <Link href="/battle" className="text-secondary-400 hover:text-secondary-300 text-sm font-medium">
                              Private Battle
                            </Link>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                ) : (
                  <motion.div
                    key="searching"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    <Card variant="glass" className="p-8 text-center">
                      <div className="mb-6">
                        <div className="w-10 h-10 border-2 border-surface-600 border-t-primary-400 rounded-full animate-spin mx-auto mb-4"></div>
                        <h2 className="text-xl font-semibold mb-2 text-white">Searching</h2>
                        <p className="text-surface-400">
                          {displayBattleType === 'prompt'
                            ? `Looking for a prompt battle (${displayPromptMinutes} min)…`
                            : `Looking for ${languages.find(l => l.id === displayLanguage)?.name} developers...`}
                        </p>
                      </div>

                      <div className="mb-6">
                        <div className="flex items-center justify-center space-x-2 mb-2">
                          <Clock className="h-5 w-5 text-primary-400" />
                          <span className={`font-mono text-2xl ${
                            waitTime >= 50 ? 'text-error-light animate-pulse' :
                            waitTime >= 40 ? 'text-warning' :
                            'text-primary-400'
                          }`}>
                            {formatTime(waitTime)}
                          </span>
                        </div>
                        <div className="text-sm text-surface-400 mb-2">
                          Status: {connectionStatus === 'connected' ? 'Searching...' :
                                  connectionStatus === 'error' ? 'Connection Error' : 'Connecting...'}
                        </div>
                        {waitTime >= 50 && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-xs text-error-light"
                          >
                            Search will timeout in {60 - waitTime} seconds
                          </motion.div>
                        )}
                      </div>

                      {queueStatus && connectionStatus === 'connected' && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-surface-800/50 rounded-xl p-4 mb-6 border border-surface-700"
                        >
                          <div className="flex items-center justify-center space-x-2 mb-2">
                            <Users className="h-5 w-5 text-primary-400" />
                            <span className="text-sm text-white">
                              Position #{queueStatus.queuePosition || queueStatus.position || 1} in queue
                            </span>
                          </div>
                          <div className="text-xs text-surface-400">
                            {queueStatus.totalInQueue || queueStatus.queuePosition || 1} total players searching
                          </div>
                        </motion.div>
                      )}

                      <div className="bg-surface-800/30 rounded-xl p-4 mb-6 border border-surface-700/50">
                        <div className="text-sm text-surface-400 mb-1">Searching as:</div>
                        <div className="font-bold text-lg text-white">{displayName}</div>
                        <div className="text-primary-400 text-sm">
                          {displayBattleType === 'prompt'
                            ? `Prompt battle · ${displayPromptMinutes} min`
                            : `${languages.find(l => l.id === displayLanguage)?.name} Developer`}
                        </div>
                      </div>

                      {error && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="bg-error/10 border border-error/30 rounded-xl p-3 mb-6 text-error-light text-sm flex items-start space-x-2"
                        >
                          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          <span>{error}</span>
                        </motion.div>
                      )}

                      <div className="flex justify-center mb-6">
                        <div className="flex space-x-1.5">
                          {[0, 1, 2].map((i) => (
                            <motion.div
                              key={i}
                              className="w-1.5 h-1.5 bg-surface-500 rounded-full"
                              animate={{ opacity: [0.3, 1, 0.3] }}
                              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3 }}
                            />
                          ))}
                        </div>
                      </div>

                      <Button
                        variant="danger"
                        fullWidth
                        onClick={cancelSearch}
                        icon={X}
                      >
                        Cancel Search
                      </Button>

                      {waitTime >= 30 && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="mt-4 text-xs text-surface-500 space-y-1"
                        >
                          <p>Taking longer than usual?</p>
                          <button
                            type="button"
                            onClick={() => {
                              cancelSearch();
                              router.push('/practice');
                            }}
                            className="text-primary-400 hover:text-primary-300 underline"
                          >
                            Try Practice Mode
                          </button>
                        </motion.div>
                      )}
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
}

export default withAuth(Matchmaking);
