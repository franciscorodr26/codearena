/**
 * Logo - CodeArena brand mark (mint "C with inner negative space") + wordmark.
 * The mark matches the favicon / app icon, see design/logo-concepts/.
 */
const MARK_PATH =
  'M390 388 L124 388 L124 124 L390 124 L390 184 L208 184 L208 328 L390 328 Z';

const Logo = ({ size = 'md', className = '', showText = true }) => {
  const sizes = {
    sm: { text: 'text-lg', icon: 22, gap: 'gap-2' },
    md: { text: 'text-xl', icon: 26, gap: 'gap-2' },
    lg: { text: 'text-2xl', icon: 30, gap: 'gap-2' },
    xl: { text: 'text-3xl', icon: 42, gap: 'gap-3' },
  };

  const s = sizes[size] || sizes.md;

  return (
    <span className={`flex items-center ${s.gap} ${className}`}>
      <svg
        width={s.icon}
        height={s.icon}
        viewBox="92 92 328 328"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d={MARK_PATH}
          stroke="#5EEAD4"
          strokeWidth="40"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {showText && (
        <span className={`${s.text} font-bold text-white`}>CodeArena</span>
      )}
    </span>
  );
};

export default Logo;
