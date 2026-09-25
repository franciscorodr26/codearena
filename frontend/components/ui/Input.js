import { forwardRef, useState } from 'react';

const Input = forwardRef(({
  label,
  error,
  success,
  helper,
  icon: Icon,
  iconPosition = 'left',
  className = '',
  containerClassName = '',
  size = 'md',
  variant = 'default',
  showCharCount = false,
  maxLength,
  required,
  ...props
}, ref) => {
  const [isFocused, setIsFocused] = useState(false);
  const [charCount, setCharCount] = useState(props.value?.length || props.defaultValue?.length || 0);

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-2.5 text-base',
  };

  const getBorderStyles = () => {
    if (error) return 'border-red-500 focus:border-red-500 focus:ring-red-500/20';
    if (success) return 'border-green-500 focus:border-green-500 focus:ring-green-500/20';
    return 'border-surface-700 focus:border-accent-500 focus:ring-accent-500/20';
  };

  const variantStyles = {
    default: 'bg-surface-900',
    filled: 'bg-surface-800 focus:bg-surface-900',
    ghost: 'bg-transparent focus:bg-surface-900/50',
  };

  const baseStyles = `
    w-full border rounded-lg text-white placeholder-surface-500
    focus:outline-none focus:ring-2 transition-colors duration-150
    disabled:opacity-50 disabled:cursor-not-allowed
    ${sizes[size]}
    ${variantStyles[variant] || variantStyles.default}
    ${getBorderStyles()}
    ${Icon && iconPosition === 'left' ? 'pl-10' : ''}
    ${Icon && iconPosition === 'right' ? 'pr-10' : ''}
  `;

  return (
    <div className={`w-full ${containerClassName}`}>
      {label && (
        <label className="block text-sm font-medium text-surface-300 mb-1.5">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className={`absolute inset-y-0 ${iconPosition === 'left' ? 'left-0 pl-3' : 'right-0 pr-3'} flex items-center pointer-events-none`}>
            <Icon className={`h-4 w-4 transition-colors duration-150 ${isFocused ? 'text-accent-400' : 'text-surface-500'}`} />
          </div>
        )}
        <input
          ref={ref}
          className={`${baseStyles} ${className}`}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={(e) => {
            setCharCount(e.target.value.length);
            props.onChange?.(e);
          }}
          maxLength={maxLength}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${props.id || props.name}-error` : undefined}
          aria-required={required}
          {...props}
        />
        {(error || success) && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            {error ? (
              <svg className="h-4 w-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-4 w-4 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        {(error || success || helper) ? (
          <p
            id={error ? `${props.id || props.name}-error` : undefined}
            className={`text-xs ${error ? 'text-red-400' : success ? 'text-green-400' : 'text-surface-500'}`}
          >
            {error || success || helper}
          </p>
        ) : <span />}
        {showCharCount && maxLength && (
          <span className={`text-xs ${charCount >= maxLength ? 'text-red-400' : 'text-surface-500'}`}>
            {charCount}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
});

Input.displayName = 'Input';

// Textarea component
const Textarea = forwardRef(({
  label,
  error,
  helper,
  className = '',
  containerClassName = '',
  rows = 4,
  resize = 'vertical',
  ...props
}, ref) => {
  const resizeStyles = {
    none: 'resize-none',
    vertical: 'resize-y',
    horizontal: 'resize-x',
    both: 'resize',
  };

  const baseStyles = `
    w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg
    text-sm text-white placeholder-surface-500
    focus:outline-none focus:ring-2 focus:border-accent-500 focus:ring-accent-500/20
    transition-colors duration-150
    disabled:opacity-50 disabled:cursor-not-allowed
    ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}
    ${resizeStyles[resize]}
  `;

  return (
    <div className={`w-full ${containerClassName}`}>
      {label && (
        <label className="block text-sm font-medium text-surface-300 mb-1.5">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        className={`${baseStyles} ${className}`}
        rows={rows}
        {...props}
      />
      {(error || helper) && (
        <p className={`mt-1.5 text-xs ${error ? 'text-red-400' : 'text-surface-500'}`}>
          {error || helper}
        </p>
      )}
    </div>
  );
});

Textarea.displayName = 'Textarea';

// Search Input preset
const SearchInput = forwardRef(({ onSearch, ...props }, ref) => {
  const SearchIcon = () => (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );

  return (
    <Input
      ref={ref}
      type="search"
      icon={SearchIcon}
      iconPosition="left"
      placeholder="Search..."
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onSearch) {
          onSearch(e.target.value);
        }
      }}
      {...props}
    />
  );
});

SearchInput.displayName = 'SearchInput';

// Password Strength Indicator
const PasswordStrengthIndicator = ({ password }) => {
  const getStrength = (pwd) => {
    if (!pwd) return { score: 0, label: '', color: 'bg-surface-700' };

    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    if (pwd.length >= 12) score++;

    const levels = [
      { label: '', color: 'bg-surface-700' },
      { label: 'Very Weak', color: 'bg-red-500' },
      { label: 'Weak', color: 'bg-red-500' },
      { label: 'Fair', color: 'bg-yellow-500' },
      { label: 'Good', color: 'bg-yellow-500' },
      { label: 'Strong', color: 'bg-green-500' },
      { label: 'Very Strong', color: 'bg-green-500' },
    ];

    return { score, ...levels[Math.min(score, levels.length - 1)] };
  };

  const strength = getStrength(password);
  if (!password) return null;

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((level) => (
          <div
            key={level}
            className={`h-1 flex-1 rounded-full transition-colors ${
              level <= strength.score ? strength.color : 'bg-surface-700'
            }`}
          />
        ))}
      </div>
      {strength.label && (
        <p className={`text-xs ${
          strength.color === 'bg-red-500' ? 'text-red-400' :
          strength.color === 'bg-yellow-500' ? 'text-yellow-400' : 'text-green-400'
        }`}>
          {strength.label}
        </p>
      )}
    </div>
  );
};

PasswordStrengthIndicator.displayName = 'PasswordStrengthIndicator';

export { Input, Textarea, SearchInput, PasswordStrengthIndicator };
export default Input;
