const { LANGUAGES } = require('../languages');
const {
  getLanguageEditorSettings,
  getLanguageFileExtension,
  getLanguageRuntimeName,
} = require('../languages');
const {
  applyCodeArenaMonacoLanguage,
  getMonacoLanguage,
  hasMonacoLanguageLoader,
  MONACO_LANGUAGE_LOADERS,
} = require('../monacoLanguages');

describe('Monaco language support', () => {
  test('every selectable CodeArena language maps to a loadable Monaco contribution', () => {
    for (const language of LANGUAGES) {
      expect(getMonacoLanguage(language.id)).not.toBe('plaintext');
      expect(hasMonacoLanguageLoader(language.id)).toBe(true);
      expect(MONACO_LANGUAGE_LOADERS[getMonacoLanguage(language.id)]).toEqual(expect.any(Function));
    }
  });

  test('every selectable CodeArena language has visible editor metadata', () => {
    for (const language of LANGUAGES) {
      expect(language.runtime).toBe(getLanguageRuntimeName(language.id));
      expect(language.extension).toBe(getLanguageFileExtension(language.id));
      expect(language.extension).toMatch(/^\./);

      const editor = getLanguageEditorSettings(language.id);
      expect(editor.tabSize).toEqual(expect.any(Number));
      expect(typeof editor.insertSpaces).toBe('boolean');
    }
  });

  test('common aliases normalize to supported Monaco language ids', () => {
    expect(getMonacoLanguage('js')).toBe('javascript');
    expect(getMonacoLanguage('TS')).toBe('typescript');
    expect(getMonacoLanguage('py')).toBe('python');
    expect(getMonacoLanguage('C++')).toBe('cpp');
    expect(getMonacoLanguage('c#')).toBe('csharp');
    expect(getMonacoLanguage('postgres')).toBe('sql');
  });

  test('unsupported languages degrade to plaintext instead of an invalid Monaco id', () => {
    expect(getMonacoLanguage('made-up-language')).toBe('plaintext');
    expect(hasMonacoLanguageLoader('made-up-language')).toBe(false);
  });

  test('language application ignores stale async requests during fast language switches', async () => {
    const model = {};
    const editor = { getModel: jest.fn(() => model) };
    const monaco = { editor: { setModelLanguage: jest.fn() } };
    const requestRef = { current: 1 };

    const first = applyCodeArenaMonacoLanguage(editor, monaco, 'made-up-language', requestRef);
    requestRef.current += 1;
    const result = await first;

    expect(result).toBeNull();
    expect(monaco.editor.setModelLanguage).not.toHaveBeenCalled();
  });

  test('language application sets plaintext for unsupported languages when request is current', async () => {
    const model = {};
    const editor = { getModel: jest.fn(() => model) };
    const monaco = { editor: { setModelLanguage: jest.fn() } };

    await expect(applyCodeArenaMonacoLanguage(editor, monaco, 'made-up-language')).resolves.toBe('plaintext');
    expect(monaco.editor.setModelLanguage).toHaveBeenCalledWith(model, 'plaintext');
  });
});
