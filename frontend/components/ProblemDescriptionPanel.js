// ProblemDescriptionPanel.js - solo practice problem details
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flag,
  Bookmark,
  BookmarkCheck,
  Copy,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Clock,
  AlertTriangle,
  Info,
  Hash,
  Code2,
  Database,
  GitBranch,
  Layers
} from 'lucide-react';

// Category icons mapping
const categoryIcons = {
  'Arrays': Layers,
  'Strings': Code2,
  'Dynamic Programming': GitBranch,
  'SQL': Database,
  'Hash Table': Hash,
  'Math': Hash,
  'Two Pointers': ArrowRight,
  'Binary Search': ArrowRight,
  'default': Code2
};

// Difficulty badge
function DifficultyBadge({ difficulty = 'Easy', size = 'default' }) {
  const config = {
    Easy: {
      bg: 'bg-emerald-500/20',
      border: 'border-emerald-500/50',
      text: 'text-emerald-400',
      dot: 'bg-emerald-400'
    },
    Medium: {
      bg: 'bg-amber-500/20',
      border: 'border-amber-500/50',
      text: 'text-amber-400',
      dot: 'bg-amber-400'
    },
    Hard: {
      bg: 'bg-rose-500/20',
      border: 'border-rose-500/50',
      text: 'text-rose-400',
      dot: 'bg-rose-400'
    }
  };

  // Ensure we always have a valid difficulty and fallback to Easy
  const validDifficulty = difficulty && config[difficulty] ? difficulty : 'Easy';
  const styles = config[validDifficulty];

  const sizing = size === 'sm'
    ? { wrap: 'px-2 py-0.5 gap-1.5', dot: 'w-1.5 h-1.5', text: 'text-xs' }
    : { wrap: 'px-3 py-1.5 gap-2', dot: 'w-2 h-2', text: 'text-sm' };

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`
        relative rounded-full
        ${sizing.wrap}
        ${styles.bg} ${styles.border} border
        flex items-center
      `}
    >
      <span className={`rounded-full ${sizing.dot} ${styles.dot} animate-pulse`} />
      <span className={`font-bold ${sizing.text} ${styles.text}`}>{validDifficulty}</span>
    </motion.div>
  );
}

