import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Loader2,
  Zap,
  Shield,
  Globe,
  TrendingUp,
  Crown,
  X
} from 'lucide-react';
import { config } from '../config/env';
import { authFetch } from '../utils/fetch';
import Button from './ui/Button';

// Strategy icons
const STRATEGY_ICONS = {
  aggressive: Zap,
  defensive: Shield,
  balanced: Globe,
  analytical: TrendingUp,
  elite: Crown
};

// Strategy colors
const STRATEGY_COLORS = {
  aggressive: 'text-orange-400',
  defensive: 'text-blue-400',
  balanced: 'text-emerald-400',
  analytical: 'text-purple-400',
  elite: 'text-amber-400'
};

export default function AgentTemplatePicker({ onSelectTemplate, onClose, compact = false }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authFetch(`${config.backend_url}/api/agent/templates`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch templates');
      setTemplates(data.templates || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplateInBuilder = (template) => {
    if (onSelectTemplate) {
      onSelectTemplate({
        loadInBuilder: true,
        model: template.model,
        systemPrompt: template.systemPrompt,
        language: template.language,
        modules: template.modules
      });
    }
  };

  if (loading) {
    return (
      <div className={`${compact ? 'p-4' : 'p-6'} bg-surface-900/40 border border-surface-800 rounded-lg`}>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 text-surface-500 animate-spin" />
        </div>
      </div>
    );
  }

  if (error && templates.length === 0) {
    return (
      <div className={`${compact ? 'p-4' : 'p-6'} bg-surface-900/40 border border-surface-800 rounded-lg`}>
        <div className="text-center py-8">
          <p className="text-sm text-error">{error}</p>
          <Button variant="ghost" size="sm" onClick={fetchTemplates} className="mt-2">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${compact ? 'p-4' : 'p-6'} bg-surface-900/40 border border-surface-800 rounded-lg`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Sparkles className="h-4 w-4 text-primary-400" />
          <h2 className="text-sm font-medium text-surface-300 uppercase tracking-wider">
            Starter Templates
          </h2>
          <span className="text-[10px] px-1.5 py-0.5 bg-primary-500/10 text-primary-400 rounded">
            Official
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-surface-500 hover:text-surface-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <p className="text-xs text-surface-500 mb-4">
        Pick a proven template to get started quickly, or use it as inspiration for your own loadout.
      </p>

      {error && (
        <div className="mb-4 p-2 bg-error/10 border border-error/20 rounded text-xs text-error">
          {error}
        </div>
      )}

      <div className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'} gap-3`}>
        {templates.map((template) => {
          const StrategyIcon = STRATEGY_ICONS[template.strategy] || Sparkles;
          const strategyColor = STRATEGY_COLORS[template.strategy] || 'text-surface-400';

          return (
            <motion.div
              key={template.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-surface-950/50 border border-surface-800 rounded-lg hover:border-surface-700 transition-all group"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <div className={`p-1.5 rounded ${strategyColor} bg-current/10`}>
                    <StrategyIcon className={`h-3.5 w-3.5 ${strategyColor}`} />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-white">{template.name}</h3>
                    <div className="text-[10px] text-surface-600 capitalize">{template.strategy}</div>
                  </div>
                </div>
                {template.winRate && (
                  <div className={`text-xs font-medium ${
                    template.winRate >= 60 ? 'text-success' :
                    template.winRate >= 50 ? 'text-warning' : 'text-surface-400'
                  }`}>
                    {template.winRate}%
                  </div>
                )}
              </div>

              <p className="text-[11px] text-surface-500 mb-3 line-clamp-2">
                {template.description}
              </p>

              <div className="flex items-center justify-between text-[10px] text-surface-600 mb-3">
                <div className="flex items-center space-x-3">
                  <span className="capitalize">{template.model}</span>
                  <span className="capitalize">{template.language}</span>
                </div>
                {template.timesUsed > 0 && (
                  <span>{template.timesUsed} uses</span>
                )}
              </div>

              <Button
                variant="secondary"
                size="sm"
                fullWidth
                onClick={() => loadTemplateInBuilder(template)}
                className="text-xs"
              >
                Use Template
              </Button>
            </motion.div>
          );
        })}
      </div>

      {templates.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-surface-500">No templates available</p>
        </div>
      )}
    </div>
  );
}
