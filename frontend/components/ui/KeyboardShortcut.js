import { usePlatform, getShortcut } from '../../utils/platform';

/**
 * KeyboardShortcut - Display platform-aware keyboard shortcuts
 *
 * Shows the appropriate modifier key based on the user's platform:
 * - Mac: Command symbol + key
 * - Windows/Linux: Ctrl + key
 *
 * @param {Object} props
 * @param {string} props.shortcut - The key to display (e.g., 'Enter', 'K', 'S')
 * @param {string} props.variant - Visual variant: 'default' | 'light' | 'subtle'
 * @param {string} props.size - Size: 'sm' | 'md'
 * @param {string} props.className - Additional CSS classes
 *
 * @example
 * <KeyboardShortcut shortcut="Enter" />
 * // Mac: "⌘↵"
 * // Windows: "Ctrl↵"
 */
const KeyboardShortcut = ({
  shortcut,
  variant = 'default',
  size = 'sm',
  className = '',
}) => {
  const { isMac, modifier } = usePlatform();

  // Get the formatted shortcut text
  const shortcutText = getShortcut(shortcut, { useSymbol: true });

  // Variant styles
  const variantStyles = {
    default: 'bg-white/20 border-white/30 text-white/90',
    light: 'bg-white/10 border-white/20 text-white/80',
    subtle: 'bg-surface-700/50 border-surface-600/50 text-surface-400',
  };

  // Size styles
  const sizeStyles = {
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-0.5 text-xs',
  };

  return (
    <kbd
      className={`
        inline-flex items-center justify-center
        font-mono font-medium
        rounded-md border
        select-none
        ${variantStyles[variant] || variantStyles.default}
        ${sizeStyles[size] || sizeStyles.sm}
        ${className}
      `}
      title={`${isMac ? 'Cmd' : 'Ctrl'}+${shortcut}`}
    >
      {shortcutText}
    </kbd>
  );
};

export default KeyboardShortcut;
