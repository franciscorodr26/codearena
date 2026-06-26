// Standard library autocomplete data for Monaco Editor
// Focused on functions commonly used in competitive programming

const pythonModules = {
  math: [
    { label: 'sqrt', insert: 'sqrt($1)', detail: 'math.sqrt(x)', doc: 'Return the square root of x' },
    { label: 'ceil', insert: 'ceil($1)', detail: 'math.ceil(x)', doc: 'Return the ceiling of x' },
    { label: 'floor', insert: 'floor($1)', detail: 'math.floor(x)', doc: 'Return the floor of x' },
    { label: 'log', insert: 'log($1)', detail: 'math.log(x[, base])', doc: 'Return the logarithm of x' },
    { label: 'log2', insert: 'log2($1)', detail: 'math.log2(x)', doc: 'Return the base-2 logarithm of x' },
    { label: 'log10', insert: 'log10($1)', detail: 'math.log10(x)', doc: 'Return the base-10 logarithm of x' },
    { label: 'pow', insert: 'pow($1, $2)', detail: 'math.pow(x, y)', doc: 'Return x raised to the power y' },
    { label: 'gcd', insert: 'gcd($1, $2)', detail: 'math.gcd(a, b)', doc: 'Return greatest common divisor' },
    { label: 'lcm', insert: 'lcm($1, $2)', detail: 'math.lcm(a, b)', doc: 'Return least common multiple' },
    { label: 'factorial', insert: 'factorial($1)', detail: 'math.factorial(n)', doc: 'Return n factorial' },
    { label: 'comb', insert: 'comb($1, $2)', detail: 'math.comb(n, k)', doc: 'Return n choose k' },
    { label: 'perm', insert: 'perm($1, $2)', detail: 'math.perm(n, k)', doc: 'Return number of permutations' },
    { label: 'inf', insert: 'inf', detail: 'math.inf', doc: 'Positive infinity' },
    { label: 'pi', insert: 'pi', detail: 'math.pi', doc: '3.141592653589793' },
    { label: 'isfinite', insert: 'isfinite($1)', detail: 'math.isfinite(x)', doc: 'Return True if x is finite' },
    { label: 'isinf', insert: 'isinf($1)', detail: 'math.isinf(x)', doc: 'Return True if x is infinite' },
    { label: 'abs', insert: 'abs($1)', detail: 'math.fabs(x)', doc: 'Return absolute value' },
  ],
  collections: [
    { label: 'Counter', insert: 'Counter($1)', detail: 'collections.Counter(iterable)', doc: 'Dict subclass for counting hashable objects' },
    { label: 'defaultdict', insert: 'defaultdict($1)', detail: 'collections.defaultdict(factory)', doc: 'Dict subclass with default factory' },
    { label: 'deque', insert: 'deque($1)', detail: 'collections.deque(iterable)', doc: 'Double-ended queue' },
    { label: 'OrderedDict', insert: 'OrderedDict($1)', detail: 'collections.OrderedDict()', doc: 'Dict that remembers insertion order' },
    { label: 'namedtuple', insert: "namedtuple('$1', [$2])", detail: 'collections.namedtuple(name, fields)', doc: 'Factory for tuple subclasses with named fields' },
  ],
  itertools: [
    { label: 'permutations', insert: 'permutations($1)', detail: 'itertools.permutations(iterable[, r])', doc: 'Return successive r-length permutations' },
    { label: 'combinations', insert: 'combinations($1, $2)', detail: 'itertools.combinations(iterable, r)', doc: 'Return r-length combinations' },
    { label: 'combinations_with_replacement', insert: 'combinations_with_replacement($1, $2)', detail: 'itertools.combinations_with_replacement(iterable, r)', doc: 'Return r-length combinations with replacement' },
    { label: 'product', insert: 'product($1)', detail: 'itertools.product(*iterables)', doc: 'Cartesian product of iterables' },
    { label: 'chain', insert: 'chain($1)', detail: 'itertools.chain(*iterables)', doc: 'Chain multiple iterables together' },
    { label: 'accumulate', insert: 'accumulate($1)', detail: 'itertools.accumulate(iterable)', doc: 'Running totals (prefix sums)' },
    { label: 'groupby', insert: 'groupby($1)', detail: 'itertools.groupby(iterable[, key])', doc: 'Group consecutive elements by key' },
    { label: 'zip_longest', insert: 'zip_longest($1)', detail: 'itertools.zip_longest(*iterables)', doc: 'Zip stopping at longest iterable' },
    { label: 'starmap', insert: 'starmap($1, $2)', detail: 'itertools.starmap(func, iterable)', doc: 'Apply function using argument tuples' },
    { label: 'count', insert: 'count($1)', detail: 'itertools.count(start=0, step=1)', doc: 'Infinite counter' },
    { label: 'cycle', insert: 'cycle($1)', detail: 'itertools.cycle(iterable)', doc: 'Infinite cycling iterator' },
    { label: 'repeat', insert: 'repeat($1)', detail: 'itertools.repeat(elem[, n])', doc: 'Repeat element n times' },
  ],
  heapq: [
    { label: 'heappush', insert: 'heappush($1, $2)', detail: 'heapq.heappush(heap, item)', doc: 'Push item onto heap' },
    { label: 'heappop', insert: 'heappop($1)', detail: 'heapq.heappop(heap)', doc: 'Pop smallest item from heap' },
    { label: 'heapify', insert: 'heapify($1)', detail: 'heapq.heapify(list)', doc: 'Transform list into a heap in-place' },
    { label: 'heappushpop', insert: 'heappushpop($1, $2)', detail: 'heapq.heappushpop(heap, item)', doc: 'Push then pop smallest' },
    { label: 'heapreplace', insert: 'heapreplace($1, $2)', detail: 'heapq.heapreplace(heap, item)', doc: 'Pop smallest then push' },
    { label: 'nlargest', insert: 'nlargest($1, $2)', detail: 'heapq.nlargest(n, iterable)', doc: 'Return n largest elements' },
    { label: 'nsmallest', insert: 'nsmallest($1, $2)', detail: 'heapq.nsmallest(n, iterable)', doc: 'Return n smallest elements' },
  ],
  bisect: [
    { label: 'bisect_left', insert: 'bisect_left($1, $2)', detail: 'bisect.bisect_left(a, x)', doc: 'Locate leftmost insertion point' },
    { label: 'bisect_right', insert: 'bisect_right($1, $2)', detail: 'bisect.bisect_right(a, x)', doc: 'Locate rightmost insertion point' },
    { label: 'insort_left', insert: 'insort_left($1, $2)', detail: 'bisect.insort_left(a, x)', doc: 'Insert x in sorted list (left)' },
    { label: 'insort_right', insert: 'insort_right($1, $2)', detail: 'bisect.insort_right(a, x)', doc: 'Insert x in sorted list (right)' },
    { label: 'bisect', insert: 'bisect($1, $2)', detail: 'bisect.bisect(a, x)', doc: 'Alias for bisect_right' },
    { label: 'insort', insert: 'insort($1, $2)', detail: 'bisect.insort(a, x)', doc: 'Alias for insort_right' },
  ],
  functools: [
    { label: 'lru_cache', insert: 'lru_cache(maxsize=$1)', detail: '@functools.lru_cache(maxsize=128)', doc: 'Memoization decorator' },
    { label: 'cache', insert: 'cache', detail: '@functools.cache', doc: 'Unbounded memoization decorator' },
    { label: 'reduce', insert: 'reduce($1, $2)', detail: 'functools.reduce(func, iterable)', doc: 'Apply function of two args cumulatively' },
    { label: 'partial', insert: 'partial($1)', detail: 'functools.partial(func, *args)', doc: 'Partial function application' },
    { label: 'cmp_to_key', insert: 'cmp_to_key($1)', detail: 'functools.cmp_to_key(func)', doc: 'Convert comparison function to key function' },
  ],
  string: [
    { label: 'ascii_lowercase', insert: 'ascii_lowercase', detail: 'string.ascii_lowercase', doc: "'abcdefghijklmnopqrstuvwxyz'" },
    { label: 'ascii_uppercase', insert: 'ascii_uppercase', detail: 'string.ascii_uppercase', doc: "'ABCDEFGHIJKLMNOPQRSTUVWXYZ'" },
    { label: 'ascii_letters', insert: 'ascii_letters', detail: 'string.ascii_letters', doc: 'Lowercase + uppercase letters' },
    { label: 'digits', insert: 'digits', detail: 'string.digits', doc: "'0123456789'" },
  ],
  re: [
    { label: 'match', insert: 'match($1, $2)', detail: 're.match(pattern, string)', doc: 'Match pattern at start of string' },
    { label: 'search', insert: 'search($1, $2)', detail: 're.search(pattern, string)', doc: 'Search for pattern anywhere in string' },
    { label: 'findall', insert: 'findall($1, $2)', detail: 're.findall(pattern, string)', doc: 'Return all non-overlapping matches' },
    { label: 'finditer', insert: 'finditer($1, $2)', detail: 're.finditer(pattern, string)', doc: 'Return iterator of match objects' },
    { label: 'sub', insert: 'sub($1, $2, $3)', detail: 're.sub(pattern, repl, string)', doc: 'Replace occurrences of pattern' },
    { label: 'split', insert: 'split($1, $2)', detail: 're.split(pattern, string)', doc: 'Split string by pattern' },
    { label: 'compile', insert: 'compile($1)', detail: 're.compile(pattern)', doc: 'Compile pattern into regex object' },
  ],
  sys: [
    { label: 'maxsize', insert: 'maxsize', detail: 'sys.maxsize', doc: 'Largest positive integer for Py_ssize_t' },
    { label: 'stdin', insert: 'stdin', detail: 'sys.stdin', doc: 'Standard input stream' },
    { label: 'stdout', insert: 'stdout', detail: 'sys.stdout', doc: 'Standard output stream' },
    { label: 'setrecursionlimit', insert: 'setrecursionlimit($1)', detail: 'sys.setrecursionlimit(limit)', doc: 'Set max recursion depth' },
    { label: 'getrecursionlimit', insert: 'getrecursionlimit()', detail: 'sys.getrecursionlimit()', doc: 'Get current max recursion depth' },
  ],
  json: [
    { label: 'dumps', insert: 'dumps($1)', detail: 'json.dumps(obj)', doc: 'Serialize object to JSON string' },
    { label: 'loads', insert: 'loads($1)', detail: 'json.loads(s)', doc: 'Deserialize JSON string to object' },
    { label: 'dump', insert: 'dump($1, $2)', detail: 'json.dump(obj, fp)', doc: 'Serialize object to JSON file' },
    { label: 'load', insert: 'load($1)', detail: 'json.load(fp)', doc: 'Deserialize JSON file to object' },
  ],
};

