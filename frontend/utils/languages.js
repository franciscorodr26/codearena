// Centralized language configuration for CodeArena.
// All language definitions should be imported from here.

export const LANGUAGE_TO_MONACO = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  go: 'go',
  rust: 'rust',
  sql: 'sql',
  csharp: 'csharp',
  ruby: 'ruby',
  php: 'php',
  kotlin: 'kotlin',
  swift: 'swift',
};

export const LANGUAGE_RUNTIME_NAMES = {
  javascript: 'Node.js 12.14',
  typescript: 'TypeScript 3.7',
  python: 'Python 3.8',
  java: 'OpenJDK 13',
  c: 'GCC 9.2',
  cpp: 'GCC 14.1',
  go: 'Go 1.13',
  rust: 'Rust 1.40',
  sql: 'SQLite 3.27',
  csharp: 'Mono 6.6',
  ruby: 'Ruby 2.7',
  php: 'PHP 7.4',
  kotlin: 'Kotlin 1.3',
  swift: 'Swift 5.2',
};

export const LANGUAGE_FILE_EXTENSIONS = {
  javascript: '.js',
  typescript: '.ts',
  python: '.py',
  java: '.java',
  c: '.c',
  cpp: '.cpp',
  go: '.go',
  rust: '.rs',
  sql: '.sql',
  csharp: '.cs',
  ruby: '.rb',
  php: '.php',
  kotlin: '.kt',
  swift: '.swift',
};

export const LANGUAGE_EDITOR_SETTINGS = {
  javascript: { tabSize: 2, insertSpaces: true },
  typescript: { tabSize: 2, insertSpaces: true },
  python: { tabSize: 4, insertSpaces: true },
  java: { tabSize: 4, insertSpaces: true },
  c: { tabSize: 4, insertSpaces: true },
  cpp: { tabSize: 4, insertSpaces: true },
  go: { tabSize: 4, insertSpaces: false },
  rust: { tabSize: 4, insertSpaces: true },
  sql: { tabSize: 2, insertSpaces: true },
  csharp: { tabSize: 4, insertSpaces: true },
  ruby: { tabSize: 2, insertSpaces: true },
  php: { tabSize: 4, insertSpaces: true },
  kotlin: { tabSize: 4, insertSpaces: true },
  swift: { tabSize: 4, insertSpaces: true },
};

const createLanguage = (id, name, color) => ({
  id,
  name,
  icon: '',
  color,
  pro: false,
  monaco: LANGUAGE_TO_MONACO[id],
  runtime: LANGUAGE_RUNTIME_NAMES[id],
  extension: LANGUAGE_FILE_EXTENSIONS[id],
  editor: LANGUAGE_EDITOR_SETTINGS[id],
});

export const LANGUAGES = [
  // All languages are free during beta testing.
  createLanguage('python', 'Python', 'from-blue-400 to-green-500'),
  createLanguage('java', 'Java', 'from-red-400 to-orange-600'),
  createLanguage('javascript', 'JavaScript', 'from-yellow-400 to-orange-500'),
  createLanguage('c', 'C', 'from-gray-400 to-blue-500'),
  createLanguage('cpp', 'C++', 'from-purple-400 to-blue-600'),
  createLanguage('csharp', 'C#', 'from-violet-500 to-violet-700'),
  createLanguage('go', 'Go', 'from-cyan-400 to-teal-600'),
  createLanguage('rust', 'Rust', 'from-orange-400 to-red-600'),
  createLanguage('typescript', 'TypeScript', 'from-blue-500 to-blue-700'),
  createLanguage('sql', 'SQL', 'from-cyan-400 to-cyan-600'),
  createLanguage('ruby', 'Ruby', 'from-red-500 to-red-700'),
  createLanguage('php', 'PHP', 'from-indigo-400 to-purple-600'),
  createLanguage('kotlin', 'Kotlin', 'from-orange-400 to-purple-500'),
  createLanguage('swift', 'Swift', 'from-orange-500 to-red-500'),
];

// Languages the open edition's runner supports. Pickers must come from here
// (or from a problem's runnableLanguages); LANGUAGES stays wider only so that
// historical battles in other languages still get display names.
export const LAUNCH_LANGUAGE_IDS = ['javascript', 'python', 'typescript'];
export const LAUNCH_LANGUAGES = LANGUAGES.filter(lang => LAUNCH_LANGUAGE_IDS.includes(lang.id));

// Pick the languages a problem can run in, in picker order
export const getRunnableLanguages = (problem) => {
  const ids = Array.isArray(problem?.runnableLanguages) && problem.runnableLanguages.length > 0
    ? problem.runnableLanguages
    : LAUNCH_LANGUAGE_IDS;
  return LANGUAGES.filter(lang => ids.includes(lang.id));
};

// Get languages available for a user (everything in the launch set is free)
export const getAvailableLanguages = () => {
  return LAUNCH_LANGUAGES;
};

// Get a specific language by ID
export const getLanguageById = (id) => {
  return LANGUAGES.find(lang => lang.id === id);
};

// Get display name for a language ID (e.g., 'cpp' -> 'C++', 'javascript' -> 'JavaScript')
export const getLanguageDisplayName = (id) => {
  const lang = LANGUAGES.find(l => l.id === id);
  return lang ? lang.name : id.charAt(0).toUpperCase() + id.slice(1);
};

export const getLanguageRuntimeName = (id) => {
  return LANGUAGE_RUNTIME_NAMES[id] || '';
};

export const getLanguageFileExtension = (id) => {
  return LANGUAGE_FILE_EXTENSIONS[id] || '';
};

export const getLanguageEditorSettings = (id) => {
  return LANGUAGE_EDITOR_SETTINGS[id] || { tabSize: 4, insertSpaces: true };
};
