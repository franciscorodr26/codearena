import dynamic from 'next/dynamic';
import { useCallback, useRef, useEffect, useState, useMemo, memo, Component } from 'react';
import { registerCompletions } from '../utils/editorCompletions';
import { applyCodeArenaMonacoLanguage, getMonacoLanguage } from '../utils/monacoLanguages';
import { getLanguageEditorSettings } from '../utils/languages';

let completionsRegistered = false;
const CODEARENA_TS_EXTRA_LIB = `declare class ListNode {
  val: number;
  next: ListNode | null;
  constructor(val?: number, next?: ListNode | null);
}

declare class TreeNode {
  val: number;
  left: TreeNode | null;
  right: TreeNode | null;
  constructor(val?: number, left?: TreeNode | null, right?: TreeNode | null);
}`;

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-900 flex items-center justify-center">
      <div className="text-gray-400 flex items-center space-x-2">
        <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
        <span>Loading editor...</span>
      </div>
    </div>
  ),
});

// Dynamic import for monaco-vim (client-side only)
const initVimMode = async (editor, statusBarElement) => {
  if (typeof window === 'undefined') return null;
  const { initVimMode: init } = await import('monaco-vim');
  return init(editor, statusBarElement);
};

// Error boundary to catch Monaco Editor failures
class EditorErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full bg-slate-900 flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <div className="text-red-400 text-4xl mb-4">!</div>
            <h3 className="text-white font-semibold mb-2">Editor failed to load</h3>
            <p className="text-gray-400 text-sm mb-4">
              There was a problem loading the code editor. This might be due to a slow connection.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Base editor options (non-mobile-dependent)
const BASE_EDITOR_OPTIONS = {
  fontFamily: 'Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  minimap: { enabled: false },
  automaticLayout: true,
  tabSize: 4,
  insertSpaces: true,
  detectIndentation: false,
  autoIndent: 'full',
  autoClosingBrackets: 'always',
  autoClosingQuotes: 'always',
  autoSurround: 'languageDefined',
  formatOnPaste: true,
  formatOnType: true,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  bracketPairColorization: { enabled: true },
  glyphMargin: false,
};

// Get mobile-specific options
const getEditorOptions = (isMobile) => ({
  ...BASE_EDITOR_OPTIONS,
  fontSize: isMobile ? 12 : 14,
  lineNumbers: isMobile ? 'off' : 'on',
  folding: !isMobile,
  padding: { top: isMobile ? 8 : 16, bottom: isMobile ? 8 : 16 },
  scrollbar: {
    vertical: 'auto',
    horizontal: 'auto',
    verticalScrollbarSize: isMobile ? 6 : 10,
    horizontalScrollbarSize: isMobile ? 6 : 10,
  },
  suggest: {
    showKeywords: true,
    showSnippets: true,
  },
  quickSuggestions: isMobile ? false : {
    other: true,
    comments: false,
    strings: false,
  },
  lineDecorationsWidth: isMobile ? 0 : 10,
  lineNumbersMinChars: isMobile ? 2 : 3,
});

