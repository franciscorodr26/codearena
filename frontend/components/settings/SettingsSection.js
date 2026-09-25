import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Card } from '../ui/Card';

const SettingsSection = forwardRef(function SettingsSection({
  id,
  icon: Icon,
  iconColor = 'text-primary-400',
  title,
  description,
  children,
  variant = 'default',
  className = ''
}, ref) {
  const borderClass = variant === 'danger' ? 'border-danger/30' : '';

  return (
    <motion.section
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={className}
    >
      <Card variant="glass" className={`p-6 ${borderClass}`}>
        {/* Section Header */}
        <div className="flex items-center space-x-3 mb-5">
          {Icon && (
            <div className={`p-2 ${variant === 'danger' ? 'bg-danger/20' : 'bg-surface-800'} rounded-xl`}>
              <Icon className={`h-5 w-5 ${variant === 'danger' ? 'text-danger' : iconColor}`} />
            </div>
          )}
          <div>
            <h2 className={`text-lg font-semibold ${variant === 'danger' ? 'text-danger' : 'text-white'}`}>
              {title}
            </h2>
            {description && (
              <p className="text-sm text-surface-400">{description}</p>
            )}
          </div>
        </div>

        {/* Section Content */}
        <div className="space-y-4">
          {children}
        </div>
      </Card>
    </motion.section>
  );
});

export default SettingsSection;
