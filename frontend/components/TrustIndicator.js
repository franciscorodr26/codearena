/**
 * Trust Indicator Component
 *
 * Displays a user's trust tier with appropriate styling.
 * Used in profiles, admin views, and battle screens.
 */

import React from 'react';
import { Shield, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';

const TIER_CONFIG = {
  trusted: {
    Icon: ShieldCheck,
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    borderColor: 'border-green-500/30',
    label: 'Trusted',
    description: 'Excellent standing'
  },
  standard: {
    Icon: Shield,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/30',
    label: 'Standard',
    description: 'Good standing'
  },
  probation: {
    Icon: ShieldAlert,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    borderColor: 'border-yellow-500/30',
    label: 'Probation',
    description: 'Under review'
  },
  restricted: {
    Icon: ShieldX,
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/30',
    label: 'Restricted',
    description: 'Limited access'
  }
};

export default function TrustIndicator({
  tier = 'standard',
  score,
  showScore = false,
  showLabel = true,
  size = 'md',
  className = ''
}) {
  const config = TIER_CONFIG[tier] || TIER_CONFIG.standard;
  const Icon = config.Icon;

  const sizeClasses = {
    sm: { icon: 'h-3.5 w-3.5', text: 'text-xs', padding: 'px-1.5 py-0.5' },
    md: { icon: 'h-4 w-4', text: 'text-xs', padding: 'px-2 py-1' },
    lg: { icon: 'h-5 w-5', text: 'text-sm', padding: 'px-2.5 py-1.5' }
  };

  const sizes = sizeClasses[size] || sizeClasses.md;

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${sizes.padding} rounded-full ${config.bgColor} border ${config.borderColor} ${className}`}
      title={`${config.label}: ${config.description}${showScore && score !== undefined ? ` (Score: ${score})` : ''}`}
    >
      <Icon className={`${sizes.icon} ${config.color}`} />
      {showLabel && (
        <span className={`font-medium ${config.color} ${sizes.text}`}>
          {config.label}
          {showScore && score !== undefined && (
            <span className="ml-1 opacity-70">({score})</span>
          )}
        </span>
      )}
    </div>
  );
}

// Export for icon-only usage
export function TrustIcon({ tier = 'standard', size = 'md', className = '' }) {
  const config = TIER_CONFIG[tier] || TIER_CONFIG.standard;
  const Icon = config.Icon;

  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6'
  };

  return (
    <Icon
      className={`${sizeClasses[size] || sizeClasses.md} ${config.color} ${className}`}
      title={`${config.label}: ${config.description}`}
    />
  );
}

// Export config for external use
export { TIER_CONFIG };
