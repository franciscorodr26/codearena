// Judge0's TypeScript image does not include Node type declarations. DOM supplies
// console (used by every wrapper); ESNext supplies Map, Set, and modern methods.
const COMPILER_OPTIONS = {
  cpp: '-std=c++17',
  typescript: '--target ESNext --lib ESNext,DOM'
}

module.exports = { COMPILER_OPTIONS }
