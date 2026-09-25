import { useState } from 'react';

/**
 * Split an assistant message into plain-text and fenced-code-block segments.
 */
function parseSegments(content) {
  const segments = [];
  const re = /```([\w+#.-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: content.slice(last, m.index) });
    segments.push({ type: 'code', lang: m[1] || '', value: m[2].replace(/\n+$/, '') });
    last = re.lastIndex;
  }
  if (last < content.length) segments.push({ type: 'text', value: content.slice(last) });
  if (segments.length === 0) segments.push({ type: 'text', value: content });
  return segments;
}

function CodeBlock({ lang, value, onApply }) {
  const [applied, setApplied] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked; ignore */ }
  };
  const apply = () => {
    onApply?.(value);
    setApplied(true);
    setTimeout(() => setApplied(false), 1200);
  };

  return (
    <div className="rounded-md border border-white/10 bg-black/40 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 border-b border-white/10 bg-white/5">
        <span className="text-[10px] uppercase tracking-wide text-white/40">{lang || 'code'}</span>
        <div className="flex items-center gap-1">
          {onApply && (
            <button
              onClick={apply}
              className="text-[11px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
            >
              {applied ? 'Applied' : 'Apply'}
            </button>
          )}
          <button
            onClick={copy}
            className="text-[11px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/80"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="p-2 text-xs overflow-x-auto text-white/90 font-mono leading-relaxed"><code>{value}</code></pre>
    </div>
  );
}

/**
 * Render a copilot (assistant) message. Fenced code blocks become boxes with
 * one-click "Apply to editor" (when onApply is provided) and Copy actions, so
 * the player can pull the copilot's code straight into the editor.
 */
export default function CopilotMessage({ content, onApply }) {
  const segments = parseSegments(content || '');
  return (
    <div className="space-y-2">
      {segments.map((seg, i) =>
        seg.type === 'text'
          ? (seg.value.trim() ? <div key={i} className="whitespace-pre-wrap break-words">{seg.value.trim()}</div> : null)
          : <CodeBlock key={i} lang={seg.lang} value={seg.value} onApply={onApply} />
      )}
    </div>
  );
}