const pythonBuiltins = [
  { label: 'sorted', insert: 'sorted($1)', detail: 'sorted(iterable, *, key=None, reverse=False)', doc: 'Return a new sorted list' },
  { label: 'enumerate', insert: 'enumerate($1)', detail: 'enumerate(iterable, start=0)', doc: 'Return enumerate object with index-value pairs' },
  { label: 'zip', insert: 'zip($1)', detail: 'zip(*iterables)', doc: 'Aggregate elements from each iterable' },
  { label: 'map', insert: 'map($1, $2)', detail: 'map(func, iterable)', doc: 'Apply function to every item of iterable' },
  { label: 'filter', insert: 'filter($1, $2)', detail: 'filter(func, iterable)', doc: 'Filter elements using function' },
  { label: 'range', insert: 'range($1)', detail: 'range(stop) / range(start, stop[, step])', doc: 'Return range of integers' },
  { label: 'len', insert: 'len($1)', detail: 'len(obj)', doc: 'Return the number of items' },
  { label: 'abs', insert: 'abs($1)', detail: 'abs(x)', doc: 'Return absolute value' },
  { label: 'min', insert: 'min($1)', detail: 'min(iterable, *, key=None)', doc: 'Return the smallest item' },
  { label: 'max', insert: 'max($1)', detail: 'max(iterable, *, key=None)', doc: 'Return the largest item' },
  { label: 'sum', insert: 'sum($1)', detail: 'sum(iterable, start=0)', doc: 'Sum items of iterable' },
  { label: 'int', insert: 'int($1)', detail: 'int(x, base=10)', doc: 'Convert to integer' },
  { label: 'float', insert: 'float($1)', detail: 'float(x)', doc: 'Convert to float' },
  { label: 'str', insert: 'str($1)', detail: 'str(object)', doc: 'Convert to string' },
  { label: 'list', insert: 'list($1)', detail: 'list(iterable)', doc: 'Convert to list' },
  { label: 'dict', insert: 'dict($1)', detail: 'dict(**kwargs)', doc: 'Create dictionary' },
  { label: 'set', insert: 'set($1)', detail: 'set(iterable)', doc: 'Create set' },
  { label: 'tuple', insert: 'tuple($1)', detail: 'tuple(iterable)', doc: 'Create tuple' },
  { label: 'print', insert: 'print($1)', detail: 'print(*objects, sep=" ", end="\\n")', doc: 'Print objects to stdout' },
  { label: 'input', insert: 'input($1)', detail: 'input(prompt)', doc: 'Read line from stdin' },
  { label: 'isinstance', insert: 'isinstance($1, $2)', detail: 'isinstance(obj, classinfo)', doc: 'Check if object is instance of class' },
  { label: 'type', insert: 'type($1)', detail: 'type(object)', doc: 'Return the type of object' },
  { label: 'reversed', insert: 'reversed($1)', detail: 'reversed(seq)', doc: 'Return reversed iterator' },
  { label: 'any', insert: 'any($1)', detail: 'any(iterable)', doc: 'Return True if any element is true' },
  { label: 'all', insert: 'all($1)', detail: 'all(iterable)', doc: 'Return True if all elements are true' },
  { label: 'ord', insert: 'ord($1)', detail: 'ord(c)', doc: 'Return Unicode code point for character' },
  { label: 'chr', insert: 'chr($1)', detail: 'chr(i)', doc: 'Return character from Unicode code point' },
  { label: 'bin', insert: 'bin($1)', detail: 'bin(x)', doc: 'Convert integer to binary string' },
  { label: 'hex', insert: 'hex($1)', detail: 'hex(x)', doc: 'Convert integer to hex string' },
  { label: 'oct', insert: 'oct($1)', detail: 'oct(x)', doc: 'Convert integer to octal string' },
  { label: 'pow', insert: 'pow($1, $2)', detail: 'pow(base, exp[, mod])', doc: 'Return base to the power exp' },
  { label: 'round', insert: 'round($1)', detail: 'round(number[, ndigits])', doc: 'Round number to ndigits precision' },
  { label: 'divmod', insert: 'divmod($1, $2)', detail: 'divmod(a, b)', doc: 'Return (quotient, remainder)' },
  { label: 'hash', insert: 'hash($1)', detail: 'hash(object)', doc: 'Return hash value of object' },
  { label: 'bool', insert: 'bool($1)', detail: 'bool(x)', doc: 'Convert to boolean' },
  { label: 'iter', insert: 'iter($1)', detail: 'iter(object)', doc: 'Return an iterator object' },
  { label: 'next', insert: 'next($1)', detail: 'next(iterator[, default])', doc: 'Return next item from iterator' },
  { label: 'open', insert: "open($1, '$2')", detail: "open(file, mode='r')", doc: 'Open file and return file object' },
];

// Module names as completions for top-level
const pythonModuleNames = Object.keys(pythonModules).map(name => ({
  label: name, insert: name, detail: `import ${name}`, doc: `Python ${name} module`, kind: 'Module',
}));

const jsCompletions = {
  Math: [
    { label: 'Math.floor', insert: 'Math.floor($1)', detail: 'Math.floor(x): number', doc: 'Round down to nearest integer' },
    { label: 'Math.ceil', insert: 'Math.ceil($1)', detail: 'Math.ceil(x): number', doc: 'Round up to nearest integer' },
    { label: 'Math.round', insert: 'Math.round($1)', detail: 'Math.round(x): number', doc: 'Round to nearest integer' },
    { label: 'Math.abs', insert: 'Math.abs($1)', detail: 'Math.abs(x): number', doc: 'Return absolute value' },
    { label: 'Math.max', insert: 'Math.max($1)', detail: 'Math.max(...values): number', doc: 'Return largest of arguments' },
    { label: 'Math.min', insert: 'Math.min($1)', detail: 'Math.min(...values): number', doc: 'Return smallest of arguments' },
    { label: 'Math.sqrt', insert: 'Math.sqrt($1)', detail: 'Math.sqrt(x): number', doc: 'Return square root' },
    { label: 'Math.pow', insert: 'Math.pow($1, $2)', detail: 'Math.pow(base, exp): number', doc: 'Return base to the power exp' },
    { label: 'Math.log', insert: 'Math.log($1)', detail: 'Math.log(x): number', doc: 'Return natural logarithm' },
    { label: 'Math.log2', insert: 'Math.log2($1)', detail: 'Math.log2(x): number', doc: 'Return base-2 logarithm' },
    { label: 'Math.log10', insert: 'Math.log10($1)', detail: 'Math.log10(x): number', doc: 'Return base-10 logarithm' },
    { label: 'Math.random', insert: 'Math.random()', detail: 'Math.random(): number', doc: 'Return random number [0, 1)' },
    { label: 'Math.trunc', insert: 'Math.trunc($1)', detail: 'Math.trunc(x): number', doc: 'Truncate to integer part' },
    { label: 'Math.sign', insert: 'Math.sign($1)', detail: 'Math.sign(x): number', doc: 'Return sign of number (-1, 0, 1)' },
    { label: 'Math.PI', insert: 'Math.PI', detail: 'Math.PI: number', doc: '3.141592653589793' },
    { label: 'Math.E', insert: 'Math.E', detail: 'Math.E: number', doc: "Euler's number 2.718..." },
    { label: 'Math.POSITIVE_INFINITY', insert: 'Math.POSITIVE_INFINITY', detail: 'number', doc: 'Positive infinity' },
  ],
  Array: [
    { label: 'Array.from', insert: 'Array.from($1)', detail: 'Array.from(arrayLike, mapFn?)', doc: 'Create array from iterable' },
    { label: 'Array.isArray', insert: 'Array.isArray($1)', detail: 'Array.isArray(value): boolean', doc: 'Check if value is an array' },
    { label: '.push', insert: '.push($1)', detail: '.push(...items): number', doc: 'Add elements to end, return new length' },
    { label: '.pop', insert: '.pop()', detail: '.pop(): T', doc: 'Remove and return last element' },
    { label: '.shift', insert: '.shift()', detail: '.shift(): T', doc: 'Remove and return first element' },
    { label: '.unshift', insert: '.unshift($1)', detail: '.unshift(...items): number', doc: 'Add elements to beginning' },
    { label: '.slice', insert: '.slice($1, $2)', detail: '.slice(start?, end?): T[]', doc: 'Return shallow copy of portion' },
    { label: '.splice', insert: '.splice($1, $2)', detail: '.splice(start, deleteCount, ...items)', doc: 'Change array by removing/adding elements' },
    { label: '.map', insert: '.map($1)', detail: '.map(callback): T[]', doc: 'Create new array with results of callback' },
    { label: '.filter', insert: '.filter($1)', detail: '.filter(callback): T[]', doc: 'Create array with elements that pass test' },
    { label: '.reduce', insert: '.reduce($1, $2)', detail: '.reduce(callback, initial?)', doc: 'Reduce array to single value' },
    { label: '.forEach', insert: '.forEach($1)', detail: '.forEach(callback): void', doc: 'Execute callback for each element' },
    { label: '.find', insert: '.find($1)', detail: '.find(callback): T | undefined', doc: 'Return first element that passes test' },
    { label: '.findIndex', insert: '.findIndex($1)', detail: '.findIndex(callback): number', doc: 'Return index of first element that passes test' },
    { label: '.includes', insert: '.includes($1)', detail: '.includes(value): boolean', doc: 'Check if array contains value' },
    { label: '.indexOf', insert: '.indexOf($1)', detail: '.indexOf(value): number', doc: 'Return first index of value' },
    { label: '.sort', insert: '.sort($1)', detail: '.sort(compareFn?): T[]', doc: 'Sort array in place' },
    { label: '.reverse', insert: '.reverse()', detail: '.reverse(): T[]', doc: 'Reverse array in place' },
    { label: '.join', insert: '.join($1)', detail: ".join(separator?): string", doc: 'Join elements into string' },
    { label: '.flat', insert: '.flat($1)', detail: '.flat(depth?): T[]', doc: 'Flatten nested arrays' },
    { label: '.flatMap', insert: '.flatMap($1)', detail: '.flatMap(callback): T[]', doc: 'Map then flatten one level' },
    { label: '.every', insert: '.every($1)', detail: '.every(callback): boolean', doc: 'Test if all elements pass' },
    { label: '.some', insert: '.some($1)', detail: '.some(callback): boolean', doc: 'Test if any element passes' },
    { label: '.fill', insert: '.fill($1)', detail: '.fill(value, start?, end?): T[]', doc: 'Fill with static value' },
    { label: '.concat', insert: '.concat($1)', detail: '.concat(...arrays): T[]', doc: 'Merge arrays' },
    { label: '.entries', insert: '.entries()', detail: '.entries(): Iterator', doc: 'Return [index, value] iterator' },
  ],
  Object: [
    { label: 'Object.keys', insert: 'Object.keys($1)', detail: 'Object.keys(obj): string[]', doc: 'Return array of own property names' },
    { label: 'Object.values', insert: 'Object.values($1)', detail: 'Object.values(obj): any[]', doc: 'Return array of own property values' },
    { label: 'Object.entries', insert: 'Object.entries($1)', detail: 'Object.entries(obj): [string, any][]', doc: 'Return array of [key, value] pairs' },
    { label: 'Object.assign', insert: 'Object.assign($1, $2)', detail: 'Object.assign(target, ...sources)', doc: 'Copy properties to target object' },
    { label: 'Object.freeze', insert: 'Object.freeze($1)', detail: 'Object.freeze(obj)', doc: 'Freeze object (prevent modifications)' },
    { label: 'Object.fromEntries', insert: 'Object.fromEntries($1)', detail: 'Object.fromEntries(iterable)', doc: 'Create object from [key, value] pairs' },
    { label: 'Object.hasOwn', insert: 'Object.hasOwn($1, $2)', detail: 'Object.hasOwn(obj, prop): boolean', doc: 'Check if object has own property' },
  ],
  String: [
    { label: '.split', insert: '.split($1)', detail: '.split(separator): string[]', doc: 'Split string into array' },
    { label: '.trim', insert: '.trim()', detail: '.trim(): string', doc: 'Remove whitespace from both ends' },
    { label: '.toLowerCase', insert: '.toLowerCase()', detail: '.toLowerCase(): string', doc: 'Convert to lowercase' },
    { label: '.toUpperCase', insert: '.toUpperCase()', detail: '.toUpperCase(): string', doc: 'Convert to uppercase' },
    { label: '.replace', insert: '.replace($1, $2)', detail: '.replace(search, replacement): string', doc: 'Replace first occurrence' },
    { label: '.replaceAll', insert: '.replaceAll($1, $2)', detail: '.replaceAll(search, replacement): string', doc: 'Replace all occurrences' },
    { label: '.includes', insert: '.includes($1)', detail: '.includes(search): boolean', doc: 'Check if string contains substring' },
    { label: '.startsWith', insert: '.startsWith($1)', detail: '.startsWith(search): boolean', doc: 'Check if string starts with' },
    { label: '.endsWith', insert: '.endsWith($1)', detail: '.endsWith(search): boolean', doc: 'Check if string ends with' },
    { label: '.substring', insert: '.substring($1, $2)', detail: '.substring(start, end?): string', doc: 'Return part of string' },
    { label: '.slice', insert: '.slice($1, $2)', detail: '.slice(start?, end?): string', doc: 'Extract section of string' },
    { label: '.indexOf', insert: '.indexOf($1)', detail: '.indexOf(search): number', doc: 'Return first index of substring' },
    { label: '.lastIndexOf', insert: '.lastIndexOf($1)', detail: '.lastIndexOf(search): number', doc: 'Return last index of substring' },
    { label: '.charAt', insert: '.charAt($1)', detail: '.charAt(index): string', doc: 'Return character at index' },
    { label: '.charCodeAt', insert: '.charCodeAt($1)', detail: '.charCodeAt(index): number', doc: 'Return UTF-16 code at index' },
    { label: '.padStart', insert: '.padStart($1, $2)', detail: '.padStart(targetLength, padString?)', doc: 'Pad start of string' },
    { label: '.padEnd', insert: '.padEnd($1, $2)', detail: '.padEnd(targetLength, padString?)', doc: 'Pad end of string' },
    { label: '.repeat', insert: '.repeat($1)', detail: '.repeat(count): string', doc: 'Repeat string count times' },
    { label: '.match', insert: '.match($1)', detail: '.match(regexp): RegExpMatchArray', doc: 'Match against regex' },
    { label: '.matchAll', insert: '.matchAll($1)', detail: '.matchAll(regexp): Iterator', doc: 'Return all regex matches' },
    { label: 'String.fromCharCode', insert: 'String.fromCharCode($1)', detail: 'String.fromCharCode(...codes)', doc: 'Create string from char codes' },
  ],
  JSON: [
    { label: 'JSON.stringify', insert: 'JSON.stringify($1)', detail: 'JSON.stringify(value): string', doc: 'Convert value to JSON string' },
    { label: 'JSON.parse', insert: 'JSON.parse($1)', detail: 'JSON.parse(text): any', doc: 'Parse JSON string' },
  ],
  Map: [
    { label: 'new Map', insert: 'new Map($1)', detail: 'new Map(entries?)', doc: 'Create a new Map' },
    { label: '.set', insert: '.set($1, $2)', detail: '.set(key, value): Map', doc: 'Set key-value pair' },
    { label: '.get', insert: '.get($1)', detail: '.get(key): V | undefined', doc: 'Get value by key' },
    { label: '.has', insert: '.has($1)', detail: '.has(key): boolean', doc: 'Check if key exists' },
    { label: '.delete', insert: '.delete($1)', detail: '.delete(key): boolean', doc: 'Remove key-value pair' },
    { label: '.size', insert: '.size', detail: '.size: number', doc: 'Number of entries' },
  ],
  Set: [
    { label: 'new Set', insert: 'new Set($1)', detail: 'new Set(iterable?)', doc: 'Create a new Set' },
    { label: '.add', insert: '.add($1)', detail: '.add(value): Set', doc: 'Add value to set' },
    { label: '.has', insert: '.has($1)', detail: '.has(value): boolean', doc: 'Check if value exists' },
    { label: '.delete', insert: '.delete($1)', detail: '.delete(value): boolean', doc: 'Remove value from set' },
    { label: '.size', insert: '.size', detail: '.size: number', doc: 'Number of elements' },
  ],
  Number: [
    { label: 'Number.parseInt', insert: 'Number.parseInt($1)', detail: 'Number.parseInt(string, radix?)', doc: 'Parse string to integer' },
    { label: 'Number.parseFloat', insert: 'Number.parseFloat($1)', detail: 'Number.parseFloat(string)', doc: 'Parse string to float' },
    { label: 'Number.isInteger', insert: 'Number.isInteger($1)', detail: 'Number.isInteger(value): boolean', doc: 'Check if value is integer' },
    { label: 'Number.isFinite', insert: 'Number.isFinite($1)', detail: 'Number.isFinite(value): boolean', doc: 'Check if value is finite' },
    { label: 'Number.isNaN', insert: 'Number.isNaN($1)', detail: 'Number.isNaN(value): boolean', doc: 'Check if value is NaN' },
    { label: 'Number.MAX_SAFE_INTEGER', insert: 'Number.MAX_SAFE_INTEGER', detail: 'number', doc: '2^53 - 1' },
  ],
  console: [
    { label: 'console.log', insert: 'console.log($1)', detail: 'console.log(...args): void', doc: 'Log to console' },
    { label: 'console.error', insert: 'console.error($1)', detail: 'console.error(...args): void', doc: 'Log error to console' },
    { label: 'console.warn', insert: 'console.warn($1)', detail: 'console.warn(...args): void', doc: 'Log warning to console' },
    { label: 'console.time', insert: "console.time('$1')", detail: 'console.time(label): void', doc: 'Start timer' },
    { label: 'console.timeEnd', insert: "console.timeEnd('$1')", detail: 'console.timeEnd(label): void', doc: 'End timer and log duration' },
  ],
  Promise: [
    { label: 'Promise.all', insert: 'Promise.all($1)', detail: 'Promise.all(promises): Promise', doc: 'Wait for all promises to resolve' },
    { label: 'Promise.race', insert: 'Promise.race($1)', detail: 'Promise.race(promises): Promise', doc: 'Wait for first promise to settle' },
    { label: 'Promise.resolve', insert: 'Promise.resolve($1)', detail: 'Promise.resolve(value): Promise', doc: 'Create resolved promise' },
    { label: 'Promise.reject', insert: 'Promise.reject($1)', detail: 'Promise.reject(reason): Promise', doc: 'Create rejected promise' },
    { label: 'Promise.allSettled', insert: 'Promise.allSettled($1)', detail: 'Promise.allSettled(promises)', doc: 'Wait for all to settle' },
  ],
  globalFunctions: [
    { label: 'parseInt', insert: 'parseInt($1)', detail: 'parseInt(string, radix?): number', doc: 'Parse string to integer' },
    { label: 'parseFloat', insert: 'parseFloat($1)', detail: 'parseFloat(string): number', doc: 'Parse string to float' },
    { label: 'isNaN', insert: 'isNaN($1)', detail: 'isNaN(value): boolean', doc: 'Check if value is NaN' },
    { label: 'isFinite', insert: 'isFinite($1)', detail: 'isFinite(value): boolean', doc: 'Check if value is finite' },
    { label: 'setTimeout', insert: 'setTimeout($1, $2)', detail: 'setTimeout(callback, ms): number', doc: 'Execute callback after delay' },
    { label: 'setInterval', insert: 'setInterval($1, $2)', detail: 'setInterval(callback, ms): number', doc: 'Execute callback repeatedly' },
    { label: 'clearTimeout', insert: 'clearTimeout($1)', detail: 'clearTimeout(id): void', doc: 'Cancel setTimeout' },
    { label: 'clearInterval', insert: 'clearInterval($1)', detail: 'clearInterval(id): void', doc: 'Cancel setInterval' },
  ],
};

