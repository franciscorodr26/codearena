import { forwardRef } from 'react';

const variants = {
  default: 'bg-surface-700/60 text-surface-300 border-surface-600/50',
  primary: 'bg-accent-500/15 text-accent-300 border-accent-500/20',
  success: 'bg-green-500/15 text-green-300 border-green-500/20',
  warning: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20',
  danger: 'bg-red-500/15 text-red-300 border-red-500/20',
  neutral: 'bg-surface-700/50 text-surface-300 border-surface-600/50',
};

const sizes = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-xs',
  lg: 'px-3 py-1 text-sm',
};

const Badge = forwardRef(({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  dot = false,
  icon: Icon,
  removable = false,
  onRemove,
  ...props
}, ref) => {
  const baseStyles = 'inline-flex items-center font-medium rounded-full border';

  const dotColor = {
    default: 'bg-surface-400',
    primary: 'bg-accent-400',
    success: 'bg-green-400',
    warning: 'bg-yellow-400',
    danger: 'bg-red-400',
    neutral: 'bg-surface-400',
  };

  return (
    <span
      ref={ref}
      className={`
        ${baseStyles}
        ${variants[variant] || variants.default}
        ${sizes[size]}
        ${className}
      `}
      {...props}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dotColor[variant] || dotColor.default}`} />
      )}
      {Icon && <Icon className="mr-1 h-3 w-3" />}
      {children}
      {removable && (
        <button
          onClick={onRemove}
          className="ml-1.5 -mr-0.5 hover:bg-white/10 rounded-full p-0.5 transition-colors"
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </span>
  );
});

Badge.displayName = 'Badge';

// Difficulty Badge preset
const DifficultyBadge = forwardRef(({ difficulty, ...props }, ref) => {
  const difficultyVariant = {
    Easy: 'success',
    Medium: 'warning',
    Hard: 'danger',
  };

  return (
    <Badge
      ref={ref}
      variant={difficultyVariant[difficulty] || 'neutral'}
      size="sm"
      {...props}
    >
      {difficulty}
    </Badge>
  );
});

DifficultyBadge.displayName = 'DifficultyBadge';

// Status Badge preset
const StatusBadge = forwardRef(({ status, ...props }, ref) => {
  const statusConfig = {
    online: { variant: 'success', dot: true },
    offline: { variant: 'neutral', dot: true },
    away: { variant: 'warning', dot: true },
    busy: { variant: 'danger', dot: true },
    in_battle: { variant: 'primary', dot: true },
  };

  const config = statusConfig[status] || statusConfig.offline;

  return (
    <Badge ref={ref} size="sm" {...config} {...props}>
      {status.replace('_', ' ')}
    </Badge>
  );
});

StatusBadge.displayName = 'StatusBadge';

export { Badge, DifficultyBadge, StatusBadge };
export default Badge;
