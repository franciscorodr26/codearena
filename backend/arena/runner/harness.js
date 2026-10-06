'use strict'

// Builds a self-contained program from a player's solution plus a small driver.
// The driver reads {"tests":[{"args":[...]}]} as JSON on stdin, calls the
// player's function once per test, and prints one marker line followed by a
// JSON array of results. Anything the player prints themselves stays on stdout
// before the marker and is returned separately as their console output.

// The marker carries a per-run random nonce so a player's own prints cannot
// pose as driver output. (A hostile program could still dig the nonce out of
// its own source, which is why hosted instances should also keep some tests
// unpublished: see docs/problems.md.)
const RESULT_MARKER = '__CODEARENA_RESULTS__'
const markerFor = nonce => `${RESULT_MARKER}${nonce}__`

const LANGUAGES = {
  javascript: { label: 'JavaScript', judge0Id: 63 },
  python: { label: 'Python 3', judge0Id: 71 },
  typescript: { label: 'TypeScript', judge0Id: 74 },
}

function functionNameFor(problem, language) {
  const fn = problem.function
  return language === 'python' ? fn.pythonName : fn.name
}

function javascriptProgram(code, name, marker, typescript = false) {
  // tsc needs the Node globals declared; at runtime this is plain Node.
  const prelude = typescript ? 'declare var require: any; declare var process: any;\n' : ''
  return `${prelude}${code}

;(function __codearenaMain() {
  const __input = JSON.parse(require('fs').readFileSync(0, 'utf8'))
  const __fn = typeof ${name} === 'function' ? ${name} : null
  const __results = __input.tests.map(test => {
    if (!__fn) return { ok: false, error: 'Function ${name} is not defined' }
    try {
      const value = __fn.apply(null, JSON.parse(JSON.stringify(test.args)))
      return { ok: true, value: value === undefined ? null : value }
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) }
    }
  })
  process.stdout.write('\\n${marker}\\n' + JSON.stringify(__results) + '\\n')
})()
`
}

function pythonProgram(code, name, marker) {
  return `${code}

def __codearena_main():
    import json, sys, copy
    data = json.loads(sys.stdin.read())
    fn = globals().get(${JSON.stringify(name)})
    results = []
    for test in data["tests"]:
        if not callable(fn):
            results.append({"ok": False, "error": "Function ${name} is not defined"})
            continue
        try:
            value = fn(*copy.deepcopy(test["args"]))
            if isinstance(value, tuple):
                value = list(value)
            results.append({"ok": True, "value": value})
        except Exception as error:
            results.append({"ok": False, "error": str(error) or type(error).__name__})
    sys.stdout.write("\\n${marker}\\n" + json.dumps(results) + "\\n")

__codearena_main()
`
}

function buildProgram({ language, code, problem, nonce }) {
  if (!/^[a-f0-9]{16,}$/.test(nonce || '')) throw new Error('A random hex nonce is required')
  if (!LANGUAGES[language]) throw new Error(`Unsupported language: ${language}`)
  const name = functionNameFor(problem, language)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid function name: ${name}`)
  const marker = markerFor(nonce)
  if (language === 'python') return pythonProgram(code, name, marker)
  return javascriptProgram(code, name, marker, language === 'typescript')
}

function buildStdin(tests) {
  return JSON.stringify({ tests: tests.map(test => ({ args: test.args })) })
}

// Splits raw stdout into the player's own output and the driver's results.
function parseOutput(stdout, nonce) {
  const text = stdout || ''
  const marker = markerFor(nonce)
  const index = text.lastIndexOf(`\n${marker}\n`)
  if (index === -1) return { consoleOutput: text, results: null }
  const tail = text.slice(index + marker.length + 2).trim()
  try {
    return { consoleOutput: text.slice(0, index), results: JSON.parse(tail) }
  } catch {
    return { consoleOutput: text.slice(0, index), results: null }
  }
}

function starterCode(problem, language) {
  const fn = problem.function
  const params = fn.params.map(p => p.name)
  if (language === 'python') {
    const pyParams = params.map(toSnakeCase)
    return `def ${fn.pythonName}(${pyParams.join(', ')}):\n    # Your code here\n    pass\n`
  }
  if (language === 'typescript') {
    const typed = fn.params.map(p => `${p.name}: ${tsType(p.type)}`)
    return `function ${fn.name}(${typed.join(', ')}): ${tsType(fn.returns)} {\n  // Your code here\n}\n`
  }
  return `function ${fn.name}(${params.join(', ')}) {\n  // Your code here\n}\n`
}

// Problem types use "integer"; TypeScript says number.
function tsType(type) {
  return String(type || 'any').replace(/integer|float/g, 'number')
}

function toSnakeCase(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

module.exports = {
  LANGUAGES,
  RESULT_MARKER,
  buildProgram,
  buildStdin,
  parseOutput,
  starterCode,
  toSnakeCase,
  tsType,
}