// TypeScript-specific utility types and keywords
const typescriptCompletions = [
  // Utility Types
  { label: 'Partial<T>', insert: 'Partial<$1>', detail: 'Partial<Type>', doc: 'Make all properties optional' },
  { label: 'Required<T>', insert: 'Required<$1>', detail: 'Required<Type>', doc: 'Make all properties required' },
  { label: 'Readonly<T>', insert: 'Readonly<$1>', detail: 'Readonly<Type>', doc: 'Make all properties readonly' },
  { label: 'Record<K,V>', insert: 'Record<$1, $2>', detail: 'Record<Keys, Type>', doc: 'Create object type with key-value mapping' },
  { label: 'Pick<T,K>', insert: 'Pick<$1, $2>', detail: 'Pick<Type, Keys>', doc: 'Create type with only specified properties' },
  { label: 'Omit<T,K>', insert: 'Omit<$1, $2>', detail: 'Omit<Type, Keys>', doc: 'Create type without specified properties' },
  { label: 'Exclude<T,U>', insert: 'Exclude<$1, $2>', detail: 'Exclude<UnionType, ExcludedMembers>', doc: 'Exclude types from union' },
  { label: 'Extract<T,U>', insert: 'Extract<$1, $2>', detail: 'Extract<Type, Union>', doc: 'Extract types matching union' },
  { label: 'NonNullable<T>', insert: 'NonNullable<$1>', detail: 'NonNullable<Type>', doc: 'Remove null and undefined' },
  { label: 'ReturnType<T>', insert: 'ReturnType<typeof $1>', detail: 'ReturnType<Type>', doc: 'Get return type of function' },
  { label: 'Parameters<T>', insert: 'Parameters<typeof $1>', detail: 'Parameters<Type>', doc: 'Get parameter types tuple' },
  { label: 'Awaited<T>', insert: 'Awaited<$1>', detail: 'Awaited<Type>', doc: 'Unwrap Promise type recursively' },
  { label: 'InstanceType<T>', insert: 'InstanceType<typeof $1>', detail: 'InstanceType<Type>', doc: 'Get instance type of constructor' },
  // Type keywords
  { label: 'keyof', insert: 'keyof $1', detail: 'keyof Type', doc: 'Get union of property keys' },
  { label: 'typeof', insert: 'typeof $1', detail: 'typeof value', doc: 'Get type of value' },
  { label: 'infer', insert: 'infer $1', detail: 'infer TypeVar', doc: 'Infer type in conditional' },
  { label: 'extends', insert: 'extends $1', detail: 'T extends Type', doc: 'Type constraint' },
  { label: 'as const', insert: 'as const', detail: 'as const', doc: 'Assert literal/readonly type' },
  { label: 'satisfies', insert: 'satisfies $1', detail: 'satisfies Type', doc: 'Type validation without widening' },
  // Common type annotations
  { label: 'type', insert: 'type $1 = $2;', detail: 'type Alias = Type', doc: 'Define type alias' },
  { label: 'interface', insert: 'interface $1 {\n    $2\n}', detail: 'interface Name { }', doc: 'Define interface' },
  { label: 'enum', insert: 'enum $1 {\n    $2\n}', detail: 'enum Name { }', doc: 'Define enum' },
  // Basic types
  { label: 'number', insert: 'number', detail: 'number', doc: 'Number type (int/float)' },
  { label: 'string', insert: 'string', detail: 'string', doc: 'String type' },
  { label: 'boolean', insert: 'boolean', detail: 'boolean', doc: 'Boolean type' },
  { label: 'null', insert: 'null', detail: 'null', doc: 'Null type' },
  { label: 'undefined', insert: 'undefined', detail: 'undefined', doc: 'Undefined type' },
  { label: 'void', insert: 'void', detail: 'void', doc: 'Void return type' },
  { label: 'never', insert: 'never', detail: 'never', doc: 'Never type (unreachable)' },
  { label: 'unknown', insert: 'unknown', detail: 'unknown', doc: 'Type-safe any' },
  { label: 'any', insert: 'any', detail: 'any', doc: 'Any type (escape hatch)' },
  // Array/Object types
  { label: 'Array<T>', insert: 'Array<$1>', detail: 'Array<Type>', doc: 'Generic array type' },
  { label: 'Map<K,V>', insert: 'Map<$1, $2>', detail: 'Map<Key, Value>', doc: 'Map type' },
  { label: 'Set<T>', insert: 'Set<$1>', detail: 'Set<Type>', doc: 'Set type' },
  { label: 'Promise<T>', insert: 'Promise<$1>', detail: 'Promise<Type>', doc: 'Promise type' },
];

