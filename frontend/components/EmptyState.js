import { motion } from 'framer-motion';

/**
 * EmptyState - Reusable empty state component for data pages
 *
 * @param {string} icon - Emoji or icon to display
 * @param {string} title - Main heading
 * @param {string} description - Supporting text
 * @param {React.ReactNode} action - Optional action button/link
 * @param {string} variant - 'default' | 'compact'
 */
const EmptyState = ({
  icon = '',
  title = 'Nothing here yet',
  description = '',
  action = null,
  variant = 'default'
}) => {
  const isCompact = variant === 'compact';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col items-center justify-center text-center ${
        isCompact ? 'py-8 px-4' : 'py-16 px-6'
      }`}
    >
      <motion.div
        className={`${isCompact ? 'text-4xl mb-3' : 'text-6xl mb-4'}`}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
      >
        {icon}
      </motion.div>

      <h3 className={`font-semibold text-white ${isCompact ? 'text-lg mb-1' : 'text-xl mb-2'}`}>
        {title}
      </h3>

      {description && (
        <p className={`text-surface-400 max-w-sm ${isCompact ? 'text-sm' : 'text-base'}`}>
          {description}
        </p>
      )}

      {action && (
        <div className={isCompact ? 'mt-4' : 'mt-6'}>
          {action}
        </div>
      )}
    </motion.div>
  );
};

// Pre-configured empty states for common scenarios
export const EmptyBattleHistory = () => (
  <EmptyState
    icon=""
    title="No battles yet"
    description="Start a battle to see your history here"
  />
);

export const EmptyFriendsList = () => (
  <EmptyState
    icon=""
    title="No friends yet"
    description="Search for players to add them as friends"
  />
);

export const EmptyMessages = () => (
  <EmptyState
    icon=""
    title="No messages"
    description="Start a conversation with a friend"
  />
);

export const EmptyLeaderboard = () => (
  <EmptyState
    icon=""
    title="No rankings yet"
    description="Complete battles to appear on the leaderboard"
  />
);

export const EmptySearchResults = ({ query }) => (
  <EmptyState
    icon=""
    title="No results found"
    description={query ? `No matches for "${query}"` : 'Try a different search term'}
    variant="compact"
  />
);

export const EmptyNotifications = () => (
  <EmptyState
    icon=""
    title="All caught up!"
    description="No new notifications"
    variant="compact"
  />
);

export const EmptyActivity = () => (
  <EmptyState
    icon=""
    title="No activity yet"
    description="Your recent activity will appear here"
  />
);

export default EmptyState;
