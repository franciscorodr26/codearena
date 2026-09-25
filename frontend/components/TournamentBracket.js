import { motion } from 'framer-motion';
import { User, Loader2, Eye, CheckCircle } from 'lucide-react';
import Card from './ui/Card';

const TournamentBracket = ({ tournament, matches, participants, onMatchClick }) => {
  if (!tournament || !matches) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        <span className="ml-3 text-surface-300">Loading bracket...</span>
      </div>
    );
  }

  // Organize matches by round
  const roundsMap = {};
  matches.forEach(match => {
    if (!roundsMap[match.round]) {
      roundsMap[match.round] = [];
    }
    roundsMap[match.round].push(match);
  });

  const rounds = Object.keys(roundsMap)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map(roundNum => ({
      number: parseInt(roundNum),
      matches: roundsMap[roundNum].sort((a, b) => a.match_number - b.match_number)
    }));

  const getRoundName = (roundNumber, totalRounds) => {
    const roundsFromEnd = totalRounds - roundNumber + 1;
    if (roundsFromEnd === 1) return 'Finals';
    if (roundsFromEnd === 2) return 'Semi-Finals';
    if (roundsFromEnd === 3) return 'Quarter-Finals';
    return `Round ${roundNumber}`;
  };

  const MatchCard = ({ match, roundNumber }) => {
    const isComplete = !!match.winner_id;
    const isBye = !match.player2_id;

    const getPlayerName = (playerId, username) => {
      if (!playerId) return 'TBD';
      return username || 'Unknown';
    };

    const isWinner = (playerId) => match.winner_id === playerId;

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className={`relative ${onMatchClick ? 'cursor-pointer' : ''}`}
        role="listitem"
        aria-label={`Match: ${getPlayerName(match.player1_id, match.player1_username)} vs ${getPlayerName(match.player2_id, match.player2_username)}${isComplete ? ', completed' : isBye ? ', automatic advance' : ', pending'}`}
        onClick={() => onMatchClick && onMatchClick(match)}
        onKeyDown={(e) => { if (onMatchClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onMatchClick(match); } }}
        tabIndex={onMatchClick ? 0 : undefined}
      >
        <Card className={`p-3 min-w-[200px] ${
          isComplete ? 'bg-surface-800/50' : 'bg-surface-800 border-primary-500/30'
        } ${onMatchClick ? 'hover:border-primary-500 hover:shadow-lg hover:shadow-primary-500/20 transition-all' : ''}`}>
          <div className="space-y-2">
            {/* Player 1 */}
            <div className={`flex items-center justify-between p-2 rounded ${
              isWinner(match.player1_id)
                ? 'bg-success-500/20 border border-success-500/30'
                : 'bg-surface-700/50'
            }`}>
              <div className="flex items-center gap-2 flex-1">
                <User className="w-4 h-4 text-surface-400" aria-hidden="true" />
                <span className={`text-sm font-medium truncate ${
                  isWinner(match.player1_id) ? 'text-success-400' : 'text-surface-200'
                }`}>
                  {getPlayerName(match.player1_id, match.player1_username)}
                </span>
              </div>
              {isWinner(match.player1_id) && (
                <CheckCircle className="w-4 h-4 text-success-400 ml-2 flex-shrink-0" aria-hidden="true" />
              )}
            </div>

            {/* VS Divider */}
            <div className="text-center text-xs text-surface-500 font-bold">
              {isBye ? 'BYE' : 'VS'}
            </div>

            {/* Player 2 */}
            <div className={`flex items-center justify-between p-2 rounded ${
              isWinner(match.player2_id)
                ? 'bg-success-500/20 border border-success-500/30'
                : 'bg-surface-700/50'
            }`}>
              <div className="flex items-center gap-2 flex-1">
                <User className="w-4 h-4 text-surface-400" aria-hidden="true" />
                <span className={`text-sm font-medium truncate ${
                  isWinner(match.player2_id) ? 'text-success-400' : 'text-surface-200'
                }`}>
                  {getPlayerName(match.player2_id, match.player2_username)}
                </span>
              </div>
              {isWinner(match.player2_id) && (
                <CheckCircle className="w-4 h-4 text-success-400 ml-2 flex-shrink-0" aria-hidden="true" />
              )}
            </div>
          </div>

          {/* Match Status */}
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className={`${isComplete ? 'text-success-400' : 'text-primary-400'}`}>
              {isComplete ? 'Completed' : isBye ? 'Automatic Advance' : 'Pending'}
            </span>
            {match.battle_id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (onMatchClick) onMatchClick(match);
                }}
                className="flex items-center gap-1 text-primary-400 hover:text-primary-300 transition-colors"
                aria-label={`View match: ${getPlayerName(match.player1_id, match.player1_username)} vs ${getPlayerName(match.player2_id, match.player2_username)}`}
              >
                <Eye className="w-3 h-3" aria-hidden="true" />
                <span>View</span>
              </button>
            )}
          </div>
        </Card>
      </motion.div>
    );
  };

  return (
    <div className="space-y-6" aria-label="Tournament bracket" role="region">
      {/* Single Elimination Bracket Layout */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-8 min-w-max" role="list" aria-label="Bracket rounds">
          {rounds.map((round) => (
            <div key={round.number} className="flex flex-col gap-4 min-w-[220px]" role="listitem" aria-label={getRoundName(round.number, tournament.total_rounds)}>
              {/* Round Header */}
              <div className="text-center mb-4">
                <h3 className="text-lg font-bold text-primary-400">
                  {getRoundName(round.number, tournament.total_rounds)}
                </h3>
                <p className="text-xs text-surface-400">
                  Round {round.number}
                </p>
              </div>

              {/* Matches */}
              <div className="flex flex-col gap-4" role="list" aria-label={`${getRoundName(round.number, tournament.total_rounds)} matches`}>
                {round.matches.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    roundNumber={round.number}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Winner Announcement */}
      {tournament.status === 'completed' && tournament.winner_username && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8"
        >
          <Card className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border-yellow-500/30 p-6">
            <div className="flex items-center justify-center gap-4">
              <CheckCircle className="w-8 h-8 text-yellow-400" />
              <div className="text-center">
                <h3 className="text-2xl font-bold text-yellow-400 mb-1">
                  Tournament Champion
                </h3>
                <p className="text-xl text-white">
                  {tournament.winner_username}
                </p>
              </div>
              <CheckCircle className="w-8 h-8 text-yellow-400" />
            </div>
          </Card>
        </motion.div>
      )}

      {/* Bracket Legend */}
      <div className="flex flex-wrap gap-4 justify-center text-sm text-surface-400">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-success-500/20 border border-success-500/30 rounded"></div>
          <span>Winner</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-surface-800 border border-primary-500/30 rounded"></div>
          <span>Upcoming Match</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-surface-800/50 rounded"></div>
          <span>Completed</span>
        </div>
      </div>
    </div>
  );
};

export default TournamentBracket;
