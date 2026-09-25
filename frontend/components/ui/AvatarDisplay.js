import { useState, useEffect } from 'react';
import { getAvatarEmoji } from '../../utils/avatars';

const SIZES = {
  xs: { container: 'w-6 h-6', text: 'text-xs', img: 24 },
  sm: { container: 'w-8 h-8', text: 'text-sm', img: 32 },
  'sm+': { container: 'w-9 h-9', text: 'text-base', img: 36 },
  md: { container: 'w-10 h-10', text: 'text-lg', img: 40 },
  lg: { container: 'w-12 h-12', text: 'text-xl', img: 48 },
  xl: { container: 'w-16 h-16', text: 'text-3xl', img: 64 },
  '2xl': { container: 'w-20 h-20', text: 'text-4xl', img: 80 },
  '3xl': { container: 'w-24 h-24', text: 'text-5xl', img: 96 },
  '4xl': { container: 'w-28 h-28', text: 'text-5xl', img: 112 },
};

export default function AvatarDisplay({ user, avatarUrl, avatar, size = 'md', className = '', rounded = 'full', fill = false }) {
  const url = avatarUrl || user?.avatar_url;
  const avatarId = avatar || user?.avatar;
  const sizeConfig = SIZES[size] || SIZES.md;
  const [imgError, setImgError] = useState(false);

  // Reset error state when URL changes
  useEffect(() => {
    setImgError(false);
  }, [url]);

  const roundedClass = rounded === 'full' ? 'rounded-full' : rounded === '2xl' ? 'rounded-2xl' : `rounded-${rounded}`;
  const fillClass = fill ? 'w-full h-full' : sizeConfig.container;

  // Show image if URL exists and hasn't errored
  if (url && !imgError) {
    return (
      <img
        src={url}
        alt={user?.username || 'Avatar'}
        width={fill ? undefined : sizeConfig.img}
        height={fill ? undefined : sizeConfig.img}
        className={`${fillClass} ${roundedClass} object-cover flex-shrink-0 ${className}`}
        loading="lazy"
        onError={() => setImgError(true)}
      />
    );
  }

  // Fallback to emoji avatar
  return (
    <div className={`${fillClass} ${roundedClass} bg-primary-500 flex items-center justify-center ${sizeConfig.text} flex-shrink-0 ${className}`}>
      {getAvatarEmoji(avatarId)}
    </div>
  );
}