const javaCompletions = [
  // Arrays utility
  { label: 'Arrays.sort', insert: 'Arrays.sort($1)', detail: 'Arrays.sort(T[] a)', doc: 'Sort array in ascending order' },
  { label: 'Arrays.binarySearch', insert: 'Arrays.binarySearch($1, $2)', detail: 'Arrays.binarySearch(T[] a, T key)', doc: 'Binary search sorted array' },
  { label: 'Arrays.fill', insert: 'Arrays.fill($1, $2)', detail: 'Arrays.fill(T[] a, T val)', doc: 'Fill array with value' },
  { label: 'Arrays.copyOf', insert: 'Arrays.copyOf($1, $2)', detail: 'Arrays.copyOf(T[] a, int len)', doc: 'Copy array with new length' },
  { label: 'Arrays.asList', insert: 'Arrays.asList($1)', detail: 'Arrays.asList(T... a): List<T>', doc: 'Convert array to fixed-size List' },
  { label: 'Arrays.stream', insert: 'Arrays.stream($1)', detail: 'Arrays.stream(T[] a): Stream<T>', doc: 'Create stream from array' },
  { label: 'Arrays.toString', insert: 'Arrays.toString($1)', detail: 'Arrays.toString(T[] a): String', doc: 'String representation of array' },
  // Collections
  { label: 'Collections.sort', insert: 'Collections.sort($1)', detail: 'Collections.sort(List<T> list)', doc: 'Sort list in ascending order' },
  { label: 'Collections.reverse', insert: 'Collections.reverse($1)', detail: 'Collections.reverse(List<?> list)', doc: 'Reverse list' },
  { label: 'Collections.min', insert: 'Collections.min($1)', detail: 'Collections.min(Collection<T>): T', doc: 'Return minimum element' },
  { label: 'Collections.max', insert: 'Collections.max($1)', detail: 'Collections.max(Collection<T>): T', doc: 'Return maximum element' },
  { label: 'Collections.frequency', insert: 'Collections.frequency($1, $2)', detail: 'Collections.frequency(Collection<?>, Object)', doc: 'Count occurrences' },
  { label: 'Collections.unmodifiableList', insert: 'Collections.unmodifiableList($1)', detail: 'Collections.unmodifiableList(List)', doc: 'Return unmodifiable view' },
  // Math
  { label: 'Math.abs', insert: 'Math.abs($1)', detail: 'Math.abs(int a): int', doc: 'Return absolute value' },
  { label: 'Math.max', insert: 'Math.max($1, $2)', detail: 'Math.max(int a, int b): int', doc: 'Return larger of two values' },
  { label: 'Math.min', insert: 'Math.min($1, $2)', detail: 'Math.min(int a, int b): int', doc: 'Return smaller of two values' },
  { label: 'Math.pow', insert: 'Math.pow($1, $2)', detail: 'Math.pow(double a, double b): double', doc: 'Return a raised to power b' },
  { label: 'Math.sqrt', insert: 'Math.sqrt($1)', detail: 'Math.sqrt(double a): double', doc: 'Return square root' },
  { label: 'Math.ceil', insert: 'Math.ceil($1)', detail: 'Math.ceil(double a): double', doc: 'Round up to nearest integer' },
  { label: 'Math.floor', insert: 'Math.floor($1)', detail: 'Math.floor(double a): double', doc: 'Round down to nearest integer' },
  { label: 'Math.round', insert: 'Math.round($1)', detail: 'Math.round(double a): long', doc: 'Round to nearest integer' },
  { label: 'Math.log', insert: 'Math.log($1)', detail: 'Math.log(double a): double', doc: 'Natural logarithm' },
  { label: 'Math.random', insert: 'Math.random()', detail: 'Math.random(): double', doc: 'Random number [0.0, 1.0)' },
  // String
  { label: '.length()', insert: '.length()', detail: 'String.length(): int', doc: 'Return string length' },
  { label: '.charAt', insert: '.charAt($1)', detail: 'String.charAt(int index): char', doc: 'Return character at index' },
  { label: '.substring', insert: '.substring($1, $2)', detail: 'String.substring(int begin, int end)', doc: 'Return substring' },
  { label: '.indexOf', insert: '.indexOf($1)', detail: 'String.indexOf(String str): int', doc: 'Return index of substring' },
  { label: '.contains', insert: '.contains($1)', detail: 'String.contains(CharSequence): boolean', doc: 'Check if string contains' },
  { label: '.equals', insert: '.equals($1)', detail: 'String.equals(Object): boolean', doc: 'Compare string equality' },
  { label: '.toCharArray', insert: '.toCharArray()', detail: 'String.toCharArray(): char[]', doc: 'Convert to char array' },
  { label: '.split', insert: '.split($1)', detail: 'String.split(String regex): String[]', doc: 'Split by regex' },
  { label: 'String.valueOf', insert: 'String.valueOf($1)', detail: 'String.valueOf(Object): String', doc: 'Convert to string' },
  { label: 'Integer.parseInt', insert: 'Integer.parseInt($1)', detail: 'Integer.parseInt(String s): int', doc: 'Parse string to int' },
  { label: 'Integer.MAX_VALUE', insert: 'Integer.MAX_VALUE', detail: 'int', doc: '2^31 - 1' },
  { label: 'Integer.MIN_VALUE', insert: 'Integer.MIN_VALUE', detail: 'int', doc: '-2^31' },
  { label: 'Long.MAX_VALUE', insert: 'Long.MAX_VALUE', detail: 'long', doc: '2^63 - 1' },
  // Data structures
  { label: 'new HashMap<>', insert: 'new HashMap<>()', detail: 'new HashMap<K, V>()', doc: 'Hash table based Map' },
  { label: 'new ArrayList<>', insert: 'new ArrayList<>()', detail: 'new ArrayList<T>()', doc: 'Resizable array List' },
  { label: 'new LinkedList<>', insert: 'new LinkedList<>()', detail: 'new LinkedList<T>()', doc: 'Doubly-linked list' },
  { label: 'new Stack<>', insert: 'new Stack<>()', detail: 'new Stack<T>()', doc: 'LIFO stack' },
  { label: 'new PriorityQueue<>', insert: 'new PriorityQueue<>()', detail: 'new PriorityQueue<T>()', doc: 'Min-heap priority queue' },
  { label: 'new HashSet<>', insert: 'new HashSet<>()', detail: 'new HashSet<T>()', doc: 'Hash table based Set' },
  { label: 'new TreeSet<>', insert: 'new TreeSet<>()', detail: 'new TreeSet<T>()', doc: 'Sorted set (Red-Black tree)' },
  { label: 'new TreeMap<>', insert: 'new TreeMap<>()', detail: 'new TreeMap<K, V>()', doc: 'Sorted map (Red-Black tree)' },
  { label: 'new LinkedHashMap<>', insert: 'new LinkedHashMap<>()', detail: 'new LinkedHashMap<K, V>()', doc: 'Insertion-ordered Map' },
  { label: 'new StringBuilder', insert: 'new StringBuilder($1)', detail: 'new StringBuilder()', doc: 'Mutable string builder' },
  { label: '.append', insert: '.append($1)', detail: 'StringBuilder.append(String)', doc: 'Append to StringBuilder' },
  // Scanner for I/O
  { label: 'new Scanner', insert: 'new Scanner(System.in)', detail: 'new Scanner(InputStream)', doc: 'Scanner for input' },
  { label: '.nextInt', insert: '.nextInt()', detail: 'Scanner.nextInt(): int', doc: 'Read next integer' },
  { label: '.nextLine', insert: '.nextLine()', detail: 'Scanner.nextLine(): String', doc: 'Read next line' },
  { label: 'System.out.println', insert: 'System.out.println($1)', detail: 'System.out.println(Object)', doc: 'Print with newline' },
];

const cppCompletions = [
  // Algorithms
  { label: 'sort', insert: 'sort(${1:begin}, ${2:end})', detail: 'std::sort(first, last)', doc: 'Sort range in ascending order' },
  { label: 'stable_sort', insert: 'stable_sort(${1:begin}, ${2:end})', detail: 'std::stable_sort(first, last)', doc: 'Stable sort range' },
  { label: 'reverse', insert: 'reverse(${1:begin}, ${2:end})', detail: 'std::reverse(first, last)', doc: 'Reverse range' },
  { label: 'lower_bound', insert: 'lower_bound(${1:begin}, ${2:end}, ${3:value})', detail: 'std::lower_bound(first, last, value)', doc: 'First element >= value' },
  { label: 'upper_bound', insert: 'upper_bound(${1:begin}, ${2:end}, ${3:value})', detail: 'std::upper_bound(first, last, value)', doc: 'First element > value' },
  { label: 'binary_search', insert: 'binary_search(${1:begin}, ${2:end}, ${3:value})', detail: 'std::binary_search(first, last, value)', doc: 'Check if value exists in sorted range' },
  { label: 'min', insert: 'min($1, $2)', detail: 'std::min(a, b)', doc: 'Return smaller of two values' },
  { label: 'max', insert: 'max($1, $2)', detail: 'std::max(a, b)', doc: 'Return larger of two values' },
  { label: 'min_element', insert: 'min_element(${1:begin}, ${2:end})', detail: 'std::min_element(first, last)', doc: 'Iterator to minimum element' },
  { label: 'max_element', insert: 'max_element(${1:begin}, ${2:end})', detail: 'std::max_element(first, last)', doc: 'Iterator to maximum element' },
  { label: 'swap', insert: 'swap($1, $2)', detail: 'std::swap(a, b)', doc: 'Swap two values' },
  { label: 'accumulate', insert: 'accumulate(${1:begin}, ${2:end}, ${3:init})', detail: 'std::accumulate(first, last, init)', doc: 'Sum elements in range' },
  { label: 'count', insert: 'count(${1:begin}, ${2:end}, ${3:value})', detail: 'std::count(first, last, value)', doc: 'Count occurrences' },
  { label: 'find', insert: 'find(${1:begin}, ${2:end}, ${3:value})', detail: 'std::find(first, last, value)', doc: 'Find first occurrence' },
  { label: 'fill', insert: 'fill(${1:begin}, ${2:end}, ${3:value})', detail: 'std::fill(first, last, value)', doc: 'Fill range with value' },
  { label: 'unique', insert: 'unique(${1:begin}, ${2:end})', detail: 'std::unique(first, last)', doc: 'Remove consecutive duplicates' },
  { label: 'next_permutation', insert: 'next_permutation(${1:begin}, ${2:end})', detail: 'std::next_permutation(first, last)', doc: 'Next lexicographic permutation' },
  { label: '__gcd', insert: '__gcd($1, $2)', detail: '__gcd(a, b)', doc: 'Greatest common divisor' },
  { label: 'gcd', insert: 'gcd($1, $2)', detail: 'std::gcd(a, b) [C++17]', doc: 'Greatest common divisor' },
  { label: 'lcm', insert: 'lcm($1, $2)', detail: 'std::lcm(a, b) [C++17]', doc: 'Least common multiple' },
  { label: 'abs', insert: 'abs($1)', detail: 'std::abs(x)', doc: 'Absolute value' },
  // Containers
  { label: 'vector', insert: 'vector<${1:int}> ${2:v}', detail: 'std::vector<T>', doc: 'Dynamic array' },
  { label: 'map', insert: 'map<${1:int}, ${2:int}> ${3:m}', detail: 'std::map<K, V>', doc: 'Ordered key-value store (Red-Black tree)' },
  { label: 'unordered_map', insert: 'unordered_map<${1:int}, ${2:int}> ${3:m}', detail: 'std::unordered_map<K, V>', doc: 'Hash table key-value store' },
  { label: 'set', insert: 'set<${1:int}> ${2:s}', detail: 'std::set<T>', doc: 'Ordered unique elements' },
  { label: 'unordered_set', insert: 'unordered_set<${1:int}> ${2:s}', detail: 'std::unordered_set<T>', doc: 'Hash set of unique elements' },
  { label: 'queue', insert: 'queue<${1:int}> ${2:q}', detail: 'std::queue<T>', doc: 'FIFO queue' },
  { label: 'stack', insert: 'stack<${1:int}> ${2:s}', detail: 'std::stack<T>', doc: 'LIFO stack' },
  { label: 'priority_queue', insert: 'priority_queue<${1:int}> ${2:pq}', detail: 'std::priority_queue<T>', doc: 'Max-heap priority queue' },
  { label: 'deque', insert: 'deque<${1:int}> ${2:d}', detail: 'std::deque<T>', doc: 'Double-ended queue' },
  { label: 'pair', insert: 'pair<${1:int}, ${2:int}>', detail: 'std::pair<T1, T2>', doc: 'Pair of two values' },
  { label: 'make_pair', insert: 'make_pair($1, $2)', detail: 'std::make_pair(a, b)', doc: 'Create a pair' },
  // I/O
  { label: 'cout', insert: 'cout << $1', detail: 'std::cout', doc: 'Standard output stream' },
  { label: 'cin', insert: 'cin >> $1', detail: 'std::cin', doc: 'Standard input stream' },
  { label: 'endl', insert: 'endl', detail: 'std::endl', doc: 'Newline and flush' },
  { label: 'getline', insert: 'getline(cin, $1)', detail: 'std::getline(is, str)', doc: 'Read entire line' },
  // Common snippets
  { label: 'to_string', insert: 'to_string($1)', detail: 'std::to_string(val)', doc: 'Convert number to string' },
  { label: 'stoi', insert: 'stoi($1)', detail: 'std::stoi(str)', doc: 'String to int' },
  { label: 'stol', insert: 'stol($1)', detail: 'std::stol(str)', doc: 'String to long' },
  { label: 'stoll', insert: 'stoll($1)', detail: 'std::stoll(str)', doc: 'String to long long' },
  // Include snippets
  { label: '#include <bits/stdc++.h>', insert: '#include <bits/stdc++.h>', detail: 'Include everything', doc: 'Include all standard headers (competitive programming)' },
  { label: '#include <vector>', insert: '#include <vector>', detail: 'vector header', doc: 'Include vector' },
  { label: '#include <algorithm>', insert: '#include <algorithm>', detail: 'algorithm header', doc: 'Include sort, binary_search, etc.' },
  { label: '#include <map>', insert: '#include <map>', detail: 'map header', doc: 'Include map and multimap' },
  { label: '#include <set>', insert: '#include <set>', detail: 'set header', doc: 'Include set and multiset' },
  { label: '#include <queue>', insert: '#include <queue>', detail: 'queue header', doc: 'Include queue and priority_queue' },
  { label: '#include <stack>', insert: '#include <stack>', detail: 'stack header', doc: 'Include stack' },
  { label: '#include <unordered_map>', insert: '#include <unordered_map>', detail: 'unordered_map header', doc: 'Include unordered_map' },
  { label: '#include <unordered_set>', insert: '#include <unordered_set>', detail: 'unordered_set header', doc: 'Include unordered_set' },
  { label: '#include <numeric>', insert: '#include <numeric>', detail: 'numeric header', doc: 'Include accumulate, gcd, lcm' },
  { label: '#include <cmath>', insert: '#include <cmath>', detail: 'cmath header', doc: 'Include math functions' },
  { label: '#include <string>', insert: '#include <string>', detail: 'string header', doc: 'Include string' },
];

