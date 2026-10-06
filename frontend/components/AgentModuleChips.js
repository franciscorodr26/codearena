import {
  BookOpen,
  Bug,
  FileType,
  GitBranch,
  HardDrive,
  Library,
  RotateCcw,
  Shield,
  TestTube,
  TrendingUp
} from 'lucide-react';

const MODULE_META = {
  'test-runner': { name: 'Test Runner', icon: TestTube },
  'auto-retry': { name: 'Auto Retry', icon: RotateCcw },
  'docs-lookup': { name: 'Docs Lookup', icon: BookOpen },
  'debug-mode': { name: 'Debug Mode', icon: Bug },
  'edge-case-focus': { name: 'Edge Case Focus', icon: Shield },
  'type-checker': { name: 'Type Checker', icon: FileType },
  'complexity-analyzer': { name: 'Complexity Analyzer', icon: TrendingUp },
  'memory-profiler': { name: 'Memory Profiler', icon: HardDrive },
  'template-library': { name: 'Template Library', icon: Library },
  'strategic-planner': { name: 'Strategic Planner', icon: GitBranch },
  run_code: { name: 'Test Runner', icon: TestTube },
  auto_retry: { name: 'Auto Retry', icon: RotateCcw },
  docs_lookup: { name: 'Docs Lookup', icon: BookOpen },
  retry: { name: 'Auto Retry', icon: RotateCcw },
  docs: { name: 'Docs Lookup', icon: BookOpen }
};

function formatModuleLabel(moduleId) {
  return moduleId
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function AgentModuleChips({
  modules = [],
  label = 'Modules',
  className = '',
  maxVisible = 4
}) {
  const normalizedModules = [...new Set(
    Array.isArray(modules)
      ? modules.filter(moduleId => typeof moduleId === 'string' && moduleId.length > 0)
      : []
  )];

  if (normalizedModules.length === 0) {
    return null;
  }

  const visibleModules = normalizedModules.slice(0, maxVisible);
  const remainingCount = normalizedModules.length - visibleModules.length;

  return (
    <div className={className}>
      <div className="flex items-start gap-2">
        <span className="pt-1 text-[10px] uppercase tracking-[0.2em] text-surface-500 shrink-0">
          {label}
        </span>
        <div className="flex flex-wrap gap-2">
          {visibleModules.map((moduleId) => {
            const moduleMeta = MODULE_META[moduleId];
            const Icon = moduleMeta?.icon || GitBranch;
            const moduleName = moduleMeta?.name || formatModuleLabel(moduleId);

            return (
              <span
                key={moduleId}
                className="inline-flex items-center gap-1.5 rounded-full border border-surface-700 bg-surface-900/70 px-2.5 py-1 text-xs text-surface-300"
                title={moduleName}
              >
                <Icon className="h-3 w-3 text-primary-400" />
                <span>{moduleName}</span>
              </span>
            );
          })}
          {remainingCount > 0 && (
            <span className="inline-flex items-center rounded-full border border-surface-700 bg-surface-900/50 px-2.5 py-1 text-xs text-surface-400">
              +{remainingCount} more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
