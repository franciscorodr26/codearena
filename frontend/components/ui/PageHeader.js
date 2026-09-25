import { forwardRef } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import Logo from './Logo';

/**
 * PageHeader - Consistent navigation header across all pages
 *
 * @param {string} title - Page title (optional)
 * @param {ReactNode} children - Right-side content (actions, buttons, etc.)
 * @param {boolean} sticky - Whether header sticks to top (default: true)
 * @param {string} maxWidth - Max width class (default: 'max-w-6xl')
 * @param {string} className - Additional classes
 */
const PageHeader = forwardRef(({
  title,
  titleIcon: TitleIcon,
  children,
  sticky = true,
  maxWidth = 'max-w-6xl',
  animate,
  className = '',
  ...props
}, ref) => {
  const stickyStyles = sticky ? 'sticky top-0 z-50' : 'relative z-10';

  const baseStyles = `
    bg-surface-900/80 backdrop-blur-sm border-b border-surface-800
    px-6 py-3 ${stickyStyles} ${className}
  `.trim();

  return (
    <header ref={ref} className={baseStyles} {...props}>
      <div className={`${maxWidth} mx-auto flex items-center justify-between`}>
        <Link
          href="/modes"
          className="flex items-center space-x-2 hover:opacity-80 transition-opacity group"
        >
          <ArrowLeft className="h-4 w-4 text-surface-500 group-hover:text-surface-300 transition-colors" />
          <Logo size="sm" />
        </Link>

        <div className="flex items-center space-x-4">
          {title && (
            <h1 className="text-sm font-medium text-surface-300">
              {title}
            </h1>
          )}
          {children}
        </div>
      </div>
    </header>
  );
});

PageHeader.displayName = 'PageHeader';

export default PageHeader;