const cCompletions = [
  // Standard I/O
  { label: 'printf', insert: 'printf($1)', detail: 'printf(format, ...)', doc: 'Print formatted output to stdout' },
  { label: 'scanf', insert: 'scanf($1)', detail: 'scanf(format, ...)', doc: 'Read formatted input from stdin' },
  { label: 'sprintf', insert: 'sprintf($1, $2)', detail: 'sprintf(str, format, ...)', doc: 'Print formatted to string' },
  { label: 'sscanf', insert: 'sscanf($1, $2)', detail: 'sscanf(str, format, ...)', doc: 'Read formatted from string' },
  { label: 'puts', insert: 'puts($1)', detail: 'puts(str)', doc: 'Print string with newline' },
  { label: 'gets', insert: 'gets($1)', detail: 'gets(str)', doc: 'Read line from stdin (deprecated)' },
  { label: 'getchar', insert: 'getchar()', detail: 'getchar()', doc: 'Read single character from stdin' },
  { label: 'putchar', insert: 'putchar($1)', detail: 'putchar(c)', doc: 'Write single character to stdout' },
  // Memory
  { label: 'malloc', insert: 'malloc($1)', detail: 'malloc(size)', doc: 'Allocate memory' },
  { label: 'calloc', insert: 'calloc($1, $2)', detail: 'calloc(num, size)', doc: 'Allocate and zero memory' },
  { label: 'realloc', insert: 'realloc($1, $2)', detail: 'realloc(ptr, size)', doc: 'Reallocate memory' },
  { label: 'free', insert: 'free($1)', detail: 'free(ptr)', doc: 'Free allocated memory' },
  { label: 'memset', insert: 'memset($1, $2, $3)', detail: 'memset(ptr, value, size)', doc: 'Fill memory with value' },
  { label: 'memcpy', insert: 'memcpy($1, $2, $3)', detail: 'memcpy(dest, src, size)', doc: 'Copy memory block' },
  { label: 'memmove', insert: 'memmove($1, $2, $3)', detail: 'memmove(dest, src, size)', doc: 'Move memory block (overlap safe)' },
  { label: 'memcmp', insert: 'memcmp($1, $2, $3)', detail: 'memcmp(ptr1, ptr2, size)', doc: 'Compare memory blocks' },
  // Strings
  { label: 'strlen', insert: 'strlen($1)', detail: 'strlen(str)', doc: 'String length' },
  { label: 'strcpy', insert: 'strcpy($1, $2)', detail: 'strcpy(dest, src)', doc: 'Copy string' },
  { label: 'strncpy', insert: 'strncpy($1, $2, $3)', detail: 'strncpy(dest, src, n)', doc: 'Copy n characters' },
  { label: 'strcat', insert: 'strcat($1, $2)', detail: 'strcat(dest, src)', doc: 'Concatenate strings' },
  { label: 'strncat', insert: 'strncat($1, $2, $3)', detail: 'strncat(dest, src, n)', doc: 'Concatenate n characters' },
  { label: 'strcmp', insert: 'strcmp($1, $2)', detail: 'strcmp(str1, str2)', doc: 'Compare strings' },
  { label: 'strncmp', insert: 'strncmp($1, $2, $3)', detail: 'strncmp(str1, str2, n)', doc: 'Compare n characters' },
  { label: 'strchr', insert: 'strchr($1, $2)', detail: 'strchr(str, c)', doc: 'Find first occurrence of char' },
  { label: 'strrchr', insert: 'strrchr($1, $2)', detail: 'strrchr(str, c)', doc: 'Find last occurrence of char' },
  { label: 'strstr', insert: 'strstr($1, $2)', detail: 'strstr(str, substr)', doc: 'Find substring' },
  { label: 'strtok', insert: 'strtok($1, $2)', detail: 'strtok(str, delim)', doc: 'Tokenize string' },
  // Conversion
  { label: 'atoi', insert: 'atoi($1)', detail: 'atoi(str)', doc: 'String to int' },
  { label: 'atol', insert: 'atol($1)', detail: 'atol(str)', doc: 'String to long' },
  { label: 'atof', insert: 'atof($1)', detail: 'atof(str)', doc: 'String to double' },
  { label: 'strtol', insert: 'strtol($1, $2, $3)', detail: 'strtol(str, endptr, base)', doc: 'String to long with base' },
  { label: 'strtod', insert: 'strtod($1, $2)', detail: 'strtod(str, endptr)', doc: 'String to double' },
  // Math
  { label: 'abs', insert: 'abs($1)', detail: 'abs(x)', doc: 'Absolute value (int)' },
  { label: 'fabs', insert: 'fabs($1)', detail: 'fabs(x)', doc: 'Absolute value (double)' },
  { label: 'sqrt', insert: 'sqrt($1)', detail: 'sqrt(x)', doc: 'Square root' },
  { label: 'pow', insert: 'pow($1, $2)', detail: 'pow(base, exp)', doc: 'Power function' },
  { label: 'ceil', insert: 'ceil($1)', detail: 'ceil(x)', doc: 'Round up' },
  { label: 'floor', insert: 'floor($1)', detail: 'floor(x)', doc: 'Round down' },
  { label: 'round', insert: 'round($1)', detail: 'round(x)', doc: 'Round to nearest' },
  { label: 'log', insert: 'log($1)', detail: 'log(x)', doc: 'Natural logarithm' },
  { label: 'log10', insert: 'log10($1)', detail: 'log10(x)', doc: 'Base-10 logarithm' },
  { label: 'exp', insert: 'exp($1)', detail: 'exp(x)', doc: 'Exponential (e^x)' },
  { label: 'sin', insert: 'sin($1)', detail: 'sin(x)', doc: 'Sine' },
  { label: 'cos', insert: 'cos($1)', detail: 'cos(x)', doc: 'Cosine' },
  { label: 'tan', insert: 'tan($1)', detail: 'tan(x)', doc: 'Tangent' },
  // Sorting/Searching
  { label: 'qsort', insert: 'qsort($1, $2, $3, $4)', detail: 'qsort(base, num, size, compar)', doc: 'Quick sort array' },
  { label: 'bsearch', insert: 'bsearch($1, $2, $3, $4, $5)', detail: 'bsearch(key, base, num, size, compar)', doc: 'Binary search' },
  // Random
  { label: 'rand', insert: 'rand()', detail: 'rand()', doc: 'Generate random number' },
  { label: 'srand', insert: 'srand($1)', detail: 'srand(seed)', doc: 'Seed random generator' },
  // Character
  { label: 'isalpha', insert: 'isalpha($1)', detail: 'isalpha(c)', doc: 'Check if alphabetic' },
  { label: 'isdigit', insert: 'isdigit($1)', detail: 'isdigit(c)', doc: 'Check if digit' },
  { label: 'isalnum', insert: 'isalnum($1)', detail: 'isalnum(c)', doc: 'Check if alphanumeric' },
  { label: 'isspace', insert: 'isspace($1)', detail: 'isspace(c)', doc: 'Check if whitespace' },
  { label: 'isupper', insert: 'isupper($1)', detail: 'isupper(c)', doc: 'Check if uppercase' },
  { label: 'islower', insert: 'islower($1)', detail: 'islower(c)', doc: 'Check if lowercase' },
  { label: 'toupper', insert: 'toupper($1)', detail: 'toupper(c)', doc: 'Convert to uppercase' },
  { label: 'tolower', insert: 'tolower($1)', detail: 'tolower(c)', doc: 'Convert to lowercase' },
  // Include headers
  { label: '#include <stdio.h>', insert: '#include <stdio.h>', detail: 'Standard I/O', doc: 'Include printf, scanf, etc.' },
  { label: '#include <stdlib.h>', insert: '#include <stdlib.h>', detail: 'Standard library', doc: 'Include malloc, qsort, atoi, etc.' },
  { label: '#include <string.h>', insert: '#include <string.h>', detail: 'String functions', doc: 'Include strlen, strcpy, memset, etc.' },
  { label: '#include <math.h>', insert: '#include <math.h>', detail: 'Math functions', doc: 'Include sqrt, pow, sin, etc.' },
  { label: '#include <stdbool.h>', insert: '#include <stdbool.h>', detail: 'Boolean type', doc: 'Include bool, true, false' },
  { label: '#include <ctype.h>', insert: '#include <ctype.h>', detail: 'Character handling', doc: 'Include isalpha, isdigit, etc.' },
  { label: '#include <limits.h>', insert: '#include <limits.h>', detail: 'Limits', doc: 'Include INT_MAX, INT_MIN, etc.' },
  // Constants
  { label: 'NULL', insert: 'NULL', detail: 'NULL', doc: 'Null pointer constant' },
  { label: 'INT_MAX', insert: 'INT_MAX', detail: 'INT_MAX', doc: 'Maximum int value' },
  { label: 'INT_MIN', insert: 'INT_MIN', detail: 'INT_MIN', doc: 'Minimum int value' },
  { label: 'sizeof', insert: 'sizeof($1)', detail: 'sizeof(type)', doc: 'Size of type in bytes' },
];

