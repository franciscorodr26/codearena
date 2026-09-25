import { forwardRef } from 'react';

const variants = {
  default: 'bg-surface-800 border border-surface-700/50',
  elevated: 'bg-surface-800 border border-surface-700/50 shadow-lg shadow-black/10',
  glass: 'bg-surface-800/60 backdrop-blur-sm border border-surface-700/40',
  gradient: 'bg-surface-800 border border-surface-700/50',
};

const Card = forwardRef(({
  children,
  variant = 'default',
  className = '',
  hover = false,
  padding = 'md',
  rounded = '2xl',
  as: Component = 'div',
  ...props
}, ref) => {
  const paddingSizes = {
    none: '',
    sm: 'p-4',
    md: 'p-5',
    lg: 'p-6',
    xl: 'p-8',
  };

  const roundedSizes = {
    none: 'rounded-none',
    sm: 'rounded-lg',
    md: 'rounded-xl',
    lg: 'rounded-2xl',
    xl: 'rounded-3xl',
    '2xl': 'rounded-2xl',
    full: 'rounded-full',
  };

  const hoverStyles = hover
    ? 'hover:border-surface-600 hover:-translate-y-0.5 cursor-pointer'
    : '';

  const baseStyles = `
    ${variants[variant] || variants.default}
    ${paddingSizes[padding]}
    ${roundedSizes[rounded]}
    ${hoverStyles}
    transition-all duration-200
  `;

  return (
    <Component
      ref={ref}
      className={`${baseStyles} ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
});

Card.displayName = 'Card';

// Card Header
const CardHeader = forwardRef(({ children, className = '', ...props }, ref) => (
  <div
    ref={ref}
    className={`mb-3 ${className}`}
    {...props}
  >
    {children}
  </div>
));
CardHeader.displayName = 'CardHeader';

// Card Title
const CardTitle = forwardRef(({ children, className = '', as: Component = 'h3', ...props }, ref) => (
  <Component
    ref={ref}
    className={`text-lg font-semibold text-white ${className}`}
    {...props}
  >
    {children}
  </Component>
));
CardTitle.displayName = 'CardTitle';

// Card Description
const CardDescription = forwardRef(({ children, className = '', ...props }, ref) => (
  <p
    ref={ref}
    className={`text-sm text-surface-400 mt-1 ${className}`}
    {...props}
  >
    {children}
  </p>
));
CardDescription.displayName = 'CardDescription';

// Card Content
const CardContent = forwardRef(({ children, className = '', ...props }, ref) => (
  <div
    ref={ref}
    className={className}
    {...props}
  >
    {children}
  </div>
));
CardContent.displayName = 'CardContent';

// Card Footer
const CardFooter = forwardRef(({ children, className = '', ...props }, ref) => (
  <div
    ref={ref}
    className={`mt-4 pt-4 border-t border-surface-700/50 ${className}`}
    {...props}
  >
    {children}
  </div>
));
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};

export default Card;
