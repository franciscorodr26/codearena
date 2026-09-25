import { LANGUAGE_TO_MONACO } from './languages';

export const MONACO_LANGUAGE_ALIASES = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  cplusplus: 'cpp',
  'c++': 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
};

const COMMON_OPERATORS = [
  '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||',
  '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '+=', '-=', '*=',
  '/=', '&=', '|=', '^=', '%=', '=>', '===', '!==', '->', '::',
];

const BRACKETS = [
  ['{', '}', 'delimiter.curly'],
  ['[', ']', 'delimiter.square'],
  ['(', ')', 'delimiter.parenthesis'],
];

const AUTO_CLOSING_PAIRS = [
  { open: '{', close: '}' },
  { open: '[', close: ']' },
  { open: '(', close: ')' },
  { open: '"', close: '"', notIn: ['string'] },
  { open: "'", close: "'", notIn: ['string', 'comment'] },
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createConfiguration({ lineComment = '//', blockComment = ['/*', '*/'] } = {}) {
  return {
    comments: {
      ...(lineComment ? { lineComment } : {}),
      ...(blockComment ? { blockComment } : {}),
    },
    brackets: BRACKETS.map(([open, close]) => [open, close]),
    autoClosingPairs: AUTO_CLOSING_PAIRS,
    surroundingPairs: AUTO_CLOSING_PAIRS,
  };
}

function createLanguage({ keywords, lineComment = '//', blockComment = true, identifier = /[a-zA-Z_$][\w$]*/, extraRoot = [] }) {
  const whitespace = [[/[ \t\r\n]+/, 'white']];
  if (lineComment) whitespace.push([new RegExp(`${escapeRegExp(lineComment)}.*$`), 'comment']);
  if (blockComment) whitespace.push([/\/\*/, 'comment', '@comment']);

  return {
    defaultToken: '',
    tokenPostfix: '.codearena',
    keywords,
    operators: COMMON_OPERATORS,
    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    escapes: /\\(?:[abfnrtv\\"'0-9xuU])/,
    tokenizer: {
      root: [
        ...extraRoot,
        [identifier, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        { include: '@whitespace' },
        [/[{}()[\]]/, '@brackets'],
        [/[<>](?!@symbols)/, '@brackets'],
        [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
        [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/\d+/, 'number'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', bracket: '@open', next: '@stringDouble' }],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/'/, { token: 'string.quote', bracket: '@open', next: '@stringSingle' }],
      ],
      whitespace,
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
      stringDouble: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],
      stringSingle: [
        [/[^\\']+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],
      tripleDouble: [
        [/[^"]+/, 'string'],
        [/"""/, 'string', '@pop'],
        [/"/, 'string'],
      ],
      tripleSingle: [
        [/[^']+/, 'string'],
        [/'''/, 'string', '@pop'],
        [/'/, 'string'],
      ],
    },
  };
}

const cLikeExtraRoot = [[/^\s*#\s*\w+/, 'keyword']];
const phpExtraRoot = [[/<\?php|<\?=|\?>/, 'metatag'], [/\$[a-zA-Z_]\w*/, 'variable']];
const rubyExtraRoot = [[/:[a-zA-Z_]\w*/, 'string.key']];
const rustExtraRoot = [[/'[a-zA-Z_]\w*/, 'variable.predefined']];
const pythonExtraRoot = [[/"""/, 'string', '@tripleDouble'], [/'''/, 'string', '@tripleSingle']];

const languageDefinitions = {
  javascript: {
    conf: createConfiguration(),
    language: createLanguage({
      keywords: [
        'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
        'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends',
        'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof',
        'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'this',
        'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
        'true', 'false', 'null', 'undefined',
      ],
    }),
  },
  typescript: {
    conf: createConfiguration(),
    language: createLanguage({
      keywords: [
        'abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case',
        'catch', 'class', 'const', 'constructor', 'continue', 'declare',
        'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
        'false', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements',
        'import', 'in', 'instanceof', 'interface', 'keyof', 'let', 'module',
        'namespace', 'new', 'null', 'number', 'of', 'private', 'protected',
        'public', 'readonly', 'return', 'set', 'static', 'string', 'super',
        'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined',
        'var', 'void', 'while', 'with', 'yield',
      ],
    }),
  },
  python: {
    conf: createConfiguration({ lineComment: '#', blockComment: null }),
    language: createLanguage({
      lineComment: '#',
      blockComment: false,
      extraRoot: pythonExtraRoot,
      keywords: [
        'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
        'def', 'del', 'elif', 'else', 'except', 'False', 'finally', 'for',
        'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None',
        'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try',
        'while', 'with', 'yield',
      ],
    }),
  },
  java: {
    conf: createConfiguration(),
    language: createLanguage({
      keywords: [
        'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch',
        'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else',
        'enum', 'extends', 'final', 'finally', 'float', 'for', 'if',
        'implements', 'import', 'instanceof', 'int', 'interface', 'long',
        'native', 'new', 'package', 'private', 'protected', 'public', 'return',
        'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
        'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while',
        'true', 'false', 'null',
      ],
    }),
  },
  c: {
    conf: createConfiguration(),
    language: createLanguage({
      extraRoot: cLikeExtraRoot,
      keywords: [
        'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
        'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if',
        'inline', 'int', 'long', 'register', 'restrict', 'return', 'short',
        'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
        'unsigned', 'void', 'volatile', 'while', 'bool', 'true', 'false',
      ],
    }),
  },
  cpp: {
    conf: createConfiguration(),
    language: createLanguage({
      extraRoot: cLikeExtraRoot,
      keywords: [
        'alignas', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class',
        'const', 'constexpr', 'continue', 'decltype', 'default', 'delete', 'do',
        'double', 'else', 'enum', 'explicit', 'extern', 'false', 'float', 'for',
        'friend', 'if', 'inline', 'int', 'long', 'namespace', 'new', 'noexcept',
        'nullptr', 'operator', 'private', 'protected', 'public', 'return',
        'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'template',
        'this', 'throw', 'true', 'try', 'typedef', 'typename', 'using',
        'virtual', 'void', 'while', 'vector', 'string',
      ],
    }),
  },
  go: {
    conf: createConfiguration(),
    language: createLanguage({
      keywords: [
        'break', 'case', 'chan', 'const', 'continue', 'default', 'defer',
        'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import',
        'interface', 'map', 'package', 'range', 'return', 'select', 'struct',
        'switch', 'type', 'var', 'true', 'false', 'nil',
      ],
    }),
  },
  rust: {
    conf: createConfiguration(),
    language: createLanguage({
      extraRoot: rustExtraRoot,
      keywords: [
        'as', 'async', 'await', 'bool', 'Box', 'break', 'const', 'continue',
        'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'i32',
        'i64', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut',
        'pub', 'ref', 'return', 'Self', 'self', 'static', 'str', 'struct',
        'super', 'trait', 'true', 'type', 'unsafe', 'use', 'Vec', 'where',
        'while',
      ],
    }),
  },
  sql: {
    conf: createConfiguration({ lineComment: '--', blockComment: ['/*', '*/'] }),
    language: createLanguage({
      lineComment: '--',
      identifier: /[a-zA-Z_][\w$]*/,
      keywords: [
        'ADD', 'ALL', 'ALTER', 'AND', 'AS', 'ASC', 'BETWEEN', 'BY', 'CASE',
        'CAST', 'CREATE', 'DELETE', 'DESC', 'DISTINCT', 'DROP', 'ELSE', 'END',
        'EXISTS', 'FROM', 'GROUP', 'HAVING', 'IN', 'INNER', 'INSERT', 'INTO',
        'IS', 'JOIN', 'LEFT', 'LIKE', 'LIMIT', 'NOT', 'NULL', 'ON', 'OR',
        'ORDER', 'OUTER', 'RIGHT', 'SELECT', 'SET', 'THEN', 'UPDATE', 'VALUES',
        'WHEN', 'WHERE',
      ],
    }),
  },
  csharp: {
    conf: createConfiguration(),
    language: createLanguage({
      keywords: [
        'abstract', 'as', 'base', 'bool', 'break', 'case', 'catch', 'class',
        'const', 'continue', 'decimal', 'default', 'delegate', 'do', 'double',
        'else', 'enum', 'event', 'explicit', 'extern', 'false', 'finally',
        'fixed', 'float', 'for', 'foreach', 'if', 'implicit', 'in', 'int',
        'interface', 'internal', 'is', 'lock', 'long', 'namespace', 'new',
        'null', 'object', 'operator', 'out', 'override', 'params', 'private',
        'protected', 'public', 'readonly', 'ref', 'return', 'sealed', 'short',
        'sizeof', 'static', 'string', 'struct', 'switch', 'this', 'throw',
        'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe',
        'using', 'virtual', 'void', 'while',
      ],
    }),
  },
  ruby: {
    conf: createConfiguration({ lineComment: '#', blockComment: null }),
    language: createLanguage({
      lineComment: '#',
      blockComment: false,
      extraRoot: rubyExtraRoot,
      keywords: [
        'alias', 'and', 'begin', 'break', 'case', 'class', 'def', 'defined',
        'do', 'else', 'elsif', 'end', 'ensure', 'false', 'for', 'if', 'in',
        'module', 'next', 'nil', 'not', 'or', 'redo', 'rescue', 'retry',
        'return', 'self', 'super', 'then', 'true', 'undef', 'unless', 'until',
        'when', 'while', 'yield',
      ],
    }),
  },
  php: {
    conf: createConfiguration(),
    language: createLanguage({
      extraRoot: phpExtraRoot,
      keywords: [
        'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch',
        'class', 'clone', 'const', 'continue', 'declare', 'default', 'die', 'do',
        'echo', 'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach',
        'endif', 'endswitch', 'endwhile', 'eval', 'exit', 'extends', 'final',
        'finally', 'fn', 'for', 'foreach', 'function', 'global', 'if',
        'implements', 'include', 'instanceof', 'interface', 'isset', 'list',
        'namespace', 'new', 'or', 'private', 'protected', 'public', 'require',
        'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset', 'use',
        'var', 'while', 'xor', 'true', 'false', 'null',
      ],
    }),
  },
  kotlin: {
    conf: createConfiguration(),
    language: createLanguage({
      keywords: [
        'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun',
        'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return',
        'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val',
        'var', 'when', 'while', 'Int', 'Boolean', 'Double', 'String', 'Array',
        'IntArray',
      ],
    }),
  },
  swift: {
    conf: createConfiguration(),
    language: createLanguage({
      keywords: [
        'Any', 'as', 'associatedtype', 'Bool', 'break', 'case', 'catch', 'class',
        'continue', 'default', 'defer', 'deinit', 'do', 'Double', 'else', 'enum',
        'extension', 'fallthrough', 'false', 'fileprivate', 'for', 'func',
        'guard', 'if', 'import', 'in', 'init', 'inout', 'Int', 'internal', 'is',
        'let', 'nil', 'open', 'operator', 'private', 'protocol', 'public',
        'repeat', 'return', 'self', 'Self', 'static', 'String', 'struct',
        'subscript', 'super', 'switch', 'throw', 'throws', 'true', 'try',
        'typealias', 'var', 'where', 'while',
      ],
    }),
  },
};

export const MONACO_LANGUAGE_LOADERS = Object.fromEntries(
  Object.entries(languageDefinitions).map(([languageId, definition]) => [
    languageId,
    () => Promise.resolve(definition),
  ])
);

const monacoLanguageLoadPromises = {};
const registeredMonacoLanguages = {};

export function getMonacoLanguage(language) {
  if (!language) return 'plaintext';

  const normalized = String(language).trim().toLowerCase();
  const mapped = LANGUAGE_TO_MONACO[normalized] || MONACO_LANGUAGE_ALIASES[normalized] || normalized;

  return MONACO_LANGUAGE_LOADERS[mapped] ? mapped : 'plaintext';
}

export function hasMonacoLanguageLoader(language) {
  return Boolean(MONACO_LANGUAGE_LOADERS[getMonacoLanguage(language)]);
}

function registerMonacoLanguage(monaco, languageId, contribution) {
  if (!monaco?.languages || !languageId || !contribution) return;

  const knownLanguages = typeof monaco.languages.getLanguages === 'function'
    ? monaco.languages.getLanguages()
    : [];

  if (!knownLanguages.some((known) => known?.id === languageId) && typeof monaco.languages.register === 'function') {
    monaco.languages.register({ id: languageId });
  }

  if (contribution.language && typeof monaco.languages.setMonarchTokensProvider === 'function') {
    monaco.languages.setMonarchTokensProvider(languageId, contribution.language);
  }

  if (contribution.conf && typeof monaco.languages.setLanguageConfiguration === 'function') {
    monaco.languages.setLanguageConfiguration(languageId, contribution.conf);
  }

  registeredMonacoLanguages[languageId] = true;
}

export function ensureMonacoLanguage(monaco, language) {
  const monacoLanguage = getMonacoLanguage(language);
  const loader = MONACO_LANGUAGE_LOADERS[monacoLanguage];

  if (!loader || typeof window === 'undefined') {
    return Promise.resolve(monacoLanguage);
  }

  if (!monacoLanguageLoadPromises[monacoLanguage]) {
    monacoLanguageLoadPromises[monacoLanguage] = loader().catch((err) => {
      delete monacoLanguageLoadPromises[monacoLanguage];
      throw err;
    });
  }

  return monacoLanguageLoadPromises[monacoLanguage].then((contribution) => {
    if (!registeredMonacoLanguages[monacoLanguage]) {
      registerMonacoLanguage(monaco, monacoLanguage, contribution);
    }
    return monacoLanguage;
  });
}

export function applyCodeArenaMonacoLanguage(editor, monaco, language, requestRef) {
  if (!editor || !monaco) return Promise.resolve(null);

  const monacoLanguage = getMonacoLanguage(language);
  const requestId = requestRef ? requestRef.current + 1 : 0;

  if (requestRef) {
    requestRef.current = requestId;
  }

  return ensureMonacoLanguage(monaco, monacoLanguage)
    .catch((err) => {
      console.warn(`Failed to load Monaco language support for ${monacoLanguage}:`, err);
      return monacoLanguage;
    })
    .then((resolvedLanguage) => {
      if (requestRef && requestRef.current !== requestId) {
        return null;
      }

      const model = editor.getModel?.();
      if (model && monaco.editor?.setModelLanguage) {
        monaco.editor.setModelLanguage(model, resolvedLanguage);
      }

      return resolvedLanguage;
    });
}