const goCompletions = [
  // fmt
  { label: 'fmt.Println', insert: 'fmt.Println($1)', detail: 'fmt.Println(a ...any)', doc: 'Print line to stdout' },
  { label: 'fmt.Printf', insert: 'fmt.Printf($1)', detail: 'fmt.Printf(format string, a ...any)', doc: 'Print formatted string' },
  { label: 'fmt.Sprintf', insert: 'fmt.Sprintf($1)', detail: 'fmt.Sprintf(format string, a ...any) string', doc: 'Return formatted string' },
  { label: 'fmt.Scanf', insert: 'fmt.Scanf($1)', detail: 'fmt.Scanf(format string, a ...any)', doc: 'Scan formatted input' },
  { label: 'fmt.Sscanf', insert: 'fmt.Sscanf($1, $2)', detail: 'fmt.Sscanf(str, format string, a ...any)', doc: 'Scan formatted string' },
  // sort
  { label: 'sort.Ints', insert: 'sort.Ints($1)', detail: 'sort.Ints(a []int)', doc: 'Sort int slice ascending' },
  { label: 'sort.Strings', insert: 'sort.Strings($1)', detail: 'sort.Strings(a []string)', doc: 'Sort string slice ascending' },
  { label: 'sort.Slice', insert: 'sort.Slice($1, func(i, j int) bool {\n\treturn $2\n})', detail: 'sort.Slice(x, less func(i, j int) bool)', doc: 'Sort slice with custom less function' },
  { label: 'sort.Search', insert: 'sort.Search($1, func(i int) bool {\n\treturn $2\n})', detail: 'sort.Search(n int, f func(int) bool) int', doc: 'Binary search' },
  { label: 'sort.SliceIsSorted', insert: 'sort.SliceIsSorted($1, func(i, j int) bool {\n\treturn $2\n})', detail: 'sort.SliceIsSorted(...) bool', doc: 'Check if slice is sorted' },
  // strings
  { label: 'strings.Contains', insert: 'strings.Contains($1, $2)', detail: 'strings.Contains(s, substr string) bool', doc: 'Check if string contains substring' },
  { label: 'strings.Split', insert: 'strings.Split($1, $2)', detail: 'strings.Split(s, sep string) []string', doc: 'Split string by separator' },
  { label: 'strings.Join', insert: 'strings.Join($1, $2)', detail: 'strings.Join(elems []string, sep string) string', doc: 'Join strings with separator' },
  { label: 'strings.Replace', insert: 'strings.Replace($1, $2, $3, $4)', detail: 'strings.Replace(s, old, new string, n int)', doc: 'Replace occurrences' },
  { label: 'strings.ToLower', insert: 'strings.ToLower($1)', detail: 'strings.ToLower(s string) string', doc: 'Convert to lowercase' },
  { label: 'strings.ToUpper', insert: 'strings.ToUpper($1)', detail: 'strings.ToUpper(s string) string', doc: 'Convert to uppercase' },
  { label: 'strings.TrimSpace', insert: 'strings.TrimSpace($1)', detail: 'strings.TrimSpace(s string) string', doc: 'Remove leading/trailing whitespace' },
  { label: 'strings.HasPrefix', insert: 'strings.HasPrefix($1, $2)', detail: 'strings.HasPrefix(s, prefix string) bool', doc: 'Check prefix' },
  { label: 'strings.HasSuffix', insert: 'strings.HasSuffix($1, $2)', detail: 'strings.HasSuffix(s, suffix string) bool', doc: 'Check suffix' },
  { label: 'strings.Index', insert: 'strings.Index($1, $2)', detail: 'strings.Index(s, substr string) int', doc: 'Index of first occurrence' },
  { label: 'strings.Count', insert: 'strings.Count($1, $2)', detail: 'strings.Count(s, substr string) int', doc: 'Count non-overlapping occurrences' },
  { label: 'strings.Repeat', insert: 'strings.Repeat($1, $2)', detail: 'strings.Repeat(s string, count int) string', doc: 'Repeat string' },
  // strconv
  { label: 'strconv.Itoa', insert: 'strconv.Itoa($1)', detail: 'strconv.Itoa(i int) string', doc: 'Int to string' },
  { label: 'strconv.Atoi', insert: 'strconv.Atoi($1)', detail: 'strconv.Atoi(s string) (int, error)', doc: 'String to int' },
  { label: 'strconv.FormatInt', insert: 'strconv.FormatInt($1, $2)', detail: 'strconv.FormatInt(i int64, base int) string', doc: 'Format int64 in given base' },
  { label: 'strconv.ParseInt', insert: 'strconv.ParseInt($1, $2, $3)', detail: 'strconv.ParseInt(s string, base, bitSize int)', doc: 'Parse string as int' },
  // math
  { label: 'math.Abs', insert: 'math.Abs($1)', detail: 'math.Abs(x float64) float64', doc: 'Absolute value' },
  { label: 'math.Max', insert: 'math.Max($1, $2)', detail: 'math.Max(x, y float64) float64', doc: 'Larger of two values' },
  { label: 'math.Min', insert: 'math.Min($1, $2)', detail: 'math.Min(x, y float64) float64', doc: 'Smaller of two values' },
  { label: 'math.Sqrt', insert: 'math.Sqrt($1)', detail: 'math.Sqrt(x float64) float64', doc: 'Square root' },
  { label: 'math.Pow', insert: 'math.Pow($1, $2)', detail: 'math.Pow(x, y float64) float64', doc: 'x raised to power y' },
  { label: 'math.Ceil', insert: 'math.Ceil($1)', detail: 'math.Ceil(x float64) float64', doc: 'Round up' },
  { label: 'math.Floor', insert: 'math.Floor($1)', detail: 'math.Floor(x float64) float64', doc: 'Round down' },
  { label: 'math.Log', insert: 'math.Log($1)', detail: 'math.Log(x float64) float64', doc: 'Natural logarithm' },
  { label: 'math.Log2', insert: 'math.Log2($1)', detail: 'math.Log2(x float64) float64', doc: 'Base-2 logarithm' },
  { label: 'math.MaxInt', insert: 'math.MaxInt', detail: 'math.MaxInt', doc: 'Max int value' },
  { label: 'math.MinInt', insert: 'math.MinInt', detail: 'math.MinInt', doc: 'Min int value' },
  { label: 'math.Inf', insert: 'math.Inf($1)', detail: 'math.Inf(sign int) float64', doc: 'Positive or negative infinity' },
  // Built-in functions
  { label: 'make', insert: 'make($1)', detail: 'make(t Type, size ...int)', doc: 'Allocate and initialize slice, map, or channel' },
  { label: 'append', insert: 'append($1, $2)', detail: 'append(slice []T, elems ...T) []T', doc: 'Append elements to slice' },
  { label: 'len', insert: 'len($1)', detail: 'len(v Type) int', doc: 'Return length' },
  { label: 'cap', insert: 'cap($1)', detail: 'cap(v Type) int', doc: 'Return capacity' },
  { label: 'copy', insert: 'copy($1, $2)', detail: 'copy(dst, src []T) int', doc: 'Copy elements between slices' },
  { label: 'delete', insert: 'delete($1, $2)', detail: 'delete(m map[K]V, key K)', doc: 'Delete map entry' },
  { label: 'panic', insert: 'panic($1)', detail: 'panic(v any)', doc: 'Stop execution with error' },
  { label: 'recover', insert: 'recover()', detail: 'recover() any', doc: 'Regain control after panic' },
];

const rustCompletions = [
  // Vec
  { label: 'Vec::new', insert: 'Vec::new()', detail: 'Vec::new() -> Vec<T>', doc: 'Create empty vector' },
  { label: 'vec!', insert: 'vec![$1]', detail: 'vec![elems...]', doc: 'Create vector with elements' },
  { label: '.push', insert: '.push($1)', detail: '.push(value: T)', doc: 'Append element to vector' },
  { label: '.pop', insert: '.pop()', detail: '.pop() -> Option<T>', doc: 'Remove and return last element' },
  { label: '.len', insert: '.len()', detail: '.len() -> usize', doc: 'Return number of elements' },
  { label: '.is_empty', insert: '.is_empty()', detail: '.is_empty() -> bool', doc: 'Check if empty' },
  { label: '.iter', insert: '.iter()', detail: '.iter() -> Iter<T>', doc: 'Return immutable iterator' },
  { label: '.iter_mut', insert: '.iter_mut()', detail: '.iter_mut() -> IterMut<T>', doc: 'Return mutable iterator' },
  { label: '.into_iter', insert: '.into_iter()', detail: '.into_iter() -> IntoIter<T>', doc: 'Return consuming iterator' },
  { label: '.sort', insert: '.sort()', detail: '.sort()', doc: 'Sort in ascending order' },
  { label: '.sort_by', insert: '.sort_by(|a, b| $1)', detail: '.sort_by(compare: F)', doc: 'Sort with custom comparator' },
  { label: '.sort_unstable', insert: '.sort_unstable()', detail: '.sort_unstable()', doc: 'Sort (unstable, faster)' },
  { label: '.binary_search', insert: '.binary_search(&$1)', detail: '.binary_search(x: &T) -> Result<usize, usize>', doc: 'Binary search sorted slice' },
  { label: '.contains', insert: '.contains(&$1)', detail: '.contains(x: &T) -> bool', doc: 'Check if slice contains value' },
  { label: '.reverse', insert: '.reverse()', detail: '.reverse()', doc: 'Reverse in place' },
  { label: '.windows', insert: '.windows($1)', detail: '.windows(size: usize)', doc: 'Return sliding windows iterator' },
  { label: '.chunks', insert: '.chunks($1)', detail: '.chunks(size: usize)', doc: 'Return chunk iterator' },
  { label: '.split', insert: '.split(|x| $1)', detail: '.split(pred: F)', doc: 'Split by predicate' },
  // Iterator methods
  { label: '.map', insert: '.map(|$1| $2)', detail: '.map(f: F) -> Map<Self, F>', doc: 'Transform each element' },
  { label: '.filter', insert: '.filter(|$1| $2)', detail: '.filter(pred: P) -> Filter<Self, P>', doc: 'Filter elements by predicate' },
  { label: '.fold', insert: '.fold($1, |acc, $2| $3)', detail: '.fold(init: B, f: F) -> B', doc: 'Fold/reduce iterator' },
  { label: '.collect', insert: '.collect::<$1>()', detail: '.collect::<B>() -> B', doc: 'Collect iterator into collection' },
  { label: '.enumerate', insert: '.enumerate()', detail: '.enumerate() -> Enumerate<Self>', doc: 'Add index to each element' },
  { label: '.zip', insert: '.zip($1)', detail: '.zip(other: U) -> Zip<Self, U>', doc: 'Zip two iterators together' },
  { label: '.sum', insert: '.sum::<$1>()', detail: '.sum::<S>() -> S', doc: 'Sum all elements' },
  { label: '.product', insert: '.product::<$1>()', detail: '.product::<P>() -> P', doc: 'Product of all elements' },
  { label: '.min', insert: '.min()', detail: '.min() -> Option<Self::Item>', doc: 'Find minimum element' },
  { label: '.max', insert: '.max()', detail: '.max() -> Option<Self::Item>', doc: 'Find maximum element' },
  { label: '.count', insert: '.count()', detail: '.count() -> usize', doc: 'Count elements' },
  { label: '.any', insert: '.any(|$1| $2)', detail: '.any(f: F) -> bool', doc: 'Check if any element matches' },
  { label: '.all', insert: '.all(|$1| $2)', detail: '.all(f: F) -> bool', doc: 'Check if all elements match' },
  { label: '.find', insert: '.find(|$1| $2)', detail: '.find(pred: P) -> Option<Self::Item>', doc: 'Find first matching element' },
  { label: '.position', insert: '.position(|$1| $2)', detail: '.position(pred: P) -> Option<usize>', doc: 'Find index of first match' },
  { label: '.take', insert: '.take($1)', detail: '.take(n: usize) -> Take<Self>', doc: 'Take first n elements' },
  { label: '.skip', insert: '.skip($1)', detail: '.skip(n: usize) -> Skip<Self>', doc: 'Skip first n elements' },
  { label: '.flatten', insert: '.flatten()', detail: '.flatten() -> Flatten<Self>', doc: 'Flatten nested iterators' },
  { label: '.flat_map', insert: '.flat_map(|$1| $2)', detail: '.flat_map(f: F) -> FlatMap<Self, U, F>', doc: 'Map then flatten' },
  { label: '.chain', insert: '.chain($1)', detail: '.chain(other: U) -> Chain<Self, U>', doc: 'Chain two iterators' },
  { label: '.cloned', insert: '.cloned()', detail: '.cloned() -> Cloned<Self>', doc: 'Clone each element' },
  { label: '.peekable', insert: '.peekable()', detail: '.peekable() -> Peekable<Self>', doc: 'Create peekable iterator' },
  // HashMap / HashSet
  { label: 'HashMap::new', insert: 'HashMap::new()', detail: 'HashMap::new() -> HashMap<K, V>', doc: 'Create empty HashMap' },
  { label: 'HashSet::new', insert: 'HashSet::new()', detail: 'HashSet::new() -> HashSet<T>', doc: 'Create empty HashSet' },
  { label: 'BTreeMap::new', insert: 'BTreeMap::new()', detail: 'BTreeMap::new() -> BTreeMap<K, V>', doc: 'Create empty sorted map' },
  { label: 'BTreeSet::new', insert: 'BTreeSet::new()', detail: 'BTreeSet::new() -> BTreeSet<T>', doc: 'Create empty sorted set' },
  { label: '.insert', insert: '.insert($1)', detail: '.insert(key, value)', doc: 'Insert key-value pair' },
  { label: '.get', insert: '.get(&$1)', detail: '.get(key: &K) -> Option<&V>', doc: 'Get value by key' },
  { label: '.entry', insert: '.entry($1).or_insert($2)', detail: '.entry(key).or_insert(default)', doc: 'Entry API for insert-or-update' },
  { label: '.remove', insert: '.remove(&$1)', detail: '.remove(key: &K) -> Option<V>', doc: 'Remove by key' },
  { label: '.contains_key', insert: '.contains_key(&$1)', detail: '.contains_key(key: &K) -> bool', doc: 'Check if key exists' },
  // String
  { label: 'String::new', insert: 'String::new()', detail: 'String::new() -> String', doc: 'Create empty String' },
  { label: 'String::from', insert: 'String::from($1)', detail: 'String::from(s: &str) -> String', doc: 'Create String from &str' },
  { label: '.to_string', insert: '.to_string()', detail: '.to_string() -> String', doc: 'Convert to String' },
  { label: '.as_str', insert: '.as_str()', detail: '.as_str() -> &str', doc: 'Convert String to &str' },
  { label: '.parse', insert: '.parse::<$1>()', detail: '.parse::<T>() -> Result<T, E>', doc: 'Parse string to type' },
  { label: '.chars', insert: '.chars()', detail: '.chars() -> Chars', doc: 'Iterate over characters' },
  { label: '.bytes', insert: '.bytes()', detail: '.bytes() -> Bytes', doc: 'Iterate over bytes' },
  { label: '.trim', insert: '.trim()', detail: '.trim() -> &str', doc: 'Remove leading/trailing whitespace' },
  { label: '.split_whitespace', insert: '.split_whitespace()', detail: '.split_whitespace() -> SplitWhitespace', doc: 'Split by whitespace' },
  // Cmp
  { label: 'std::cmp::min', insert: 'std::cmp::min($1, $2)', detail: 'std::cmp::min(a, b) -> T', doc: 'Return smaller value' },
  { label: 'std::cmp::max', insert: 'std::cmp::max($1, $2)', detail: 'std::cmp::max(a, b) -> T', doc: 'Return larger value' },
  { label: 'std::cmp::Reverse', insert: 'std::cmp::Reverse($1)', detail: 'std::cmp::Reverse(T)', doc: 'Reverse ordering wrapper' },
  // Macros
  { label: 'println!', insert: 'println!("$1", $2)', detail: 'println!(fmt, ...)', doc: 'Print with newline' },
  { label: 'format!', insert: 'format!("$1", $2)', detail: 'format!(fmt, ...) -> String', doc: 'Create formatted String' },
  { label: 'eprintln!', insert: 'eprintln!("$1", $2)', detail: 'eprintln!(fmt, ...)', doc: 'Print to stderr' },
];

