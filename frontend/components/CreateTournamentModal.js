import React, { useState } from 'react';
import Link from 'next/link';
import { X, Users, Calendar, Clock, Copy, Share2, Check, Loader2, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTournaments } from '../contexts/TournamentContext';
import { useAuth } from '../contexts/AuthContext';

export default function CreateTournamentModal({ isOpen, onClose }) {
  const { user } = useAuth();
  const { createTournament } = useTournaments();

  const [step, setStep] = useState('form'); // 'form' | 'success'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);

  // Result state
  const [createdTournament, setCreatedTournament] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Combine date and time
      const startDateTime = new Date(`${startDate}T${startTime}`);
      // Registration deadline is 30 minutes before start
      const registrationDeadline = new Date(startDateTime.getTime() - 30 * 60 * 1000);

      const result = await createTournament({
        name,
        description,
        isPrivate,
        maxPlayers,
        minPlayers: 2,
        startTime: startDateTime.toISOString(),
        registrationDeadline: registrationDeadline.toISOString()
      });

      setCreatedTournament(result);
      setStep('success');
    } catch (err) {
      setError(err.message || 'Failed to create tournament');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (createdTournament?.inviteUrl) {
      await navigator.clipboard.writeText(createdTournament.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (createdTournament?.inviteUrl && navigator.share) {
      try {
        await navigator.share({
          title: `Join my CodeArena Tournament: ${name}`,
          text: `I'm hosting a coding battle! Join me at CodeArena.`,
          url: createdTournament.inviteUrl
        });
      } catch (err) {
        // User cancelled or share failed, fallback to copy
        handleCopyLink();
      }
    } else {
      handleCopyLink();
    }
  };

  const handleClose = () => {
    setStep('form');
    setName('');
    setDescription('');
    setMaxPlayers(4);
    setStartDate('');
    setStartTime('');
    setIsPrivate(true);
    setCreatedTournament(null);
    setError('');
    onClose();
  };

  // Get minimum date (today)
  const today = new Date().toISOString().split('T')[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-gradient-to-br from-slate-800 to-slate-900 border border-purple-500/50 rounded-2xl max-w-md w-full overflow-hidden max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-pink-600 p-4 relative flex-shrink-0">
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 text-white/80 hover:text-white transition-colors"
            aria-label="Close create tournament modal"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <Calendar className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                {step === 'form' ? 'Create Tournament' : 'Tournament Created!'}
              </h2>
              <p className="text-white/80 text-xs">
                {step === 'form'
                  ? 'Host a coding battle with friends'
                  : (isPrivate ? 'Share the invite link' : 'Your tournament is now live!')}
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          <AnimatePresence mode="wait">
            {step === 'form' ? (
              <motion.form
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onSubmit={handleSubmit}
                className="space-y-3"
              >
                {/* Tournament Name */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Tournament Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Friday Night Code Battle"
                    required
                    maxLength={50}
                    className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="A friendly coding competition..."
                    maxLength={200}
                    className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50"
                  />
                </div>

                {/* Max Players */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    <Users className="inline h-3 w-3 mr-1" />
                    Max Players
                  </label>
                  <select
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(parseInt(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50"
                  >
                    <option value={2}>2 Players (1v1)</option>
                    <option value={4}>4 Players</option>
                    <option value={8}>8 Players</option>
                    <option value={16}>16 Players</option>
                    <option value={32}>32 Players</option>
                    <option value={64}>64 Players</option>
                  </select>
                </div>

                {/* Start Date & Time */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      <Calendar className="inline h-3 w-3 mr-1" />
                      Start Date *
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      min={today}
                      required
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      <Clock className="inline h-3 w-3 mr-1" />
                      Start Time *
                    </label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50"
                    />
                  </div>
                </div>

                {/* Public/Private Toggle */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Visibility
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIsPrivate(false)}
                      className={`p-2 rounded-lg border transition-all text-left ${
                        !isPrivate
                          ? 'bg-purple-500/20 border-purple-500/50 text-white'
                          : 'bg-slate-700/30 border-slate-600 text-slate-400 hover:border-slate-500'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3 w-3" />
                        <span className="text-sm font-medium">Public</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPrivate(true)}
                      className={`p-2 rounded-lg border transition-all text-left ${
                        isPrivate
                          ? 'bg-purple-500/20 border-purple-500/50 text-white'
                          : 'bg-slate-700/30 border-slate-600 text-slate-400 hover:border-slate-500'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Lock className="h-3 w-3" />
                        <span className="text-sm font-medium">Private</span>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Error message */}
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2">
                    <p className="text-xs text-red-400">{error}</p>
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={loading || !name || !startDate || !startTime}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Calendar className="h-4 w-4" />
                      Create Tournament
                    </>
                  )}
                </button>
              </motion.form>
            ) : (
              <motion.div
                key="success"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {/* Success animation */}
                <div className="text-center py-2">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-green-500/20 rounded-full mb-3">
                    <Check className="h-6 w-6 text-green-400" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1">{name}</h3>
                  <p className="text-slate-400 text-xs">
                    {maxPlayers} players max • Starts {new Date(`${startDate}T${startTime}`).toLocaleString()}
                  </p>
                </div>

                {isPrivate ? (
                  <>
                    {/* Invite link for private tournaments */}
                    <div className="bg-slate-700/50 rounded-lg p-3">
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Invite Link
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={createdTournament?.inviteUrl || ''}
                          readOnly
                          className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-white text-xs"
                        />
                        <button
                          onClick={handleCopyLink}
                          className="px-2 py-1.5 bg-slate-600 hover:bg-slate-500 rounded transition-colors"
                        >
                          {copied ? (
                            <Check className="h-4 w-4 text-green-400" />
                          ) : (
                            <Copy className="h-4 w-4 text-white" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Share buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={handleCopyLink}
                        className="py-2 px-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 text-sm"
                      >
                        <Copy className="h-4 w-4" />
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                      <button
                        onClick={handleShare}
                        className="py-2 px-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 text-sm"
                      >
                        <Share2 className="h-4 w-4" />
                        Share
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Public tournament success message */}
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <Users className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-blue-300">
                          Your tournament is now visible in the listings. Players can find and join it.
                        </p>
                      </div>
                    </div>

                    {/* View Tournament button */}
                    <Link
                      href={`/tournaments/${createdTournament?.tournamentId}`}
                      onClick={handleClose}
                      className="w-full py-2 px-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 text-sm"
                    >
                      <Calendar className="h-4 w-4" />
                      View Tournament
                    </Link>
                  </>
                )}

                {/* Done button */}
                <button
                  onClick={handleClose}
                  className="w-full py-2 px-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors text-sm"
                >
                  Done
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
