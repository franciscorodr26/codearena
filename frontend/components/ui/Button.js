import { forwardRef } from 'react';

const variants = {
  primary: 'bg-accent-500 text-white hover:bg-accent-400 focus-visible:ring-accent-500',
  secondary: 'bg-surface-700 text-surface-200 hover:bg-surface-600 hover:text-white focus-visible:ring-surface-500',
  ghost: 'bg-transparent text-surface-300 hover:bg-surface-800 hover:text-white focus-visible:ring-surface-500',
  outline: 'bg-transparent border border-surface-600 text-surface-300 hover:border-surface-500 hover:text-white focus-visible:ring-surface-500',
  danger: 'bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500',
  accent: 'bg-accent-500 text-white hover:bg-accent-400 focus-visible:ring-accent-500',
  success: 'bg-green-600 text-white hover:bg-green-500 focus-visible:ring-green-500',
  warning: 'bg-yellow-600 text-white hover:bg-yellow-500 focus-visible:ring-yellow-500',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
  xl: 'px-6 py-3 text-base',
};

const Button = forwardRef(({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  loading = false,
  loadingText,
  icon: Icon,
  iconPosition = 'left',
  fullWidth = false,
  ...props
}, ref) => {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900 disabled:opacity-50 disabled:pointer-events-none';

  return (
    <button
      ref={ref}
      className={`
        ${baseStyles}
        ${variants[variant] || variants.primary}
        ${sizes[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          {loadingText || children}
        </>
      ) : (
        <>
          {Icon && iconPosition === 'left' && <Icon className="mr-2 h-4 w-4" />}
          {children}
          {Icon && iconPosition === 'right' && <Icon className="ml-2 h-4 w-4" />}
        </>
      )}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