const csharpCompletions = [
  // Math
  { label: 'Math.Abs', insert: 'Math.Abs($1)', detail: 'Math.Abs(value): number', doc: 'Return absolute value' },
  { label: 'Math.Max', insert: 'Math.Max($1, $2)', detail: 'Math.Max(a, b)', doc: 'Return larger value' },
  { label: 'Math.Min', insert: 'Math.Min($1, $2)', detail: 'Math.Min(a, b)', doc: 'Return smaller value' },
  { label: 'Math.Pow', insert: 'Math.Pow($1, $2)', detail: 'Math.Pow(x, y): double', doc: 'Return x raised to power y' },
  { label: 'Math.Sqrt', insert: 'Math.Sqrt($1)', detail: 'Math.Sqrt(d): double', doc: 'Return square root' },
  { label: 'Math.Ceiling', insert: 'Math.Ceiling($1)', detail: 'Math.Ceiling(d): double', doc: 'Round up' },
  { label: 'Math.Floor', insert: 'Math.Floor($1)', detail: 'Math.Floor(d): double', doc: 'Round down' },
  { label: 'Math.Round', insert: 'Math.Round($1)', detail: 'Math.Round(d): double', doc: 'Round to nearest' },
  { label: 'Math.Log', insert: 'Math.Log($1)', detail: 'Math.Log(d): double', doc: 'Natural logarithm' },
  { label: 'Math.Log2', insert: 'Math.Log2($1)', detail: 'Math.Log2(d): double', doc: 'Base-2 logarithm' },
  // Array
  { label: 'Array.Sort', insert: 'Array.Sort($1)', detail: 'Array.Sort(array)', doc: 'Sort array in place' },
  { label: 'Array.Reverse', insert: 'Array.Reverse($1)', detail: 'Array.Reverse(array)', doc: 'Reverse array in place' },
  { label: 'Array.BinarySearch', insert: 'Array.BinarySearch($1, $2)', detail: 'Array.BinarySearch(array, value)', doc: 'Binary search sorted array' },
  { label: 'Array.IndexOf', insert: 'Array.IndexOf($1, $2)', detail: 'Array.IndexOf(array, value): int', doc: 'Find index of value' },
  { label: 'Array.Fill', insert: 'Array.Fill($1, $2)', detail: 'Array.Fill(array, value)', doc: 'Fill array with value' },
  { label: 'Array.Copy', insert: 'Array.Copy($1, $2, $3)', detail: 'Array.Copy(src, dst, length)', doc: 'Copy elements between arrays' },
  // Collections
  { label: 'new List<>', insert: 'new List<$1>()', detail: 'new List<T>()', doc: 'Create dynamic list' },
  { label: 'new Dictionary<>', insert: 'new Dictionary<$1, $2>()', detail: 'new Dictionary<K, V>()', doc: 'Create hash map' },
  { label: 'new HashSet<>', insert: 'new HashSet<$1>()', detail: 'new HashSet<T>()', doc: 'Create hash set' },
  { label: 'new Queue<>', insert: 'new Queue<$1>()', detail: 'new Queue<T>()', doc: 'Create FIFO queue' },
  { label: 'new Stack<>', insert: 'new Stack<$1>()', detail: 'new Stack<T>()', doc: 'Create LIFO stack' },
  { label: 'new SortedSet<>', insert: 'new SortedSet<$1>()', detail: 'new SortedSet<T>()', doc: 'Create sorted set' },
  { label: 'new SortedDictionary<>', insert: 'new SortedDictionary<$1, $2>()', detail: 'new SortedDictionary<K, V>()', doc: 'Create sorted dictionary' },
  { label: 'new PriorityQueue<>', insert: 'new PriorityQueue<$1, $2>()', detail: 'new PriorityQueue<T, TPriority>()', doc: 'Create priority queue' },
  { label: 'new StringBuilder', insert: 'new StringBuilder($1)', detail: 'new StringBuilder()', doc: 'Mutable string builder' },
  // LINQ
  { label: '.Select', insert: '.Select($1)', detail: '.Select(selector): IEnumerable', doc: 'Project each element (map)' },
  { label: '.Where', insert: '.Where($1)', detail: '.Where(predicate): IEnumerable', doc: 'Filter elements' },
  { label: '.OrderBy', insert: '.OrderBy($1)', detail: '.OrderBy(keySelector): IOrderedEnumerable', doc: 'Sort ascending' },
  { label: '.OrderByDescending', insert: '.OrderByDescending($1)', detail: '.OrderByDescending(keySelector)', doc: 'Sort descending' },
  { label: '.GroupBy', insert: '.GroupBy($1)', detail: '.GroupBy(keySelector): IEnumerable<IGrouping>', doc: 'Group by key' },
  { label: '.Aggregate', insert: '.Aggregate($1)', detail: '.Aggregate(func): T', doc: 'Accumulate (reduce)' },
  { label: '.Any', insert: '.Any($1)', detail: '.Any(predicate?): bool', doc: 'Check if any match' },
  { label: '.All', insert: '.All($1)', detail: '.All(predicate): bool', doc: 'Check if all match' },
  { label: '.Count', insert: '.Count()', detail: '.Count(): int', doc: 'Count elements' },
  { label: '.Sum', insert: '.Sum()', detail: '.Sum(): number', doc: 'Sum elements' },
  { label: '.Min', insert: '.Min()', detail: '.Min(): T', doc: 'Find minimum' },
  { label: '.Max', insert: '.Max()', detail: '.Max(): T', doc: 'Find maximum' },
  { label: '.First', insert: '.First()', detail: '.First(): T', doc: 'First element' },
  { label: '.FirstOrDefault', insert: '.FirstOrDefault()', detail: '.FirstOrDefault(): T', doc: 'First or default value' },
  { label: '.Last', insert: '.Last()', detail: '.Last(): T', doc: 'Last element' },
  { label: '.ToList', insert: '.ToList()', detail: '.ToList(): List<T>', doc: 'Convert to List' },
  { label: '.ToArray', insert: '.ToArray()', detail: '.ToArray(): T[]', doc: 'Convert to array' },
  { label: '.ToDictionary', insert: '.ToDictionary($1)', detail: '.ToDictionary(keySelector)', doc: 'Convert to Dictionary' },
  { label: '.ToHashSet', insert: '.ToHashSet()', detail: '.ToHashSet(): HashSet<T>', doc: 'Convert to HashSet' },
  { label: '.Distinct', insert: '.Distinct()', detail: '.Distinct(): IEnumerable', doc: 'Remove duplicates' },
  { label: '.Take', insert: '.Take($1)', detail: '.Take(count): IEnumerable', doc: 'Take first N elements' },
  { label: '.Skip', insert: '.Skip($1)', detail: '.Skip(count): IEnumerable', doc: 'Skip first N elements' },
  { label: '.Zip', insert: '.Zip($1)', detail: '.Zip(second): IEnumerable', doc: 'Zip two sequences' },
  { label: '.Contains', insert: '.Contains($1)', detail: '.Contains(value): bool', doc: 'Check if contains value' },
  { label: '.Reverse', insert: '.Reverse()', detail: '.Reverse(): IEnumerable', doc: 'Reverse sequence' },
  // Console
  { label: 'Console.WriteLine', insert: 'Console.WriteLine($1)', detail: 'Console.WriteLine(value)', doc: 'Print with newline' },
  { label: 'Console.ReadLine', insert: 'Console.ReadLine()', detail: 'Console.ReadLine(): string', doc: 'Read line from stdin' },
  { label: 'int.Parse', insert: 'int.Parse($1)', detail: 'int.Parse(s): int', doc: 'Parse string to int' },
  { label: 'int.TryParse', insert: 'int.TryParse($1, out $2)', detail: 'int.TryParse(s, out result): bool', doc: 'Try parse string to int' },
  { label: 'int.MaxValue', insert: 'int.MaxValue', detail: 'int.MaxValue', doc: '2^31 - 1' },
  { label: 'int.MinValue', insert: 'int.MinValue', detail: 'int.MinValue', doc: '-2^31' },
];

