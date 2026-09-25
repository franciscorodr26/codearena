import { Clock } from 'lucide-react';

/**
 * Displays partial credit battle result when timer expires
 * Shows test progress comparison and scaled ELO change
 */
export default function PartialCreditResult({ winner, partialCreditData }) {
  if (!partialCreditData) return null;

  const { testProgress, ratingChanges, scaleFactor } = partialCreditData;
  const scalePercent = Math.round((scaleFactor || 0.5) * 100);
  const isWinner = winner === 'you';

  // Determine which test counts to show for "your" vs "opponent"
  const yourTests = isWinner ? testProgress?.winner : testProgress?.loser;
  const opponentTests = isWinner ? testProgress?.loser : testProgress?.winner;
  const totalTests = testProgress?.total || 0;

  // Get rating change for display
  const ratingChange = isWinner
    ? ratingChanges?.winner?.change || 0
    : ratingChanges?.loser?.change || 0;

  return (
    <div className={`bg-gradient-to-br ${
      isWinner
        ? 'from-amber-900/30 to-yellow-900/30 border-warning'
        : 'from-slate-900/30 to-gray-900/30 border-surface-500'
    } border rounded-xl p-6 mb-6`}>
      {/* Header */}
      <div className="flex items-center justify-center space-x-2 mb-4">
        <Clock className="h-5 w-5 text-warning" />
        <h3 className="text-xl font-bold text-warning">Time Expired - Partial Credit</h3>
      </div>

      {/* Test Progress Comparison */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className={`text-center p-3 rounded-lg ${isWinner ? 'bg-success/20' : 'bg-danger/20'}`}>
          <div className="text-2xl font-bold">{yourTests}/{totalTests}</div>
          <div className="text-sm text-surface-400">Your Tests</div>
        </div>
        <div className={`text-center p-3 rounded-lg ${!isWinner ? 'bg-success/20' : 'bg-danger/20'}`}>
          <div className="text-2xl font-bold">{opponentTests}/{totalTests}</div>
          <div className="text-sm text-surface-400">Opponent Tests</div>
        </div>
      </div>

      {/* Explanation */}
      <p className="text-surface-300 text-sm text-center">
        {isWinner
          ? `You passed more tests! Rating scaled to ${scalePercent}% of a full win.`
          : `Opponent passed more tests. Rating scaled to ${scalePercent}% of a full loss.`
        }
      </p>

      {/* Rating Change */}
      {ratingChanges && (
        <div className="mt-4 pt-4 border-t border-surface-700 text-center">
          <span className={`text-lg font-bold ${isWinner ? 'text-success' : 'text-danger'}`}>
            {isWinner ? `+${ratingChange}` : ratingChange} ELO
          </span>
          <span className="text-surface-400 text-sm ml-2">
            ({scalePercent}% partial credit)
          </span>
        </div>
      )}
    </div>
  );
}