const CodeEditorInner = memo(function CodeEditorInner({
  value,
  onChange,
  onPaste,
  onPasteBlocked,
  onSubmit,
  language = 'javascript',
  readOnly = false,
  height = '400px',
  vimMode = false,
  disablePaste = false,
}) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const containerRef = useRef(null);
  const statusBarRef = useRef(null);
  const vimModeRef = useRef(null);
  const onSubmitRef = useRef(onSubmit);
  const onPasteRef = useRef(onPaste);
  const pasteDisposableRef = useRef(null);
  const languageApplyRequestRef = useRef(0);
  const [editorReady, setEditorReady] = useState(false);
  const monacoLanguage = getMonacoLanguage(language);
  const languageEditorSettings = useMemo(() => getLanguageEditorSettings(language), [language]);

  const applyMonacoLanguage = useCallback((editor, monaco, languageId) => {
    if (!editor || !monaco || !languageId) return;
    applyCodeArenaMonacoLanguage(editor, monaco, languageId, languageApplyRequestRef);
  }, []);

  // Keep onSubmit ref up to date
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  // Keep onPaste ref up to date so the Monaco onDidPaste listener always
  // calls the latest callback without needing to re-subscribe.
  useEffect(() => {
    onPasteRef.current = onPaste;
  }, [onPaste]);

  // Track last value sent via onChange to distinguish user edits from external updates
  const lastOnChangeValueRef = useRef(null);

  // Track mobile state with resize listener
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
  );

  // Listen for resize/orientation changes
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);

  // Paste tracking is wired up inside handleEditorMount via Monaco's
  // editor.onDidPaste: a DOM-level 'paste' listener on the container
  // misses Monaco-internal pastes (e.g. keyboard Ctrl+V), because Monaco
  // intercepts those and does not re-dispatch a DOM paste event.

  // Memoize editor options based on mobile state
  const editorOptions = useMemo(() => ({
    ...getEditorOptions(isMobile),
    tabSize: languageEditorSettings.tabSize,
    insertSpaces: languageEditorSettings.insertSpaces,
    readOnly,
  }), [isMobile, languageEditorSettings.insertSpaces, languageEditorSettings.tabSize, readOnly]);

  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    lastOnChangeValueRef.current = editor.getValue();
    editor.focus();
    setEditorReady(true);
    applyMonacoLanguage(editor, monaco, monacoLanguage);

    // Register standard library completions (once per page load)
    if (!completionsRegistered) {
      completionsRegistered = true;
      registerCompletions(monaco);
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        CODEARENA_TS_EXTRA_LIB,
        'ts:codearena/common-structures.d.ts'
      );
    }

    // Track all pastes via Monaco's authoritative paste signal. This fires for
    // keyboard (Ctrl/Cmd+V), context-menu paste, and drag-drop inside the editor,
    // none of which reliably bubble up as DOM 'paste' events on the container.
    // We always subscribe (even when disablePaste is true) so that if anything
    // sneaks past the block below, the tracker still logs it.
    if (pasteDisposableRef.current) {
      pasteDisposableRef.current.dispose();
      pasteDisposableRef.current = null;
    }
    pasteDisposableRef.current = editor.onDidPaste((event) => {
      const cb = onPasteRef.current;
      if (!cb) return;
      let pastedText = '';
      try {
        const model = editor.getModel();
        if (model && event && event.range) {
          pastedText = model.getValueInRange(event.range) || '';
        }
      } catch (_) {
        pastedText = '';
      }
      cb(pastedText);
    });

    // Block paste at the Monaco level (DOM events don't catch Monaco's internal paste)
    if (disablePaste) {
      const blockPaste = () => { if (onPasteBlocked) onPasteBlocked(); };
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, blockPaste);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV, blockPaste);
      // Override the clipboard paste action (covers context menu paste)
      const originalPaste = editor.getAction('editor.action.clipboardPasteAction');
      if (originalPaste) {
        editor.addAction({
          id: 'editor.action.clipboardPasteAction',
          label: 'Paste',
          run: blockPaste,
        });
      }
    }

    // Cmd/Ctrl+Enter to submit/run tests
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (onSubmitRef.current) onSubmitRef.current();
    });
  }, [applyMonacoLanguage, disablePaste, monacoLanguage, onPasteBlocked]);

  useEffect(() => {
    if (!editorReady) return;
    applyMonacoLanguage(editorRef.current, monacoRef.current, monacoLanguage);
  }, [applyMonacoLanguage, editorReady, monacoLanguage]);

  // Initialize vim mode after editor is mounted and statusBar ref is available
  useEffect(() => {
    if (!editorReady || !vimMode) return;

    const editor = editorRef.current;
    const statusBar = statusBarRef.current;
    if (!editor || !statusBar) return;

    const initVim = async () => {
      try {
        vimModeRef.current = await initVimMode(editor, statusBar);
      } catch (err) {
        console.error('Failed to initialize vim mode:', err);
      }
    };

    initVim();

    return () => {
      if (vimModeRef.current) {
        vimModeRef.current.dispose();
        vimModeRef.current = null;
      }
    };
  }, [editorReady, vimMode]);

  // Dispose the onDidPaste subscription when the component unmounts so we
  // don't leak listeners across React re-mounts (e.g. language switches).
  useEffect(() => {
    return () => {
      if (pasteDisposableRef.current) {
        pasteDisposableRef.current.dispose();
        pasteDisposableRef.current = null;
      }
    };
  }, []);

  const handleChange = useCallback((newValue) => {
    lastOnChangeValueRef.current = newValue;
    onChange(newValue);
  }, [onChange]);

  // Only update editor from external sources (problem switch, language change, reset)
  // Skip updates that are just the parent reflecting back our own onChange
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !editorReady) return;

    // If the incoming value matches what we last sent via onChange,
    // it's just the parent reflecting our own edit: don't touch the editor
    if (value === lastOnChangeValueRef.current) return;

    // This is a genuine external change: apply it
    const currentEditorValue = editor.getValue();
    if (value !== currentEditorValue) {
      const model = editor.getModel();

      // For full content replacements (problem switch, language change, reset),
      // use executeEdits to preserve cursor/scroll position when possible
      if (model) {
        const fullRange = model.getFullModelRange();
        editor.executeEdits('external-update', [{
          range: fullRange,
          text: value,
          forceMoveMarkers: true,
        }]);
      } else {
        editor.setValue(value);
      }
      lastOnChangeValueRef.current = value;
    }
  }, [value, editorReady]);

  // Force Monaco to re-layout when container resizes (fixes scroll bugs after panel resize)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !editorReady) return;

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      // Monaco's automaticLayout can miss rapid resizes; force a layout pass
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.layout();
        }
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [editorReady]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col min-h-0"
      style={{ height }}
      role="textbox"
      aria-label={`Code editor for ${language}`}
      data-testid="code-editor"
      data-codearena-language={language}
      data-monaco-language={monacoLanguage}
    >
      <div className="flex-1 min-h-0 overflow-hidden">
        <MonacoEditor
          height="100%"
          language={monacoLanguage}
          defaultValue={value}
          onChange={handleChange}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={editorOptions}
        />
      </div>
      {vimMode && (
        <div
          ref={statusBarRef}
          className="h-6 bg-slate-800 text-gray-300 text-xs font-mono px-2 flex items-center border-t border-slate-700"
        />
      )}
    </div>
  );
});

// Wrap with error boundary
const CodeEditor = memo(function CodeEditor(props) {
  return (
    <EditorErrorBoundary>
      <CodeEditorInner {...props} />
    </EditorErrorBoundary>
  );
});

export default CodeEditor;