// Category tag component
function CategoryTag({ category }) {
  const IconComponent = categoryIcons[category] || categoryIcons.default;

  return (
    <motion.div
      initial={{ x: -10, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-800/80 border border-surface-700/50"
    >
      <IconComponent className="w-3.5 h-3.5 text-primary-400" />
      <span className="text-xs font-medium text-surface-300">{category || 'Algorithm'}</span>
    </motion.div>
  );
}

function TopicTag({ tag, isActive = false, onClick }) {
  const TagElement = onClick ? motion.button : motion.span;
  const interactiveProps = onClick
    ? {
        type: 'button',
        onClick,
        'aria-pressed': isActive,
        title: `Show other ${tag} problems`
      }
    : {};

  return (
    <TagElement
      {...interactiveProps}
      initial={{ y: 4, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
        isActive
          ? 'border-primary-400/60 bg-primary-500/15 text-primary-200'
          : 'border-surface-700/70 bg-surface-900/70 text-surface-300 hover:border-surface-600 hover:bg-surface-800/90 hover:text-surface-100'
      }`}
    >
      {tag}
    </TagElement>
  );
}

// Bookmark button with animation
function BookmarkButton({ isBookmarked, onToggle }) {
  const [animate, setAnimate] = useState(false);

  const handleClick = () => {
    setAnimate(true);
    onToggle?.();
    setTimeout(() => setAnimate(false), 300);
  };

  return (
    <motion.button
      onClick={handleClick}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      className={`
        p-2 rounded-lg transition-all duration-200
        ${isBookmarked
          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
          : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/15 hover:text-emerald-200 hover:border-emerald-500/35'
        }
      `}
      title={isBookmarked ? 'Remove bookmark' : 'Bookmark problem'}
    >
      <motion.div
        animate={animate ? { scale: [1, 1.3, 1], rotate: [0, 10, -10, 0] } : {}}
        transition={{ duration: 0.3 }}
      >
        {isBookmarked ? (
          <BookmarkCheck className="w-4 h-4" />
        ) : (
          <Bookmark className="w-4 h-4" />
        )}
      </motion.div>
    </motion.button>
  );
}

// Copy button with feedback
function CopyButton({ text, size = 'sm' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <motion.button
      onClick={handleCopy}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={`
        ${size === 'sm' ? 'p-1' : 'p-1.5'}
        rounded-md transition-all duration-200
        ${copied
          ? 'bg-emerald-500/20 text-emerald-400'
          : 'bg-surface-700/50 text-surface-400 hover:text-surface-200 hover:bg-surface-700'
        }
      `}
      title={copied ? 'Copied!' : 'Copy'}
    >
      <AnimatePresence mode="wait">
        {copied ? (
          <motion.div
            key="check"
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 90 }}
          >
            <Check className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
          </motion.div>
        ) : (
          <motion.div
            key="copy"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
          >
            <Copy className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

// Glassmorphism Example Card
function ExampleCard({ example, index, isSQL = false }) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Guard against null/undefined example
  if (!example || typeof example !== 'object') {
    return null;
  }

  // Safely extract example properties with defaults
  const { input = '', output = '', explanation = '' } = example;

  // Format input/output for display with syntax highlighting
  const formatValue = (value, type = 'input') => {
    if (!value) return null;

    const colorClass = type === 'input' ? 'text-sky-400' : 'text-emerald-400';

    // Handle multiline
    if (value.includes('\n')) {
      return (
        <div className="font-mono text-sm">
          {value.split('\n').map((line, i) => (
            <div key={i} className={colorClass}>{line || ' '}</div>
          ))}
        </div>
      );
    }

    return <span className={`font-mono text-sm ${colorClass}`}>{value}</span>;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="relative group"
    >
      <div className="absolute -inset-[1px] rounded-xl border border-primary-500/0 transition-colors duration-200 group-hover:border-primary-500/30" />

      {/* Card content */}
      <div className="relative bg-surface-800/60 backdrop-blur-md rounded-xl border border-surface-700/50 overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 bg-surface-800/80 border-b border-surface-700/50 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
              <span className="text-xs font-bold text-primary-300">{index + 1}</span>
            </div>
            <span className="text-sm font-medium text-surface-200">Example {index + 1}</span>
          </div>
          <div className="flex items-center gap-2">
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-4 h-4 text-surface-400" />
            </motion.div>
          </div>
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Input and output sit side by side once the panel is wide
                  enough for both. Stacking them cost a full extra card height
                  per example: plus a decorative arrow row: to show two short
                  values, which pushed the constraints below the fold. */}
              <div className="space-y-2.5 p-3">
                <div className="grid gap-2.5 xl:grid-cols-2">
                  {/* Input */}
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Input</span>
                      <CopyButton text={input} />
                    </div>
                    <div className="relative rounded-lg border border-surface-700/30 bg-surface-900/80 p-2.5">
                      <code className="block whitespace-pre-wrap break-all">
                        {formatValue(input, 'input')}
                      </code>
                    </div>
                  </div>

                  {/* Output */}
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Output</span>
                      <CopyButton text={output} />
                    </div>
                    <div className="relative rounded-lg border border-emerald-500/20 bg-surface-900/80 p-2.5">
                      <code className="block whitespace-pre-wrap break-all">
                        {formatValue(output, 'output')}
                      </code>
                    </div>
                  </div>
                </div>

                {/* Explanation */}
                {explanation && (
                  <div className="border-t border-surface-700/50 pt-2.5">
                    <div className="flex items-start gap-2">
                      <Info className="w-4 h-4 text-surface-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-surface-400 leading-relaxed">
                        {explanation}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// Helper to detect constraint type for appropriate icon - defined outside component
const getConstraintIcon = (text) => {
  if (!text || typeof text !== 'string') return 'info';
  const lower = text.toLowerCase();
  if (lower.includes('time') || lower.includes('o(')) return 'clock';
  if (lower.includes('length') || lower.includes('size') || lower.includes('<=') || lower.includes('>=')) return 'hash';
  if (lower.includes('positive') || lower.includes('negative') || lower.includes('integer')) return 'alert';
  return 'info';
};

// Icon mapping for constraints
const constraintIcons = {
  clock: Clock,
  hash: Hash,
  alert: AlertTriangle,
  info: Info
};

// Constraint item with icon and tooltip
function ConstraintItem({ constraint, index }) {
  // Guard against null/undefined constraint
  if (!constraint || typeof constraint !== 'string') {
    return null;
  }

  // Get icon type and check importance at render time
  const iconType = getConstraintIcon(constraint);
  const IconComponent = constraintIcons[iconType];

  // Check if this is an important constraint (contains numbers or big-O notation)
  const isImportant = /\d+|O\(/.test(constraint);

  return (
    <motion.li
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`
        flex items-start gap-3 p-2 rounded-lg transition-colors
        ${isImportant ? 'bg-primary-500/5 border border-primary-500/10' : 'hover:bg-surface-800/30'}
      `}
    >
      <div className={`
        flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center mt-0.5
        ${isImportant ? 'bg-primary-500/20 text-primary-400' : 'bg-surface-700/50 text-surface-400'}
      `}>
        <IconComponent className="w-3.5 h-3.5" />
      </div>
      <span className={`text-sm leading-relaxed ${isImportant ? 'text-surface-200 font-medium' : 'text-surface-300'}`}>
        {constraint}
      </span>
    </motion.li>
  );
}

// Render inline **bold** segments as <strong>, leaving the rest as text
function renderInlineBold(text) {
  if (!text) return text;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="text-surface-100 font-semibold">{part.slice(2, -2)}</strong>
      : part
  );
}

// Collapsible section for long descriptions
function CollapsibleDescription({ description, maxLength = 300 }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const needsCollapse = description && description.length > maxLength;

  if (!description) return null;

  const displayText = needsCollapse && !isExpanded
    ? description.slice(0, maxLength) + '...'
    : description;

  return (
    <div className="space-y-2">
      <p className="text-surface-300 text-base leading-relaxed whitespace-pre-line">
        {renderInlineBold(displayText)}
      </p>
      {needsCollapse && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-4 h-4" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              Read more
            </>
          )}
        </button>
      )}
    </div>
  );
}

// Main component export
export default function ProblemDescriptionPanel({
  problem,
  onReportProblem,
  relatedProblems = [],
  onSelectRelatedProblem,
  ProblemDescriptionRenderer,
  ProblemHelperChatComponent
}) {
  const [activeTag, setActiveTag] = useState(null);

  useEffect(() => {
    setActiveTag(null);
  }, [problem?.id]);

  // Guard against null/undefined problem prop to prevent crashes during loading
  if (!problem || typeof problem !== 'object') return null;

  // Safely extract properties with defaults
  const {
    title = 'Loading...',
    description = '',
    category = 'General',
    difficulty = 'Easy',
    tags = [],
    examples = [],
    constraints = []
  } = problem;

  const normalizedTags = Array.isArray(tags)
    ? tags.filter(tag => typeof tag === 'string' && tag.trim())
    : [];
  const selectedTag = activeTag && normalizedTags.includes(activeTag) ? activeTag : null;
  // The category chip already sits at the top of the header, so repeating it as
  // a topic chip spends a row on nothing.
  const displayTags = normalizedTags.filter(
    tag => tag.trim().toLowerCase() !== String(category || '').trim().toLowerCase()
  );
  const canBrowseRelatedProblems = typeof onSelectRelatedProblem === 'function';
  const difficultyOrder = { Easy: 0, Medium: 1, Hard: 2 };
  const matchingRelatedProblems = selectedTag && Array.isArray(relatedProblems)
    ? relatedProblems
        .filter(related => (
          related
          && related.id !== problem.id
          && Array.isArray(related.tags)
          && related.tags.includes(selectedTag)
        ))
        .sort((a, b) => {
          const difficultyDelta = (difficultyOrder[a.difficulty] ?? 99) - (difficultyOrder[b.difficulty] ?? 99);
          if (difficultyDelta !== 0) return difficultyDelta;
          return String(a.title || '').localeCompare(String(b.title || ''));
        })
        .slice(0, 8)
    : [];

  return (
    <div className="space-y-4">
      {/* Problem Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-xl"
      >
        {/* Content */}
        <div className="relative rounded-xl border border-surface-800 bg-surface-900/70 p-4">
          {/* Top row - Category and actions */}
          <div className="flex items-center justify-between mb-3">
            <CategoryTag category={category} />
            <div className="flex items-center gap-2">
              <motion.button
                onClick={onReportProblem}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-lg bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 hover:bg-yellow-500/20 hover:text-yellow-200 hover:border-yellow-500/40 transition-all"
                title="Report problem"
              >
                <Flag className="w-4 h-4" />
              </motion.button>
            </div>
          </div>

          {/* Title, difficulty and topics share one row. They used to occupy
              three stacked rows: including a "Topics" label for what is
              usually a single chip that repeats the category shown above. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="break-words text-xl font-bold leading-snug tracking-tight text-white">
              {title}
            </h1>
            <DifficultyBadge difficulty={difficulty} size="sm" />
            {displayTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {displayTags.map(tag => (
                  <TopicTag
                    key={tag}
                    tag={tag}
                    isActive={selectedTag === tag}
                    onClick={canBrowseRelatedProblems ? () => setActiveTag(selectedTag === tag ? null : tag) : undefined}
                  />
                ))}
              </div>
            )}
          </div>

          {selectedTag && canBrowseRelatedProblems && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-lg border border-surface-700/70 bg-surface-950/70 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-surface-400">
                  Other {selectedTag} problems
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTag(null)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-200"
                  aria-label="Close related problems"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {matchingRelatedProblems.length > 0 ? (
                <div className="space-y-1.5">
                  {matchingRelatedProblems.map(related => (
                    <button
                      key={related.id}
                      type="button"
                      onClick={() => onSelectRelatedProblem(related)}
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-surface-800 bg-surface-900/80 px-3 py-2 text-left transition-colors hover:border-surface-600 hover:bg-surface-800"
                    >
                      <span className="min-w-0 truncate text-sm font-medium text-surface-100">
                        {related.title || related.id}
                      </span>
                      <span className="flex-shrink-0 text-xs text-surface-500">
                        {related.difficulty || 'Practice'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-surface-500">
                  No other problems use this tag yet.
                </p>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Description Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="prose prose-invert max-w-none"
      >
        {ProblemDescriptionRenderer ? (
          <ProblemDescriptionRenderer description={description} />
        ) : (
          <CollapsibleDescription description={description} maxLength={500} />
        )}
      </motion.div>

      {/* AI Problem Helper Section */}
      {ProblemHelperChatComponent && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="pt-4 border-t border-surface-700"
        >
          {ProblemHelperChatComponent}
        </motion.div>
      )}

      {/* Examples Section */}
      {Array.isArray(examples) && examples.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          <div className="mb-2.5 flex items-center gap-2">
            <Code2 className="h-4 w-4 text-primary-300" />
            <h3 className="text-base font-semibold text-white">Examples</h3>
          </div>

          <div className="space-y-2.5">
            {examples.map((example, index) => (
              <ExampleCard key={index} example={example} index={index} />
            ))}
          </div>
        </motion.div>
      )}

      {/* Constraints Section */}
      {Array.isArray(constraints) && constraints.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <div className="mb-2.5 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h3 className="text-base font-semibold text-white">Constraints</h3>
          </div>

          <ul className="space-y-1">
            {constraints.map((constraint, idx) => (
              <ConstraintItem key={idx} constraint={constraint} index={idx} />
            ))}
          </ul>
        </motion.div>
      )}

    </div>
  );
}

// Export subcomponents for flexibility
export {
  DifficultyBadge,
  CategoryTag,
  TopicTag,
  BookmarkButton,
  CopyButton,
  ExampleCard,
  ConstraintItem,
  CollapsibleDescription
};
