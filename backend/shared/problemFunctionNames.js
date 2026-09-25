const FUNCTION_NAME_OVERRIDES = {
  'palindrome-number': { js: 'isPalindrome', py: 'is_palindrome' },
  'valid-parentheses': { js: 'isValid', py: 'is_valid' },
  'reverse-integer': { js: 'reverse', py: 'reverse' },
  'merge-sorted-arrays': { js: 'merge', py: 'merge' },
  'maximum-subarray': { js: 'maxSubArray', py: 'max_sub_array' },
  'best-time-stock': { js: 'maxProfit', py: 'max_profit' },
  'valid-anagram': { js: 'isAnagram', py: 'is_anagram' },
  'climbing-stairs': { js: 'climbStairs', py: 'climb_stairs' },
  'first-unique-character': { js: 'firstUniqChar', py: 'first_uniq_char' },
  'linked-list-cycle': { js: 'hasCycle', py: 'has_cycle' },
  'linked-list-cycle-detect': { js: 'hasCycle', py: 'has_cycle' },
  'valid-palindrome': { js: 'isPalindrome', py: 'is_palindrome' },
  'binary-search': { js: 'search', py: 'search' },
  'product-array-except-self': { js: 'productExceptSelf', py: 'product_except_self' },
  'longest-substring': { js: 'lengthOfLongestSubstring', py: 'length_of_longest_substring' },
  'merge-two-sorted-lists': { js: 'mergeTwoLists', py: 'merge_two_lists' },
  'remove-duplicates-sorted-array': { js: 'removeDuplicates', py: 'remove_duplicates' },
  'sqrt-x': { js: 'mySqrt', py: 'my_sqrt' },
  'roman-to-integer': { js: 'romanToInt', py: 'roman_to_int' },
  'search-insert-position': { js: 'searchInsert', py: 'search_insert' },
  'fizz-buzz': { js: 'fizzBuzz', py: 'fizz_buzz' },
  'contains-duplicate': { js: 'containsDuplicate', py: 'contains_duplicate' },
  'missing-number': { js: 'missingNumber', py: 'missing_number' },
  'single-number': { js: 'singleNumber', py: 'single_number' },
  'move-zeroes': { js: 'moveZeroes', py: 'move_zeroes' },
  'reverse-string': { js: 'reverseString', py: 'reverse_string' },
  'longest-common-prefix': { js: 'longestCommonPrefix', py: 'longest_common_prefix' },
  'remove-element': { js: 'removeElement', py: 'remove_element' },
  'length-of-last-word': { js: 'lengthOfLastWord', py: 'length_of_last_word' },
  'add-binary': { js: 'addBinary', py: 'add_binary' },
  'plus-one': { js: 'plusOne', py: 'plus_one' },
  'kth-largest-element-in-stream': { js: 'kthLargest', py: 'kth_largest' },
  'logger-rate-limiter': { js: 'shouldPrintMessages', py: 'should_print_messages' },
  'moving-average-from-data-stream': { js: 'movingAverage', py: 'moving_average' },
  'range-sum-query-immutable': { js: 'sumRange', py: 'sum_range' },
  'design-hashmap': { js: 'myHashMap', py: 'my_hash_map' },
};

function toCamelCase(str) {
  let result = str.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
  if (/^\d/.test(result)) result = `_${result}`;
  return result;
}

function toSnakeCase(str) {
  let result = str.replace(/-/g, '_');
  if (/^\d/.test(result)) result = `_${result}`;
  return result;
}

function toPascalCase(str) {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function problemIdToFunctionName(problemId) {
  const camelCase = toCamelCase(problemId);
  const snakeCase = toSnakeCase(problemId);
  const pascalCase = camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
  return { camelCase, snakeCase, pascalCase };
}

function getFunctionNames(problemId) {
  const override = FUNCTION_NAME_OVERRIDES[problemId];
  if (override) {
    const camelCase = override.js;
    const snakeCase = override.py;
    const pascalCase = camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
    return { camelCase, snakeCase, pascalCase };
  }

  return problemIdToFunctionName(problemId);
}

function getFunctionName(problemId, language) {
  const { camelCase, snakeCase, pascalCase } = getFunctionNames(problemId);

  if (
    language === 'python' ||
    language === 'rust' ||
    language === 'c' ||
    language === 'ruby' ||
    language === 'php'
  ) {
    // Backend wrappers call Ruby/PHP by the snake_case name (config.pyFunc
    // fallback), so starter code must use the same convention.
    return snakeCase;
  }

  if (language === 'go' || language === 'csharp') {
    return pascalCase;
  }

  return camelCase;
}

module.exports = {
  FUNCTION_NAME_OVERRIDES,
  toCamelCase,
  toSnakeCase,
  toPascalCase,
  problemIdToFunctionName,
  getFunctionNames,
  getFunctionName,
};