const sqlCompletions = [
  // Keywords
  { label: 'SELECT', insert: 'SELECT $1 FROM $2', detail: 'SELECT columns FROM table', doc: 'Query data from table', kind: 'Keyword' },
  { label: 'INSERT INTO', insert: 'INSERT INTO $1 ($2) VALUES ($3)', detail: 'INSERT INTO table (cols) VALUES (vals)', doc: 'Insert new rows', kind: 'Keyword' },
  { label: 'UPDATE', insert: 'UPDATE $1 SET $2 WHERE $3', detail: 'UPDATE table SET col = val WHERE ...', doc: 'Update existing rows', kind: 'Keyword' },
  { label: 'DELETE FROM', insert: 'DELETE FROM $1 WHERE $2', detail: 'DELETE FROM table WHERE ...', doc: 'Delete rows', kind: 'Keyword' },
  { label: 'WHERE', insert: 'WHERE $1', detail: 'WHERE condition', doc: 'Filter rows', kind: 'Keyword' },
  { label: 'JOIN', insert: 'JOIN $1 ON $2', detail: 'JOIN table ON condition', doc: 'Inner join tables', kind: 'Keyword' },
  { label: 'LEFT JOIN', insert: 'LEFT JOIN $1 ON $2', detail: 'LEFT JOIN table ON condition', doc: 'Left outer join', kind: 'Keyword' },
  { label: 'RIGHT JOIN', insert: 'RIGHT JOIN $1 ON $2', detail: 'RIGHT JOIN table ON condition', doc: 'Right outer join', kind: 'Keyword' },
  { label: 'FULL OUTER JOIN', insert: 'FULL OUTER JOIN $1 ON $2', detail: 'FULL OUTER JOIN table ON condition', doc: 'Full outer join', kind: 'Keyword' },
  { label: 'CROSS JOIN', insert: 'CROSS JOIN $1', detail: 'CROSS JOIN table', doc: 'Cartesian product', kind: 'Keyword' },
  { label: 'GROUP BY', insert: 'GROUP BY $1', detail: 'GROUP BY column', doc: 'Group rows by column', kind: 'Keyword' },
  { label: 'HAVING', insert: 'HAVING $1', detail: 'HAVING condition', doc: 'Filter groups', kind: 'Keyword' },
  { label: 'ORDER BY', insert: 'ORDER BY $1', detail: 'ORDER BY column [ASC|DESC]', doc: 'Sort result set', kind: 'Keyword' },
  { label: 'LIMIT', insert: 'LIMIT $1', detail: 'LIMIT count', doc: 'Limit number of rows', kind: 'Keyword' },
  { label: 'OFFSET', insert: 'OFFSET $1', detail: 'OFFSET count', doc: 'Skip rows', kind: 'Keyword' },
  { label: 'DISTINCT', insert: 'DISTINCT $1', detail: 'DISTINCT column', doc: 'Remove duplicates', kind: 'Keyword' },
  { label: 'UNION', insert: 'UNION\nSELECT $1', detail: 'UNION SELECT ...', doc: 'Combine result sets (no duplicates)', kind: 'Keyword' },
  { label: 'UNION ALL', insert: 'UNION ALL\nSELECT $1', detail: 'UNION ALL SELECT ...', doc: 'Combine result sets (with duplicates)', kind: 'Keyword' },
  { label: 'CASE', insert: 'CASE\n\tWHEN $1 THEN $2\n\tELSE $3\nEND', detail: 'CASE WHEN ... THEN ... END', doc: 'Conditional expression', kind: 'Keyword' },
  { label: 'EXISTS', insert: 'EXISTS ($1)', detail: 'EXISTS (subquery)', doc: 'Check subquery returns rows', kind: 'Keyword' },
  { label: 'IN', insert: 'IN ($1)', detail: 'IN (values)', doc: 'Match any value in list', kind: 'Keyword' },
  { label: 'BETWEEN', insert: 'BETWEEN $1 AND $2', detail: 'BETWEEN low AND high', doc: 'Range check', kind: 'Keyword' },
  { label: 'LIKE', insert: "LIKE '$1'", detail: "LIKE pattern", doc: 'Pattern matching with % and _', kind: 'Keyword' },
  { label: 'IS NULL', insert: 'IS NULL', detail: 'IS NULL', doc: 'Check for NULL', kind: 'Keyword' },
  { label: 'IS NOT NULL', insert: 'IS NOT NULL', detail: 'IS NOT NULL', doc: 'Check for not NULL', kind: 'Keyword' },
  { label: 'COALESCE', insert: 'COALESCE($1, $2)', detail: 'COALESCE(val1, val2, ...)', doc: 'Return first non-NULL value', kind: 'Keyword' },
  { label: 'CAST', insert: 'CAST($1 AS $2)', detail: 'CAST(expr AS type)', doc: 'Convert data type', kind: 'Keyword' },
  { label: 'WITH', insert: 'WITH $1 AS (\n\t$2\n)\nSELECT $3', detail: 'WITH cte AS (...) SELECT ...', doc: 'Common Table Expression (CTE)', kind: 'Keyword' },
  // Aggregate functions
  { label: 'COUNT', insert: 'COUNT($1)', detail: 'COUNT(column|*)', doc: 'Count rows' },
  { label: 'SUM', insert: 'SUM($1)', detail: 'SUM(column)', doc: 'Sum of values' },
  { label: 'AVG', insert: 'AVG($1)', detail: 'AVG(column)', doc: 'Average of values' },
  { label: 'MIN', insert: 'MIN($1)', detail: 'MIN(column)', doc: 'Minimum value' },
  { label: 'MAX', insert: 'MAX($1)', detail: 'MAX(column)', doc: 'Maximum value' },
  { label: 'GROUP_CONCAT', insert: 'GROUP_CONCAT($1)', detail: 'GROUP_CONCAT(column)', doc: 'Concatenate group values' },
  // Window functions
  { label: 'ROW_NUMBER', insert: 'ROW_NUMBER() OVER ($1)', detail: 'ROW_NUMBER() OVER (ORDER BY ...)', doc: 'Sequential row number' },
  { label: 'RANK', insert: 'RANK() OVER ($1)', detail: 'RANK() OVER (ORDER BY ...)', doc: 'Rank with gaps' },
  { label: 'DENSE_RANK', insert: 'DENSE_RANK() OVER ($1)', detail: 'DENSE_RANK() OVER (ORDER BY ...)', doc: 'Rank without gaps' },
  { label: 'LAG', insert: 'LAG($1, $2) OVER ($3)', detail: 'LAG(col, offset) OVER (...)', doc: 'Access previous row value' },
  { label: 'LEAD', insert: 'LEAD($1, $2) OVER ($3)', detail: 'LEAD(col, offset) OVER (...)', doc: 'Access next row value' },
  { label: 'NTILE', insert: 'NTILE($1) OVER ($2)', detail: 'NTILE(n) OVER (ORDER BY ...)', doc: 'Divide rows into n groups' },
  { label: 'PARTITION BY', insert: 'PARTITION BY $1 ORDER BY $2', detail: 'PARTITION BY col ORDER BY col', doc: 'Window partition', kind: 'Keyword' },
  // String functions
  { label: 'CONCAT', insert: 'CONCAT($1, $2)', detail: 'CONCAT(str1, str2)', doc: 'Concatenate strings' },
  { label: 'SUBSTRING', insert: 'SUBSTRING($1, $2, $3)', detail: 'SUBSTRING(str, pos, len)', doc: 'Extract substring' },
  { label: 'LENGTH', insert: 'LENGTH($1)', detail: 'LENGTH(str)', doc: 'String length' },
  { label: 'UPPER', insert: 'UPPER($1)', detail: 'UPPER(str)', doc: 'Convert to uppercase' },
  { label: 'LOWER', insert: 'LOWER($1)', detail: 'LOWER(str)', doc: 'Convert to lowercase' },
  { label: 'TRIM', insert: 'TRIM($1)', detail: 'TRIM(str)', doc: 'Remove leading/trailing spaces' },
  { label: 'REPLACE', insert: 'REPLACE($1, $2, $3)', detail: 'REPLACE(str, from, to)', doc: 'Replace substring' },
  // Date functions
  { label: 'NOW', insert: 'NOW()', detail: 'NOW()', doc: 'Current date and time' },
  { label: 'DATE', insert: 'DATE($1)', detail: 'DATE(expr)', doc: 'Extract date part' },
  { label: 'DATEDIFF', insert: 'DATEDIFF($1, $2)', detail: 'DATEDIFF(date1, date2)', doc: 'Difference between dates' },
  // Numeric functions
  { label: 'ABS', insert: 'ABS($1)', detail: 'ABS(x)', doc: 'Absolute value' },
  { label: 'ROUND', insert: 'ROUND($1, $2)', detail: 'ROUND(x, decimals)', doc: 'Round to decimals' },
  { label: 'CEIL', insert: 'CEIL($1)', detail: 'CEIL(x)', doc: 'Round up' },
  { label: 'FLOOR', insert: 'FLOOR($1)', detail: 'FLOOR(x)', doc: 'Round down' },
  { label: 'MOD', insert: 'MOD($1, $2)', detail: 'MOD(x, y)', doc: 'Modulo' },
  { label: 'POWER', insert: 'POWER($1, $2)', detail: 'POWER(x, y)', doc: 'x raised to power y' },
  // NULL handling
  { label: 'IFNULL', insert: 'IFNULL($1, $2)', detail: 'IFNULL(expr, alt)', doc: 'Return alt if expr is NULL' },
  { label: 'NULLIF', insert: 'NULLIF($1, $2)', detail: 'NULLIF(expr1, expr2)', doc: 'Return NULL if expr1 = expr2' },
];

// Helper to build Monaco CompletionItem
function makeItem(monaco, entry, defaultKind) {
  const kindMap = {
    Function: monaco.languages.CompletionItemKind.Function,
    Module: monaco.languages.CompletionItemKind.Module,
    Class: monaco.languages.CompletionItemKind.Class,
    Keyword: monaco.languages.CompletionItemKind.Keyword,
    Snippet: monaco.languages.CompletionItemKind.Snippet,
    Variable: monaco.languages.CompletionItemKind.Variable,
    Property: monaco.languages.CompletionItemKind.Property,
  };
  const kind = kindMap[entry.kind] || defaultKind || monaco.languages.CompletionItemKind.Function;
  return {
    label: entry.label,
    kind,
    insertText: entry.insert,
    insertTextRules: entry.insert.includes('$') ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    detail: entry.detail,
    documentation: entry.doc,
  };
}

function buildItems(monaco, entries, defaultKind) {
  return entries.map(e => makeItem(monaco, e, defaultKind));
}

export function registerCompletions(monaco) {
  // Python: context-aware for module.member completions
  monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const lineContent = model.getLineContent(position.lineNumber);
      const textBeforeCursor = lineContent.substring(0, position.column - 1);

      // Check if user typed "module."
      const dotMatch = textBeforeCursor.match(/(\w+)\.$/);
      if (dotMatch) {
        const moduleName = dotMatch[1];
        const members = pythonModules[moduleName];
        if (members) {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return { suggestions: members.map(e => ({ ...makeItem(monaco, e), range })) };
        }
      }

      // Top-level: builtins + module names
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions = [
        ...buildItems(monaco, pythonBuiltins),
        ...buildItems(monaco, pythonModuleNames, monaco.languages.CompletionItemKind.Module),
      ].map(s => ({ ...s, range }));
      return { suggestions };
    },
  });

  // JavaScript & TypeScript: shared completions with dot-triggered namespace members
  const jsItems = [];
  const jsDotMap = {}; // namespace -> member items

  for (const [namespace, entries] of Object.entries(jsCompletions)) {
    for (const entry of entries) {
      jsItems.push(entry);
      // If label starts with "Namespace.", index it for dot triggering
      if (entry.label.startsWith(namespace + '.')) {
        if (!jsDotMap[namespace]) jsDotMap[namespace] = [];
        jsDotMap[namespace].push({
          ...entry,
          label: entry.label.slice(namespace.length + 1), // remove "Math." prefix for dot context
        });
      }
    }
  }

  const jsProvider = {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const lineContent = model.getLineContent(position.lineNumber);
      const textBeforeCursor = lineContent.substring(0, position.column - 1);

      const dotMatch = textBeforeCursor.match(/(\w+)\.$/);
      if (dotMatch) {
        const ns = dotMatch[1];
        if (jsDotMap[ns]) {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return {
            suggestions: jsDotMap[ns].map(e => ({
              ...makeItem(monaco, e),
              range,
              // Insert just the member name since namespace. is already typed
              insertText: e.insert,
            })),
          };
        }
      }

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return { suggestions: buildItems(monaco, jsItems).map(s => ({ ...s, range })) };
    },
  };

  monaco.languages.registerCompletionItemProvider('javascript', jsProvider);

  // TypeScript: JS completions + TypeScript-specific utility types
  const tsProvider = {
    triggerCharacters: ['.', '<'],
    provideCompletionItems(model, position) {
      const lineContent = model.getLineContent(position.lineNumber);
      const textBeforeCursor = lineContent.substring(0, position.column - 1);

      const dotMatch = textBeforeCursor.match(/(\w+)\.$/);
      if (dotMatch) {
        const ns = dotMatch[1];
        if (jsDotMap[ns]) {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return {
            suggestions: jsDotMap[ns].map(e => ({
              ...makeItem(monaco, e),
              range,
              insertText: e.insert,
            })),
          };
        }
      }

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      // Include both JS completions and TypeScript-specific completions
      const allItems = [...jsItems, ...typescriptCompletions];
      return { suggestions: buildItems(monaco, allItems).map(s => ({ ...s, range })) };
    },
  };
  monaco.languages.registerCompletionItemProvider('typescript', tsProvider);

  // Java
  monaco.languages.registerCompletionItemProvider('java', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return { suggestions: buildItems(monaco, javaCompletions).map(s => ({ ...s, range })) };
    },
  });

  // C++
  monaco.languages.registerCompletionItemProvider('cpp', {
    triggerCharacters: [':', '<'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return { suggestions: buildItems(monaco, cppCompletions).map(s => ({ ...s, range })) };
    },
  });

  // C
  monaco.languages.registerCompletionItemProvider('c', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return { suggestions: buildItems(monaco, cCompletions).map(s => ({ ...s, range })) };
    },
  });

  // Go
  monaco.languages.registerCompletionItemProvider('go', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return { suggestions: buildItems(monaco, goCompletions).map(s => ({ ...s, range })) };
    },
  });

  // Rust
  monaco.languages.registerCompletionItemProvider('rust', {
    triggerCharacters: ['.', ':'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return { suggestions: buildItems(monaco, rustCompletions).map(s => ({ ...s, range })) };
    },
  });

  // C#
  monaco.languages.registerCompletionItemProvider('csharp', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return { suggestions: buildItems(monaco, csharpCompletions).map(s => ({ ...s, range })) };
    },
  });

  // SQL
  monaco.languages.registerCompletionItemProvider('sql', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return { suggestions: buildItems(monaco, sqlCompletions, monaco.languages.CompletionItemKind.Keyword).map(s => ({ ...s, range })) };
    },
  });
}
